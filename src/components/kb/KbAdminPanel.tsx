"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, FolderPlus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/labels";
import { Chip } from "@/components/kb/KbChip";
import { BTN_OUTLINE, BTN_PRIMARY, INPUT, LABEL, NOTE_CRITICAL, NOTE_WARN } from "@/components/kb/kb-controls";

export interface KbAdminSettings {
  embedBaseUrl: string;
  embedModel: string;
  embedDimensions: string;
  autodeliverCategories: string[];
  dailyCap: string;
  /** kb-lib-2: the opt-in model enrichment switch, its filing switch, and
   *  how many indexed documents have no enrichment yet. */
  enrichEnabled: boolean;
  enrichAutoFile: boolean;
  enrichPending: number;
}

/** The Knowledge admin panel (kb-17): collections, embeddings configuration
 *  with the query-egress warning BESIDE the field (not in a doc nobody
 *  opens), and auto-delivery toggles carrying the sends-without-a-human
 *  warning. Everything here requires settings.manage server-side. */
export interface ExtractorHealth {
  configured: boolean;
  url: string;
  version: string;
  circuit: string;
}

export interface FallbackQueueEntry {
  id: string;
  name: string;
  extractorFallback: string;
}

/** The panel's sections, in order — the header strip links to each so a
 *  long admin page is a jump away, not a scroll. */
const SECTIONS = [
  { id: "kb-admin-collections", label: "Collections" },
  { id: "kb-admin-extractor", label: "Extractor" },
  { id: "kb-admin-queue", label: "Queue" },
  { id: "kb-admin-enrichment", label: "Enrichment" },
  { id: "kb-admin-embeddings", label: "Embeddings" },
  { id: "kb-admin-autodelivery", label: "Auto-delivery" },
] as const;

/** One definition row: the term and its hint on the left, the controls on
 *  the right. Stacks on narrow screens. */
function AdminRow({ id, title, hint, testId, children }: { id: string; title: string; hint: ReactNode; testId?: string; children: ReactNode }) {
  return (
    <div id={id} data-testid={testId} className="grid scroll-mt-20 gap-3 px-4 py-4 md:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] md:gap-8">
      <dt>
        <p className="font-heading text-[13px] font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </dt>
      <dd className="flex min-w-0 flex-col gap-2">{children}</dd>
    </div>
  );
}

/** A labelled switch: the design system's boolean policy toggle, with a
 *  mono on/off readout so the state survives a greyscale print. */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-2 ${disabled ? "opacity-60" : ""}`}>
      <span className="min-w-0">
        <span className="block font-heading text-[12.5px] font-medium text-foreground">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{checked ? "on" : "off"}</span>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </span>
    </label>
  );
}

export default function KbAdminPanel({
  settings,
  collections,
  extractorHealth,
  fallbackQueue,
}: {
  settings: KbAdminSettings;
  collections: { id: string; name: string; documentCount?: number }[];
  /** dcl-09: the sidecar surface + the fallback queue. */
  extractorHealth: ExtractorHealth;
  fallbackQueue: FallbackQueueEntry[];
}) {
  const router = useRouter();
  const [embed, setEmbed] = useState(settings);
  const [newCollection, setNewCollection] = useState("");
  const [draining, setDraining] = useState(false);
  const [drainNote, setDrainNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nonLocalEndpoint =
    embed.embedBaseUrl.length > 0 &&
    !/localhost|127\.0\.0\.1|::1/i.test(embed.embedBaseUrl);

  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);

  async function enrichPending() {
    setEnriching(true);
    setEnrichNote(null);
    try {
      const res = await fetch("/api/kb/enrich", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { walked?: number; enriched?: number; failed?: number; skipped?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Enrichment failed.");
      setEnrichNote(
        `Walked ${body?.walked ?? 0}: ${body?.enriched ?? 0} enriched, ${body?.failed ?? 0} failed, ${body?.skipped ?? 0} skipped.`,
      );
      router.refresh();
    } catch (err) {
      setEnrichNote(err instanceof Error ? err.message : "Enrichment failed.");
    } finally {
      setEnriching(false);
    }
  }

  async function put(payload: Record<string, string | boolean>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function drainQueue() {
    setDraining(true);
    setDrainNote(null);
    try {
      const res = await fetch("/api/kb/reextract-queue", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { walked?: number; drained?: number; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "The drain failed.");
      setDrainNote(`Walked ${body?.walked ?? 0}, cleared ${body?.drained ?? 0}.`);
      router.refresh();
    } catch (err) {
      setDrainNote(err instanceof Error ? err.message : "The drain failed.");
    } finally {
      setDraining(false);
    }
  }

  async function createCollection() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kb/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newCollection }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Create failed.");
      setNewCollection("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="kb-admin" className="mt-8 scroll-mt-20 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-(--surface-2) px-4 py-2.5">
        <h2 className={LABEL}>Knowledge admin</h2>
        <nav className="flex flex-wrap gap-0.5" aria-label="Admin sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full px-2 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      {error && <p className={`${NOTE_CRITICAL} rounded-none border-x-0 border-t-0`}>{error}</p>}

      <dl className="divide-y divide-border">
        {/* --- Collections ------------------------------------------------- */}
        <AdminRow id="kb-admin-collections" title="Collections" hint="The shelves documents are filed on. A shelf is a filter in the library and a node in the graph.">
          <ul className="flex flex-wrap gap-1.5">
            {collections.map((c) => (
              <li key={c.id}>
                <Chip tone="neutral" icon={<FolderOpen size={11} />}>
                  {c.name}
                  {c.documentCount !== undefined ? ` · ${c.documentCount}` : ""}
                </Chip>
              </li>
            ))}
            {collections.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
          </ul>
          <div className="flex items-center gap-2">
            <input
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              placeholder="New collection name"
              aria-label="New collection name"
              className={`${INPUT} max-w-xs px-2.5`}
            />
            <button type="button" disabled={busy || !newCollection.trim()} onClick={() => void createCollection()} className={BTN_OUTLINE}>
              <FolderPlus size={13} /> Create
            </button>
          </div>
        </AdminRow>

        {/* --- Extraction sidecar (dcl-09) --------------------------------- */}
        <AdminRow
          id="kb-admin-extractor"
          title="Extraction sidecar"
          hint={
            extractorHealth.configured
              ? "The high-fidelity extraction lane. A version mismatch after an image change shows up HERE, as a version — not as a stream of fallback baselines."
              : "Not configured — every document extracts on the built-in baseline (exceljs, unpdf, the text chunker). Configuring kb.extract.docling.url opts PDFs into the high-fidelity lane."
          }
        >
          {extractorHealth.configured ? (
            <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border text-xs sm:grid-cols-3">
              {[
                ["URL", extractorHealth.url],
                ["Reported version", extractorHealth.version],
                ["Circuit", extractorHealth.circuit],
              ].map(([term, value]) => (
                <div key={term} className="bg-background px-3 py-2">
                  <dt className={LABEL}>{term}</dt>
                  <dd className="mt-1 break-all font-mono text-[11px] text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Chip tone="neutral" caps>baseline only</Chip>
          )}
        </AdminRow>

        {/* --- The re-extraction queue (dcl-09) ----------------------------- */}
        <AdminRow id="kb-admin-queue" title="Re-extraction queue" hint="Documents that landed on the baseline because the high-fidelity extractor was unavailable. Draining walks them one at a time.">
          {fallbackQueue.length === 0 ? (
            <p className="text-xs text-muted-foreground">Empty — every document carries its preferred extraction.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-lg border border-border bg-background">
                {fallbackQueue.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <a href={`/kb/${entry.id}`} className="min-w-0 flex-1 truncate hover:underline">{entry.name}</a>
                    <Chip tone="warn" caps>{entry.extractorFallback}</Chip>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={draining} onClick={() => void drainQueue()} className={BTN_OUTLINE}>
                  {draining ? "Draining…" : `Re-extract ${fallbackQueue.length} document${fallbackQueue.length === 1 ? "" : "s"}`}
                </button>
                {drainNote && <span className="text-xs text-muted-foreground">{drainNote}</span>}
              </div>
            </>
          )}
        </AdminRow>

        {/* --- AI enrichment (kb-lib-2) ------------------------------------- */}
        <AdminRow
          id="kb-admin-enrichment"
          testId="kb-enrichment"
          title="AI enrichment (optional)"
          hint={
            <>
              Off by default. When on, every newly indexed document is sent (a sample
              of up to 12k characters) to the configured model provider, which writes
              topics, a summary in the document&apos;s language and a shelf to file it on.
              This is the one place ingest sends document CONTENT outside this
              container — the same provider and key your tickets already use.
            </>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              label="Enrichment"
              hint="Topics, a summary and a suggested shelf for every newly indexed document."
              checked={embed.enrichEnabled}
              disabled={busy}
              onChange={(next) => {
                setEmbed({ ...embed, enrichEnabled: next });
                void put({ kbEnrichEnabled: next });
              }}
            />
            <ToggleRow
              label="Auto-file"
              hint="File unfiled documents on the shelf the model names, creating the collection when it is new. Documents a person already filed are never moved."
              checked={embed.enrichAutoFile}
              disabled={busy || !embed.enrichEnabled}
              onChange={(next) => {
                setEmbed({ ...embed, enrichAutoFile: next });
                void put({ kbEnrichAutoFile: next });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={enriching || !embed.enrichEnabled || settings.enrichPending === 0}
              onClick={() => void enrichPending()}
              className={BTN_OUTLINE}
            >
              {enriching
                ? "Enriching…"
                : `Enrich ${settings.enrichPending} pending document${settings.enrichPending === 1 ? "" : "s"}`}
            </button>
            {enrichNote && <span className="text-xs text-muted-foreground">{enrichNote}</span>}
          </div>
        </AdminRow>

        {/* --- Embeddings -------------------------------------------------- */}
        <AdminRow
          id="kb-admin-embeddings"
          title="Embeddings (optional)"
          hint="Keyword-only search is the shipped default and keeps every question inside your infrastructure. With no embeddings endpoint configured, retrieval is tsvector-only and nothing leaves the container."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={embed.embedBaseUrl}
              onChange={(e) => setEmbed({ ...embed, embedBaseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              aria-label="Embeddings base URL"
              className={`${INPUT} px-2.5 font-mono text-xs`}
            />
            <input
              value={embed.embedModel}
              onChange={(e) => setEmbed({ ...embed, embedModel: e.target.value })}
              placeholder="model (e.g. nomic-embed-text)"
              aria-label="Embeddings model"
              className={`${INPUT} px-2.5 font-mono text-xs`}
            />
            <input
              value={embed.embedDimensions}
              onChange={(e) => setEmbed({ ...embed, embedDimensions: e.target.value })}
              placeholder="dimensions (≤ 1536, empty = native)"
              aria-label="Embeddings dimensions"
              className={`${INPUT} px-2.5 font-mono text-xs`}
            />
          </div>
          {nonLocalEndpoint && (
            <p className={NOTE_WARN}>
              Query egress: with a non-local endpoint, the question text — which
              may carry requester PII — is sent to this endpoint on every search.
              A local Ollama or vLLM base URL is the private-with-vectors mode.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void put({
                kbEmbedBaseUrl: embed.embedBaseUrl,
                kbEmbedModel: embed.embedModel,
                kbEmbedDimensions: embed.embedDimensions,
              })
            }
            className={`${BTN_PRIMARY} self-start`}
          >
            Save embeddings
          </button>
        </AdminRow>

        {/* --- Auto-deliver ------------------------------------------------ */}
        <AdminRow id="kb-admin-autodelivery" title="Auto-delivery" hint="Per category, whether a cited reply may go out without a person reviewing it. Default is OFF for every category.">
          <p className={NOTE_WARN}>
            These toggles send replies WITHOUT a human reviewing them (cited,
            re-verified at send time, QA-checked and capped per day — but
            unattended). Default is OFF for every category.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((category) => {
              const on = embed.autodeliverCategories.includes(category);
              return (
                <ToggleRow
                  key={category}
                  label={CATEGORY_LABEL[category]}
                  hint={<span className="font-mono">{category}</span>}
                  checked={on}
                  disabled={busy}
                  onChange={() =>
                    void put({
                      kbAutodeliverCategories: on
                        ? embed.autodeliverCategories.filter((c) => c !== category).join(",")
                        : [...embed.autodeliverCategories, category].join(","),
                    })
                  }
                />
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={embed.dailyCap}
              onChange={(e) => setEmbed({ ...embed, dailyCap: e.target.value })}
              placeholder="daily cap (default 20)"
              aria-label="Daily cap"
              className={`${INPUT} w-48 px-2.5 font-mono text-xs`}
            />
            <button type="button" disabled={busy} onClick={() => void put({ kbAutodeliverDailyCap: embed.dailyCap })} className={BTN_OUTLINE}>
              Save cap
            </button>
          </div>
        </AdminRow>
      </dl>
    </section>
  );
}
