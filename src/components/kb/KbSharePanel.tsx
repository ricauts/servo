"use client";

import { useCallback, useEffect, useState } from "react";
import { Share2 } from "lucide-react";

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
    <div className="mt-4 rounded-md border border-border bg-card p-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-heading text-[13px] font-medium"
      >
        <Share2 size={14} /> Share
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={subjectType}
              onChange={(e) => setSubjectType(e.target.value as "USER" | "GROUP" | "AGENT")}
              className="rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
            >
              <option value="USER">User</option>
              <option value="GROUP">Group</option>
              <option value="AGENT">Agent</option>
            </select>
            <input
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder="user/group/agent id — e.g. builtin:resolver"
              className="min-w-56 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              disabled={busy || !subjectId.trim()}
              onClick={() => void share()}
              className="rounded-md bg-primary px-3 py-1.5 font-heading text-[12.5px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Sharing…" : "Grant read"}
            </button>
          </div>
          {error && (
            <p className="font-mono text-[11px]" style={{ color: "var(--critical-chip-ink)" }}>
              {error}
            </p>
          )}
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Who can read this now
            </p>
            {readers === null ? (
              <p className="mt-1 text-xs text-muted-foreground">Resolving…</p>
            ) : readers.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Only the owner.</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {readers.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-full border px-2 py-px font-mono text-[10.5px]"
                    style={{ borderColor: "var(--line)", color: "var(--text-muted)" }}
                  >
                    {r.name}
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
