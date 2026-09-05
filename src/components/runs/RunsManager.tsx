"use client";

// The runs console (spec ux-05): a cross-ticket, read-only monitor of what
// every agent is doing and has done. Three-layer progressive disclosure per
// docs/design/ux.md §9.6 — the row's human summary, the run's step
// timeline, a step's raw content. No mutation surface: nothing here can
// start, stop or resume a run.
//
// The list is built to be scanned: the kind as a mono chip, the agent with
// its dot, the ticket, a status chip, the QA verdict, and a duration bar
// scaled to the longest run on screen so the slow ones stand out. A row
// opens its step timeline in place; the trace itself is RunStepTimeline,
// the same component the ticket page renders.

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, ChevronRight, RefreshCw } from "lucide-react";
import Markdown from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import MonoBlock from "@/components/runs/MonoBlock";
import QaNote from "@/components/runs/QaNote";
import RunChip, { RUN_STATUS_CHIP, RUN_STATUS_TEXT } from "@/components/runs/RunChip";
import RunStepTimeline from "@/components/runs/RunStepTimeline";
import { elapsedMs, formatDuration } from "@/components/runs/run-format";
import { RUN_STATUS_LABEL } from "@/lib/labels";
import type { RunView } from "@/lib/runs-views";
import { cn } from "@/lib/utils";

interface RunDetail {
  run: Omit<RunView, "steps" | "approvals"> & {
    qaNotes: string | null;
    steps: { id: string; index: number; type: string; toolName: string | null; content: string; riskLevel: string | null; createdAt: string }[];
    approvals: { id: string; toolName: string; riskLevel: string; status: string; reason: string | null; requestedAt: string; decidedAt: string | null; decider: { name: string } | null }[];
  };
}

/** The agent's dot: which kind of agent ran, in the status inks. */
const AGENT_DOT: Record<string, string> = {
  RESOLVER: "bg-(--brand-chip-ink)",
  TRIAGE: "bg-(--info-chip-ink)",
  QA: "bg-(--neutral-chip-ink)",
};

const COLUMNS =
  "md:grid md:grid-cols-[88px_minmax(150px,1fr)_minmax(200px,1.7fr)_136px_72px_200px_92px] md:items-center md:gap-x-4";

const CONTROL =
  "h-8 rounded-md border border-(--line-strong) bg-(--surface) px-2 font-sans text-[12.5px] text-(--text-body) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)";

const LABEL = "font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-(--text-faint)";

export default function RunsManager({ initialRuns }: { initialRuns: RunView[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, RunDetail["run"]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  // The clock arrives after mount so the server and client first paints agree;
  // until then a running run shows no bar.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [runs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (kind) params.set("kind", kind);
      const res = await fetch(`/api/runs?${params}`, { cache: "no-store" });
      if (res.ok) setRuns((await res.json()).runs);
    } finally {
      setLoading(false);
    }
  }, [status, kind]);

  useEffect(() => {
    // A filter change re-queries; the initial paint came from the server.
    if (status !== "" || kind !== "") void refresh();
  }, [status, kind, refresh]);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!detail[id]) {
      setDetailLoading(id);
      try {
        const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()).run;
          setDetail((prev) => ({ ...prev, [id]: body }));
        }
      } finally {
        setDetailLoading(null);
      }
    }
  };

  const elapsed = useMemo(
    () => new Map(runs.map((run) => [run.id, elapsedMs(run, now)])),
    [runs, now],
  );
  const longest = useMemo(
    () => Math.max(0, ...[...elapsed.values()].map((ms) => ms ?? 0)),
    [elapsed],
  );

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-(--line) bg-(--bg) px-4 py-3 md:px-8">
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={CONTROL}
        >
          <option value="">All statuses</option>
          {Object.keys(RUN_STATUS_LABEL).map((s) => (
            <option key={s} value={s}>
              {RUN_STATUS_LABEL[s as keyof typeof RUN_STATUS_LABEL].toLowerCase()}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={CONTROL}
        >
          <option value="">All kinds</option>
          <option value="TRIAGE">triage</option>
          <option value="RESOLVE">resolve</option>
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          className={cn(CONTROL, "flex items-center gap-1.5 px-2.5 text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-strong)")}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden />
          Refresh
        </button>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-(--text-muted)">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>

      <div className="p-4 md:p-8">
        {loading && runs.length === 0 ? (
          <ListSkeleton />
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-(--line-strong) bg-(--surface) px-6 py-14 text-center">
            <Activity size={20} strokeWidth={1.75} className="text-(--text-faint)" aria-hidden />
            <div className="font-heading text-[14px] font-semibold text-(--text-strong)">No runs</div>
            <div className="max-w-sm font-sans text-[12.5px] text-(--text-muted)">
              No agent runs match this filter yet. Runs appear here as soon as an agent works a ticket.
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-(--line) bg-(--surface)">
            <div className={cn("hidden border-b border-(--line) bg-(--surface-2) px-4 py-2", COLUMNS, LABEL)}>
              <span>Run</span>
              <span>Agent</span>
              <span>Ticket</span>
              <span>Status</span>
              <span>QA</span>
              <span>Started · duration</span>
              <span>Trace</span>
            </div>
            <ol>
              {runs.map((run, i) => {
                const open = openId === run.id;
                const d = detail[run.id];
                const ms = elapsed.get(run.id) ?? null;
                return (
                  <Fragment key={run.id}>
                    <li className={cn(i > 0 && "border-t border-(--line)")}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => void toggle(run.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void toggle(run.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--focus-ring)",
                        COLUMNS,
                        open ? "bg-(--surface-2)" : "hover:bg-(--surface-inset)",
                      )}
                    >
                      <span>
                        <RunChip tone="neutral">{run.kind}</RunChip>
                      </span>

                      <span className="flex min-w-0 items-center gap-2 font-sans text-[13px]">
                        <span
                          aria-hidden
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            AGENT_DOT[run.agent.aiKind ?? ""] ?? "bg-(--neutral-chip-ink)",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-tight text-(--text-strong)">
                            {run.agent.name}
                          </span>
                          {run.profile?.name && (
                            <span className="block truncate text-[11.5px] leading-tight text-(--text-muted)">
                              {run.profile.name}
                            </span>
                          )}
                        </span>
                      </span>

                      <span className="min-w-0 basis-full font-sans text-[13px] md:basis-auto">
                        <Link
                          href={`/tickets/${run.ticket.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title={run.ticket.title}
                          className="block truncate text-(--text-body) hover:text-(--text-link) hover:underline"
                        >
                          <span className="font-mono text-[11px] text-(--text-muted)">#{run.ticket.number}</span>{" "}
                          {run.ticket.title}
                        </Link>
                      </span>

                      <span>
                        <RunChip tone={RUN_STATUS_CHIP[run.status] ?? "neutral"}>
                          {RUN_STATUS_TEXT[run.status] ?? run.status.toLowerCase()}
                        </RunChip>
                      </span>

                      <span>
                        {run.qaVerdict ? (
                          <RunChip tone={run.qaVerdict === "PASS" ? "good" : "critical"}>{run.qaVerdict}</RunChip>
                        ) : (
                          <span className="hidden font-mono text-[11px] text-(--text-faint) md:inline">—</span>
                        )}
                      </span>

                      <span className="min-w-0 basis-full md:basis-auto">
                        <DurationCell run={run} ms={ms} longest={longest} />
                      </span>

                      {/* What the click opens: the step count, and a chevron that turns. */}
                      <span className="ml-auto flex items-center justify-end gap-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-(--text-muted) md:ml-0">
                        {run.steps} {run.steps === 1 ? "step" : "steps"}
                        <ChevronRight
                          size={14}
                          aria-hidden
                          className={cn(
                            "text-(--text-faint) transition-transform",
                            open && "rotate-90 text-(--text-strong)",
                          )}
                        />
                      </span>
                    </div>
                    </li>

                    {open && (
                      <li className="border-t border-(--line) bg-(--surface-inset) px-4 py-4 md:px-6">
                        {detailLoading === run.id && !d ? (
                          <TraceSkeleton />
                        ) : d ? (
                          <TracePanel run={d} onClose={() => setOpenId(null)} />
                        ) : (
                          <p className="py-6 text-center font-sans text-[12.5px] text-(--critical)">
                            Run trace unavailable.
                          </p>
                        )}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cells and panels
// ---------------------------------------------------------------------------

function DurationCell({
  run,
  ms,
  longest,
}: {
  run: RunView;
  ms: number | null;
  longest: number;
}) {
  const running = !run.completedAt;
  // Only a RUNNING run is in flight; one waiting on a human is paused.
  const inFlight = run.status === "RUNNING";
  const width = ms === null || longest === 0 ? 0 : Math.max(2, Math.round((ms / longest) * 100));
  return (
    <span className="block min-w-0">
      <span className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
        <RelativeTime value={run.createdAt} className="text-(--text-muted)" />
        <span className={running ? "text-(--text-muted)" : "text-(--text-strong)"}>
          {ms === null ? (inFlight ? "running" : "paused") : formatDuration(ms)}
          {inFlight && ms !== null ? " …" : ""}
        </span>
      </span>
      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-(--surface-2)" aria-hidden>
        <span
          className="block h-full rounded-full bg-(--chart-2) transition-[width] duration-200"
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  );
}

function TracePanel({ run, onClose }: { run: RunDetail["run"]; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={LABEL}>Trace</span>
        <Link
          href={`/tickets/${run.ticket.id}`}
          className="inline-flex items-center gap-1 font-sans text-[12.5px] font-medium text-(--text-link) hover:underline"
        >
          <span className="font-mono text-[11px]">#{run.ticket.number}</span>
          <span className="max-w-[40ch] truncate">{run.ticket.title}</span>
          <ArrowUpRight size={12} aria-hidden />
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex h-7 items-center rounded-md border border-(--line-strong) bg-(--surface) px-2 font-sans text-[12px] text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-strong)"
        >
          Collapse
        </button>
      </div>

      {run.summary && (
        <div className="rounded-md border border-(--line) bg-(--surface) px-4 py-3">
          <Markdown className="text-(--text-body)">{run.summary}</Markdown>
        </div>
      )}

      {run.error && <MonoBlock raw={run.error} tone="critical" />}

      {run.qaNotes && <QaNote notes={run.qaNotes} />}

      <RunStepTimeline
        run={run}
        steps={run.steps}
        approvals={run.approvals}
        agentName={run.profile?.name ?? run.agent.name}
      />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-(--line) bg-(--surface)" aria-busy>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn("flex items-center gap-4 px-4 py-3", i > 0 && "border-t border-(--line)")}>
          <span className="h-5 w-16 animate-pulse rounded-full bg-(--surface-2)" />
          <span className="h-3 w-32 animate-pulse rounded bg-(--surface-2)" />
          <span className="h-3 flex-1 animate-pulse rounded bg-(--surface-2)" />
          <span className="h-5 w-24 animate-pulse rounded-full bg-(--surface-2)" />
        </div>
      ))}
    </div>
  );
}

function TraceSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <span className="sr-only">Loading run trace</span>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-(--line) bg-(--line) sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse bg-(--surface-2)" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-(--surface-2)" />
          <div className="flex-1 space-y-2">
            <span className="block h-3 w-40 animate-pulse rounded bg-(--surface-2)" />
            <span className="block h-10 animate-pulse rounded bg-(--surface-2)" />
          </div>
        </div>
      ))}
    </div>
  );
}
