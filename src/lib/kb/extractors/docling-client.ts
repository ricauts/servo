// The Docling client (dcl-03): hand-written fetch against docling-serve's
// public HTTP surface — POST /v1/convert/file/async, GET
// /v1/status/poll/{task_id}, GET /v1/result/{task_id}, best-effort DELETE
// /v1/result/{task_id}, version from GET /openapi.json -> info.version.
//
// NO npm dependency: docling-ts self-describes as an unstable draft and
// its published package id is UNVERIFIED; we consume about ten fields and
// the format is used FORMAT-ONLY, exactly like SKILL.md in spec §6.4.
//
// The source-by-URL conversion endpoint is NEVER called — it would make
// the SIDECAR the fetcher, which is the egress path dcl-06 closes. A test
// greps the source tree for that endpoint's path and fails on any
// occurrence, so it is not even written here in a comment.
//
// LANE 1: nothing here executes without configuration. The extractor
// registry does not import this module; dcl-07's live lane does.
//
// UNVERIFIED, said here rather than discovered later: a dedicated version
// endpoint does not exist in every docling-serve build — openapi.json's
// info.version is the documented place; on failure the recorded version is
// the literal "docling-serve@unknown", never a guess. Whether DELETE
// /v1/result exists is likewise UNVERIFIED: 404 and 405 are treated as
// success because an idempotent cleanup that the server does not support
// must not fail a conversion that already succeeded.

import {
  DoclingError,
  DoclingTaskStatus,
  parseCappedDocument,
  readCappedBody,
  type DoclingDocumentT,
  DOCLING_MAX_BYTES,
} from "./docling-schema";

/** The transport seam: tests inject FixtureTransport or stubs; production
 *  uses HttpTransport. No test ever opens a socket. */
export interface DoclingTransport {
  /** Send one HTTP request and return the Response. */
  request(url: string, init: RequestInit): Promise<Response>;
}

export class HttpTransport implements DoclingTransport {
  async request(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

/** Serves canned Responses from fixture files — the test lane. */
export class FixtureTransport implements DoclingTransport {
  constructor(private readonly route: (url: string, init: RequestInit) => Promise<Response>) {}
  request(url: string, init: RequestInit): Promise<Response> {
    return this.route(url, init);
  }
}

export interface DoclingClientOptions {
  baseUrl: string;
  /** Bearer key; sent only when non-empty, never logged, never echoed. */
  apiKey?: string;
  transport?: DoclingTransport;
  /** Poll deadline for one conversion. */
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface DoclingConversion {
  document: DoclingDocumentT;
  /** The recorded server version — "docling-serve@unknown" on failure. */
  serverVersion: string;
  bytes: number;
}

const UNKNOWN_VERSION = "docling-serve@unknown";

export class DoclingClient {
  private versionCache: string | null = null;
  private readonly transport: DoclingTransport;

  constructor(private readonly opts: DoclingClientOptions) {
    this.transport = opts.transport ?? new HttpTransport();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json", ...extra };
    // The key is attached here and nowhere else — no log line, no error
    // message, no echo into model context ever sees it.
    if (this.opts.apiKey) h.authorization = `Bearer ${this.opts.apiKey}`;
    return h;
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
  }

  /** GET /openapi.json -> info.version, cached per process of this client.
   *  Never a guess: failures yield the literal "docling-serve@unknown". */
  async serverVersion(): Promise<string> {
    if (this.versionCache !== null) return this.versionCache;
    try {
      const res = await this.transport.request(this.url("/openapi.json"), {
        headers: this.headers(),
        signal: this.opts.signal,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = JSON.parse(await res.text()) as { info?: { version?: string } };
      const v = body.info?.version;
      this.versionCache = typeof v === "string" && v ? `docling-serve@${v}` : UNKNOWN_VERSION;
    } catch {
      this.versionCache = UNKNOWN_VERSION;
    }
    return this.versionCache;
  }

  /**
   * Convert one file: submit asynchronously, poll to completion, fetch the
   * capped result, and clean up best-effort. The source-by-URL endpoint
   * is not a path this client can even express.
   */
  async convertFile(
    filename: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<DoclingConversion> {
    const deadlineMs = this.opts.deadlineMs ?? 300_000;
    const deadlineAt = Date.now() + deadlineMs;
    const form = new FormData();
    form.append("files", new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType }), filename);

    const submit = await this.transport.request(this.url("/v1/convert/file/async"), {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: this.opts.signal,
    });
    if (!submit.ok) {
      throw new DoclingError("docling-task-failed", `submit failed with status ${submit.status}`);
    }
    const { task_id: taskId } = JSON.parse(await submit.text()) as { task_id?: string };
    if (!taskId) {
      throw new DoclingError("docling-task-failed", "submit returned no task_id");
    }

    // Poll to completion under the deadline.
    for (;;) {
      if (Date.now() >= deadlineAt || this.opts.signal?.aborted) {
        await this.abandon(taskId);
        throw new DoclingError(
          "docling-task-abandoned",
          `poll deadline of ${deadlineMs} ms passed before the task completed`,
        );
      }
      const statusRes = await this.transport.request(this.url(`/v1/status/poll/${taskId}`), {
        headers: this.headers(),
        signal: this.opts.signal,
      });
      if (!statusRes.ok) {
        throw new DoclingError("docling-task-failed", `status poll failed with ${statusRes.status}`);
      }
      const status = DoclingTaskStatus.safeParse(JSON.parse(await statusRes.text()));
      if (!status.success) {
        throw new DoclingError("docling-bad-schema", "status payload did not match the poll shape");
      }
      if (status.data.task_status === "success") break;
      if (status.data.task_status === "failure") {
        await this.abandon(taskId);
        throw new DoclingError(
          "docling-task-failed",
          status.data.message ?? "the sidecar reported task failure",
        );
      }
      await sleep(250);
    }

    // Fetch the result under the response caps, then clean up.
    const resultRes = await this.transport.request(this.url(`/v1/result/${taskId}`), {
      headers: this.headers(),
      signal: this.opts.signal,
    });
    if (!resultRes.ok) {
      throw new DoclingError("docling-task-failed", `result fetch failed with ${resultRes.status}`);
    }
    let body: Buffer;
    try {
      body = await readCappedBody(resultRes, { abort: this.opts.signal ?? new AbortController().signal });
    } finally {
      await this.abandon(taskId);
    }
    const document = parseCappedDocument(body);
    return { document, serverVersion: await this.serverVersion(), bytes: body.byteLength };
  }

  /** Best-effort DELETE; 404/405 are success (the endpoint existing at all
   *  is UNVERIFIED). An unconfirmed abandonment is still reported as the
   *  reason string docling-task-abandoned by the CALLER that hit the
   *  deadline — this method never throws. */
  private async abandon(taskId: string): Promise<void> {
    try {
      const res = await this.transport.request(this.url(`/v1/result/${taskId}`), {
        method: "DELETE",
        headers: this.headers(),
        signal: this.opts.signal,
      });
      void res.status; // 404/405 and everything else: cleanup is best-effort
    } catch {
      /* an unconfirmed abandonment yields the reason docling-task-abandoned */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { DOCLING_MAX_BYTES, UNKNOWN_VERSION };
