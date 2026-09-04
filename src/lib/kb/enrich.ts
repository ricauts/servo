// Opt-in model enrichment of documents (kb-lib-2): topics, a short summary
// in the document's own language, and a shelf (collection) to file it on.
//
// The shipped default is OFF, and the reason is stated where the switch is:
// enrichment sends document CONTENT to the configured model provider, which
// is exactly what ingest otherwise never does (kb-08: no model call at
// ingest). Turning it on is an egress decision an operator makes once, in
// Settings, with the provider they already trust for tickets.
//
// Everything a model writes lands in four additive columns (topics,
// aiSummary, enrichModel, enrichedAt). The deterministic summary and keyword
// profile are never overwritten, so switching enrichment off leaves a
// document exactly as the offline pipeline would have made it, plus the
// four fields — and a re-extract recomputes the deterministic half without
// touching them until the next enrichment run.
//
// Filing rules (kb.enrich.autoFile): the model may name an EXISTING
// collection or propose a NEW one; a proposal creates the collection. A
// document a human already filed is never moved — automation fills empty
// shelves, it does not reorganize the library.

import type { ChatProvider } from "@/lib/ai/provider";
import { getRealProvider } from "@/lib/ai/provider";
import { getAiSettings } from "@/lib/ai/settings";
import { withUsage } from "@/lib/ai/credentials";
import { db } from "@/lib/db";

export const KB_ENRICH_SETTING_KEYS = {
  enabled: "kb.enrich.enabled", // "true" | "false" — default false
  autoFile: "kb.enrich.autoFile", // "true" | "false" — default true (only matters when enabled)
} as const;
export const KB_ENRICH_ENABLED_ENV = "KB_ENRICH_ENABLED";

/** How much document text one enrichment call sees: the opening, then a
 *  sample of the middle and the end, under a hard character budget. A
 *  400-page manual is described from ~12k characters of it; that is a
 *  known limit, not a bug, and the prompt says so to the model. */
export const ENRICH_TEXT_BUDGET = 12_000;
export const MAX_TOPICS = 8;
export const MAX_TOPIC_CHARS = 48;
export const MAX_SUMMARY_CHARS = 600;
export const MAX_COLLECTION_CHARS = 60;

export interface EnrichSettings {
  enabled: boolean;
  autoFile: boolean;
}

interface SettingReader {
  setting: { findMany(args: { where: { key: { in: string[] } } }): Promise<{ key: string; value: string }[]> };
}

/** Env-first like getAiSettings: KB_ENRICH_ENABLED=true|false wins over the row. */
export async function getEnrichSettings(
  client: SettingReader = db,
  env: Record<string, string | undefined> = process.env,
): Promise<EnrichSettings> {
  const rows = await client.setting.findMany({
    where: { key: { in: Object.values(KB_ENRICH_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const envEnabled = env[KB_ENRICH_ENABLED_ENV];
  const enabled =
    envEnabled === "true" || envEnabled === "false"
      ? envEnabled === "true"
      : map.get(KB_ENRICH_SETTING_KEYS.enabled) === "true";
  const autoFile = (map.get(KB_ENRICH_SETTING_KEYS.autoFile) ?? "true") !== "false";
  return { enabled, autoFile };
}

/** The shape the model is asked for, after sanitizing. */
export interface Enrichment {
  language: string;
  summary: string;
  topics: string[];
  /** A shelf: an existing collection's exact name, or a new one. null = none fits. */
  collection: { name: string; isNew: boolean } | null;
}

/** Build the text sample under the budget: opening, then middle, then end. */
export function sampleText(chunkTexts: readonly string[], budget = ENRICH_TEXT_BUDGET): string {
  const joined = chunkTexts.join("\n\n").replace(/\s+\n/g, "\n");
  if (joined.length <= budget) return joined;
  const head = Math.floor(budget * 0.6);
  const mid = Math.floor(budget * 0.2);
  const tail = budget - head - mid;
  const midStart = Math.floor(joined.length / 2 - mid / 2);
  return (
    joined.slice(0, head) +
    "\n\n[…]\n\n" +
    joined.slice(midStart, midStart + mid) +
    "\n\n[…]\n\n" +
    joined.slice(joined.length - tail)
  );
}

export function buildPrompt(input: {
  name: string;
  contentType: string;
  existingCollections: readonly string[];
  text: string;
}): { system: string; user: string } {
  const shelves = input.existingCollections.length
    ? input.existingCollections.map((c) => `- ${c}`).join("\n")
    : "(none yet)";
  const system =
    "You are the librarian of a company knowledge base. You read one document " +
    "and describe it for a catalog. Answer with ONE JSON object and nothing else — " +
    "no prose, no code fence. Write the summary and the topics in the document's " +
    "own language. Schema:\n" +
    '{"language": "<ISO 639-1>", "summary": "<1-2 sentences, what the document is and who it is for>", ' +
    `"topics": ["<3 to ${MAX_TOPICS} short noun phrases, most specific first>"], ` +
    '"collection": {"name": "<shelf>", "isNew": <true|false>} | null}\n' +
    "Collection rules: prefer an EXISTING shelf when one fits, copying its name exactly " +
    "and setting isNew=false. Propose a NEW shelf (isNew=true, 1-3 words, Title Case, in the " +
    "language of the existing shelves or of the document) only when no existing one fits. " +
    "Use null only when the document is unclassifiable. You may see only a sample of a long " +
    "document; describe what the sample shows and do not invent sections you did not see.";
  const user =
    `Document: ${input.name}\nType: ${input.contentType}\n\nExisting shelves:\n${shelves}\n\n` +
    `--- BEGIN DOCUMENT SAMPLE ---\n${input.text}\n--- END DOCUMENT SAMPLE ---`;
  return { system, user };
}

/**
 * Parse and sanitize the model's answer. Tolerates a code fence or prose
 * around the object (the first `{` to the last `}`), refuses anything that
 * is not an object, and caps every string so a runaway answer cannot bloat
 * a row. Returns null when nothing usable came back — the caller records
 * nothing rather than a half-enrichment.
 */
export function parseEnrichment(raw: string): Enrichment | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  const summary = typeof o.summary === "string" ? squeeze(o.summary).slice(0, MAX_SUMMARY_CHARS) : "";
  const topics = Array.isArray(o.topics)
    ? dedupe(
        o.topics
          .filter((t): t is string => typeof t === "string")
          .map((t) => squeeze(t).slice(0, MAX_TOPIC_CHARS))
          .filter(Boolean),
      ).slice(0, MAX_TOPICS)
    : [];
  if (!summary && topics.length === 0) return null;

  let collection: Enrichment["collection"] = null;
  if (typeof o.collection === "object" && o.collection !== null) {
    const c = o.collection as Record<string, unknown>;
    const name = typeof c.name === "string" ? squeeze(c.name).slice(0, MAX_COLLECTION_CHARS) : "";
    if (name) collection = { name, isNew: c.isNew === true };
  }
  const language = typeof o.language === "string" ? o.language.trim().slice(0, 8).toLowerCase() : "";
  return { language, summary, topics, collection };
}

function squeeze(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export type EnrichOutcome =
  | { status: "enriched"; documentId: string; topics: string[]; collection: string | null; created: boolean }
  | { status: "skipped"; documentId: string; reason: string }
  | { status: "failed"; documentId: string; error: string };

export interface EnrichOptions {
  /** Test seam: a provider to use instead of the configured one. */
  provider?: ChatProvider;
  /** Test seam / bulk runs: settings already resolved. */
  settings?: EnrichSettings;
  /** Re-run on a document that already carries an enrichment. */
  force?: boolean;
}

/**
 * Enrich one EXTRACTED document. Idempotent by default (a document with
 * enrichedAt set is skipped unless force); never throws for a model or
 * parse problem — the outcome says what happened, and the caller decides
 * whether that is a log line or an HTTP status.
 */
export async function enrichDocument(documentId: string, opts: EnrichOptions = {}): Promise<EnrichOutcome> {
  const settings = opts.settings ?? (await getEnrichSettings());
  if (!settings.enabled && !opts.provider) {
    return { status: "skipped", documentId, reason: "kb.enrich.enabled is off" };
  }
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      contentType: true,
      textStatus: true,
      kind: true,
      collectionId: true,
      enrichedAt: true,
      chunks: { select: { text: true }, orderBy: { index: "asc" } },
    },
  });
  if (!doc) return { status: "skipped", documentId, reason: "unknown document" };
  if (doc.kind !== "FILE") return { status: "skipped", documentId, reason: "catalog cards are not enriched" };
  if (doc.textStatus !== "EXTRACTED" || doc.chunks.length === 0) {
    return { status: "skipped", documentId, reason: "no indexed text" };
  }
  if (doc.enrichedAt && !opts.force) return { status: "skipped", documentId, reason: "already enriched" };

  let provider = opts.provider ?? null;
  let modelName = "test";
  if (!provider) {
    const ai = await getAiSettings();
    const real = getRealProvider(ai);
    if (!real) return { status: "skipped", documentId, reason: "no model provider configured (mock mode)" };
    modelName = ai.model;
    provider = withUsage(real, {
      kind: "ENRICH",
      agentName: "Servo Librarian",
      credentialName: ai.keySource === "env" ? "env" : "settings",
      provider: ai.provider,
      model: ai.model,
    });
  }

  const collections = await db.collection.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const prompt = buildPrompt({
    name: doc.name,
    contentType: doc.contentType,
    existingCollections: collections.map((c) => c.name),
    text: sampleText(doc.chunks.map((c) => c.text)),
  });

  let raw: string;
  try {
    const turn = await provider.complete({
      system: prompt.system,
      messages: [{ role: "user", content: [{ type: "text", text: prompt.user }] }],
      tools: [],
      maxTokens: 800,
    });
    raw = turn.text;
  } catch (err) {
    return { status: "failed", documentId, error: err instanceof Error ? err.message : String(err) };
  }
  const enrichment = parseEnrichment(raw);
  if (!enrichment) return { status: "failed", documentId, error: "the model's answer was not the expected JSON" };

  // Filing: only an UNFILED document moves, and only when auto-file is on.
  let collectionId: string | null = doc.collectionId;
  let filedName: string | null = null;
  let created = false;
  if (settings.autoFile && doc.collectionId === null && enrichment.collection) {
    const wanted = enrichment.collection.name;
    const existing = collections.find((c) => c.name.toLowerCase() === wanted.toLowerCase());
    if (existing) {
      collectionId = existing.id;
      filedName = existing.name;
    } else {
      // A proposal creates the shelf. `create` races with a concurrent
      // proposal of the same name only on a unique-name conflict, which is
      // exactly when reading it back is the right answer.
      const shelf = await db.collection
        .create({ data: { name: wanted, description: "Created by enrichment (kb-lib-2)." }, select: { id: true, name: true } })
        .catch(async () => db.collection.findUnique({ where: { name: wanted }, select: { id: true, name: true } }));
      if (shelf) {
        collectionId = shelf.id;
        filedName = shelf.name;
        created = true;
      }
    }
  }

  await db.document.update({
    where: { id: documentId },
    data: {
      topics: enrichment.topics,
      aiSummary: enrichment.summary,
      enrichModel: modelName,
      enrichedAt: new Date(),
      ...(collectionId !== doc.collectionId ? { collectionId } : {}),
    },
  });
  return { status: "enriched", documentId, topics: enrichment.topics, collection: filedName, created };
}

/** Enrich every indexed FILE document that has no enrichment yet, oldest
 *  first, one at a time — a bulk run is a settings-panel button, and a
 *  button that fires fifty parallel model calls is a bill, not a feature. */
export async function enrichPending(limit = 25): Promise<{ walked: number; enriched: number; failed: number; skipped: number }> {
  const settings = await getEnrichSettings();
  const report = { walked: 0, enriched: 0, failed: 0, skipped: 0 };
  if (!settings.enabled) return report;
  const docs = await db.document.findMany({
    where: { textStatus: "EXTRACTED", kind: "FILE", enrichedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const d of docs) {
    report.walked++;
    const outcome = await enrichDocument(d.id, { settings });
    if (outcome.status === "enriched") report.enriched++;
    else if (outcome.status === "failed") report.failed++;
    else report.skipped++;
  }
  return report;
}

/** The ingest hook: fire-and-forget so an upload answers as fast as it did
 *  before, with the outcome on the server log. Nothing here can throw. */
export function enrichAfterIngest(documentId: string): void {
  void enrichDocument(documentId)
    .then((outcome) => {
      if (outcome.status === "failed") {
        console.error(`[servo] enrichment failed for ${documentId}: ${outcome.error}`);
      }
    })
    .catch((err: unknown) => {
      console.error(`[servo] enrichment crashed for ${documentId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}
