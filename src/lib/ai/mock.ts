// Deterministic offline provider. Derives a tool script from the ticket text
// so the whole demo (triage, resolution, approvals, QA) works without an API
// key. Each complete() call emits the first script step that has no tool_use
// in the conversation yet; when a tool_result carries is_error (e.g. a human
// rejected an approval) the script collapses to acknowledge + resolve.

import { randomUUID } from "crypto";
import type { Ticket, User } from "@prisma/client";
import type { Category, ConversationMessage, Priority } from "@/lib/types";
import type { AssistantTurn, ChatProvider, ToolSpec } from "./provider";

export interface MockContext {
  ticket: Ticket & { requester: User };
  kind: "TRIAGE" | "RESOLVE" | "QA" | "DRAFT";
}

interface ScriptStep {
  name: string;
  input: Record<string, unknown>;
  plan: string;
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "ticket";
}

function usedToolNames(messages: ConversationMessage[]): Set<string> {
  const used = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") used.add(block.name);
    }
  }
  return used;
}

/**
 * Only an actual human rejection should trigger the rejection script. The
 * engine's rejection message is deterministic ("Rejected by <name>: ..."),
 * while other is_error results (disabled tool, execution failure, skipped
 * sibling calls) must not make the mock claim a reviewer rejected anything.
 */
function hasRejectionResult(messages: ConversationMessage[]): boolean {
  return messages.some((message) =>
    message.content.some(
      (block) =>
        block.type === "tool_result" &&
        block.is_error === true &&
        typeof block.content === "string" &&
        block.content.startsWith("Rejected by"),
    ),
  );
}

export class MockProvider implements ChatProvider {
  constructor(private readonly ctx: MockContext) {}

  async complete(p: {
    system: string;
    messages: ConversationMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<AssistantTurn> {
    if (this.ctx.kind === "TRIAGE") {
      return { text: this.triageJson(), toolCalls: [] };
    }
    if (this.ctx.kind === "DRAFT") {
      return { text: this.draftReplyText(), toolCalls: [] };
    }
    if (this.ctx.kind === "QA") {
      return {
        text: JSON.stringify({
          verdict: "PASS",
          notes:
            "Actions match the ticket request, risky steps went through human approval, and the requester was informed before resolution.",
        }),
        toolCalls: [],
      };
    }

    const available = new Set(p.tools.map((t) => t.name));
    const script = hasRejectionResult(p.messages)
      ? this.rejectionScript()
      : [...this.skillStep(p.system, p.tools), ...this.script(available)];
    const used = usedToolNames(p.messages);
    const next = script.find((step) => !used.has(step.name));
    if (!next) {
      return {
        text: "Worked the ticket end to end: executed the planned actions, updated the requester and marked the ticket resolved.",
        toolCalls: [],
      };
    }
    return {
      text: next.plan,
      toolCalls: [{ id: `mock_${randomUUID()}`, name: next.name, input: next.input }],
    };
  }

  // -- TRIAGE ---------------------------------------------------------------

  private triageJson(): string {
    const text = `${this.ctx.ticket.title} ${this.ctx.ticket.description}`;
    let category: Category = "OTHER";
    let assignTo: "AI" | "HUMAN" = "HUMAN";

    if (/password|mfa|locked|2fa|login|access|badge|permission/i.test(text)) {
      category = "ACCESS";
      assignTo = /password|mfa|locked|2fa/i.test(text) ? "AI" : "HUMAN";
    } else if (/device|laptop|monitor|asset|warranty|phone|printer|dock|hardware/i.test(text)) {
      category = "HARDWARE";
      assignTo = /device|laptop|monitor|asset|warranty|phone/i.test(text) ? "AI" : "HUMAN";
    } else if (/table|database|sql|schema|query/i.test(text)) {
      category = "DATABASE";
      assignTo = "AI";
    } else if (/deploy|\brepos?\b|repository|pipeline|\bci\b|cloud|azure|aws|gcp/i.test(text)) {
      // \brepo\b, not /repo/: Spanish "reporte" must not read as DEVOPS.
      category = "DEVOPS";
      assignTo = "AI";
    } else if (/wifi|vpn|network|dns|signal|connection/i.test(text)) {
      category = "NETWORK";
    } else if (/software|app\b|excel|outlook|slack|zoom|license|install|crash|update/i.test(text)) {
      category = "SOFTWARE";
      assignTo = /license/i.test(text) ? "AI" : "HUMAN";
    }

    let priority: Priority = "MEDIUM";
    if (/urgent|asap|critical|immediately|production|blocked|locked out|down\b|today/i.test(text)) {
      priority = "HIGH";
    } else if (/whenever|no rush|minor|low priority/i.test(text)) {
      priority = "LOW";
    }

    const rationale =
      `Classified as ${category} based on the ticket text; priority ${priority}. ` +
      (assignTo === "AI"
        ? "The request maps to the resolver's automation tools, so it is assigned to the AI resolver."
        : "The request needs human attention, so it stays in the human queue.");

    return JSON.stringify({ category, priority, assignTo, rationale });
  }

  // -- DRAFT ----------------------------------------------------------------

  /** Deterministic reply draft so the approve-and-send flow works offline. */
  private draftReplyText(): string {
    const ticket = this.ctx.ticket;
    const text = `${ticket.title} ${ticket.description}`;
    const first = ticket.requester.name.split(" ")[0];
    let plan =
      "We've received your request and a teammate is looking into it. We'll follow up on this same thread as soon as we have an update.";
    if (/password|mfa|locked|2fa/i.test(text)) {
      plan =
        "We can reset your access right away. You'll receive a recovery link at this address within the next few minutes — it expires after 60 minutes, so please use it promptly and set a new password. If it doesn't arrive, check your spam folder and reply here.";
    } else if (/wifi|vpn|network|dns|connection/i.test(text)) {
      plan =
        "We're checking the network side now. In the meantime, please try disconnecting and reconnecting once; if it still fails, reply with the exact error message you see and whether you're on office Wi-Fi or working remotely, and we'll take it from there.";
    } else if (/device|laptop|monitor|asset|warranty|phone|printer/i.test(text)) {
      plan =
        "We've located your device in the inventory and are reviewing its status and warranty. We'll confirm the next step (repair, replacement or configuration) on this thread shortly.";
    } else if (/install|license|software|app\b|excel|outlook|slack|zoom/i.test(text)) {
      plan =
        "We're validating the license and preparing the installation for your account. You'll get a confirmation here once it's ready — no action needed from you for now.";
    }
    return `Hi ${first},\n\nThanks for reaching out. ${plan}\n\nBest regards,\nSupport team`;
  }

  // -- RESOLVE --------------------------------------------------------------

  /**
   * Consult the desk's procedure before acting, when there is one to consult.
   * The catalogue is advertised in the system prompt as `- <slug> (scope): …`,
   * so the mock reads it the way a real model would rather than being handed a
   * slug out of band — which keeps the offline demo honest about the flow and
   * means a desk with no skills produces exactly the old script.
   */
  private skillStep(system: string, tools: ToolSpec[]): ScriptStep[] {
    if (!tools.some((t) => t.name === "read_skill")) return [];
    const section = system.split("## Desk skills")[1];
    if (!section) return [];
    const slug = section.match(/^- ([a-z0-9-]+) \(/m)?.[1];
    if (!slug) return [];
    return [
      {
        name: "read_skill",
        input: { slug },
        plan: `This desk has an agreed procedure for requests like this — I'll read "${slug}" before touching anything.`,
      },
    ];
  }

  private script(available: Set<string> = new Set()): ScriptStep[] {
    const ticket = this.ctx.ticket;
    const text = `${ticket.title} ${ticket.description}`;
    const steps: ScriptStep[] = [];

    // KB-shaped tickets exercise the knowledge base (kb-11): a ticket that
    // names the knowledge base, a manual or a document gets a search_knowledge
    // call before anything else, so the offline loop exercises the tool.
    if (
      available.has("search_knowledge") &&
      /knowledge base|manual|documentation|document|pricing\.md/i.test(text)
    ) {
      steps.push({
        name: "search_knowledge",
        input: { query: ticket.title },
        plan: "This looks like a documentation question — I'll search the knowledge base for an authoritative source before answering.",
      });
    }

    // Desk memory first, mirroring the rule the real resolver is given: check
    // whether this desk has solved the request before. Only when the running
    // profile actually has the tool — an admin can disable it.
    if (available.has("search_tickets")) {
      steps.push({
        name: "search_tickets",
        input: { query: ticket.title, resolvedOnly: true },
        plan: "Before acting I'll check whether this desk has already solved a ticket like this one.",
      });
    }

    // A ticket that points at a page: read it before reasoning about it. The
    // guard in src/lib/egress.ts decides whether the URL may be opened, so
    // the offline demo shows a refusal for an internal link and a real read
    // for a public one — without a key and without a mock of the guard.
    const link = text.match(/https?:\/\/[^\s<>"'),\]]+/i)?.[0];
    if (link && available.has("fetch_url")) {
      steps.push({
        name: "fetch_url",
        input: { url: link },
        plan: `The ticket points at ${link} — I'll read the page before drawing any conclusion from it.`,
      });
    }
    let comment =
      "I've reviewed this request. No automated action was applicable, so I'm summarizing my findings here — a teammate can pick this up if anything else is needed.";
    let resolution = "Reviewed by the AI resolver.";

    if (/password|mfa|locked|2fa/i.test(text)) {
      steps.push({
        name: "reset_password",
        input: { email: ticket.requester.email },
        plan: "The requester is locked out — I'll trigger an identity-provider password reset with a recovery link.",
      });
      comment =
        "I've reset your password and sent a recovery link to the recovery address on file. The link expires in 60 minutes — after signing in you'll be asked to set a new password.";
      resolution = "Password reset completed; recovery link delivered.";
    } else if (/device|laptop|monitor|asset|warranty|phone/i.test(text)) {
      const assetTag = text.match(/[A-Z]{2}-\d{3,4}/)?.[0] ?? "LT-2043";
      steps.push({
        name: "get_device_info",
        input: { assetTag },
        plan: `I'll look up ${assetTag} in the asset inventory to get its model, assignment and warranty details.`,
      });
      comment = `I've looked up ${assetTag} in the asset inventory — model, assignment and warranty details are in the run trace above. Let me know if you need anything else.`;
      resolution = `Provided inventory and warranty details for ${assetTag}.`;
    } else if (/table|database|sql|schema|query|report|license/i.test(text)) {
      steps.push({
        name: "query_ops_database",
        input: { sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name" },
        plan: "I'll inspect the database schema first to understand what exists before making any change.",
      });
      comment =
        "I've queried the analytics database and gathered the information requested — details are in the run trace above.";
      resolution = "Answered the request using a read-only database query.";
      if (/create|add|drop|delete|update|insert|alter/i.test(text)) {
        const sql = /drop/i.test(text)
          ? "DROP TABLE employees_backup;"
          : `CREATE TABLE ${slug(ticket.title).replace(/-/g, "_")} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL);`;
        steps.push({
          name: "execute_ops_sql",
          input: { sql },
          plan: "The schema change is destructive/mutating, so it may require human approval before it runs.",
        });
        comment =
          "I've applied the requested database change after review. The run trace above shows the exact SQL that was executed.";
        resolution = "Database change executed as requested.";
      }
    } else if (/deploy|\brepos?\b|repository|pipeline|\bci\b|cloud|azure|aws|gcp/i.test(text)) {
      if (/\brepos?\b|repository/i.test(text)) {
        const name = slug(ticket.title);
        steps.push({
          name: "github_create_repo",
          input: { name },
          plan: `I'll create the ${name} repository with the standard template and CI enabled.`,
        });
        comment = `Repository acme/${name} is ready with default branch protection and the CI template enabled.`;
        resolution = `Created repository ${name}.`;
      } else {
        steps.push({
          name: "cloud_plan_deployment",
          input: {
            provider: "azure",
            service: slug(ticket.title),
            description: ticket.title,
          },
          plan: "I'll generate a deployment plan first so the change can be reviewed before it is applied.",
        });
        steps.push({
          name: "cloud_apply_deployment",
          input: { planId: `plan-${slug(ticket.title)}` },
          plan: "Applying the validated plan to the target environment — this may require human approval.",
        });
        comment =
          "The deployment plan was generated, validated and applied to the target environment. Rollout completed with health checks passing.";
        resolution = "Deployment applied successfully.";
      }
    }

    steps.push({
      name: "post_comment",
      input: { body: comment },
      plan: "I'll post an update so the requester knows what was done.",
    });
    steps.push({
      name: "resolve_ticket",
      input: { resolution },
      plan: "Everything is done — marking the ticket resolved.",
    });
    return steps;
  }

  private rejectionScript(): ScriptStep[] {
    return [
      {
        name: "post_comment",
        input: {
          body: "The action this request needed was sent for human approval and was rejected by the reviewer, so I have not made the change. A human teammate will follow up with next steps.",
        },
        plan: "The approval was rejected — I'll acknowledge the decision instead of retrying the action.",
      },
      {
        name: "escalate_to_human",
        input: {
          reason:
            "The required action was rejected by the human reviewer, so the main objective was not completed. A teammate needs to decide the alternative path.",
        },
        plan: "The objective was not met — escalating to a human instead of resolving.",
      },
    ];
  }
}
