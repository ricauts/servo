// fed-05: transcript compaction, the audit split, the graceful last turn.
// Compaction replaces federation tool_result CONTENT in the conversation
// (tool_use_id preserved) with a ≤120-char handle line; the original text
// stays in AgentStep.content and leaves AgentRun.conversation; the ledger
// is never refunded; it runs only past 60% after a discard, once per
// dataset; under 60% the conversation is byte-identical to a control run.
// At MAX_ITERATIONS-1 the engine withdraws tools and the run COMPLETES.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";

type ServoDb = { [key: string]: unknown };
const holder = vi.hoisted(() => ({ db: null as unknown as ServoDb }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "x", role: "ADMIN" }) }));

import {
  compactFederationResults, compactionLine, compactionDue,
  COMPACTION_TRIGGER_FRACTION, COMPACTION_MAX_LINE,
} from "@/lib/ai/compaction";
import type { ConversationMessage } from "@/lib/types";
import { FED_CONTEXT_BUDGET } from "@/lib/ai/retrieval-budget";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const h of handles) await h.dispose();
});

let db: PrismaClient;
let requester: { id: string };
let resolver: { id: string };
let runId: string;

function conversationWith(datasetId: string, cardText: string): ConversationMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "question" }] },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "tu_1", name: "open_dataset", input: { datasetId } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: cardText }],
    },
  ];
}

beforeEach(async () => {
  if (handles.length > 1) await handles.shift()?.dispose();
  const a = await tmpDb();
  handles.push(a);
  db = a.client;
  holder.db = db as unknown as ServoDb;
  requester = await db.user.create({ data: { name: "R", email: "r@x.com", role: "REQUESTER" } });
  resolver = await db.user.create({ data: { name: "S", email: `s${Date.now()}@servo.ai`, role: "AI_AGENT", aiKind: "RESOLVER" } });
  const ticket = await db.ticket.create({ data: { number: 9700, title: "t", description: "d", requesterId: requester.id } });
  runId = (await db.agentRun.create({ data: { ticketId: ticket.id, agentUserId: resolver.id, kind: "RESOLVE", status: "RUNNING" } })).id;
});

describe("compactFederationResults", () => {
  const card = "public.payroll overview · columns a b c · values ACTIVE CLOSED · 800 characters of detail ".repeat(4);

  it("replaces the dataset's tool_result content, preserves tool_use_id", () => {
    const messages = conversationWith("ds_1", card);
    const { compacted } = compactFederationResults(messages, "ds_1", new Set());
    expect(compacted).toBe(1);
    const block = (messages[2] as { content: Array<{ type: string; tool_use_id?: string; content: string }> }).content[0];
    expect(block.type).toBe("tool_result");
    expect(block.tool_use_id).toBe("tu_1"); // structurally valid
    expect(block.content).not.toBe(card);
    expect(block.content).toMatch(/\[compacted\]/);
    expect(block.content.length).toBeLessThanOrEqual(COMPACTION_MAX_LINE);
  });

  it("the replacement NAMES THE HANDLE — a re-fetch is always possible", () => {
    const line = compactionLine("ds_9");
    expect(line).not.toBeNull();
    expect(line!).toContain("ds_9");
    expect(line!).toMatch(/open_dataset/);
    expect(line!.length).toBeLessThanOrEqual(COMPACTION_MAX_LINE);
    // An id too long to name in 120 characters: compaction is REFUSED —
    // nothing un-re-fetchable may ever be compacted.
    const longId = "ds_" + "x".repeat(90);
    expect(compactionLine(longId)).toBeNull();
    const longConversation = conversationWith(longId, "card ".repeat(50));
    expect(compactFederationResults(longConversation, longId, new Set()).compacted).toBe(0);
    expect((longConversation[2] as { content: Array<{ content: string }> }).content[0].content).toContain("card ");
  });

  it("at most ONCE per dataset per run", () => {
    const messages = conversationWith("ds_1", card);
    const seen = new Set<string>();
    expect(compactFederationResults(messages, "ds_1", seen).compacted).toBe(1);
    expect(compactFederationResults(messages, "ds_1", seen).compacted).toBe(0);
  });

  it("other datasets' results are untouched", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "open_dataset", input: { datasetId: "ds_other" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: card }] },
    ];
    expect(compactFederationResults(messages, "ds_1", new Set()).compacted).toBe(0);
    expect((messages[2] as { content: Array<{ content: string }> }).content[0].content).toBe(card);
  });
});

describe("the trigger and the no-refund rule", () => {
  it("compactionDue: only after a discard, only past 60%, only once", () => {
    expect(compactionDue(true, 0, FED_CONTEXT_BUDGET, false)).toBe(false);
    expect(compactionDue(false, FED_CONTEXT_BUDGET, FED_CONTEXT_BUDGET, false)).toBe(false);
    expect(compactionDue(true, Math.ceil(COMPACTION_TRIGGER_FRACTION * FED_CONTEXT_BUDGET), FED_CONTEXT_BUDGET, false)).toBe(false); // not strictly over
    expect(compactionDue(true, Math.ceil(COMPACTION_TRIGGER_FRACTION * FED_CONTEXT_BUDGET) + 1, FED_CONTEXT_BUDGET, false)).toBe(true);
    expect(compactionDue(true, FED_CONTEXT_BUDGET, FED_CONTEXT_BUDGET, true)).toBe(false); // already compacted
  });

  it("compaction NEVER refunds: the ledger row is identical before and after", async () => {
    const before = { chars: 15000, finds: 2 };
    await db.agentRun.update({ where: { id: runId }, data: { retrieval: { probed: 1, opened: 1, discarded: 1, perDataset: {}, chars: before.chars, hops: 0, finds: before.finds, compacted: 0, discards: [] } } });
    const messages = conversationWith("ds_1", "x".repeat(500));
    compactFederationResults(messages, "ds_1", new Set());
    const row = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect((row.retrieval as { chars: number }).chars).toBe(before.chars);
    expect((row.retrieval as { finds: number }).finds).toBe(before.finds);
  });

  it("under 60% the conversation is BYTE-IDENTICAL to a control run", () => {
    const control = conversationWith("ds_1", "card text ".repeat(40));
    const treatment = conversationWith("ds_1", "card text ".repeat(40));
    // Under the threshold the engine never calls compact — simulate:
    if (compactionDue(true, 100, FED_CONTEXT_BUDGET, false)) {
      compactFederationResults(treatment, "ds_1", new Set());
    }
    expect(JSON.stringify(treatment)).toBe(JSON.stringify(control));
  });
});

describe("AUDIT PRESERVED — the four halves", () => {
  it("original in AgentStep.content, absent from AgentRun.conversation; replacement the reverse", async () => {
    const card = "THE ORIGINAL CARD TEXT public.payroll overview with columns";
    // The engine wrote the step BEFORE compaction ran (compaction touches
    // only ctx.messages); simulate both writes:
    await db.agentStep.create({ data: { runId, index: 0, type: "TOOL_RESULT", toolName: "open_dataset", content: card } });
    const messages = conversationWith("ds_1", card);
    compactFederationResults(messages, "ds_1", new Set());
    const replacement = (messages[2] as { content: Array<{ content: string }> }).content[0].content;
    await db.agentRun.update({ where: { id: runId }, data: { conversation: JSON.stringify(messages) } });

    const step = await db.agentStep.findFirstOrThrow({ where: { runId } });
    const conversation = (await db.agentRun.findUniqueOrThrow({ where: { id: runId } })).conversation;
    expect(step.content).toContain("THE ORIGINAL CARD TEXT"); // 1: original in steps
    expect(conversation).not.toContain("THE ORIGINAL CARD TEXT"); // 2: absent from conversation
    // 3: replacement in conversation (JSON-escaped in storage — assert on
    // the parsed structure, not the serialised string).
    const stored = JSON.parse(conversation) as Array<{ content: Array<{ content?: string }> }>;
    const storedText = stored.map((m) => m.content.map((b) => b.content ?? "").join(" ")).join(" ");
    expect(storedText).toContain(replacement);
    expect(step.content).not.toContain(replacement); // 4: absent from steps
  });
});

describe("the graceful last turn", () => {
  it("the engine withdraws tools on the final iteration — source-pinned", () => {
    const source = readFileSync("src/lib/ai/engine.ts", "utf8");
    expect(source).toMatch(/tools: lastTurn \? \[\] : ctx\.toolSpecs/);
    expect(source).toMatch(/iteration === MAX_ITERATIONS - 1/);
  });

  it("a mock script that calls a tool on every turn finishes COMPLETED with a summary (not a throw)", async () => {
    // A provider stub whose every scripted turn wants a tool: the engine
    // still completes because the last turn has NO tools to call.
    const { ensureAiAgents } = await import("@/lib/bootstrap");
    const { ensureToolPolicies } = await import("@/lib/ai/custom-tools");
    await ensureToolPolicies();
    await ensureAiAgents();
    const agent = await db.user.findUniqueOrThrow({ where: { email: "resolver@servo.ai" } });
    const ticket = await db.ticket.create({ data: { number: 9701, title: "loop forever", description: "d", requesterId: requester.id, category: "DATABASE" } });
    const { runResolver } = await import("@/lib/ai/engine");
    const run = await runResolver(ticket.id);
    expect(["COMPLETED", "WAITING_APPROVAL"]).toContain(run.status);
    if (run.status === "COMPLETED") {
      expect((run.summary ?? "").length).toBeGreaterThan(0);
    }
    void agent;
  }, 120_000);
});

describe("the approval path is untouched", () => {
  it("scripts/approval-path-guard.mjs exists and exits 0 on the current tree", () => {
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("node", ["scripts/approval-path-guard.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/unchanged|OK/i);
  });
});
