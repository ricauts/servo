"use client";

// The runs console (spec ux-05): a cross-ticket, read-only monitor of what
// every agent is doing and has done. Three-layer progressive disclosure per
// docs/design/ux.md §9.6 — the row's human summary, the run's step
// timeline, a step's raw content. No mutation surface: nothing here can
// start, stop or resume a run.

import { useCallback, useEffect, useState, Fragment } from "react";
import Link from "next/link";
import { Activity, ChevronRight, RefreshCw } from "lucide-react";
import Badge from "@/components/legacy/Badge";
import RelativeTime from "@/components/tickets/RelativeTime";
import {
  APPROVAL_STATUS_TONE,
  RISK_LABEL,
  RISK_TONE,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  type BadgeTone,
} from "@/lib/labels";
import type { RunView } from "@/lib/runs-views";

const STEP_TONE: Record<string, BadgeTone> = {
  TEXT: "neutral",
  TOOL_CALL: "brand",
  TOOL_RESULT: "neutral",
  APPROVAL_REQUEST: "warn",
  QA_REVIEW: "violet",
  ERROR: "critical",
};

interface RunDetail {
  run: Omit<RunView, "steps" | "approvals"> & {
    qaNotes: string | null;
    steps: { id: string; index: number; type: string; toolName: string | null; content: string; riskLevel: string | null; createdAt: string }[];
    approvals: { id: string; toolName: string; riskLevel: string; status: string; reason: string | null; requestedAt: string; decidedAt: string | null; decider: { name: string } | null }[];
  };
}

function duration(run: { createdAt: string | Date; completedAt: string | Date | null }): string | null {
  if (!run.completedAt) return null;
  const ms = new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime();
  if (ms < 1000) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export default function RunsManager({ initialRuns }: { initialRuns: RunView[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, RunDetail["run"]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

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

  return (
    <div className="space-y-4 p-4 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-sans text-xs"
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
          className="h-8 rounded-md border border-input bg-background px-2 font-sans text-xs"
        >
          <option value="">All kinds</option>
          <option value="TRIAGE">triage</option>
          <option value="RESOLVE">resolve</option>
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 font-sans text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden />
          Refresh
        </button>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {runs.length} runs
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 px-6 py-14 text-center">
          <Activity size={26} strokeWidth={1.5} className="text-muted-foreground" />
          <div className="font-heading text-[14px] font-medium text-foreground">No runs</div>
          <div className="max-w-sm font-sans text-[12.5px] text-muted-foreground">
            No agent runs match this filter yet. Runs appear here as soon as an agent works a ticket.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">QA</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium" aria-label="Expand" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const open = openId === run.id;
                const d = detail[run.id];
                return (
                  <Fragment key={run.id}>
                    <tr
                      onClick={() => void toggle(run.id)}
                      className={`cursor-pointer border-b border-border transition-colors hover:bg-muted/40 ${open ? "bg-muted/30" : ""}`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-[11px] uppercase text-muted-foreground">
                          {run.kind.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-sans text-[13px]">
                        <span className="font-medium">{run.agent.name}</span>
                        {run.profile?.name && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {run.profile.name}
                          </span>
                        )}
                      </td>
                      <td className="max-w-56 px-3 py-2.5 font-sans text-[13px]">
                        <Link
                          href={`/tickets/${run.ticket.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate hover:underline"
                        >
                          <span className="font-mono text-[11px] text-muted-foreground">
                            #{run.ticket.number}
                          </span>{" "}
                          {run.ticket.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={RUN_STATUS_TONE[run.status as keyof typeof RUN_STATUS_TONE] ?? "neutral"}>
                          {RUN_STATUS_LABEL[run.status as keyof typeof RUN_STATUS_LABEL]?.toLowerCase() ?? run.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {run.qaVerdict ? (
                          <Badge tone={run.qaVerdict === "PASS" ? "good" : "critical"}>
                            {run.qaVerdict}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        <RelativeTime value={run.createdAt} />
                        {duration(run) && <span> · {duration(run)}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <ChevronRight
                          size={14}
                          aria-hidden
                          className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-muted/20">
                        <td colSpan={7} className="px-4 py-3">
                          {detailLoading === run.id && !d ? (
                            <div className="py-6 text-center font-sans text-xs text-muted-foreground">
                              Loading run trace…
                            </div>
                          ) : d ? (
                            <div className="space-y-3">
                              {d.summary && (
                                <p className="font-sans text-[13px] leading-relaxed text-muted-foreground">
                                  {d.summary}
                                </p>
                              )}
                              {d.error && (
                                <p className="rounded-md bg-critical-soft px-3 py-2 font-mono text-xs text-critical">
                                  {d.error}
                                </p>
                              )}
                              {d.qaNotes && (
                                <p className="rounded-md bg-violet-soft/60 px-3 py-2 font-sans text-xs leading-relaxed text-muted-foreground">
                                  <span className="font-heading font-semibold uppercase tracking-wide">
                                    QA
                                  </span>{" "}
                                  {d.qaNotes}
                                </p>
                              )}
                              {d.approvals.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {d.approvals.map((a) => (
                                    <span
                                      key={a.id}
                                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px]"
                                    >
                                      {a.toolName}
                                      {a.riskLevel && (
                                        <Badge tone={RISK_TONE[a.riskLevel as keyof typeof RISK_TONE]}>
                                          {RISK_LABEL[a.riskLevel as keyof typeof RISK_LABEL] ?? a.riskLevel}
                                        </Badge>
                                      )}
                                      <Badge
                                        tone={
                                          a.status === "APPROVED" ? "good" : a.status === "REJECTED" ? "critical" : "warn"
                                        }
                                      >
                                        {a.status.toLowerCase()}
                                      </Badge>
                                      {a.decider && <span className="text-muted-foreground">by {a.decider.name}</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <ol className="space-y-1">
                                {d.steps.map((step) => (
                                  <li key={step.id}>
                                    <details className="group rounded-md border border-border bg-card">
                                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-mono text-[11px] [&::-webkit-details-marker]:hidden">
                                        <span className="w-6 text-muted-foreground/60">
                                          {step.index}
                                        </span>
                                        <Badge tone={STEP_TONE[step.type] ?? "neutral"}>
                                          {step.type.toLowerCase().replace(/_/g, " ")}
                                        </Badge>
                                        {step.toolName && <span>{step.toolName}</span>}
                                        {step.riskLevel && (
                                          <Badge tone={RISK_TONE[step.riskLevel as keyof typeof RISK_TONE]}>
                                            {RISK_LABEL[step.riskLevel as keyof typeof RISK_LABEL] ?? step.riskLevel}
                                          </Badge>
                                        )}
                                        <span className="ml-auto truncate pl-3 text-muted-foreground/70 group-open:hidden">
                                          {step.content.slice(0, 90)}
                                        </span>
                                      </summary>
                                      <pre className="max-h-72 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                                        {step.content}
                                      </pre>
                                    </details>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ) : (
                            <div className="py-6 text-center font-sans text-xs text-critical">
                              Run trace unavailable.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
