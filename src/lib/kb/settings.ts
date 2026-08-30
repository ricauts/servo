// KB settings (dcl-01, extended by dcl-05). Resolved ENV-FIRST exactly
// like getAiSettings() in src/lib/ai/settings.ts:68: the environment
// variable wins, the Setting row is the desk-level default, and the
// constant is the fresh-install default.
//
// The worker budget (dcl-01) is a NAMED setting rather than a wall-clock
// constant so an operator of a slow extraction lane can raise it without a
// deploy; extraction OUTPUT never depends on it, so nothing stored is
// invalidated when it moves.
//
// The Docling lane (dcl-05) carries six settings of its own. Its URL is
// validated AT RESOLUTION TIME — four rules, each with its reason — and is
// read ONLY from settings or env: a URL arriving through a document, a
// ticket or a request body is never consulted. It does not pass through
// checkEgress, the same exemption class as kb.embed.baseUrl (an operator's
// own extraction sidecar, not an agent-directed destination); the bounds
// of that exemption are the host allowlist below and redirect: "manual"
// on every request the client makes.

/** The minimal structural reader the budget needs — accepts the app's
 *  $extends-extended client and a bare PrismaClient alike. */
export interface SettingReader {
  setting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
  };
}

export const KB_EXTRACT_BUDGET_KEY = "kb.extract.workerBudgetMs";
export const KB_EXTRACT_BUDGET_ENV = "KB_EXTRACT_WORKER_BUDGET_MS";
export const KB_EXTRACT_BUDGET_DEFAULT_MS = 360_000;

/** Resolve the extraction budget: env → Setting row → default. db may be
 *  null where no database handle exists (the pure runner paths). */
export async function getKbExtractBudgetMs(db: SettingReader | null): Promise<number> {
  const env = Number(process.env[KB_EXTRACT_BUDGET_ENV]);
  if (Number.isFinite(env) && env > 0) return env;
  if (db) {
    const row = await db.setting.findUnique({ where: { key: KB_EXTRACT_BUDGET_KEY } });
    const stored = Number(row?.value);
    if (Number.isFinite(stored) && stored > 0) return stored;
  }
  return KB_EXTRACT_BUDGET_DEFAULT_MS;
}

// ---------------------------------------------------------------------------
// The Docling lane (dcl-05).
// ---------------------------------------------------------------------------

export const DOCLING_URL_KEY = "kb.extract.docling.url";
export const DOCLING_URL_ENV = "KB_EXTRACT_DOCLING_URL";
export const DOCLING_TYPES_KEY = "kb.extract.docling.types";
export const DOCLING_TYPES_ENV = "KB_EXTRACT_DOCLING_TYPES";
export const DOCLING_TIMEOUT_KEY = "kb.extract.docling.timeoutMs";
export const DOCLING_TIMEOUT_ENV = "KB_EXTRACT_DOCLING_TIMEOUT_MS";
export const DOCLING_MAXPAGES_KEY = "kb.extract.docling.maxPages";
export const DOCLING_MAXPAGES_ENV = "KB_EXTRACT_DOCLING_MAX_PAGES";
export const DOCLING_OCR_KEY = "kb.extract.docling.ocr";
export const DOCLING_OCR_ENV = "KB_EXTRACT_DOCLING_OCR";
export const DOCLING_APIKEY_KEY = "kb.extract.docling.apiKey";
export const DOCLING_APIKEY_ENV = "KB_EXTRACT_DOCLING_API_KEY";

/** OCR engines baked into the pinned image. "tesseract" is REFUSED at
 *  configuration time: it needs a system binary whose presence in this
 *  image is UNVERIFIED. */
export const DOCLING_OCR_ENGINES = ["auto", "easyocr", "rapidocr", "off"] as const;
export type DoclingOcrEngine = (typeof DOCLING_OCR_ENGINES)[number];

export interface DoclingConfig {
  /** "" disables the lane entirely — LANE 1. */
  url: string;
  /** Which sniffed content types route to Docling. Defaults to PDF ONLY:
   *  xlsx stays on exceljs unless an admin opts in. Docling's xlsx path is
   *  deterministic openpyxl (no torch) and genuinely better on messy
   *  workbooks, but changing the default extraction path for documents
   *  that already work is not a trade this item makes. */
  types: string[];
  timeoutMs: number;
  maxPages: number;
  ocr: DoclingOcrEngine;
  apiKey: string;
}

export const DOCLING_DEFAULTS: DoclingConfig = {
  url: "",
  types: ["application/pdf"],
  timeoutMs: 300_000,
  maxPages: 40,
  ocr: "auto",
  apiKey: "",
};

/** The poll cadence the client uses inside timeoutMs (dcl-05). */
export const DOCLING_POLL_INTERVAL_MS = 2_000;
/** Headroom the docling deadline must leave inside the worker budget. */
export const DOCLING_POLL_SLACK_MS = 30_000;
/** Per-page budget the invariant assumes (ms per page of OCR work). */
export const DOCLING_MS_PER_PAGE = 6_000;

async function readSetting(db: SettingReader | null, key: string): Promise<string | null> {
  if (!db) return null;
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/**
 * The four URL rules, each refusing with its own reason:
 *   1. http/https only — no file:, no ws:, nothing else.
 *   2. no credentials — user:pass@host is refused outright.
 *   3. no redirects — enforced by the client (redirect: "manual"), the
 *      transport-level half of this rule.
 *   4. the host must be loopback, RFC1918, ULA, or a compose service name
 *      (a single DNS label) — anything routable to the open internet is
 *      refused.
 */
export function validateDoclingUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: `kb.extract.docling.url "${raw}" is not a parseable URL` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `kb.extract.docling.url must be http or https, got "${u.protocol}"` };
  }
  if (u.username !== "" || u.password !== "") {
    return { ok: false, reason: "kb.extract.docling.url must carry no credentials" };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" || /^127\./.test(host);
  const rfc1918 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const ula = /^f[cd][0-9a-f]{2}:/.test(host);
  // A compose service name: one DNS label, no dots.
  const serviceName = !host.includes(".") && /^[a-z][a-z0-9-]{0,62}$/.test(host);
  if (!(loopback || rfc1918 || ula || serviceName)) {
    return {
      ok: false,
      reason: `kb.extract.docling.url host "${host}" is not loopback, RFC1918/ULA, or a compose service name — an extraction sidecar must not point at the open internet`,
    };
  }
  return { ok: true };
}

/** Resolve the whole Docling lane: env first, then Setting rows, then the
 *  shipped defaults. Invalid values refuse with the reason — the caller
 *  surfaces it, never silently falls back to a different URL. */
export async function getDoclingConfig(db: SettingReader | null): Promise<DoclingConfig> {
  const cfg: DoclingConfig = { ...DOCLING_DEFAULTS };

  const urlEnv = process.env[DOCLING_URL_ENV];
  const urlRow = await readSetting(db, DOCLING_URL_KEY);
  const url = urlEnv !== undefined && urlEnv !== "" ? urlEnv : urlEnv === "" ? "" : (urlRow ?? "");
  if (url) {
    const verdict = validateDoclingUrl(url);
    if (!verdict.ok) throw new Error(verdict.reason);
    cfg.url = url;
  }

  const typesRaw = process.env[DOCLING_TYPES_ENV] ?? (await readSetting(db, DOCLING_TYPES_KEY));
  if (typesRaw) {
    const types = typesRaw.split(",").map((t) => t.trim()).filter(Boolean);
    if (types.length > 0) cfg.types = types;
  }

  const timeoutRaw = process.env[DOCLING_TIMEOUT_ENV] ?? (await readSetting(db, DOCLING_TIMEOUT_KEY));
  if (timeoutRaw) {
    const v = Number(timeoutRaw);
    if (Number.isFinite(v) && v > 0) cfg.timeoutMs = v;
  }

  const pagesRaw = process.env[DOCLING_MAXPAGES_ENV] ?? (await readSetting(db, DOCLING_MAXPAGES_KEY));
  if (pagesRaw) {
    const v = Number(pagesRaw);
    if (Number.isFinite(v) && v > 0) cfg.maxPages = v;
  }

  const ocrRaw = process.env[DOCLING_OCR_ENV] ?? (await readSetting(db, DOCLING_OCR_KEY));
  if (ocrRaw) {
    const v = ocrRaw.trim().toLowerCase();
    if (v === "tesseract") {
      throw new Error(
        'kb.extract.docling.ocr "tesseract" is refused: it needs a system binary whose presence in this image is UNVERIFIED — use auto, easyocr, rapidocr, or off',
      );
    }
    if (!(DOCLING_OCR_ENGINES as readonly string[]).includes(v)) {
      throw new Error(`kb.extract.docling.ocr must be one of ${DOCLING_OCR_ENGINES.join(", ")}, got "${v}"`);
    }
    cfg.ocr = v as DoclingOcrEngine;
  }

  cfg.apiKey = process.env[DOCLING_APIKEY_ENV] ?? (await readSetting(db, DOCLING_APIKEY_KEY)) ?? "";
  return cfg;
}
