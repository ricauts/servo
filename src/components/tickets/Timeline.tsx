// Server component: unified chronological story of a ticket — description,
// human/AI comments and agent runs merged into one stream. shadcn Cards
// render the bodies; a run renders through RunGroup, whose step trace is the
// shared RunStepTimeline (src/components/runs).

import type {
  AgentRun,
  AgentStep,
  Approval,
  Comment,
  Ticket,
  User,
} from "@prisma/client";
import { Info, Terminal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import Markdown from "@/components/tickets/Markdown";
import RelativeTime from "@/components/tickets/RelativeTime";
import RunGroup from "@/components/tickets/RunGroup";
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

function When({ at }: { at: Date }) {
  return (
    <RelativeTime value={at} className="text-xs text-muted-foreground/80" />
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
    <IconDot className="border-(--line) bg-(--surface-2) text-(--text-muted)">
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
    />
  );
}
