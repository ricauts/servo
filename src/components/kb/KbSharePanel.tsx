"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Share2 } from "lucide-react";
import { Chip } from "@/components/kb/KbChip";
import { BTN_PRIMARY, INPUT, LABEL, SELECT_TEXT } from "@/components/kb/kb-controls";

/** The share panel (kb-17): share/revoke USER / GROUP / AGENT grants and the
 *  effective-readers preview that resolves through the SAME entitlement CTE
 *  retrieval uses — if the preview and retrieval ever disagree, one of them
 *  is a bug. */
export default function KbSharePanel({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [subjectType, setSubjectType] = useState<"USER" | "GROUP" | "AGENT">("AGENT");
  const [subjectId, setSubjectId] = useState("builtin:resolver");
  const [readers, setReaders] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/kb/documents/${documentId}/readers`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Preview failed.");
      const body = (await res.json()) as { readers: { id: string; name: string }[] };
      setReaders(body.readers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    }
  }, [documentId]);

  useEffect(() => {
    if (open && readers === null) void refresh();
  }, [open, readers, refresh]);

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/kb/documents/${documentId}/grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Share failed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Share failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card px-3.5 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 font-heading text-[13px] font-semibold text-foreground"
      >
        <ChevronRight size={13} className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <Share2 size={13} /> Share
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {/* One 32px control row: subject kind, subject id, the action. */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={subjectType}
              onChange={(e) => setSubjectType(e.target.value as "USER" | "GROUP" | "AGENT")}
              aria-label="Subject kind"
              className={SELECT_TEXT}
            >
              <option value="USER">User</option>
              <option value="GROUP">Group</option>
              <option value="AGENT">Agent</option>
            </select>
            <input
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder="user/group/agent id — e.g. builtin:resolver"
              aria-label="Subject id"
              className={`${INPUT} min-w-56 flex-1 px-2.5 font-mono text-xs`}
            />
            <button
              type="button"
              disabled={busy || !subjectId.trim()}
              onClick={() => void share()}
              className={BTN_PRIMARY}
            >
              {busy ? "Sharing…" : "Grant read"}
            </button>
          </div>
          {error && <p className="font-mono text-[11px] text-(--critical-chip-ink)">{error}</p>}
          <div>
            <p className={LABEL}>Who can read this now</p>
            {readers === null ? (
              <p className="mt-1 text-xs text-muted-foreground">Resolving…</p>
            ) : readers.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Only the owner.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {readers.map((r) => (
                  <li key={r.id}>
                    <Chip tone="neutral" title={r.id}>{r.name}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
