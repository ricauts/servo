"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, HardDrive, RefreshCw } from "lucide-react";
import { Chip, sourceStatusTone } from "@/components/kb/KbChip";
import { BTN_OUTLINE, LABEL } from "@/components/kb/kb-controls";

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

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="font-heading text-[13.5px] font-semibold text-foreground">External data sources</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{syncHint}</p>
          </div>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {sources.length} source{sources.length === 1 ? "" : "s"}
          </span>
        </div>

        {sources.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No sources yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {sources.map((s) => (
              <li key={s.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                  <HardDrive size={14} aria-hidden className="text-muted-foreground" />
                  <a href={`/kb/sources/${s.id}`} className="font-heading text-[13.5px] font-semibold text-foreground underline-offset-2 hover:underline">{s.name}</a>
                  <Chip tone="neutral" caps>{s.kind === "POSTGRES" ? "PostgreSQL" : s.kind}</Chip>
                  <Chip tone={sourceStatusTone(s.status)} caps>{s.status}</Chip>
                  <button
                    type="button"
                    onClick={() => void sync(s.id)}
                    disabled={busy !== null}
                    className={`${BTN_OUTLINE} ml-auto`}
                  >
                    <RefreshCw size={12} className={busy === s.id ? "animate-spin" : undefined} />
                    Sync now
                  </button>
                </div>
                <div className="border-t border-border bg-(--surface-2) px-3.5 py-2">
                  <p className="text-xs leading-relaxed text-foreground">{statusCopy(s)}</p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                    last run {when(s.lastSyncAt)}
                    {" · "}complete through {when(s.lastCompleteSyncAt)}
                    {s.syncEveryMin > 0 ? ` · hint: every ${s.syncEveryMin} min (an external caller reads this hint; Servo schedules nothing)` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      </section>

      <section>
        <p className="font-heading text-[13.5px] font-semibold text-foreground">The least-privilege credential to create</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Create exactly this on the source side; the crawler needs nothing more. Open a block to copy it.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {leastPrivilege.map((lp) => (
            <details key={lp.kind} className="group overflow-hidden rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 hover:bg-accent">
                <ChevronRight size={13} className="text-muted-foreground transition-transform group-open:rotate-90" />
                <span className={LABEL}>{lp.kind === "POSTGRES" ? "PostgreSQL" : lp.kind}</span>
                <span className="text-xs text-muted-foreground">{lp.kind === "S3" ? "IAM policy" : "read-only role"}</span>
              </summary>
              <pre className="overflow-x-auto border-t border-border bg-(--surface-inset) px-3.5 py-2.5 font-mono text-[11px] leading-relaxed">{lp.text}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
