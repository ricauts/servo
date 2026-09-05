"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { BTN_OUTLINE_SM } from "@/components/kb/kb-controls";

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
      {error && <span className="font-mono text-[11px] text-(--critical-chip-ink)">{error}</span>}
      <button type="button" onClick={run} disabled={busy} className={BTN_OUTLINE_SM}>
        <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
        {busy ? "Re-extracting…" : "Re-extract"}
      </button>
    </span>
  );
}
