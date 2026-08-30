"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * The re-extract action (dcl-09): re-runs extraction on the stored bytes
 * with the currently configured extractor — chunks, edges and embeddings
 * replaced, grants untouched. Sits beside the extractor provenance so a
 * fallback row never reads as a silent baseline.
 */
export default function KbReextractButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/kb/documents/${documentId}/reextract`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Re-extraction failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-extraction failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="ml-auto inline-flex items-center gap-2">
      {error && <span className="text-critical-fore" style={{ color: "var(--critical)" }}>{error}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40 disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
        {busy ? "Re-extracting…" : "Re-extract"}
      </button>
    </span>
  );
}
