"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardDrive, RefreshCw } from "lucide-react";

/** The non-secret config a source carries, as the routes accept it. */
export interface SourceView {
  id: string;
  name: string;
  kind: "S3" | "POSTGRES";
  status: string;
  statusError: string | null;
  lastSyncAt: string | null;
  lastCompleteSyncAt: string | null;
  syncEveryMin: number;
  maxRows: number;
  scopeJson: unknown;
  configJson: unknown;
}

/**
 * The sources admin panel (xds-09): the honest status column, the
 * least-privilege credential text an operator should create, and the
 * trigger reminder — the copy never implies Servo schedules anything.
 */
export default function KbSourcesPanel({
  sources,
  leastPrivilege,
  syncHint,
}: {
  sources: SourceView[];
  /** The exact IAM policy / CREATE ROLE text the page renders. */
  leastPrivilege: { kind: "S3" | "POSTGRES"; text: string }[];
  syncHint: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const sync = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/kb/sources/${id}/sync`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; documentsWritten?: number } | null;
      if (!res.ok) setNote(body?.error ?? "The sync was refused.");
      else setNote(`Crawled ${body?.documentsWritten ?? 0} document(s).`);
      router.refresh();
    } catch {
      setNote("Network error — the sync was not started.");
    } finally {
      setBusy(null);
    }
  };

  const statusCopy = (s: SourceView): string => {
    switch (s.status) {
      case "READY":
        return "Ready — indexed and readable through the source ceiling.";
      case "SYNCING":
        return "Crawling now — documents stay readable while it runs.";
      case "ERROR":
        return `Error — ${s.statusError ?? "the last crawl failed"}. Nothing was deleted.`;
      case "UNREACHABLE":
        return "Unreachable — the endpoint did not answer. Deletions are NOT propagating while this lasts; existing documents stay readable.";
      case "DISABLED":
        return "Disabled — the reversible kill switch. Every document it fed is hidden from search and send; re-enable to restore.";
      case "PURGED":
        return "Purged — the stored bytes were destroyed by an administrator.";
      default:
        return s.status;
    }
  };

  return (
    <div className="mt-6">
      <p className="font-heading text-[13px] font-medium">External data sources</p>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{syncHint}</p>

      {sources.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No sources yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <HardDrive size={14} aria-hidden />
                <a href={`/kb/sources/${s.id}`} className="font-heading text-[13px] font-medium hover:underline">{s.name}</a>
                <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{s.kind}</span>
                <span className="font-mono text-[10.5px] uppercase tracking-wider" style={{
                  color: `var(${
                    s.status === "READY" ? "--good"
                    : s.status === "SYNCING" ? "--brand"
                    : s.status === "UNREACHABLE" || s.status === "ERROR" ? "--warn"
                    : "--critical"
                  })`,
                }}>
                  {s.status}
                </span>
                <button
                  type="button"
                  onClick={() => void sync(s.id)}
                  disabled={busy !== null}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={busy === s.id ? "animate-spin" : undefined} />
                  Sync now
                </button>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{statusCopy(s)}</p>
              <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                last run {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "never"}
                {" · "}complete through {s.lastCompleteSyncAt ? new Date(s.lastCompleteSyncAt).toLocaleString() : "never"}
                {s.syncEveryMin > 0 ? ` · hint: every ${s.syncEveryMin} min (an external caller reads this hint; Servo schedules nothing)` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}

      <div className="mt-5 space-y-3">
        <p className="font-heading text-[13px] font-medium">The least-privilege credential to create</p>
        {leastPrivilege.map((lp) => (
          <div key={lp.kind}>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{lp.kind}</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">{lp.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
