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
export default function KbAdminPanel({
  settings,
  collections,
}: {
  settings: KbAdminSettings;
  collections: { id: string; name: string; documentCount?: number }[];
}) {
  const router = useRouter();
  const [embed, setEmbed] = useState(settings);
  const [newCollection, setNewCollection] = useState("");
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
