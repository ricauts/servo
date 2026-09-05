"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Sparkles } from "lucide-react";
import { BTN_OUTLINE, LABEL, SELECT_TEXT } from "@/components/kb/kb-controls";

/**
 * Filing controls on a document page (kb-lib-2): the shelf (collection)
 * and the visibility, written through PATCH /api/kb/documents/:id, plus the
 * "Enrich now" button when the operator turned enrichment on. Rendered only
 * for actors the route would accept (the page checks owner-or-manage), so a
 * control that would 403 is never shown.
 */
export default function KbDocumentFiling({
  documentId,
  collectionId,
  visibility,
  collections,
  enrichment,
}: {
  documentId: string;
  collectionId: string | null;
  visibility: string;
  collections: { id: string; name: string }[];
  enrichment: { enabled: boolean; enrichedAt: string | null; model: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function patch(body: { collectionId?: string | null; visibility?: string }) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/kb/documents/${documentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed.");
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function enrichNow() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/kb/documents/${documentId}/enrich`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; outcome?: { status: string; collection?: string | null; created?: boolean; reason?: string } }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Enrichment failed.");
      const o = body?.outcome;
      setNote(
        o?.status === "enriched"
          ? o.collection
            ? `Enriched · filed on "${o.collection}"${o.created ? " (new shelf)" : ""}.`
            : "Enriched."
          : `Skipped: ${o?.reason ?? "nothing to do"}.`,
      );
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Enrichment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // One 32px control row: mono micro-labels, two selects in the UI face
    // (their options are sentences, not enums), the optional action flush right.
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs" data-testid="kb-filing">
      <span className={`${LABEL} inline-flex items-center gap-1`}>
        <FolderOpen size={12} /> Shelf
      </span>
      <select
        value={collectionId ?? ""}
        disabled={busy}
        aria-label="Collection"
        onChange={(e) => void patch({ collectionId: e.target.value === "" ? null : e.target.value })}
        className={SELECT_TEXT}
      >
        <option value="">Uncategorized</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className={LABEL}>Visibility</span>
      <select
        value={visibility}
        disabled={busy}
        aria-label="Visibility"
        onChange={(e) => void patch({ visibility: e.target.value })}
        className={SELECT_TEXT}
      >
        <option value="PRIVATE">PRIVATE — owner and grants</option>
        <option value="STAFF">STAFF — every admin and agent</option>
        <option value="PUBLIC">PUBLIC — anyone signed in</option>
      </select>
      {enrichment.enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void enrichNow()}
          className={`${BTN_OUTLINE} ml-auto`}
          title={
            enrichment.enrichedAt
              ? `Last enriched ${enrichment.enrichedAt.slice(0, 16).replace("T", " ")} UTC by ${enrichment.model}`
              : "Send a sample of this document to the model for topics, a summary and a shelf"
          }
        >
          <Sparkles size={12} /> {enrichment.enrichedAt ? "Re-enrich" : "Enrich now"}
        </button>
      )}
      {note && <span className="w-full text-muted-foreground">{note}</span>}
    </div>
  );
}
