// Server component: unified chronological story of a ticket — description,
// human/AI comments and agent-run steps merged into one stream.
// shadcn Cards render the bodies; the gutter markers and step tints use the
// semantic status tone utilities (good/warn/critical/violet).

import type {
  AgentRun,
  AgentStep,
  Approval,
  Comment,
  Ticket,
  User,
} from "@prisma/client";
import {
  AlertTriangle,
  ClipboardCheck,
  Info,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import JsonBlock from "@/components/tickets/JsonBlock";
import Markdown from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import RunGroup from "@/components/tickets/RunGroup";
import {
  APPROVAL_STATUS_TONE,
  RISK_LABEL,
  RISK_TONE,
} from "@/lib/labels";
import type { ApprovalStatus, RiskLevel } from "@/lib/types";
import { AVATAR_FALLBACK_COLOR } from "@/lib/avatar";

type CommentWithAuthor = Comment & { author: User };
type ApprovalWithDecider = Approval & { decider: User | null };
type RunWithSteps = AgentRun & {
  steps: AgentStep[];
  approvals: ApprovalWithDecider[];
  profile?: { name: string } | null;
};

type TimelineItem =
  | { key: string; at: Date; kind: "description" }
  | { key: string; at: Date; kind: "comment"; comment: CommentWithAuthor }
  | { key: string; at: Date; kind: "run"; run: RunWithSteps };

/**
 * A tool call and the result it produced read as one event, not two. Pairing
 * them halves the length of a trace without dropping anything.
 */
type TracePart =
  | { key: string; kind: "step"; step: AgentStep }
  | { key: string; kind: "call"; call: AgentStep; result: AgentStep | null };

function traceParts(steps: AgentStep[]): TracePart[] {
  const parts: TracePart[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "TOOL_CALL") {
      const next = steps[i + 1];
      const result =
        next && next.type === "TOOL_RESULT" && next.toolName === step.toolName ? next : null;
      if (result) i++;
      parts.push({ key: step.id, kind: "call", call: step, result });
    } else {
      parts.push({ key: step.id, kind: "step", step });
    }
  }
  return parts;
}

function When({ at }: { at: Date }) {
  return (
    <RelativeTime value={at} className="text-xs text-muted-foreground/80" />
  );
}

/** Inline mono chip for tool names. */
function ToolName({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

export default function Timeline({
  ticket,
  comments,
  runs,
  agents,
}: {
  ticket: Ticket & { requester: User };
  comments: CommentWithAuthor[];
  runs: RunWithSteps[];
  agents: Record<string, User>;
}) {
  const items: TimelineItem[] = [
    { key: "description", at: ticket.createdAt, kind: "description" },
    ...comments.map(
      (comment): TimelineItem => ({
        key: `comment-${comment.id}`,
        at: comment.createdAt,
        kind: "comment",
        comment,
      }),
    ),
    // One entry per run rather than one per step: 40 steps of trace collapse
    // into a headline the reader can scan, expandable in place.
    ...runs
      .filter((run) => run.steps.length > 0)
      .map(
        (run): TimelineItem => ({
          key: `run-${run.id}`,
          at: run.createdAt,
          kind: "run",
          run,
        }),
      ),
  ];
  // Stable sort keeps step order intact when timestamps collide.
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="relative">
      <div
        className="absolute bottom-2 left-[13px] top-2 w-px bg-border"
        aria-hidden
      />
      <ol className="space-y-7">
        {items.map((item) => (
          <li key={item.key} className="relative pl-10">
            <span className="absolute left-0 top-0">
              <Marker item={item} ticket={ticket} agents={agents} />
            </span>
            <ItemBody item={item} ticket={ticket} agents={agents} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function IconDot({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-md border ${className}`}
    >
      {children}
    </span>
  );
}

function Marker({
  item,
  ticket,
  agents,
}: {
  item: TimelineItem;
  ticket: Ticket & { requester: User };
  agents: Record<string, User>;
}) {
  if (item.kind === "description") {
    return (
      <Avatar
        name={ticket.requester.name}
        color={ticket.requester.color}
        size={28}
      />
    );
  }
  if (item.kind === "comment") {
    const { author } = item.comment;
    if (item.comment.kind === "SYSTEM") {
      return (
        <IconDot className="border-border bg-muted text-muted-foreground">
          <Info size={14} strokeWidth={1.8} />
        </IconDot>
      );
    }
    return (
      <Avatar
        name={author.name}
        color={author.color}
        size={28}
        isAi={author.role === "AI_AGENT"}
      />
    );
  }

  // A run: the agent's own avatar, so the stream still reads as a
  // conversation between people and agents.
  const agent = agents[item.run.agentUserId];
  return agent ? (
    <Avatar name={agent.name} color={agent.color} size={28} isAi />
  ) : (
    <IconDot className="border-border bg-muted text-muted-foreground">
      <Terminal size={14} strokeWidth={1.8} />
    </IconDot>
  );
}

// ---------------------------------------------------------------------------
// Item bodies
// ---------------------------------------------------------------------------

function ItemBody({
  item,
  ticket,
  agents,
}: {
  item: TimelineItem;
  ticket: Ticket & { requester: User };
  agents: Record<string, User>;
}) {
  if (item.kind === "description") {
    return (
      <div>
        <div className="flex items-center gap-2 font-sans">
          <span className="text-sm font-medium">{ticket.requester.name}</span>
          <span className="text-xs text-muted-foreground/80">
            opened this ticket · <When at={ticket.createdAt} />
          </span>
        </div>
        <Card size="sm" className="mt-2">
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.description}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (item.kind === "comment") {
    const { comment } = item;
    if (comment.kind === "SYSTEM") {
      return (
        <div className="pt-1 font-sans">
          <span className="text-xs text-muted-foreground">
            {comment.body}{" "}
            <span className="whitespace-nowrap">
              · <When at={comment.createdAt} />
            </span>
          </span>
        </div>
      );
    }
    const isAi = comment.author.role === "AI_AGENT";
    return (
      <div>
        <div className="flex items-center gap-2 font-sans">
          <span className="text-sm font-medium">{comment.author.name}</span>
          {isAi && <Badge tone="brand">AI</Badge>}
          <span className="text-xs text-muted-foreground/80">
            commented · <When at={comment.createdAt} />
          </span>
        </div>
        <Card size="sm" className="mt-2">
          <CardContent>
            <Markdown>{comment.body}</Markdown>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { run } = item;
  const agentName = run.profile?.name ?? agents[run.agentUserId]?.name ?? "AI agent";
  return (
    <RunGroup
      run={run}
      agentName={agentName}
      agentColor={agents[run.agentUserId]?.color ?? AVATAR_FALLBACK_COLOR}
    >
      {traceParts(run.steps).map((part) =>
        part.kind === "call" ? (
          <ToolExchange
            key={part.key}
            call={part.call}
            result={part.result}
            agentName={agentName}
          />
        ) : (
          <StepBody key={part.key} step={part.step} run={run} agents={agents} />
        ),
      )}
    </RunGroup>
  );
}

/** A tool call and its result, rendered as one exchange. */
function ToolExchange({
  call,
  result,
  agentName,
}: {
  call: AgentStep;
  result: AgentStep | null;
  agentName: string;
}) {
  const risk = call.riskLevel as RiskLevel | null;
  const failed = result?.content.startsWith("Error:") || result?.content.includes("GitHub error");
  return (
    <div className="font-sans">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground/80">{agentName} called</span>
        <ToolName>{call.toolName ?? "tool"}</ToolName>
        {risk && <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>}
        {failed && <Badge tone="critical">failed</Badge>}
        <span className="text-xs text-muted-foreground/80">
          · <When at={call.createdAt} />
        </span>
      </div>
      <JsonBlock raw={call.content} className="mt-2 max-h-44" />
      {result && (
        <div className="mt-1.5 border-l-2 border-border pl-3">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground/70">
            returned
          </span>
          <JsonBlock raw={result.content} className="mt-1 max-h-40" />
        </div>
      )}
    </div>
  );
}

function StepBody({
  step,
  run,
  agents,
}: {
  step: AgentStep;
  run: RunWithSteps;
  agents: Record<string, User>;
}) {
  const agentName = agents[run.agentUserId]?.name ?? "AI agent";
  const risk = step.riskLevel as RiskLevel | null;
  const when = <When at={step.createdAt} />;

  switch (step.type) {
    case "TEXT":
      return (
        <div className="font-sans">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agentName}</span>
            <Badge tone="brand">AI</Badge>
            <span className="text-xs text-muted-foreground/80">· {when}</span>
          </div>
          <Markdown className="mt-1.5 text-muted-foreground">{step.content}</Markdown>
        </div>
      );

    case "TOOL_CALL":
      return (
        <div className="font-sans">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground/80">
              {agentName} called
            </span>
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            {risk && <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>}
            <span className="text-xs text-muted-foreground/80">· {when}</span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-48" />
        </div>
      );

    case "TOOL_RESULT":
      return (
        <div className="font-sans">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            <span className="text-xs text-muted-foreground/80">
              returned · {when}
            </span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-40" />
        </div>
      );

    case "APPROVAL_REQUEST": {
      // Best-effort match: latest approval on this run for the same tool.
      const approval = [...run.approvals]
        .reverse()
        .find((a) => a.toolName === step.toolName);
      return (
        <div className="rounded-md border border-warn/50 bg-warn-soft/40 p-4 font-sans">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Approval requested</span>
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            {risk && <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>}
            {approval && (
              <Badge
                tone={APPROVAL_STATUS_TONE[approval.status as ApprovalStatus]}
              >
                {approval.status}
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground/80">
              {when}
            </span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-40" />
          {approval && approval.status !== "PENDING" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {approval.status === "APPROVED" ? "Approved" : "Rejected"}
              {approval.decider ? ` by ${approval.decider.name}` : ""}
              {approval.reason ? ` — “${approval.reason}”` : ""}
            </p>
          )}
        </div>
      );
    }

    case "QA_REVIEW": {
      const verdict = run.qaVerdict;
      return (
        <Card
          size="sm"
          className={
            verdict
              ? verdict === "PASS"
                ? "ring-good/40"
                : "ring-critical/40"
              : undefined
          }
        >
          <CardContent className="font-sans">
            <div className="flex items-center gap-2">
              <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                QA review
              </span>
              {verdict && (
                <Badge tone={verdict === "PASS" ? "good" : "critical"}>
                  {verdict}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground/80">
                {when}
              </span>
            </div>
            <Markdown className="mt-2 text-muted-foreground">
              {run.qaNotes ?? step.content}
            </Markdown>
          </CardContent>
        </Card>
      );
    }

    case "ERROR":
      return (
        <div className="rounded-md border border-critical/40 bg-critical-soft/40 p-3 font-sans">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-critical">
              Run error
            </span>
            <span className="ml-auto text-xs text-muted-foreground/80">
              {when}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-critical">
            {step.content}
          </p>
        </div>
      );

    default:
      return (
        <p className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {step.content}
        </p>
      );
  }
}
