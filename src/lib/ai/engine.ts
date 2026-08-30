// The agent engine: triage runs, the resolver loop with approval pauses, the
// resume-after-approval continuation and the automated QA review. The
// conversation (Messages API shape) is persisted to run.conversation on every
// state change — that is what makes a paused run resumable purely from the
// database (run.conversation + the Approval row's toolUseId).

import type { AgentRun, AgentStep, Ticket, ToolPolicy, User } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  AiKind,
  Category,
  ContentBlock,
  ConversationMessage,
  Priority,
  StepType,
} from "@/lib/types";
import { CATEGORIES, PRIORITIES } from "@/lib/types";
import {
  groupForCategory,
  minSeniorityFor,
  pickGroupAssignee,
} from "@/lib/escalation";
import { pickAgentProfile, profileAllowsTool } from "@/lib/agent-profiles";
import {
  enabledSkillCatalog,
  skillCatalogSection,
  skillReviewSection,
} from "@/lib/skills";
import { settingsForProfile, withUsage } from "./credentials";
import { notifyApprovalPending } from "@/lib/notify";
import { emitEvent } from "@/lib/webhooks";
import { applySlaToTicket } from "@/lib/sla";
import { qaPrompt, qaSystem, resolverSystem, triageSystem, triageUser } from "./prompts";
import { getProvider, type ChatProvider, type ToolSpec } from "./provider";
import { getAiSettings, type AiSettings } from "./settings";
import { ensureToolPolicies, getToolRegistry } from "./custom-tools";
import type { ToolDef } from "./tools";
import { agentPrincipalId } from "@/lib/kb/principals";

const MAX_ITERATIONS = 12;

type TicketWithRequester = Ticket & { requester: User };

interface LoopContext {
  runId: string;
  ticket: TicketWithRequester;
  agentUser: User;
  /** KB principal chain (kb-11): agentPrincipalId(run) ∩ ticket requester. */
  principals: { agentId: string; humanId: string | null };
  settings: AiSettings;
  /** Pool credential the run bills to ("default"/"mock" otherwise). */
  credentialName: string;
  provider: ChatProvider;
  system: string;
  toolSpecs: ToolSpec[];
  policies: Map<string, ToolPolicy>;
  registry: Record<string, ToolDef>;
  messages: ConversationMessage[];
  nextIndex: number;
}

// -- small shared helpers ----------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse a JSON object out of a model reply, tolerating code fences/prose. */
function parseJsonLoose(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const object = candidate.match(/\{[\s\S]*\}/);
  if (!object) throw new Error("The model reply did not contain a JSON object.");
  return JSON.parse(object[0]) as Record<string, unknown>;
}

async function getAiUser(kind: AiKind): Promise<User> {
  const user = await db.user.findFirst({ where: { role: "AI_AGENT", aiKind: kind } });
  if (!user) throw new Error(`No AI agent user with kind ${kind} — re-run the seed.`);
  return user;
}

async function loadTicket(ticketId: string): Promise<TicketWithRequester> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { requester: true },
  });
  if (!ticket) throw new Error("Ticket not found.");
  return ticket;
}

function loadRun(runId: string): Promise<AgentRun & { steps: AgentStep[] }> {
  return db.agentRun.findUniqueOrThrow({
    where: { id: runId },
    include: { steps: { orderBy: { index: "asc" } }, approvals: true },
  });
}

async function persistConversation(ctx: LoopContext): Promise<void> {
  await db.agentRun.update({
    where: { id: ctx.runId },
    data: { conversation: JSON.stringify(ctx.messages) },
  });
}

async function addStep(
  ctx: LoopContext,
  step: { type: StepType; content: string; toolName?: string | null; riskLevel?: string | null },
): Promise<void> {
  await db.agentStep.create({
    data: {
      runId: ctx.runId,
      index: ctx.nextIndex++,
      type: step.type,
      toolName: step.toolName ?? null,
      riskLevel: step.riskLevel ?? null,
      content: step.content,
    },
  });
}

/**
 * Append a tool_result block to the conversation. Tool results for one
 * assistant turn must share a single user message, so we extend the trailing
 * tool_result message when there is one.
 */
/**
 * The ENGINE BOUNDARY CAP (fed-04): every tool result is charged to the
 * run's federation ledger BEFORE it re-enters the conversation — the
 * engine otherwise appends tool strings verbatim (RESULT_LIMIT is an
 * ad-hoc cap four tools apply; it was never an engine backstop). This is
 * added at BOTH execute sites: the driveResolverLoop site and the
 * resume-after-approval site; deleting either call makes the ledger stop
 * charging while the conversation keeps growing — the test pins both.
 */
async function capToolResult(ctx: LoopContext, toolName: string, result: string): Promise<string> {
  try {
    const { chargeChars } = await import("./retrieval-budget");
    const res = await chargeChars(db, ctx.runId, `tool:${toolName}`, result.length, {
      overview: result.slice(0, Math.min(400, result.length)),
      requested: result,
      withheldName: "the remainder of the tool result",
    });
    return res.ok ? res.text : res.text;
  } catch {
    return result; // a ledger failure must not eat the tool's answer
  }
}

function appendToolResult(
  messages: ConversationMessage[],
  block: Extract<ContentBlock, { type: "tool_result" }>,
): void {
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && last.content.every((b) => b.type === "tool_result")) {
    last.content.push(block);
  } else {
    messages.push({ role: "user", content: [block] });
  }
}

/** Never leave a run RUNNING: mark FAILED, add ERROR step, ticket → TRIAGED. */
async function failRun(runId: string, ticketId: string, err: unknown): Promise<void> {
  const message = errorMessage(err);
  try {
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  } catch {
    /* keep going — the remaining cleanup is still worth attempting */
  }
  try {
    const lastStep = await db.agentStep.findFirst({
      where: { runId },
      orderBy: { index: "desc" },
    });
    await db.agentStep.create({
      data: { runId, index: (lastStep?.index ?? -1) + 1, type: "ERROR", content: message },
    });
  } catch {
    /* ignore */
  }
  try {
    await db.ticket.update({
      where: { id: ticketId },
      data: { status: "TRIAGED", resolvedAt: null },
    });
  } catch {
    /* ignore */
  }
}

function toolSpecsFor(
  policies: ToolPolicy[],
  registry: Record<string, ToolDef>,
): ToolSpec[] {
  return policies
    .filter((policy) => registry[policy.toolName])
    .map((policy) => {
      const tool = registry[policy.toolName];
      return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    });
}

async function buildLoopContext(
  runId: string,
  ticket: TicketWithRequester,
  agentUser: User,
  messages: ConversationMessage[],
  nextIndex: number,
): Promise<LoopContext> {
  // Built-in tools added by an upgrade need their policy row before the
  // enabled-policy query below can surface them.
  await ensureToolPolicies();
  const enabledPolicies = await db.toolPolicy.findMany({ where: { enabled: true } });
  // Built-in tools plus admin-defined custom integrations.
  const registry = await getToolRegistry();
  // A specialized profile (pinned on the run at creation so resumes keep the
  // same persona) narrows the tool set, extends the system prompt, and may
  // carry its own pool credential.
  const runRow = await db.agentRun.findUnique({
    where: { id: runId },
    include: { profile: { include: { credential: true } } },
  });
  const profile = runRow?.profile ?? null;
  const { settings, credentialName } = await settingsForProfile(profile);
  const activePolicies = enabledPolicies.filter((policy) =>
    profileAllowsTool(profile, policy.toolName),
  );
  // The desk's agreed procedures, advertised as a catalogue the agent opens
  // with read_skill. Only when that tool actually survived the allowlist —
  // otherwise the prompt would name procedures the agent cannot read.
  const canReadSkills = activePolicies.some((p) => p.toolName === "read_skill");
  const skillSection = canReadSkills
    ? skillCatalogSection(await enabledSkillCatalog(), ticket.category)
    : "";
  const base = resolverSystem(activePolicies, skillSection);
  const system = profile
    ? `${base}\n\n## Specialization: ${profile.name}\n\n${profile.systemPrompt}`
    : base;
  return {
    runId,
    ticket,
    agentUser,
    principals: {
      agentId: agentPrincipalId({ profileId: profile?.id ?? null }),
      humanId: ticket.requesterId,
    },
    settings,
    credentialName: settings.provider === "mock" ? "mock" : credentialName,
    provider: withUsage(getProvider(settings, { ticket, kind: "RESOLVE" }), {
      kind: "RESOLVE",
      agentName: profile?.name ?? "Servo Resolver",
      credentialName: settings.provider === "mock" ? "mock" : credentialName,
      provider: settings.provider,
      model: settings.model,
    }),
    system,
    toolSpecs: toolSpecsFor(activePolicies, registry),
    policies: new Map(activePolicies.map((policy) => [policy.toolName, policy])),
    registry,
    messages,
    nextIndex,
  };
}

// -- triage -------------------------------------------------------------------

export async function runTriage(ticketId: string): Promise<AgentRun> {
  const ticket = await loadTicket(ticketId);
  const triageAgent = await getAiUser("TRIAGE");
  const settings = await getAiSettings();
  const provider = withUsage(getProvider(settings, { ticket, kind: "TRIAGE" }), {
    kind: "TRIAGE",
    agentName: "Servo Triage",
    credentialName: settings.provider === "mock" ? "mock" : "default",
    provider: settings.provider,
    model: settings.model,
  });

  const messages: ConversationMessage[] = [
    { role: "user", content: [{ type: "text", text: triageUser(ticket) }] },
  ];
  const run = await db.agentRun.create({
    data: {
      ticketId,
      agentUserId: triageAgent.id,
      kind: "TRIAGE",
      status: "RUNNING",
      conversation: JSON.stringify(messages),
    },
  });

  try {
    const turn = await provider.complete({ system: triageSystem, messages, tools: [] });
    messages.push({ role: "assistant", content: [{ type: "text", text: turn.text }] });

    const parsed = parseJsonLoose(turn.text);
    const category = CATEGORIES.includes(parsed.category as Category)
      ? (parsed.category as Category)
      : "OTHER";
    const priority = PRIORITIES.includes(parsed.priority as Priority)
      ? (parsed.priority as Priority)
      : "MEDIUM";
    const assignTo = parsed.assignTo === "AI" ? "AI" : "HUMAN";
    const rationale =
      typeof parsed.rationale === "string" && parsed.rationale
        ? parsed.rationale
        : "Classified automatically.";

    const resolverAgent = assignTo === "AI" ? await getAiUser("RESOLVER") : null;
    // Route to the group that owns this category; priority sets the tier.
    const group = await groupForCategory(category);
    const level = minSeniorityFor(priority);
    const humanAssignee =
      !resolverAgent && group ? await pickGroupAssignee(group.id, level) : null;
    await db.ticket.update({
      where: { id: ticketId },
      data: {
        category,
        priority,
        status: "TRIAGED",
        ...(group ? { groupId: group.id } : {}),
        escalationLevel: level,
        ...(resolverAgent
          ? { assigneeId: resolverAgent.id }
          : humanAssignee
            ? { assigneeId: humanAssignee.id }
            : {}),
      },
    });
    // Triage usually changes the priority, so the SLA clock re-baselines.
    await applySlaToTicket(ticketId);
    await db.comment.create({
      data: {
        ticketId,
        authorId: triageAgent.id,
        kind: "SYSTEM",
        body: `Triage: ${rationale}`,
      },
    });
    await db.agentStep.create({
      data: { runId: run.id, index: 0, type: "TEXT", content: rationale },
    });
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        summary: `Triaged as ${category}/${priority}; ${
          assignTo === "AI" ? "assigned to the AI resolver" : "left for human assignment"
        }.`,
        completedAt: new Date(),
        conversation: JSON.stringify(messages),
      },
    });
  } catch (err) {
    // Triage failures leave the ticket untouched.
    const message = errorMessage(err);
    try {
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: message,
          completedAt: new Date(),
          conversation: JSON.stringify(messages),
        },
      });
    } catch {
      /* ignore */
    }
    try {
      await db.agentStep.create({
        data: { runId: run.id, index: 0, type: "ERROR", content: message },
      });
    } catch {
      /* ignore */
    }
  }
  return loadRun(run.id);
}

// -- resolver -----------------------------------------------------------------

const BRIEFING_COMMENT_LIMIT = 12;
const BRIEFING_BODY_CHARS = 600;

/**
 * What the resolver is told when a run starts. A ticket is rarely a blank
 * slate by the time an agent picks it up: earlier runs may have already
 * created branches or opened pull requests, and the conversation carries the
 * human's decisions. Without this, a second run starts amnesiac and redoes
 * work that already exists.
 */
async function resolverBriefing(ticket: TicketWithRequester): Promise<string> {
  const [comments, priorRuns] = await Promise.all([
    db.comment.findMany({
      where: { ticketId: ticket.id },
      include: { author: true },
      orderBy: { createdAt: "desc" },
      take: BRIEFING_COMMENT_LIMIT,
    }),
    db.agentRun.findMany({
      where: { ticketId: ticket.id, kind: "RESOLVE", status: "COMPLETED" },
      orderBy: { createdAt: "asc" },
      select: { summary: true, createdAt: true },
    }),
  ]);

  const parts = [
    `Ticket #${ticket.number}: ${ticket.title}`,
    "",
    ticket.description,
    "",
    `Requester: ${ticket.requester.name} <${ticket.requester.email}>`,
    `Status: ${ticket.status} · Priority: ${ticket.priority} · Category: ${ticket.category}`,
  ];

  if (priorRuns.length > 0) {
    parts.push(
      "",
      "## Work already done on this ticket",
      "Do NOT repeat it — build on it or finish what it left open.",
      ...priorRuns.map((run, i) => `${i + 1}. ${run.summary ?? "(no summary recorded)"}`),
    );
  }

  if (comments.length > 0) {
    parts.push(
      "",
      "## Conversation so far (oldest last)",
      ...comments.reverse().map((c) => {
        const body =
          c.body.length > BRIEFING_BODY_CHARS
            ? `${c.body.slice(0, BRIEFING_BODY_CHARS)}…`
            : c.body;
        return `- **${c.author.name}**: ${body}`;
      }),
    );
  }

  return parts.join("\n");
}

// In-process guard closing the check-then-create race between the two entry
// points (POST /runs and the PATCH assign side effect); the DB findFirst below
// covers persisted state (e.g. WAITING_APPROVAL pauses) across restarts.
const activeResolverTickets = new Set<string>();

export async function runResolver(ticketId: string): Promise<AgentRun> {
  if (activeResolverTickets.has(ticketId)) {
    throw new Error("An agent run is already in progress for this ticket.");
  }
  activeResolverTickets.add(ticketId);
  try {
    return await runResolverInner(ticketId);
  } finally {
    activeResolverTickets.delete(ticketId);
  }
}

async function runResolverInner(ticketId: string): Promise<AgentRun> {
  const ticket = await loadTicket(ticketId);
  const active = await db.agentRun.findFirst({
    where: { ticketId, status: { in: ["RUNNING", "WAITING_APPROVAL"] } },
  });
  if (active) throw new Error("An agent run is already in progress for this ticket.");
  const resolverAgent = await getAiUser("RESOLVER");

  const messages: ConversationMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: await resolverBriefing(ticket) }],
    },
  ];
  // Pin the specialized profile (if any) on the run so resumes reuse it.
  const profile = await pickAgentProfile(ticket.category);
  const run = await db.agentRun.create({
    data: {
      ticketId,
      agentUserId: resolverAgent.id,
      profileId: profile?.id ?? null,
      kind: "RESOLVE",
      status: "RUNNING",
      conversation: JSON.stringify(messages),
    },
  });
  try {
    await db.ticket.update({ where: { id: ticketId }, data: { status: "IN_PROGRESS" } });
    const ctx = await buildLoopContext(run.id, ticket, resolverAgent, messages, 0);
    await driveResolverLoop(ctx);
  } catch (err) {
    await failRun(run.id, ticketId, err);
  }
  return loadRun(run.id);
}

/**
 * The shared resolver loop (used by fresh runs and by resumeAfterApproval).
 * Calls the provider, persists steps and the conversation, executes tools,
 * and pauses (returns) when a tool requires human approval.
 */
async function driveResolverLoop(ctx: LoopContext): Promise<"completed" | "paused"> {
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const turn = await ctx.provider.complete({
      system: ctx.system,
      messages: ctx.messages,
      tools: ctx.toolSpecs,
    });

    const assistantBlocks: ContentBlock[] = [];
    if (turn.text) assistantBlocks.push({ type: "text", text: turn.text });
    for (const call of turn.toolCalls) {
      assistantBlocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    if (assistantBlocks.length === 0) assistantBlocks.push({ type: "text", text: "" });
    ctx.messages.push({ role: "assistant", content: assistantBlocks });
    await persistConversation(ctx);

    if (turn.text) await addStep(ctx, { type: "TEXT", content: turn.text });

    if (turn.toolCalls.length === 0) {
      await db.agentRun.update({
        where: { id: ctx.runId },
        data: { status: "COMPLETED", summary: turn.text || null, completedAt: new Date() },
      });
      await runQaReview(ctx);
      return "completed";
    }

    for (let i = 0; i < turn.toolCalls.length; i++) {
      const call = turn.toolCalls[i];
      const tool = ctx.registry[call.name];
      const policy = ctx.policies.get(call.name);

      if (!tool || !policy) {
        const message = `Tool "${call.name}" is not available or has been disabled by policy.`;
        await addStep(ctx, {
          type: "TOOL_CALL",
          toolName: call.name,
          content: JSON.stringify(call.input),
        });
        await addStep(ctx, { type: "TOOL_RESULT", toolName: call.name, content: message });
        appendToolResult(ctx.messages, {
          type: "tool_result",
          tool_use_id: call.id,
          content: message,
          is_error: true,
        });
        await persistConversation(ctx);
        continue;
      }

      if (policy.requiresApproval) {
        const approval = await db.approval.create({
          data: {
            runId: ctx.runId,
            ticketId: ctx.ticket.id,
            toolName: call.name,
            toolInput: JSON.stringify(call.input),
            toolUseId: call.id,
            riskLevel: policy.riskLevel,
            status: "PENDING",
          },
        });
        void notifyApprovalPending(approval.id);
        void emitEvent("approval.pending", {
          approvalId: approval.id,
          ticketId: ctx.ticket.id,
          ticketNumber: ctx.ticket.number,
          toolName: call.name,
          riskLevel: policy.riskLevel,
          toolInput: call.input,
        });
        await addStep(ctx, {
          type: "APPROVAL_REQUEST",
          toolName: call.name,
          content: JSON.stringify(call.input),
          riskLevel: policy.riskLevel,
        });
        // Sibling tool calls after the paused one would leave dangling
        // tool_use blocks — close them so the conversation stays valid.
        for (const skipped of turn.toolCalls.slice(i + 1)) {
          appendToolResult(ctx.messages, {
            type: "tool_result",
            tool_use_id: skipped.id,
            content:
              "Not executed: a preceding tool call is waiting for human approval. Request it again after the decision if still needed.",
            is_error: true,
          });
        }
        await db.agentRun.update({
          where: { id: ctx.runId },
          data: { status: "WAITING_APPROVAL" },
        });
        await db.ticket.update({
          where: { id: ctx.ticket.id },
          data: { status: "WAITING_APPROVAL" },
        });
        await persistConversation(ctx);
        return "paused";
      }

      await addStep(ctx, {
        type: "TOOL_CALL",
        toolName: call.name,
        content: JSON.stringify(call.input),
        riskLevel: policy.riskLevel,
      });
      let result: string;
      let isError = false;
      try {
        result = await tool.execute(call.input, {
          ticketId: ctx.ticket.id,
          runId: ctx.runId,
          agentUser: ctx.agentUser,
          principals: ctx.principals,
        });
      } catch (err) {
        result = errorMessage(err);
        isError = true;
      }
      // THE CAP, site 1 of 2 (driveResolverLoop). The twin call sits in
      // resumeAfterApproval — deleting either makes the ledger-charging
      // test fail; keep them together.
      result = await capToolResult(ctx, call.name, result);
      await addStep(ctx, { type: "TOOL_RESULT", toolName: call.name, content: result });
      appendToolResult(ctx.messages, {
        type: "tool_result",
        tool_use_id: call.id,
        content: result,
        ...(isError ? { is_error: true } : {}),
      });
      await persistConversation(ctx);
    }
  }
  throw new Error(`Resolver run exceeded ${MAX_ITERATIONS} iterations without completing.`);
}

// -- resume after approval ----------------------------------------------------

export async function resumeAfterApproval(approvalId: string): Promise<AgentRun> {
  const approval = await db.approval.findUnique({
    where: { id: approvalId },
    include: { decider: true },
  });
  if (!approval) throw new Error("Approval not found.");
  if (approval.status === "PENDING") throw new Error("Approval has not been decided yet.");

  // Intentionally outside the try: a run that is not paused must not be
  // resumed (and must not be marked FAILED by the catch below).
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: approval.runId } });
  if (run.status !== "WAITING_APPROVAL") {
    throw new Error("Run is not waiting for approval.");
  }

  try {
    const ticket = await loadTicket(approval.ticketId);
    const agentUser = await db.user.findUniqueOrThrow({ where: { id: run.agentUserId } });
    const messages = JSON.parse(run.conversation) as ConversationMessage[];
    const lastStep = await db.agentStep.findFirst({
      where: { runId: run.id },
      orderBy: { index: "desc" },
    });
    const ctx = await buildLoopContext(
      run.id,
      ticket,
      agentUser,
      messages,
      (lastStep?.index ?? -1) + 1,
    );

    if (approval.status === "APPROVED") {
      const input = JSON.parse(approval.toolInput) as Record<string, unknown>;
      const tool = ctx.registry[approval.toolName];
      await addStep(ctx, {
        type: "TOOL_CALL",
        toolName: approval.toolName,
        content: approval.toolInput,
        riskLevel: approval.riskLevel,
      });
      let result: string;
      let isError = false;
      if (!tool) {
        result = `Tool "${approval.toolName}" is not available.`;
        isError = true;
      } else {
        try {
          result = await tool.execute(input, {
            ticketId: ticket.id,
            runId: run.id,
            agentUser,
          });
        } catch (err) {
          result = errorMessage(err);
          isError = true;
        }
      }
      // THE CAP, site 2 of 2 (resumeAfterApproval). The twin call sits in
      // driveResolverLoop — deleting either makes the ledger-charging test
      // fail; keep them together.
      result = await capToolResult(ctx, approval.toolName, result);
      await addStep(ctx, { type: "TOOL_RESULT", toolName: approval.toolName, content: result });
      appendToolResult(ctx.messages, {
        type: "tool_result",
        tool_use_id: approval.toolUseId,
        content: result,
        ...(isError ? { is_error: true } : {}),
      });
    } else {
      const reason = approval.reason?.trim() ? approval.reason : "No reason provided.";
      const deciderName = approval.decider?.name ?? "a human reviewer";
      const message = `Rejected by ${deciderName}: ${reason}`;
      await addStep(ctx, { type: "TOOL_RESULT", toolName: approval.toolName, content: message });
      appendToolResult(ctx.messages, {
        type: "tool_result",
        tool_use_id: approval.toolUseId,
        content: message,
        is_error: true,
      });
      await db.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: agentUser.id,
          kind: "SYSTEM",
          body: `Approval for ${approval.toolName} was rejected by ${deciderName}: ${reason}`,
        },
      });
    }

    await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING" } });
    await db.ticket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS" } });
    await persistConversation(ctx);

    await driveResolverLoop(ctx);
  } catch (err) {
    await failRun(run.id, approval.ticketId, err);
  }
  return loadRun(run.id);
}

// -- QA review ----------------------------------------------------------------

/**
 * Reviews a completed run when a MEDIUM/HIGH-risk tool was executed and QA is
 * enabled. Best-effort: a QA failure never un-completes the run.
 */
async function runQaReview(ctx: LoopContext): Promise<void> {
  if (!ctx.settings.qaEnabled) return;
  // Derive riskiness from persisted steps so it survives pause/resume cycles
  // (an in-memory flag would be lost when the loop context is rebuilt).
  const riskyExecuted = await db.agentStep.count({
    where: {
      runId: ctx.runId,
      type: "TOOL_CALL",
      riskLevel: { in: ["MEDIUM", "HIGH"] },
    },
  });
  if (riskyExecuted === 0) return;
  try {
    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: ctx.runId },
      include: { steps: { orderBy: { index: "asc" } } },
    });
    const qaProvider = withUsage(
      getProvider(ctx.settings, { ticket: ctx.ticket, kind: "QA" }),
      {
        kind: "QA",
        agentName: "Servo QA",
        credentialName: ctx.credentialName,
        provider: ctx.settings.provider,
        model: ctx.settings.model,
      },
    );
    // Which desk skills applied, and which the run actually opened. Read from
    // the persisted steps so it survives pause/resume like the risk check above.
    const skillReads = await db.agentStep.findMany({
      where: { runId: ctx.runId, type: "TOOL_CALL", toolName: "read_skill" },
      select: { content: true },
    });
    const readSlugs = skillReads
      .map((step) => {
        try {
          return String((JSON.parse(step.content) as { slug?: unknown }).slug ?? "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    const skillSection = skillReviewSection(
      await enabledSkillCatalog(),
      ctx.ticket.category,
      readSlugs,
    );

    const turn = await qaProvider.complete({
      system: qaSystem,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: qaPrompt(run, ctx.ticket, skillSection) }],
        },
      ],
      tools: [],
    });
    const parsed = parseJsonLoose(turn.text);
    const verdict = parsed.verdict === "FAIL" ? "FAIL" : "PASS";
    const notes = typeof parsed.notes === "string" ? parsed.notes : "";

    await db.agentRun.update({
      where: { id: ctx.runId },
      data: { qaVerdict: verdict, qaNotes: notes },
    });
    await addStep(ctx, {
      type: "QA_REVIEW",
      content: `${verdict}${notes ? ` — ${notes}` : ""}`,
    });

    if (verdict === "FAIL") {
      // Prefer a member of the ticket's group at its escalation tier; fall
      // back to any human agent so the ticket never dead-ends.
      const ticketRow = await db.ticket.findUnique({
        where: { id: ctx.ticket.id },
        select: { groupId: true, escalationLevel: true },
      });
      const groupPick = ticketRow?.groupId
        ? await pickGroupAssignee(ticketRow.groupId, ticketRow.escalationLevel)
        : null;
      const humanAgent =
        groupPick ??
        (await db.user.findFirst({
          where: { role: "AGENT" },
          orderBy: { createdAt: "asc" },
        }));
      await db.ticket.update({
        where: { id: ctx.ticket.id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          ...(humanAgent ? { assigneeId: humanAgent.id } : {}),
        },
      });
      const qaUser = await db.user.findFirst({ where: { role: "AI_AGENT", aiKind: "QA" } });
      await db.comment.create({
        data: {
          ticketId: ctx.ticket.id,
          authorId: (qaUser ?? ctx.agentUser).id,
          kind: "SYSTEM",
          body: `QA flagged this run — reassigned to a human agent. ${notes}`,
        },
      });
    }
  } catch {
    // QA is best-effort; the run stays COMPLETED even if review fails.
  }
}
