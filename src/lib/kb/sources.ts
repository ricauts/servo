// src/lib/kb/sources.ts — the connection layer's validators (spec xds-01),
// canonized in docs/design/external-sources.md.
//
// Nothing here is the enforcement. Every SECURITY rule below is ALSO a CHECK
// constraint in prisma/migrations/0012_datasource/migration.sql, because a row
// written by a seed, a migration or a direct write must be exactly as
// constrained as one written by a route. This module exists to refuse earlier
// and to say WHICH key was wrong, which a CHECK cannot.
// tests/kb-source-schema.test.ts runs ONE table of payloads through both
// layers and asserts they agree in both directions, so the claim is checked
// rather than asserted.
//
// TWO EXCEPTIONS, both stated so nobody reads more parity into this than
// there is:
//
//   * assertNotServoDatabase cannot live in the catalog at all: it compares
//     the candidate against the process's own DATABASE_URL, and a CHECK has no
//     way to see an environment variable. It is therefore called at SAVE and
//     again at CRAWL (xds-04) — never once.
//   * two rules here are COSMETIC and have no catalog counterpart:
//     CONFIG_VALUE_LIMIT (a 1024-character cap) and the whole-number test on
//     `port`. The catalog pins the TYPE of every key and refuses every
//     credential shape; a 2000-character region name or a fractional port is
//     a bad row, not an unsafe one, and adding a string-length predicate to a
//     jsonpath CHECK is not worth the second place to get it wrong.

import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";

export const SOURCE_KINDS = ["S3", "POSTGRES"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATUSES = [
  "DISABLED",
  "READY",
  "SYNCING",
  "ERROR",
  "UNREACHABLE",
  "PURGED",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** INDEX is the only mode in v1, pinned by a CHECK. FEDERATE cannot be written. */
export const SOURCE_MODE = "INDEX" as const;

/**
 * A validation refusal. Carries the offending key PATH so a route can say
 * "configJson.password" rather than "invalid config" — the acceptance asks
 * for a credential to be rejected BY NAME.
 */
export class SourceConfigError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
    this.name = "SourceConfigError";
  }
}

/** The Setting key a source's credential is sealed under. Never the credential. */
export function sourceSecretKey(id: string): string {
  return `datasource.${id}.secret`;
}

// ---------------------------------------------------------------------------
// configJson: NON-SECRET only
// ---------------------------------------------------------------------------

/**
 * Key fragments that mean "this is, or embeds, a credential". Matched against
 * the key with every non-alphanumeric character removed, so `secret_access_key`,
 * `secretAccessKey` and `SECRET-ACCESS-KEY` are one rule.
 *
 * `url`, `uri`, `dsn` and `connectionstring` are here for the sneakiest path
 * of all: `postgresql://user:pw@host/db` is a password with no key named
 * "password" anywhere near it.
 */
const CREDENTIAL_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "credential",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "sessiontoken",
  "auth",
  "bearer",
  "connectionstring",
  "dsn",
  "url",
  "uri",
];

/**
 * The non-secret keys each kind may carry, AND the scalar type each must be.
 * Deny-by-default twice over: an unknown key is refused, and so is any value
 * that is not a scalar of the declared type.
 *
 * THE FLATNESS RULE IS THE SECURITY RULE. A key-name denylist can only refuse
 * names it was told about, and it only ever looked at the top level: with
 * nesting allowed, `{"ssl": {"key": "-----BEGIN PRIVATE KEY-----…"}}` is a TLS
 * private key stored in configJson under two innocent names, and configJson is
 * returned to every AGENT by the list route. Refusing every object and every
 * array closes that whole class rather than one spelling of it.
 */
const CONFIG_KEYS: Record<SourceKind, Record<string, "string" | "number" | "boolean">> = {
  S3: { endpoint: "string", region: "string", forcePathStyle: "boolean" },
  POSTGRES: { host: "string", port: "number", database: "string", ssl: "boolean" },
};

/** Keys without which the kind cannot be checked or crawled at all. POSTGRES
 *  names both fields assertNotServoDatabase compares, so that guard can never
 *  be short-circuited by a missing key. */
const CONFIG_REQUIRED: Record<SourceKind, readonly string[]> = {
  S3: [],
  POSTGRES: ["host", "database"],
};

/** A config string long enough to hide a key blob is refused on length alone. */
const CONFIG_VALUE_LIMIT = 1024;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * WHATWG `URL` trims leading and trailing ASCII whitespace and DELETES every
 * tab, CR and LF anywhere in the input before it parses. So ` https://u:pw@h`
 * and `htt\tps://u:pw@h` are working credential-bearing URLs to every consumer
 * while being invisible to any test anchored on the raw string. Normalize the
 * same way the parser does, then test.
 */
function urlNormalize(value: string): string {
  return value.replace(/[\t\n\r]/g, "").trim();
}

/**
 * The value rules, and they are deliberately STRUCTURAL rather than clever.
 *
 * An earlier version of this file tried to recognise a credential by its
 * shape, and every round of review found another spelling it missed — a bare
 * AWS secret key, a Bearer value, base64 DER, a PEM without dashes. That is an
 * arms race a validator cannot win, and it is the wrong layer to fight it at:
 * the thing that actually stops a credential landing in these columns is the
 * KEY ALLOWLIST (CONFIG_KEYS, SCOPE_KEYS). A source may carry six settings and
 * a scope entry may carry six fields; there is no key called `password`
 * because there is no key that is not one of those.
 *
 * What is left is the case where a credential rides INSIDE a legitimate field,
 * and only two forms of that are worth a rule, because both are mirrorable
 * exactly in a CHECK constraint and neither has a false positive:
 *
 *   * `://` in any value except `configJson.endpoint`. No bucket, prefix,
 *     region, host, database, schema, table or column name contains it; a
 *     connection URL always does. `endpoint` is the one field whose value IS
 *     a URL, so it is exempt — and gets the next rule instead.
 *   * `@` in `configJson.endpoint`. An S3 endpoint has no userinfo; a
 *     credential-bearing URL is exactly what a userinfo is.
 *   * a PEM header, anywhere.
 *
 * All three are also DataSource_config_nonsecret / DataSource_scope_explicit
 * clauses, spelled the same way, and one table of payloads is run through both
 * layers in tests/kb-source-schema.test.ts.
 */
function credentialShape(value: string, key: string): string | null {
  if (/-{3,}\s*BEGIN/i.test(value)) {
    return "looks like a PEM block; credentials belong in the sealed store, never in a JSON column";
  }
  // libpq's keyword/value form, which carries a password with no URL and no
  // "@" anywhere: `host=… dbname=… password=hunter2`. Only the password
  // keywords are refused, not `host=`/`dbname=`: an S3 prefix legitimately
  // uses `k=v` partitioning (`dt=2026-01-01/`), and the crawler composes its
  // connection from configJson.host and configJson.database, never from a
  // free string, so a stray `host=` in a bucket prefix is not a target.
  if (/(^|[\s;])(password|passwd|pgpassword)\s*=/i.test(value)) {
    return "carries a libpq password= keyword; credentials belong in the sealed store, never in a JSON column";
  }
  if (key === "endpoint") {
    if (value.includes("@")) {
      return 'must not contain "@" — an endpoint has no userinfo, and a userinfo is a credential';
    }
    return null;
  }
  if (value.includes("://")) {
    return 'must not contain "://" — only an S3 endpoint is a URL, and a URL here is usually a credential someone pasted';
  }
  return null;
}

/**
 * Refuses a credential written into configJson, naming the key. Walks nested
 * objects and arrays: `{"pg": {"password": "…"}}` hides from a top-level scan
 * and is the shape an operator reaches for second.
 */
export function assertNoCredentials(config: unknown, path = "configJson", key = ""): void {
  // Every string is tested, wherever it sits — including a bare string inside
  // an array, which an earlier shape of this function walked past because it
  // only ever tested strings that were VALUES OF A KEY.
  if (typeof config === "string") {
    const shape = credentialShape(config, key);
    if (shape) {
      throw new SourceConfigError(
        `"${path}" ${shape}. Post the credential as "secret" and it is sealed in the secret store.`,
        path,
      );
    }
    return;
  }
  if (Array.isArray(config)) {
    config.forEach((entry, i) => assertNoCredentials(entry, `${path}[${i}]`, key));
    return;
  }
  if (config === null || typeof config !== "object") return;
  for (const [k, value] of Object.entries(config as Record<string, unknown>)) {
    const here = `${path}.${k}`;
    // The key-name scan stays as a BETTER MESSAGE, not as the boundary: the
    // allowlists below refuse every key that is not one of the six a source
    // may carry, so a key called `password` is already impossible. Naming it
    // as a credential rather than as "unknown key" is worth the two lines.
    const flat = normalizeKey(k);
    const hit = CREDENTIAL_KEY_FRAGMENTS.find((fragment) => flat.includes(fragment));
    if (hit) {
      throw new SourceConfigError(
        `"${here}" looks like a credential (matched "${hit}"). Credentials are never stored in a JSON column — post it as "secret" and it is sealed in the secret store.`,
        here,
      );
    }
    assertNoCredentials(value, here, k);
  }
}

/** The non-secret config, validated per kind. Runs assertNoCredentials first
 *  so a password is refused by its own name rather than as "unknown key". */
export function assertConfigShape(kind: SourceKind, config: unknown): void {
  assertNoCredentials(config);
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new SourceConfigError("configJson must be an object.", "configJson");
  }
  const allowed = CONFIG_KEYS[kind];
  const names = Object.keys(allowed);
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    const at = `configJson.${key}`;
    const expected = allowed[key];
    if (expected === undefined) {
      throw new SourceConfigError(
        `"${at}" is not a ${kind} setting. Allowed: ${names.join(", ")}.`,
        at,
      );
    }
    // Flat scalars only — never an object, never an array. See CONFIG_KEYS.
    if (typeof value !== expected) {
      throw new SourceConfigError(
        `"${at}" must be a ${expected}; configJson holds flat, non-secret values only.`,
        at,
      );
    }
    if (expected === "string") {
      const text = value as string;
      if (text.trim() === "") {
        throw new SourceConfigError(`"${at}" must not be empty.`, at);
      }
      if (text.length > CONFIG_VALUE_LIMIT) {
        throw new SourceConfigError(
          `"${at}" is longer than ${CONFIG_VALUE_LIMIT} characters; configJson holds settings, never blobs.`,
          at,
        );
      }
    }
    if (expected === "number" && !Number.isInteger(value)) {
      throw new SourceConfigError(`"${at}" must be a whole number.`, at);
    }
  }
  for (const key of CONFIG_REQUIRED[kind]) {
    if (!(key in (config as Record<string, unknown>))) {
      throw new SourceConfigError(
        `"configJson.${key}" is required for a ${kind} source.`,
        `configJson.${key}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// scopeJson: the whole security model of the connection
// ---------------------------------------------------------------------------

/**
 * The scope entry shapes, canonized in docs/design/external-sources.md. A
 * CLOSED SET, per kind, exactly like CONFIG_KEYS — and for the same reason.
 * "The scope allowlist is the whole security model of the connection": a
 * column with open-ended keys is a place to park anything, including a
 * credential, and it is served to every AGENT by the list route. Adding a
 * seventh field is a deliberate migration, not an accident of typing.
 */
const SCOPE_KEYS: Record<SourceKind, readonly string[]> = {
  S3: ["bucket", "prefix", "suffixes"],
  POSTGRES: ["schema", "table", "idColumn", "textColumns", "titleColumn", "updatedAtColumn"],
};

/** Scope fields whose value is a LIST of names rather than one name. */
const SCOPE_LIST_KEYS = new Set(["suffixes", "textColumns"]);

/**
 * Mirrors DataSource_scope_explicit, with a key name in the message. The two
 * must agree on the same table of payloads — a validator stricter than the
 * catalog leaves a hole for a seed, and a catalog stricter than the validator
 * turns a clear 400 into a 500.
 */
export function assertScopeExplicit(scope: unknown, kind: SourceKind = "S3"): void {
  if (!Array.isArray(scope)) {
    throw new SourceConfigError(
      "scopeJson must be an array of explicit entries. An empty array reaches nothing, which is the safe default.",
      "scopeJson",
    );
  }
  const allowed = SCOPE_KEYS[kind];
  scope.forEach((entry, i) => {
    const at = `scopeJson[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new SourceConfigError(`"${at}" must be an object.`, at);
    }
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      const here = `${at}.${key}`;
      if (key === "where") {
        throw new SourceConfigError(
          `"${here}" is refused: Servo composes every statement itself. Name a VIEW upstream if you need a predicate.`,
          here,
        );
      }
      if (!allowed.includes(key)) {
        throw new SourceConfigError(
          `"${here}" is not a ${kind} scope field. Allowed: ${allowed.join(", ")}.`,
          here,
        );
      }
      const values = SCOPE_LIST_KEYS.has(key) ? value : [value];
      if (SCOPE_LIST_KEYS.has(key) && !Array.isArray(value)) {
        throw new SourceConfigError(`"${here}" must be a list of names.`, here);
      }
      (values as unknown[]).forEach((v, j) => {
        const vAt = SCOPE_LIST_KEYS.has(key) ? `${here}[${j}]` : here;
        if (typeof v !== "string") {
          throw new SourceConfigError(
            `"${vAt}" must be a string — a scope names one bucket, prefix, schema, table or column, explicitly.`,
            vAt,
          );
        }
        if (v.includes("*")) {
          throw new SourceConfigError(
            `"${vAt}" carries a "*". A scope is a list of explicit names, never a wildcard.`,
            vAt,
          );
        }
        const shape = credentialShape(v, key);
        if (shape) {
          throw new SourceConfigError(`"${vAt}" ${shape}.`, vAt);
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// The guard that matters most
// ---------------------------------------------------------------------------

/** A Postgres endpoint, as configJson spells it. */
export interface PostgresTarget {
  host?: unknown;
  port?: unknown;
  database?: unknown;
}

/** Resolves a hostname to its addresses. Injectable so a test can spell a
 *  container hostname that its own resolver does not carry. */
export type HostResolver = (host: string) => Promise<string[]>;

const dnsResolver: HostResolver = async (host) => {
  const all = await lookup(host, { all: true });
  return all.map((a) => a.address);
};

/** The env vars naming a database Servo itself owns. */
export const SERVO_DATABASE_URL_VARS = [
  "DATABASE_URL",
  "OPS_DATABASE_URL",
  "OPS_DATABASE_READONLY_URL",
] as const;

/**
 * `::ffff:127.0.0.1` and `127.0.0.1` are one address; so are `::1` and its
 * expanded form. Compared as text after this, never as the URL string.
 *
 * EVERY LOOPBACK AND UNSPECIFIED ADDRESS FOLDS TO ONE TOKEN. Address-set
 * intersection is not host identity: `0.0.0.0`, `::`, `::1` and any
 * `127.x.x.x` name the local machine, and a set-intersection that keeps them
 * apart would accept `0.0.0.0` as "a different server" from `localhost`.
 *
 * `0.0.0.0` as a DESTINATION is a kernel courtesy — Linux routes it to the
 * local host — and not every stack extends it: a WSL host will accept the
 * dial from node's socket and refuse it from Prisma's Rust engine. So the
 * folding is justified by that kernel behaviour rather than by a test that
 * dials it, and the test asserts the two things that ARE portable: the guard
 * refuses every one of these spellings, and two spellings resolving to one
 * address really are one postmaster. Folding can only produce refusals, never
 * acceptances, so a platform that cannot reach `0.0.0.0` loses nothing by it.
 */
function normalizeAddress(address: string): string {
  const lower = address.toLowerCase().split("%")[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return loopbackOr(mapped[1]);
  if (!lower.includes(":")) return loopbackOr(lower);
  // Expand an IPv6 address to its eight full groups so `::1` and
  // `0:0:0:0:0:0:0:1` compare equal.
  const [head, tail] = lower.split("::", 2);
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  if (fill < 0) return lower;
  const groups = [...headGroups, ...Array(fill).fill("0"), ...tailGroups];
  const expanded = groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":");
  if (expanded === "0:0:0:0:0:0:0:1" || expanded === "0:0:0:0:0:0:0:0") return LOOPBACK;
  // An IPv4-mapped address has TWO spellings — `::ffff:127.0.0.1` (handled
  // above, before expansion) and `::ffff:7f00:1`, the same 32 bits written as
  // two hex groups. Fold the second onto the first rather than leaving them as
  // two different strings for the intersection to miss each other on.
  const mappedHex = /^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(expanded);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return loopbackOr(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (localAddressSet().has(lower)) return LOOPBACK;
  return expanded;
}

/** The single token every address that reaches THIS machine folds to. */
const LOOPBACK = "loopback";

/**
 * Every address bound to a local interface THIS PROCESS CAN ENUMERATE, not
 * merely the loopback ones: a host reaches itself through its LAN address and
 * a container through its bridge address, and both land on the same postmaster
 * as 127.0.0.1 while being different strings in a different subnet.
 *
 * THE HONEST LIMIT: `os.networkInterfaces()` lists the interfaces the process
 * can see and skips ones that are down, so this is a best-effort widening of
 * the loopback class, not a proof that no other address reaches this machine.
 * A docker bridge address on a host whose docker0 is idle, or an address on a
 * network namespace this process is not in, will not be folded. The rules that
 * do NOT depend on enumeration are the ones the acceptance rests on: address
 * intersection catches every SPELLING of the same resolved address, and the
 * database-name match is port-blind on purpose.
 *
 * Read once, and only a NON-EMPTY read is cached — interfaces do not change
 * under a running process often enough to matter, and re-reading per
 * comparison would put a syscall inside a loop over three environment vars.
 */
let localAddresses: Set<string> | null = null;
function localAddressSet(): Set<string> {
  if (localAddresses) return localAddresses;
  const out = new Set<string>();
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        out.add(entry.address.toLowerCase().split("%")[0]);
      }
    }
  } catch {
    /* an environment with no interface list still gets the fixed set above */
  }
  // A transient failure is NOT memoized: caching an empty set would degrade
  // the guard to the fixed 127.x/0.0.0.0 rules for the rest of the process.
  if (out.size > 0) localAddresses = out;
  return out;
}

function loopbackOr(v4: string): string {
  if (v4 === "0.0.0.0" || /^127\./.test(v4)) return LOOPBACK;
  if (localAddressSet().has(v4)) return LOOPBACK;
  return v4;
}

async function addressesOf(host: string, resolve: HostResolver): Promise<Set<string> | null> {
  try {
    const addresses = await resolve(host);
    if (addresses.length === 0) return null;
    return new Set(addresses.map(normalizeAddress));
  } catch {
    return null;
  }
}

/**
 * The database NAME of a datasource URL, parsed — never the raw string.
 *
 * This is loop-guard rail 1's parser, re-stated rather than imported:
 * `scripts/loop-guard.mjs` is a CLI that pulls in `node:child_process` at
 * module scope, and dragging it into the Next.js server bundle to reach one
 * pure function is the wrong trade. `tests/kb-source-schema.test.ts` imports
 * BOTH and asserts they agree on a table of URLs, so the two copies cannot
 * drift silently — which is the only reason a second copy is tolerable.
 */
export function parseDatabaseName(databaseUrl: string): string | null {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") return null;
  const url = databaseUrl.trim();
  if (url.startsWith("file:")) {
    const file = url.slice(5).split("?")[0].replace(/[\\/]+$/, "");
    return file.split(/[\\/]/).pop() || null;
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] || null;
  } catch {
    return null;
  }
}

/**
 * What a Servo datasource URL names.
 *
 *  - `kind: "none"` — it names no server AND no database that a POSTGRES
 *    source could collide with: `file:./ops.db` (the ops sandbox is SQLite on
 *    some installs), or a URL with no database name at all.
 *  - `kind: "server"` — a host and a database name, both usable.
 *  - `kind: "opaque"` — a database name is readable but the HOST is not: a
 *    unix-socket DSN (`postgresql:///servo?host=/var/run/postgresql`), a URL
 *    with an empty authority, or one `new URL` will not parse. This case is
 *    FAIL-CLOSED at the call site: an unreadable host is an unproven host, and
 *    treating it as "no collision possible" is how the guard would be walked
 *    past by the very deployment style that makes host comparison hardest.
 *
 * The database name is percent-DECODED, because the hostname is (WHATWG `URL`
 * decodes neither path segments nor much else for us) and comparing an encoded
 * name against a plain one silently disables the guard.
 */
type ServoEndpoint =
  | { kind: "none" }
  | { kind: "unreadable" }
  | { kind: "opaque"; database: string }
  | { kind: "server"; host: string; database: string };

function servoEndpoint(url: string): ServoEndpoint {
  // A file: URL is a SQLite path: no server, so a Postgres source cannot be
  // pointed at it however its database is spelled.
  if (url.trim().startsWith("file:")) return { kind: "none" };
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Set, but not a URL at all. Neither half of the comparison is legible,
    // so nothing can be proven different — the whole point of `unreadable`.
    return { kind: "unreadable" };
  }
  const raw = parseDatabaseName(url);
  if (!raw) return { kind: "none" };
  let database = raw;
  try {
    database = decodeURIComponent(raw);
  } catch {
    /* a stray % is not an escape — compare the literal */
  }
  if (parsed.hostname === "") return { kind: "opaque", database };
  return { kind: "server", host: decodeURIComponent(parsed.hostname), database };
}

export interface NotServoDatabaseOptions {
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Defaults to a real DNS lookup. */
  resolve?: HostResolver;
}

/**
 * THE GUARD THAT MATTERS MOST. A DataSource pointed at Servo's own database is
 * one row that walks around every entitlement CTE in the knowledge base, and
 * it is one row an admin could create by accident.
 *
 * Refuses when the RESOLVED HOST ADDRESSES intersect AND the PARSED DATABASE
 * NAME matches any of DATABASE_URL, OPS_DATABASE_URL or
 * OPS_DATABASE_READONLY_URL. Never a URL-string comparison: `localhost`,
 * `127.0.0.1` and a container hostname are one target, and none of them looks
 * like the others as text.
 *
 * TWO DELIBERATE ASYMMETRIES, both erring toward refusal:
 *
 *  - The PORT is not part of the match, though docs/design/external-sources.md
 *    describes the triple as `host:port:database`. A port is the weakest
 *    element of it — a connection pooler, a forwarded port and a second
 *    listener all reach the same database on a different number — so matching
 *    on host and name alone can only produce a false REFUSAL, never a false
 *    acceptance. spec.md's acceptance criterion names exactly these two, and
 *    where the design document and spec.md disagree spec.md wins.
 *  - A host that will not resolve, on either side, is treated as a MATCH when
 *    the database name already matches. Unresolvable means unproven, and this
 *    is not the guard to fail open on. The same rule covers a Servo URL whose
 *    host cannot be read at all (a unix-socket DSN).
 *
 * IT NEVER SKIPS ITSELF. A config that names a database but whose host is
 * missing, empty or not a string is REFUSED rather than waved through: a
 * Postgres client given no host connects to the LOCAL machine over a unix
 * socket, so "no host" is the most dangerous value there is, not the least.
 * Only a config that names neither a host nor a database — an S3 config — is
 * a legitimate no-op.
 */
export async function assertNotServoDatabase(
  config: PostgresTarget,
  options: NotServoDatabaseOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const resolve = options.resolve ?? dnsResolver;

  const namesHost = config.host !== undefined && config.host !== null;
  const namesDb = config.database !== undefined && config.database !== null;
  // An S3 config reaches here with neither: there is no database to collide
  // with, and the caller is allowed to pass any config without special-casing.
  if (!namesHost && !namesDb) return;

  const host = typeof config.host === "string" ? config.host.trim() : "";
  const database = typeof config.database === "string" ? config.database.trim() : "";
  if (host === "" || database === "") {
    throw new SourceConfigError(
      'A Postgres source must name both "host" and "database" as non-empty strings — a client given neither connects to the local machine, which is exactly what this guard exists to refuse.',
      host === "" ? "configJson.host" : "configJson.database",
    );
  }

  let candidate: Set<string> | null | undefined;
  for (const varName of SERVO_DATABASE_URL_VARS) {
    const raw = env[varName];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const servo = servoEndpoint(raw.trim());
    if (servo.kind === "none") continue;
    if (servo.kind === "unreadable") {
      throw new SourceConfigError(
        `${varName} is set to something this guard cannot parse, so no source can be proven to point somewhere else. Fix ${varName} before adding a Postgres source.`,
        "configJson.host",
      );
    }
    if (servo.database !== database) continue;

    // The name matches — only now is a DNS round trip worth making.
    if (candidate === undefined) candidate = await addressesOf(host, resolve);
    const theirs = servo.kind === "server" ? await addressesOf(servo.host, resolve) : null;
    const unresolved = candidate === null || theirs === null;
    const shared =
      !unresolved && [...candidate!].some((address) => theirs!.has(address));
    if (unresolved || shared) {
      throw new SourceConfigError(
        `This source points at Servo's own database: "${database}" on a host that resolves to the same address as ${varName}` +
          (unresolved ? " (one of the two hosts cannot be resolved, so the addresses cannot be proven different)" : "") +
          ". A data source may never read the database it is stored in.",
        "configJson.host",
      );
    }
  }
}

/**
 * The same guard applied to a credential that happens to BE a connection URL.
 * For a Postgres source the crawler composes its connection from configJson
 * plus the sealed secret, and an operator who pastes a whole DSN as the secret
 * would otherwise route around the host/database comparison entirely. A secret
 * that is not a URL is not a target and is ignored — never parsed, never
 * logged, never echoed.
 */
export async function assertSecretNotServoDatabase(
  secret: string,
  options: NotServoDatabaseOptions = {},
): Promise<void> {
  const refuse = (why: string): never => {
    // Re-thrown against the SECRET field, and deliberately without echoing one
    // character of it.
    throw new SourceConfigError(`The credential ${why}.`, "secret");
  };

  const candidate = urlNormalize(secret);

  // libpq's OTHER spelling. `host=127.0.0.1 port=5433 dbname=servo user=…` is
  // a complete connection string with no scheme at all, so a scheme test
  // returns before looking at it — and it is exactly what an operator pastes
  // out of a runbook. Anything wearing this shape is refused outright rather
  // than parsed: this guard does not need to understand conninfo, it needs to
  // not be walked past by it. `service=` goes with them, because libpq then
  // reads the host and database out of pg_service.conf, where nothing here
  // can see them.
  //
  // Tested against BOTH spellings of the input. urlNormalize deletes tabs and
  // newlines, which is right for a URL and wrong here: a conninfo written one
  // key per LINE collapses to `…user=servo\nhost=…` -> `…user=servohost=…`
  // and stops matching `(^|\s)host=`. The raw string still matches.
  const conninfo = /(^|[\s;])(host|hostaddr|dbname|service)\s*=/i;
  if (conninfo.test(candidate) || conninfo.test(secret)) {
    refuse(
      "is a libpq connection string. Store only the credential itself; the host and database come from the source's config, where the never-Servo's-own-database guard can see them",
    );
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return; // not a connection target
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return refuse("looks like a connection URL but cannot be parsed, so it cannot be proven to point elsewhere");
  }
  const database = parseDatabaseName(candidate);
  if (!database) return; // a URL with no database names no target
  // Fail CLOSED on an authority this guard cannot read — `postgresql://u:p@/db
  // ?host=127.0.0.1` carries its host in a query parameter, which is precisely
  // the spelling that would otherwise wave itself through.
  if (parsed.hostname === "") {
    return refuse(
      "is a connection URL whose host cannot be read (it names a database but no authority), so it cannot be proven to point elsewhere",
    );
  }
  let decoded = database;
  try {
    decoded = decodeURIComponent(database);
  } catch {
    /* a stray % is not an escape — compare the literal */
  }
  // libpq reads `?dbname=` in preference to the path, so a URL whose path
  // names one database and whose query names another connects to the query's.
  // Both are checked; the path one was checked above.
  const fromQuery = parsed.searchParams.get("dbname");
  if (fromQuery && fromQuery !== decoded) {
    try {
      await assertNotServoDatabase(
        { host: decodeURIComponent(parsed.hostname), database: fromQuery },
        options,
      );
    } catch (err) {
      if (err instanceof SourceConfigError) {
        return refuse(
          "is a connection URL whose ?dbname parameter points at Servo's own database. A data source may never read the database it is stored in",
        );
      }
      throw err;
    }
  }
  try {
    await assertNotServoDatabase(
      { host: decodeURIComponent(parsed.hostname), database: decoded },
      options,
    );
  } catch (err) {
    if (err instanceof SourceConfigError) {
      // A DATABASE_URL this guard cannot parse is a DIFFERENT problem from a
      // secret that points at Servo's own database, and reporting the second
      // when the first is true sends an operator hunting the wrong field.
      if (/cannot parse/.test(err.message)) throw err;
      return refuse(
        "is a connection URL pointing at Servo's own database. A data source may never read the database it is stored in",
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The response shape
// ---------------------------------------------------------------------------

/** What a route may return. secretRef is a Setting KEY rather than a
 *  credential, and it is still omitted: naming the row a secret lives in is a
 *  step toward reading it, and nothing outside the crawler needs it. */
export interface RedactedSource {
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
  secretSet: boolean;
  createdById: string;
  createdAt: Date;
}

export function redactSource(
  row: {
    id: string;
    name: string;
    kind: string;
    mode: string;
    configJson: unknown;
    scopeJson: unknown;
    status: string;
    statusError: string | null;
    lastSyncAt: Date | null;
    lastCompleteSyncAt: Date | null;
    syncEveryMin: number;
    maxRows: number;
    createdById: string;
    createdAt: Date;
  },
  secretSet: boolean,
): RedactedSource {
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
    secretSet,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}
