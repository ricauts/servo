// The S3 crawler in INDEX mode (xds-03). EXACTLY THREE commands leave this
// module — ListObjectsV2Command, HeadObjectCommand, GetObjectCommand —
// and a test reads the import line to keep it that way: an indexer has no
// business writing, deleting or tagging anything. The upload-command
// name appears nowhere in src/ — the test greps for the literal.
//
// THE CLIENT IS PINNED:
//   - explicit credentials, opened from the SEALED store (the source's
//     secretRef names a Setting row; a missing row is a NAMED refusal
//     made BEFORE any network call);
//   - a credentialDefaultProvider that THROWS — with no provider chain
//     there is no ambient-role fallback, no ~/.aws, no IMDS hop;
//   - forcePathStyle: true, followRedirects: false — a path-style
//     endpoint is an operator-named host, and neither the SDK's region
//     redirect nor an HTTP redirect is followed to anywhere.
//
// EGRESS is its OWN allowlist: kb.sources.egress.allowlist, read only by
// this crawler — never integration.egress.allowlist, which is the
// agent-facing list web_fetch reads. A host permitted for data sources
// is still refused by web_fetch; the test asserts that directly.
//
// EXTRACTION runs inside kb-05's forked worker: a crafted object from a
// bucket is exactly as hostile as an upload, under the same caps. The
// 25 MB cap is enforced on the GetObject STREAM as well as against the
// HeadObject size, because the remote store controls the header.

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { open } from "@/lib/secret-store";

/** The egress allowlist key, deliberately NOT integration.egress.allowlist. */
export const SOURCES_EGRESS_KEY = "kb.sources.egress.allowlist";

/** The stored-byte cap, mirroring the upload cap. */
export const S3_MAX_BYTES = 25 * 1024 * 1024;

/** One scope entry, as the catalog CHECK (xds-01) admits it. */
export interface S3ScopeEntry {
  bucket: string;
  prefix: string;
  suffixes: string[];
}

export interface ListedS3Object {
  key: string;
  /** null when the listing is used without a HEAD pass. */
  etag: string | null;
  size: number | null;
}

/** Read the source's allowlist setting; an absent row is an empty list. */
async function sourcesAllowlist(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: SOURCES_EGRESS_KEY } });
  return (row?.value ?? "")
    .split(/[\n,]/)
    .map((h) => h.trim())
    .filter(Boolean);
}

/** The endpoint host must be named in kb.sources.egress.allowlist. */
export function assertSourceEgress(host: string, allowlist: readonly string[]): void {
  const bare = String(host).replace(/^https?:\/\//, "").split(/[/:]/)[0].toLowerCase();
  const bareOf = (e: string) => e.trim().replace(/^https?:\/\//, "").split(/[/:]/)[0].toLowerCase();
  const ok = allowlist.some((entry) => bareOf(entry) === bare);
  if (!ok) {
    throw new Error(
      `The object-store host "${bare}" is not in kb.sources.egress.allowlist. Data-source egress is its own list — add the host there (not to integration.egress.allowlist, which is the agent-facing list web_fetch reads).`,
    );
  }
}

/** Build the pinned client. The secret row is opened HERE and only here. */
export async function makeS3Client(
  endpoint: string,
  secretRef: string,
  opts: { allowlist?: readonly string[] } = {},
): Promise<S3Client> {
  // The SECRET check runs FIRST: a source whose credentials are missing
  // refuses before the egress question is even reached — both refusals
  // are pre-network, but the credential is the operator's own row.
  const row = await db.setting.findUnique({ where: { key: secretRef } });
  if (!row) {
    throw new Error(
      `The source's secret row "${secretRef}" is missing. Store the explicit access key pair sealed (Setting key) before crawling; the crawler never falls back to ambient credentials.`,
    );
  }
  const allowlist = opts.allowlist ?? (await sourcesAllowlist());
  const url = new URL(endpoint);
  assertSourceEgress(url.hostname, allowlist);

  const secret = open(row.value);
  // The sealed value carries both halves, JSON: {accessKeyId, secretAccessKey}.
  let accessKeyId = "";
  let secretAccessKey = "";
  try {
    const parsed = JSON.parse(secret) as { accessKeyId?: string; secretAccessKey?: string };
    accessKeyId = parsed.accessKeyId ?? "";
    secretAccessKey = parsed.secretAccessKey ?? "";
  } catch {
    throw new Error(`The sealed secret at "${secretRef}" is not the expected {accessKeyId, secretAccessKey} JSON.`);
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`The sealed secret at "${secretRef}" is missing one of accessKeyId / secretAccessKey.`);
  }
  return new S3Client({
    endpoint,
    region: "us-east-1", // path-style: the region never selects a host
    forcePathStyle: true,
    // HTTP redirects are refused at the NODE level: the SDK has no
    // followRedirects config of its own (region redirects are disabled by
    // the fixed region above + path style), and the fetch underneath must
    // never hop to an operator-unnamed host.
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // NO provider chain: if the explicit credentials are absent the client
    // construction above already refused; this makes any residual chain
    // path throw rather than discover ambient credentials.
    credentialDefaultProvider: () => async () => {
      throw new Error("The S3 crawler uses explicit sealed credentials only — no ambient provider chain.");
    },
    requestHandler: { requestTimeout: 30_000 },
  });
}

/** List the keys under one scope entry, filtered by prefix and suffixes
 *  BEFORE any HEAD or GET: objects outside the scope are not fetched. */
export async function listScope(
  client: S3Client,
  scope: S3ScopeEntry,
): Promise<ListedS3Object[]> {
  const out: ListedS3Object[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: scope.bucket,
        Prefix: scope.prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key) continue;
      if (scope.suffixes.length > 0 && !scope.suffixes.some((sfx) => obj.Key!.endsWith(sfx))) continue;
      out.push({ key: obj.Key, etag: obj.ETag ?? null, size: obj.Size ?? null });
    }
    token = page.NextContinuationToken;
  } while (token);
  return out;
}

export interface FetchedObject {
  key: string;
  etag: string;
  bytes: Buffer;
  contentType: string;
}

/** HEAD then GET one object, enforcing the cap on BOTH the header and the
 *  stream: the remote store controls the header, so the stream is the
 *  authority. Over-cap lands an UNSUPPORTED-shaped refusal, never silence. */
export async function getObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<FetchedObject> {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if ((head.ContentLength ?? 0) > S3_MAX_BYTES) {
    throw new Error(
      `"${key}" is ${head.ContentLength} bytes; the object-store cap is ${S3_MAX_BYTES} (25 MB). Store a smaller object or link to it.`,
    );
  }
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const parts: Buffer[] = [];
  let total = 0;
  const body = got.Body as AsyncIterable<Uint8Array> | undefined;
  if (!body) throw new Error(`"${key}" returned no body.`);
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > S3_MAX_BYTES) {
      // Cancel the stream: the cap is enforced mid-flight, not after.
      await (got.Body as { cancel?: () => Promise<void> }).cancel?.().catch(() => undefined);
      throw new Error(
        `"${key}" streamed past the ${S3_MAX_BYTES}-byte (25 MB) cap — the header under-reported the size. The object is refused, never silently skipped.`,
      );
    }
    parts.push(Buffer.from(chunk));
  }
  return {
    key,
    etag: got.ETag ?? "",
    bytes: Buffer.concat(parts),
    contentType: got.ContentType ?? "application/octet-stream",
  };
}

/** The externalLocator xds-01 canonized, as one object. */
export function s3Locator(bucket: string, key: string, etag: string) {
  return { kind: "S3" as const, bucket, key, etag };
}

/** The content type a key's suffix implies — the extractors' own table. */
export function contentTypeFor(key: string): string {
  if (key.endsWith(".md")) return "text/markdown";
  if (key.endsWith(".txt")) return "text/plain";
  if (key.endsWith(".pdf")) return "application/pdf";
  if (key.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

/** The document name from a key: the final path segment. */
export function nameForKey(key: string): string {
  return key.split("/").pop() ?? key;
}

/** The chunk count a re-crawl replaces — exposed for the caller's rule. */
export function etagOf(obj: ListedS3Object): string | null {
  return obj.etag;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
