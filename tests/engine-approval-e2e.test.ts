// loop-05: the approval gate, end to end, on the deterministic mock provider
// against a throwaway Postgres database.
//
// Two things are proved here, and they are load-bearing for every later item
// that widens tool exposure:
//
//  1. The run really is offline. `tests/setup-env.ts` scrubs the provider key
//     env vars, and the tests below prove the scrub is not decorative: with a
//     key present, `provider = anthropic` in the Setting table resolves to a
//     REAL client, so a suite that writes that row would bill a live call. The
//     engine's own provider object is asserted to be MockProvider.
//  2. A `requiresApproval` tool pauses the run, and the gated tool executes
//     exactly once across the pause/resume boundary — the failure modes being
//     zero (the resume silently dropped it) and twice (the resume re-entered
//     the loop and the model re-called it).
//
// Only @/lib/db is redirected, at the tmpDb clone. @/lib/notify and
// @/lib/webhooks are left real: both are configuration-gated and no-op with
// no SMTP row and no Webhook row, so the run exercises the real code paths.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tmpDb, type TmpDb } from "./helpers/tmp-db";
// From the data module, never from tests/setup-env.ts: importing the setup
// file here would run its scrub as an import side effect and the assertions
// below would hold even with the `setupFiles` registration deleted.
import { PROVIDER_KEY_ENV_VARS, SCRUB_MARKER } from "./helpers/provider-env";

type ServoDb = { [key: string]: unknown };

const holder = vi.hoisted(() => ({
  db: null as unknown as ServoDb,
  /** The `tools` array of every provider.complete() call, in order. */
  toolSpecCalls: [] as string[][],
  /** The provider instances getProvider() actually handed the engine. */
  providers: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return holder.db;
  },
}));

// Observe, do not substitute: the real getProvider still chooses the provider,
// and the real object still answers complete(). The wrapper only records what
// the engine passed as `tools` — which is the only externally visible form of
// buildLoopContext's toolSpecs — and which provider was chosen.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return {
    ...actual,
    getProvider: (
      settings: Parameters<typeof actual.getProvider>[0],
      ctx: Parameters<typeof actual.getProvider>[1],
    ) => {
      const inner = actual.getProvider(settings, ctx);
      holder.providers.push(inner);
      return {
        async complete(p: Parameters<typeof inner.complete>[0]) {
          holder.toolSpecCalls.push(p.tools.map((t) => t.name));
          return inner.complete(p);
        },
      };
    },
  };
});

import { MockProvider } from "@/lib/ai/mock";
import { resumeAfterApproval, runResolver } from "@/lib/ai/engine";
import { ensureToolPolicies } from "@/lib/ai/custom-tools";
import { envKeyNameFor, getAiSettings, type AiProviderKind } from "@/lib/ai/settings";
import { ensureAiAgents } from "@/lib/bootstrap";
import { SETTING_KEYS } from "@/lib/types";

const handles: TmpDb[] = [];
afterAll(async () => {
  for (const handle of handles) await handle.dispose();
});

let db: PrismaClient;
let requesterId: string;
let adminId: string;

beforeEach(async () => {
  const handle = await tmpDb();
  handles.push(handle);
  db = handle.client;
  holder.db = db as unknown as ServoDb;
  holder.toolSpecCalls = [];
  holder.providers = [];
  // Exactly the seeding the item names: the AI agent users and the default
  // tool policy rows, nothing else. No Skill rows, so the mock's script is the
  // plain one; no AgentProfile rows, so no profile narrows the tool set.
  await ensureAiAgents();
  await ensureToolPolicies();
  requesterId = (
    await db.user.create({
      data: { name: "Rita Requester", email: "rita@example.com", role: "REQUESTER" },
    })
  ).id;
  adminId = (
    await db.user.create({
      data: { name: "Ada Admin", email: "ada@example.com", role: "ADMIN" },
    })
  ).id;
});

/**
 * A ticket whose text drives the mock's deployment script:
 * search_tickets → cloud_plan_deployment → cloud_apply_deployment (HIGH,
 * requiresApproval) → post_comment → resolve_ticket.
 *
 * The wording is deliberate. src/lib/ai/mock.ts tests its database branch
 * (`table|database|sql|schema|query|report|license`) BEFORE its deployment
 * branch, and the deployment branch itself forks to github_create_repo on
 * `repo`/`repository`, so neither may appear. cloud_apply_deployment is the
 * gated tool used here because it is fully simulated: no egress, no ops
 * database, nothing this test would have to stub out to stay offline.
 */
function deployTicket(number: number) {
  return db.ticket.create({
    data: {
      number,
      title: "Deploy the checkout service to staging",
      description:
        "Please roll out the latest build of the checkout service to the staging environment.",
      requesterId,
      category: "DEVOPS",
      status: "TRIAGED",
    },
  });
}

/** Steps of one type, in index order. */
async function steps(runId: string, type: string) {
  return db.agentStep.findMany({ where: { runId, type }, orderBy: { index: "asc" } });
}

describe("loop-05 · the env scrub", () => {
  it("actually ran in this worker — the setupFiles registration is present", () => {
    // Without this, a developer whose shell holds no provider key could delete
    // the `setupFiles` line from vitest.config.ts and every other assertion in
    // this describe block would still pass.
    expect(
      process.env[SCRUB_MARKER],
      "tests/setup-env.ts did not run — is it still registered as setupFiles in vitest.config.ts?",
    ).toBe("1");
  });

  it("has deleted every provider key env var src/lib/ai/settings.ts reads", () => {
    for (const name of PROVIDER_KEY_ENV_VARS) {
      expect(process.env[name], `${name} survived the scrub`).toBeUndefined();
    }
  });

  it("scrubs every name envKeyNameFor() can return, so a new provider cannot slip past", () => {
    // Record<AiProviderKind, …> is the drift guard, and it is enforced by the
    // COMPILER, not by this list being remembered: adding a fifth kind to the
    // AiProviderKind union makes this object literal fail `npm run typecheck`
    // until the kind is given its env var name here. A hand-written array
    // would simply not mention the new kind and slip through silently.
    const envKeyByKind: Record<AiProviderKind, string | null> = {
      anthropic: "ANTHROPIC_API_KEY",
      zai: "ZAI_API_KEY",
      openai: "OPENAI_API_KEY",
      mock: null,
    };

    const named: string[] = [];
    for (const [kind, expected] of Object.entries(envKeyByKind) as [
      AiProviderKind,
      string | null,
    ][]) {
      // The map above is only trustworthy if it still matches the real
      // resolver, so pin it against envKeyNameFor() rather than assuming.
      expect(envKeyNameFor(kind), `envKeyNameFor(${kind})`).toBe(expected);
      if (expected !== null) named.push(expected);
    }

    // Every env var the resolver can consult must be one this suite deletes.
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(PROVIDER_KEY_ENV_VARS as readonly string[]).toContain(name);
    }
    // And nothing in the scrub list is dead weight — each name is one the
    // resolver actually reads.
    for (const name of PROVIDER_KEY_ENV_VARS) {
      expect(named).toContain(name);
    }
  });

  it("resolves the provider to exactly \"mock\", with no key from any source", async () => {
    const settings = await getAiSettings();
    expect(settings.provider).toBe("mock");
    expect(settings.configuredProvider).toBe("mock");
    expect(settings.apiKey).toBe("");
    expect(settings.keySource).toBe("none");
  });

  it("is load-bearing: a configured provider falls back to mock ONLY because no env key survives", async () => {
    // The trap this rail exists for. An empty database resolves to "mock"
    // whatever the environment holds — envKeyNameFor("mock") is null — so
    // asserting "mock" on a bare database proves nothing at all. Configure a
    // real provider first; only then does the env key decide the outcome.
    await db.setting.create({ data: { key: SETTING_KEYS.provider, value: "anthropic" } });

    const scrubbed = await getAiSettings();
    expect(scrubbed.configuredProvider).toBe("anthropic");
    expect(scrubbed.provider).toBe("mock"); // no key anywhere → unusable → mock
    expect(scrubbed.keySource).toBe("none");

    // Not a credential: a fixture string, never sent anywhere, deleted below.
    process.env.ANTHROPIC_API_KEY = "fixture-not-a-real-key";
    try {
      const leaked = await getAiSettings();
      expect(leaked.provider).toBe("anthropic");
      expect(leaked.keySource).toBe("env");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    // And restored once the leak is gone.
    expect((await getAiSettings()).provider).toBe("mock");
  });

  it("beats a database key too: env precedence is what the scrub removes", async () => {
    await db.setting.createMany({
      data: [
        { key: SETTING_KEYS.provider, value: "openai" },
        { key: SETTING_KEYS.apiKey, value: "fixture-db-key" },
      ],
    });
    const fromDb = await getAiSettings();
    expect(fromDb.provider).toBe("openai");
    expect(fromDb.keySource).toBe("db");
    expect(fromDb.apiKey).toBe("fixture-db-key");

    process.env.OPENAI_API_KEY = "fixture-env-key";
    try {
      const settings = await getAiSettings();
      expect(settings.keySource).toBe("env");
      expect(settings.apiKey).toBe("fixture-env-key");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("loop-05 · the approval gate, end to end", () => {
  it("pauses the run and the ticket in WAITING_APPROVAL with an Approval carrying toolUseId", async () => {
    const ticket = await deployTicket(9001);
    const run = await runResolver(ticket.id);

    expect(run.status).toBe("WAITING_APPROVAL");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
      "WAITING_APPROVAL",
    );

    // The run really went through the deterministic mock provider.
    expect(holder.providers.length).toBeGreaterThan(0);
    for (const provider of holder.providers) expect(provider).toBeInstanceOf(MockProvider);

    const approvals = await db.approval.findMany({ where: { runId: run.id } });
    expect(approvals).toHaveLength(1);
    const [approval] = approvals;
    expect(approval.toolName).toBe("cloud_apply_deployment");
    expect(approval.status).toBe("PENDING");
    expect(approval.riskLevel).toBe("HIGH");
    expect(approval.toolUseId).toBeTruthy();

    // The toolUseId is the conversation's own tool_use id, not a fresh one —
    // that is what makes the paused run resumable from the database alone.
    const conversation = JSON.parse(
      (await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).conversation,
    ) as { role: string; content: { type: string; id?: string; name?: string }[] }[];
    const toolUseIds = conversation
      .flatMap((message) => message.content)
      .filter((block) => block.type === "tool_use" && block.name === "cloud_apply_deployment")
      .map((block) => block.id);
    expect(toolUseIds).toEqual([approval.toolUseId]);

    // Paused BEFORE executing: an APPROVAL_REQUEST step and no TOOL_CALL for it.
    const requests = await steps(run.id, "APPROVAL_REQUEST");
    expect(requests.map((s) => s.toolName)).toEqual(["cloud_apply_deployment"]);
    const calls = await steps(run.id, "TOOL_CALL");
    expect(calls.map((s) => s.toolName)).not.toContain("cloud_apply_deployment");
    // The ungated tools before it did run, so the pause is the gate and not an
    // early crash.
    expect(calls.map((s) => s.toolName)).toContain("cloud_plan_deployment");
  });

  it("after approval, the resume completes the run and the gated tool executed exactly once", async () => {
    const ticket = await deployTicket(9002);
    const paused = await runResolver(ticket.id);
    expect(paused.status).toBe("WAITING_APPROVAL");

    const approval = await db.approval.findFirstOrThrow({ where: { runId: paused.id } });
    await db.approval.update({
      where: { id: approval.id },
      data: { status: "APPROVED", decidedAt: new Date(), deciderId: adminId },
    });

    const resumed = await resumeAfterApproval(approval.id);
    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.error).toBeNull();

    const calls = await steps(resumed.id, "TOOL_CALL");
    const gatedCalls = calls.filter((s) => s.toolName === "cloud_apply_deployment");
    // Not zero (the resume dropped it) and not twice (the resumed loop let the
    // model call it again).
    expect(gatedCalls).toHaveLength(1);
    expect(gatedCalls[0].riskLevel).toBe("HIGH");

    const results = (await steps(resumed.id, "TOOL_RESULT")).filter(
      (s) => s.toolName === "cloud_apply_deployment",
    );
    expect(results).toHaveLength(1);
    // The tool's own success output — and this assertion is the ONLY thing
    // separating "executed" from "recorded as attempted". engine.ts writes the
    // TOOL_CALL step BEFORE it looks the tool up, so a resume that never
    // reached tool.execute() still leaves exactly one TOOL_CALL row: the count
    // above cannot detect zero executions on its own. Matched on the tool's
    // full success token rather than a bare "applied", which a failure string
    // ("could not be applied — rollout aborted") would also satisfy.
    expect(results[0].content).toContain("Rollout completed");
    expect(results[0].content).toContain(`Deployment plan ${JSON.parse(approval.toolInput).planId} applied`);
    expect(results[0].content).not.toContain("is not available");

    // The gated call is ordered after its approval request, and there is only
    // one approval for the whole run.
    const request = (await steps(resumed.id, "APPROVAL_REQUEST"))[0];
    expect(gatedCalls[0].index).toBeGreaterThan(request.index);
    expect(await db.approval.count({ where: { runId: resumed.id } })).toBe(1);

    // And the run went on to finish the script rather than stopping at resume.
    expect(calls.map((s) => s.toolName)).toContain("resolve_ticket");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
      "RESOLVED",
    );
  });

  it("a rejected approval executes the gated tool zero times", async () => {
    const ticket = await deployTicket(9003);
    const paused = await runResolver(ticket.id);
    const approval = await db.approval.findFirstOrThrow({ where: { runId: paused.id } });
    await db.approval.update({
      where: { id: approval.id },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        deciderId: adminId,
        reason: "Staging is frozen this week.",
      },
    });

    const resumed = await resumeAfterApproval(approval.id);
    const calls = await steps(resumed.id, "TOOL_CALL");
    expect(calls.filter((s) => s.toolName === "cloud_apply_deployment")).toHaveLength(0);
    expect(calls.map((s) => s.toolName)).not.toContain("resolve_ticket");
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).not.toBe(
      "RESOLVED",
    );
  });

  it("a tool with enabled:false is invisible to buildLoopContext (deny-by-default)", async () => {
    // Disabled AFTER the policy rows exist, exactly as an admin would: the row
    // stays, only `enabled` flips. ensureToolPolicies() must not resurrect it.
    await db.toolPolicy.update({
      where: { toolName: "cloud_apply_deployment" },
      data: { enabled: false },
    });

    const ticket = await deployTicket(9004);
    const run = await runResolver(ticket.id);

    // The engine never saw a policy for it, so it never paused for approval
    // and never executed it — the mock still asked, which is the point.
    expect(run.status).toBe("COMPLETED");
    expect(await db.approval.count({ where: { runId: run.id } })).toBe(0);

    // The ATTEMPT is still audited — engine.ts records a TOOL_CALL step for a
    // refused call, which is the behaviour worth having and worth pinning. It
    // carries no riskLevel, because no policy row was in scope to supply one:
    // that null is the visible trace of the tool being absent from
    // buildLoopContext's policy map rather than merely declined.
    const attempts = (await steps(run.id, "TOOL_CALL")).filter(
      (s) => s.toolName === "cloud_apply_deployment",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].riskLevel).toBeNull();

    const refusals = (await steps(run.id, "TOOL_RESULT")).filter(
      (s) => s.toolName === "cloud_apply_deployment",
    );
    expect(refusals).toHaveLength(1);
    expect(refusals[0].content).toContain("has been disabled by policy");
    // Never the tool's own output: it was not executed, only refused.
    expect(refusals[0].content).not.toContain("Rollout completed");

    // And directly: the tool was absent from every tool list the engine built,
    // while an enabled sibling was present in all of them.
    expect(holder.toolSpecCalls.length).toBeGreaterThan(0);
    for (const names of holder.toolSpecCalls) {
      expect(names).not.toContain("cloud_apply_deployment");
      expect(names).toContain("cloud_plan_deployment");
    }
  });

  it("the disabled tool is visible again once re-enabled — the assertion above is not vacuous", async () => {
    const ticket = await deployTicket(9005);
    await runResolver(ticket.id);
    expect(holder.toolSpecCalls.length).toBeGreaterThan(0);
    for (const names of holder.toolSpecCalls) {
      expect(names).toContain("cloud_apply_deployment");
    }
  });
});
