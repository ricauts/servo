"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";
import { CATEGORIES } from "@/lib/types";

export interface KbAdminSettings {
  embedBaseUrl: string;
  embedModel: string;
  embedDimensions: string;
  autodeliverCategories: string[];
  dailyCap: string;
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

  async function put(payload: Record<string, string>) {
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
    <section className="mt-8 rounded-md border border-border bg-card p-4">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        Knowledge admin
      </h2>

      {error && (
        <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--critical-chip-ink)" }}>
          {error}
        </p>
      )}

      {/* --- Collections ------------------------------------------------- */}
      <div className="mt-3">
        <p className="font-heading text-[13px] font-medium">Collections</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {collections.map((c) => (
            <li
              key={c.id}
              className="rounded-full border px-2 py-px font-mono text-[10.5px]"
              style={{ borderColor: "var(--line)", color: "var(--text-muted)" }}
            >
              {c.name}
              {c.documentCount !== undefined ? ` · ${c.documentCount}` : ""}
            </li>
          ))}
          {collections.length === 0 && (
            <li className="text-xs text-muted-foreground">None yet.</li>
          )}
        </ul>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            placeholder="New collection name"
            className="min-w-48 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={busy || !newCollection.trim()}
            onClick={() => void createCollection()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-heading text-[12.5px] font-medium disabled:opacity-50"
          >
            <FolderPlus size={13} /> Create
          </button>
        </div>
      </div>

      {/* --- Extraction sidecar (dcl-09) --------------------------------- */}
      <div className="mt-5">
        <p className="font-heading text-[13px] font-medium">Extraction sidecar</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {extractorHealth.configured
            ? "The high-fidelity extraction lane. A version mismatch after an image change shows up HERE, as a version — not as a stream of fallback baselines."
            : "Not configured — every document extracts on the built-in baseline (exceljs, unpdf, the text chunker). Configuring kb.extract.docling.url opts PDFs into the high-fidelity lane."}
        </p>
        {extractorHealth.configured && (
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">URL</dt>
              <dd className="font-mono text-[11px]">{extractorHealth.url}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reported version</dt>
              <dd className="font-mono text-[11px]">{extractorHealth.version}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Circuit</dt>
              <dd className="font-mono text-[11px]">{extractorHealth.circuit}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* --- The re-extraction queue (dcl-09) ----------------------------- */}
      <div className="mt-5">
        <p className="font-heading text-[13px] font-medium">Re-extraction queue</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Documents that landed on the baseline because the high-fidelity
          extractor was unavailable. Draining walks them one at a time.
        </p>
        {fallbackQueue.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Empty — every document carries its preferred extraction.</p>
        ) : (
          <>
            <ul className="mt-2 space-y-1">
              {fallbackQueue.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 text-xs">
                  <a href={`/kb/${entry.id}`} className="hover:underline">{entry.name}</a>
                  <span className="font-mono text-[10.5px] text-muted-foreground">{entry.extractorFallback}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={draining}
                onClick={() => void drainQueue()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-heading text-[12.5px] font-medium disabled:opacity-50"
              >
                {draining ? "Draining…" : `Re-extract ${fallbackQueue.length} document${fallbackQueue.length === 1 ? "" : "s"}`}
              </button>
              {drainNote && <span className="text-xs text-muted-foreground">{drainNote}</span>}
            </div>
          </>
        )}
      </div>

      {/* --- Embeddings -------------------------------------------------- */}
      <div className="mt-5">
        <p className="font-heading text-[13px] font-medium">Embeddings (optional)</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Keyword-only search is the shipped default and keeps every question
          inside your infrastructure. With no embeddings endpoint configured,
          retrieval is tsvector-only and nothing leaves the container.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            value={embed.embedBaseUrl}
            onChange={(e) => setEmbed({ ...embed, embedBaseUrl: e.target.value })}
            placeholder="http://localhost:11434/v1"
            className="rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
          <input
            value={embed.embedModel}
            onChange={(e) => setEmbed({ ...embed, embedModel: e.target.value })}
            placeholder="model (e.g. nomic-embed-text)"
            className="rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
          <input
            value={embed.embedDimensions}
            onChange={(e) => setEmbed({ ...embed, embedDimensions: e.target.value })}
            placeholder="dimensions (≤ 1536, empty = native)"
            className="rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
        </div>
        {nonLocalEndpoint && (
          <p
            className="mt-2 rounded-md border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: "var(--warn-chip-line)",
              background: "var(--warn-chip)",
              color: "var(--warn-chip-ink)",
            }}
          >
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
          className="mt-2 rounded-md bg-primary px-3 py-1.5 font-heading text-[12.5px] font-medium text-primary-foreground disabled:opacity-50"
        >
          Save embeddings
        </button>
      </div>

      {/* --- Auto-deliver ------------------------------------------------ */}
      <div className="mt-5">
        <p className="font-heading text-[13px] font-medium">Auto-delivery</p>
        <p
          className="mt-1 rounded-md border px-3 py-2 font-mono text-[11px]"
          style={{
            borderColor: "var(--warn-chip-line)",
            background: "var(--warn-chip)",
            color: "var(--warn-chip-ink)",
          }}
        >
          These toggles send replies WITHOUT a human reviewing them (cited,
          re-verified at send time, QA-checked and capped per day — but
          unattended). Default is OFF for every category.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CATEGORIES.map((category) => {
            const on = embed.autodeliverCategories.includes(category);
            return (
              <button
                key={category}
                type="button"
                disabled={busy}
                onClick={() =>
                  void put({
                    kbAutodeliverCategories: on
                      ? embed.autodeliverCategories.filter((c) => c !== category).join(",")
                      : [...embed.autodeliverCategories, category].join(","),
                  })
                }
                className="rounded-full border px-2 py-px font-mono text-[10.5px] uppercase tracking-wider disabled:opacity-50"
                style={{
                  borderColor: on ? "var(--brand-chip-line)" : "var(--line)",
                  background: on ? "var(--brand-chip)" : "transparent",
                  color: on ? "var(--brand-chip-ink)" : "var(--text-muted)",
                }}
              >
                {category}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={embed.dailyCap}
            onChange={(e) => setEmbed({ ...embed, dailyCap: e.target.value })}
            placeholder="daily cap (default 20)"
            className="w-48 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void put({ kbAutodeliverDailyCap: embed.dailyCap })}
            className="rounded-md border border-border px-2.5 py-1.5 font-heading text-[12.5px] font-medium disabled:opacity-50"
          >
            Save cap
          </button>
        </div>
      </div>
    </section>
  );
}
