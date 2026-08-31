// External data sources — the validation layer (spec xds-01), canonized in
// docs/design/external-sources.md.
//
// Three things live here and nothing else does: the guard that refuses a
// source pointed at Servo's own database, the config validator that keeps
// credentials out of `configJson`, and the scope-allowlist validator that
// mirrors migration 0012's JSONB CHECK. Crawling is xds-03/xds-04; the
// source ceiling in the entitlement CTE is xds-02.
//
// The catalog is the real enforcement point for the vocabularies and the
// allowlist — every scope rule below is also a CHECK constraint, so a row
// written by a seed, a migration or a psql session is exactly as constrained
// as one written by a route. This module exists to turn those refusals into
// messages a human can act on, and to add the per-key TYPE and FORMAT rules
// a CHECK cannot express.

import net from "node:net";
import dns from "node:dns/promises";

/** A DataSource's non-secret configuration. Credentials never appear here. */
export type SourceKind = "S3" | "POSTGRES";

interface ConfigSpec {
  type: "string" | "number" | "boolean";
  /** Returns a human-readable reason to refuse, or null when the value is fine. */
  check?: (value: never) => string | null;
}

/**
 * The keys `configJson` may carry, per kind, WITH THEIR TYPES AND FORMATS.
 *
 * The types are not decoration. A name-only allowlist lets a credential ride
 * inside an ALLOWED key — `ssl: {"password": "…"}` or
 * `endpoint: "http://AKIA:secret@minio:9000"` are both credentials in
 * `configJson`, and both would be echoed back by every read route. Pinning
 * each key to a primitive kills the nested case outright, and the format
 * checks kill the userinfo/connection-string case.
 */
const CONFIG_SPEC: Record<SourceKind, Record<string, ConfigSpec>> = {
  S3: {
    endpoint: { type: "string", check: checkEndpoint },
    region: {
      type: "string",
      check: (v: string) =>
        /^[A-Za-z0-9-]{1,32}$/.test(v) ? null : "must be a plain region name such as us-east-1",
    },
    forcePathStyle: { type: "boolean" },
  },
  POSTGRES: {
    host: { type: "string", check: checkHost },
    port: {
      type: "number",
      check: (v: number) =>
        Number.isInteger(v) && v >= 1 && v <= 65535 ? null : "must be a port number between 1 and 65535",
    },
    database: { type: "string", check: checkDatabaseName },
    ssl: { type: "boolean" },
  },
};

/** The keys a scope entry may carry, per kind. */
const SCOPE_KEYS: Record<SourceKind, readonly string[]> = {
  S3: ["bucket", "prefix", "suffixes"],
  POSTGRES: ["schema", "table", "idColumn", "textColumns", "titleColumn", "updatedAtColumn"],
};

/**
 * Substrings that make a config key a credential. Checked BEFORE the
 * allowlist so the message says "this is a credential" rather than "unknown
 * key" — the difference between an admin moving the value to the sealed
 * store and an admin renaming it until it is accepted.
 */
const CREDENTIAL_HINTS = [
  "password",
  "passwd",
  "secret",
  "credential",
  "token",
  "accesskey",
  "apikey",
  "privatekey",
  "session",
  "auth",
];

export class SourceValidationError extends Error {}

function fail(message: string): never {
  throw new SourceValidationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSourceKind(value: unknown): value is SourceKind {
  return value === "S3" || value === "POSTGRES";
}

/** The Setting key a source's sealed credential lives under. Never the
 *  credential itself — `secretRef` is a pointer, and that is the whole
 *  point of the column.
 *
 *  NOTE for whoever reads the credential (xds-03/xds-04): this key is
 *  DYNAMIC, so it can never appear in `SENSITIVE_SETTING_KEYS`, and
 *  src/lib/db.ts's auto-seal/auto-open middleware therefore does not cover
 *  it. The write side calls `seal()` explicitly; the read side must call
 *  `open()` explicitly. */
export function secretRefFor(sourceId: string): string {
  return `datasource.${sourceId}.secret`;
}

/** An endpoint URL may not carry credentials, and may not be a scheme that
 *  smuggles one (a connection string, a file path). */
function checkEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an http(s) URL, e.g. https://s3.eu-central-1.amazonaws.com";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "must be an http(s) URL";
  if (url.username !== "" || url.password !== "") {
    return "must not embed a username or password — the credential belongs in the sealed store, not in configJson";
  }
  return null;
}

/** A host is a plain hostname or an IP literal. Anything carrying `@`, `/`,
 *  `?` or whitespace is a connection string wearing a hostname's name. */
function checkHost(value: string): string | null {
  const bare = value.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) !== 0) return null;
  return /^[A-Za-z0-9]([A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/.test(bare)
    ? null
    : "must be a plain hostname or IP address";
}

/** A database name, not a URL and not a connection string. */
function checkDatabaseName(value: string): string | null {
  if (value.length > 63) return "must be at most 63 characters";
  return /^[A-Za-z0-9_$][A-Za-z0-9_$.-]*$/.test(value)
    ? null
    : "must be a plain database name — a connection URL belongs in no field at all";
}

/**
 * Refuse a `configJson` that carries a credential, a key this kind does not
 * define, or a value of the wrong type or shape. Returns the config unchanged
 * when it is clean, so callers can write the result rather than the input.
 */
export function validateSourceConfig(kind: SourceKind, config: unknown): Record<string, unknown> {
  if (!isPlainObject(config)) fail("configJson must be an object.");
  const spec = CONFIG_SPEC[kind];
  for (const [key, value] of Object.entries(config)) {
    const flat = key.toLowerCase().replace(/[^a-z]/g, "");
    const hint = CREDENTIAL_HINTS.find((h) => flat.includes(h));
    if (hint) {
      fail(
        `configJson may not carry credentials: remove "${key}". ` +
          `A source's credential is sealed into its own Setting row (secretRef) and is never stored ` +
          `in, or returned with, the configuration.`,
      );
    }
    const rule = spec[key];
    if (!rule) {
      fail(
        `configJson for a ${kind} source may not carry "${key}". ` +
          `Allowed keys: ${Object.keys(spec).join(", ")}.`,
      );
    }
    // The type gate comes before the format gate: it is what makes a nested
    // object impossible, and a nested object is how a credential rides inside
    // an allowed key name.
    if (typeof value !== rule.type) {
      fail(`configJson: "${key}" must be a ${rule.type}, and may not be an object or a list.`);
    }
    const reason = rule.check?.(value as never);
    if (reason) fail(`configJson: "${key}" ${reason}.`);
  }
  return config;
}

/**
 * The scope allowlist: a list of objects, never a wildcard, never a
 * free-text predicate. An EMPTY list is legal and reaches nothing — the safe
 * default, not an error. This mirrors migration 0012's
 * `DataSource_scope_allowlist` CHECK exactly: the same three refusals
 * (non-object entry, a `where`-shaped key at any depth and in any case, an
 * asterisk in any string at any depth) hold on both sides, so neither the
 * route nor the catalog is the looser one. The per-kind shape below is the
 * part only the route can express.
 */
export function validateSourceScope(kind: SourceKind, scope: unknown): Record<string, unknown>[] {
  if (!Array.isArray(scope)) fail("scopeJson must be an array of scope entries.");
  const out: Record<string, unknown>[] = [];
  for (const [i, raw] of scope.entries()) {
    const at = `scope entry ${i + 1}`;
    if (!isPlainObject(raw)) fail(`${at} must be an object.`);
    const entry = raw;
    // The two catalog rules, applied at every depth exactly as the CHECK
    // applies them.
    walkScope(entry, (key, value) => {
      if (key !== null && /^\s*where\s*$/i.test(key)) {
        fail(
          `${at} may not carry a "${key}" clause. There is no free-text predicate: ` +
            `create a view upstream and name the view instead.`,
        );
      }
      if (typeof value === "string" && value.includes("*")) {
        fail(`${at} may not use a wildcard${key ? ` in "${key}"` : ""}. Name each bucket, schema and table explicitly.`);
      }
    });
    for (const key of Object.keys(entry)) {
      if (!SCOPE_KEYS[kind].includes(key)) {
        fail(`${at} may not carry "${key}". Allowed keys: ${SCOPE_KEYS[kind].join(", ")}.`);
      }
    }
    if (kind === "S3") {
      if (typeof entry.bucket !== "string" || entry.bucket.trim() === "") fail(`${at} needs a bucket.`);
      if ("prefix" in entry && typeof entry.prefix !== "string") fail(`${at}: prefix must be a string.`);
      if (
        "suffixes" in entry &&
        (!Array.isArray(entry.suffixes) || entry.suffixes.some((s) => typeof s !== "string"))
      ) {
        fail(`${at}: suffixes must be a list of strings.`);
      }
    } else {
      for (const key of ["schema", "table", "idColumn"] as const) {
        if (typeof entry[key] !== "string" || (entry[key] as string).trim() === "") fail(`${at} needs a ${key}.`);
      }
      if (
        !Array.isArray(entry.textColumns) ||
        entry.textColumns.length === 0 ||
        entry.textColumns.some((c) => typeof c !== "string")
      ) {
        fail(`${at} needs textColumns: a non-empty list of column names.`);
      }
    }
    out.push(entry);
  }
  return out;
}

/** Visit every key and every scalar in a scope entry, at any depth — the
 *  jsonpath `$.**` the CHECK uses, written in TypeScript. */
function walkScope(node: unknown, visit: (key: string | null, value: unknown) => void, key: string | null = null): void {
  visit(key, node);
  if (Array.isArray(node)) {
    for (const item of node) walkScope(item, visit, key);
  } else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) walkScope(v, visit, k);
  }
}

/** A Postgres endpoint, already split into its parts. */
export interface PostgresTarget {
  host: string;
  port: number;
  database: string;
}

/**
 * Split a Postgres connection URL into host/port/database WITHOUT comparing
 * strings anywhere. libpq spellings the URL path does not carry are honoured:
 * `?host=` overrides the authority (that is how a socket directory is named),
 * `?port=` / `?dbname=` fill in for an omitted authority port or path, and an
 * omitted database falls back to the USER NAME, which is what libpq does.
 *
 * Returns null — which every caller treats as "refuse, do not guess" — for a
 * URL whose credentials are not percent-encoded, because an unencoded `/` in
 * a password makes the authority genuinely ambiguous and a wrong split would
 * silently compare against the wrong endpoint.
 */
export function parsePostgresUrl(url: string): PostgresTarget | null {
  const raw = url.trim();
  if (!/^postgres(ql)?:\/\//i.test(raw)) return null;

  // Ambiguity check first: an `@` after the path separator means the userinfo
  // contained an unencoded `/`.
  const rest = raw.replace(/^postgres(ql)?:\/\//i, "");
  const queryAt = rest.indexOf("?");
  const beforeQuery = queryAt >= 0 ? rest.slice(0, queryAt) : rest;
  const slashAt = beforeQuery.indexOf("/");
  if (slashAt >= 0 && beforeQuery.slice(slashAt).includes("@")) return null;

  let host = "";
  let portText = "";
  let path = "";
  let user = "";
  let params: URLSearchParams;
  try {
    const parsed = new URL(raw);
    host = parsed.hostname;
    portText = parsed.port;
    path = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    user = decodeURIComponent(parsed.username);
    params = parsed.searchParams;
  } catch {
    // `new URL` refuses an empty authority, which is exactly the shape a
    // unix-socket URL takes: postgresql://user:pw@/db?host=/var/run/postgresql
    const m = /^postgres(?:ql)?:\/\/([^/?#]*)(?:\/([^?#]*))?(?:\?([^#]*))?/i.exec(raw);
    if (!m) return null;
    const authority = m[1] ?? "";
    const at = authority.lastIndexOf("@");
    user = decodeURIComponent((at >= 0 ? authority.slice(0, at) : "").split(":")[0] ?? "");
    const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
    const hp = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(hostPort);
    host = hp?.[1] ?? "";
    portText = hp?.[2] ?? "";
    path = decodeURIComponent(m[2] ?? "");
    params = new URLSearchParams(m[3] ?? "");
  }

  const hostParam = params.get("host");
  const resolvedHost = (hostParam ?? host).replace(/^\[|\]$/g, "").trim();
  const port = Number(portText || params.get("port") || 5432);
  const database = path || params.get("dbname") || user;
  if (resolvedHost === "" || database === "" || !Number.isFinite(port)) return null;
  return { host: resolvedHost, port, database };
}

/**
 * One IP address, reduced to a token two spellings of the same endpoint
 * share. This is the whole guard: `localhost`, `127.0.0.1`, `127.1`,
 * `0x7f000001`, `::1`, `0:0:0:0:0:0:0:1`, `::ffff:127.0.0.1` and `0.0.0.0`
 * are eight spellings of one destination, and every one of them reaches the
 * desk's database when the desk is on this host.
 *
 * `0.0.0.0` and `::` are the unspecified addresses: as a CONNECT target the
 * kernel routes them to loopback, so they collapse to the same token rather
 * than being treated as a distinct host.
 */
export function addressToken(raw: string): string {
  const bare = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(bare)) return ipv4Token(bare);
  if (net.isIPv6(bare)) {
    const groups = expandIPv6(bare);
    if (groups.every((g) => g === 0)) return "loopback"; // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback"; // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: unwrap to the v4 form
    // so ::ffff:127.0.0.1 and 127.0.0.1 are one token.
    if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
      const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
      return ipv4Token(v4);
    }
    return groups.map((g) => g.toString(16)).join(":");
  }
  return bare;
}

function ipv4Token(address: string): string {
  if (address.startsWith("127.") || address === "0.0.0.0") return "loopback";
  return address;
}

/** Expand any IPv6 spelling to its eight 16-bit groups. */
function expandIPv6(address: string): number[] {
  let text = address;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = tail[1].split(".").map(Number);
    text =
      text.slice(0, text.length - tail[1].length) +
      (((octets[0] << 8) | octets[1]) >>> 0).toString(16) +
      ":" +
      (((octets[2] << 8) | octets[3]) >>> 0).toString(16);
  }
  let parts: string[];
  if (text.includes("::")) {
    const [head, rest] = text.split("::");
    const left = head ? head.split(":").filter((p) => p !== "") : [];
    const right = rest ? rest.split(":").filter((p) => p !== "") : [];
    parts = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  } else {
    parts = text.split(":");
  }
  return parts.slice(0, 8).map((p) => parseInt(p || "0", 16) || 0);
}

/** The tokens a host resolves to, or null when it does not resolve. An IP
 *  literal resolves to itself, which is what makes `localhost`, `127.0.0.1`
 *  and a container name one target rather than three. */
async function resolveTokens(host: string): Promise<Set<string> | null> {
  const bare = host.replace(/^\[|\]$/g, "").trim();
  if (net.isIP(bare) !== 0) return new Set([addressToken(bare)]);
  try {
    const records = await dns.lookup(bare, { all: true, verbatim: true });
    const set = new Set(records.map((r) => addressToken(r.address)));
    return set.size > 0 ? set : null;
  } catch {
    return null;
  }
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/** The three URLs a DataSource must never be. Unset ones are skipped: there
 *  is nothing to protect behind an env var that does not exist. */
function ownDatabaseUrls(): { label: string; url: string }[] {
  return (["DATABASE_URL", "OPS_DATABASE_URL", "OPS_DATABASE_READONLY_URL"] as const)
    .map((label) => ({ label, url: process.env[label] ?? "" }))
    .filter((e) => e.url.trim() !== "");
}

/** Every Postgres endpoint a config could reach, however it is spelled.
 *  Reading only the literal keys `host`/`database` would make the guard a
 *  SILENT no-op for `{Host, DATABASE}` or `{connectionString: "postgres://…"}`
 *  — and a guard whose failure mode is acceptance is not a guard. */
function candidateTargets(config: unknown): PostgresTarget[] {
  if (!isPlainObject(config)) return [];
  const out: PostgresTarget[] = [];
  for (const value of Object.values(config)) {
    if (typeof value !== "string") continue;
    const embedded = parsePostgresUrl(value);
    if (embedded) out.push(embedded);
  }
  const lower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(config)) lower.set(key.toLowerCase(), value);
  const pick = (names: string[]): string | null => {
    for (const name of names) {
      const value = lower.get(name);
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };
  const database = pick(["database", "dbname", "db", "databasename"]);
  if (database !== null) {
    const portValue = lower.get("port");
    const port = Number(typeof portValue === "string" ? portValue.trim() : (portValue ?? 5432));
    out.push({
      // libpq's own default: no host means the local server.
      host: (pick(["host", "hostname", "server", "address", "addr"]) ?? "localhost").replace(/^\[|\]$/g, ""),
      port: Number.isFinite(port) ? port : 5432,
      database,
    });
  }
  return out;
}

/** Echo a host back to the caller only when it is a plain, safe token. */
function safeHost(host: string): string {
  return /^[A-Za-z0-9._:[\]-]{1,255}$/.test(host) ? `"${host}"` : "the configured host";
}

/**
 * THE GUARD THAT MATTERS MOST: a DataSource may never point at Servo's own
 * database. One such row is a path around every entitlement CTE in the
 * knowledge base, and it is one row an admin could create by accident.
 *
 * The comparison is on RESOLVED HOST ADDRESSES, reduced to canonical tokens,
 * and on the PARSED DATABASE NAME (plus the port, which is what makes a
 * second server on the same host a different target). It is NEVER a
 * URL-string comparison, and it is never a comparison of address STRINGS
 * either: `127.0.0.1`, `::1`, `::ffff:127.0.0.1` and `0.0.0.0` are one
 * destination spelled four ways, and a set-of-strings intersection passes
 * three of them.
 *
 * Fail-closed in every direction that matters:
 *  - a candidate host that does not resolve is REFUSED, because an
 *    unresolvable host cannot be proven not to be the desk;
 *  - a `DATABASE_URL` that is set but unparseable is REFUSED, for the same
 *    reason from the other side;
 *  - a config that names a database under ANY spelling, or embeds a
 *    connection URL in any string value, is checked — the guard never
 *    returns silently because it did not recognise a key.
 * When only the ENV side fails to resolve (a hostname reachable from the
 * database container but not from this process), the pair falls back to a
 * case-insensitive HOSTNAME comparison — still not a URL-string compare,
 * and still able to catch the obvious spelling.
 *
 * This is the pre-connection sibling of the catalog probe in
 * src/lib/opsdb.ts: that one asks a database it already reached whether it
 * carries the desk's tables; this one refuses before a socket is opened.
 * Both exist; neither replaces the other.
 */
export async function assertNotServoDatabase(config: unknown): Promise<void> {
  const targets = candidateTargets(config);
  // Nothing to compare: an S3 config names no database. The S3 endpoint is
  // constrained by kb.sources.egress.allowlist instead (xds-03).
  if (targets.length === 0) return;

  const own = ownDatabaseUrls().map(({ label, url }) => {
    const parsed = parsePostgresUrl(url);
    if (!parsed) {
      fail(
        `Refusing the source: ${label} is set but is not a connection URL this server can parse, ` +
          `so a source cannot be proven not to point at it. Percent-encode any credentials in it.`,
      );
    }
    return { label, target: parsed };
  });
  if (own.length === 0) return;

  for (const target of targets) {
    const candidate = await resolveTokens(target.host);
    if (!candidate) {
      fail(
        `Refusing the source: its host ${safeHost(target.host)} does not resolve, so it cannot be checked ` +
          `against Servo's own database. Name a host this server can resolve.`,
      );
    }
    for (const { label, target: mine } of own) {
      if (mine.port !== target.port) continue;
      if (mine.database !== target.database) continue;
      const ownTokens = await resolveTokens(mine.host);
      const sameHost = ownTokens
        ? intersects(candidate, ownTokens)
        : mine.host.toLowerCase() === target.host.toLowerCase();
      if (sameHost) {
        fail(
          `Refusing the source: it points at Servo's own database (${label}). ` +
            `A data source that can read the desk is a path around every knowledge-base grant. ` +
            `Point it at a separate server, or at a different database on this one.`,
        );
      }
    }
  }
}

/** What a DataSource row looks like to the outside world. `secretRef` is
 *  absent by construction — the field and the value both — so no route can
 *  leak it by forgetting to strip it. */
export interface SourceView {
  id: string;
  name: string;
  kind: string;
  mode: string;
  config: unknown;
  scope: unknown;
  status: string;
  statusError: string | null;
  lastSyncAt: Date | null;
  lastCompleteSyncAt: Date | null;
  syncEveryMin: number;
  maxRows: number;
  hasSecret: boolean;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  mode: string;
  configJson: unknown;
  scopeJson: unknown;
  secretRef: string;
  status: string;
  statusError: string | null;
  lastSyncAt: Date | null;
  lastCompleteSyncAt: Date | null;
  syncEveryMin: number;
  maxRows: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export function sourceView(row: SourceRow, hasSecret: boolean): SourceView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.mode,
    config: row.configJson,
    scope: row.scopeJson,
    status: row.status,
    statusError: row.statusError,
    lastSyncAt: row.lastSyncAt,
    lastCompleteSyncAt: row.lastCompleteSyncAt,
    syncEveryMin: row.syncEveryMin,
    maxRows: row.maxRows,
    hasSecret,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
