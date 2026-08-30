// Shared enum-like unions and API payload shapes. Enum-like fields are strings
// BY CHOICE, not by dialect — see prisma/schema.prisma: a Prisma enum would turn
// every new status or role into a migration. These unions are the single source
// of truth for the string values stored in the database. Keep prisma/seed-core.ts
// and all agents consistent with them.

export type Role = "ADMIN" | "AGENT" | "REQUESTER" | "AI_AGENT";
export type AiKind = "TRIAGE" | "RESOLVER" | "QA" | "DRAFT";

export type TicketStatus =
  | "OPEN"
  | "TRIAGED"
  | "IN_PROGRESS"
  | "WAITING_APPROVAL"
  | "RESOLVED"
  | "CLOSED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type Category =
  | "ACCESS"
  | "HARDWARE"
  | "SOFTWARE"
  | "DATABASE"
  | "DEVOPS"
  | "NETWORK"
  | "OTHER";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Outcome of one MCP tools/call, recorded on every McpCall row. ERROR exists
 * because a tool that throws must still leave a trail. */
export type McpCallDecision = "EXECUTED" | "REFUSED_POLICY" | "REFUSED_UNKNOWN" | "ERROR";

/** Escalation tiers within a group, lowest to highest. */
export type Seniority = "JUNIOR" | "MID" | "SENIOR";
export const SENIORITIES: Seniority[] = ["JUNIOR", "MID", "SENIOR"];

/**
 * A membership is either on the JUNIOR→MID→SENIOR ladder or STANDALONE — a
 * specialist outside the hierarchy who can take tickets at any tier but is
 * never the target of tier escalation preference.
 */
export type MemberTier = Seniority | "STANDALONE";
export const MEMBER_TIERS: MemberTier[] = [...SENIORITIES, "STANDALONE"];

export type RunStatus = "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED";
export type RunKind = "TRIAGE" | "RESOLVE";
export type StepType =
  | "TEXT"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "APPROVAL_REQUEST"
  | "QA_REVIEW"
  | "ERROR";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DraftStatus = "PENDING" | "SENT" | "REJECTED";

/** How a ticket entered the desk (ux-03). CHAT is in the union for the
 *  roadmap chat surface (ux-07) — nothing may stamp it in v1, and it must
 *  survive here until that surface ships. */
export type TicketChannel = "WEB" | "EMAIL" | "MCP" | "CHAT";

export const TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "TRIAGED",
  "IN_PROGRESS",
  "WAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
];
export const TICKET_CHANNELS: TicketChannel[] = ["WEB", "EMAIL", "MCP", "CHAT"];
export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const CATEGORIES: Category[] = [
  "ACCESS",
  "HARDWARE",
  "SOFTWARE",
  "DATABASE",
  "DEVOPS",
  "NETWORK",
  "OTHER",
];

// ---------------------------------------------------------------------------
// Provider conversation format (persisted on AgentRun.conversation as JSON).
// Mirrors the Anthropic Messages API shape so real and mock providers share it.
// ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ConversationMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/**
 * Content provenance (cnp-06): bundled with the desk ("local") or shipped by
 * an installed plugin ("plugin:<name>", the plugin.json's kebab-case name).
 * Plugin content is namespaced <plugin>--<slug> and arrives DISABLED; the
 * kind is recorded so the UI can say where a skill or profile came from.
 */
export type OriginKind = "local" | `plugin:${string}`;

// ---------------------------------------------------------------------------
// Settings keys (Setting table). Values are strings; booleans are "true"/"false".
// ---------------------------------------------------------------------------

export const SETTING_KEYS = {
  provider: "ai.provider", // "anthropic" | "openai" | "mock"
  apiKey: "ai.apiKey", // stored key; the provider-matching env var takes precedence
  baseUrl: "ai.baseUrl", // optional provider endpoint
  model: "ai.model", // default "claude-opus-5"
  autoTriage: "ai.autoTriage", // "true" | "false"
  autoDraft: "ai.autoDraft", // "true" | "false" — draft a reply for inbound-email tickets
  qaEnabled: "ai.qaEnabled", // "true" | "false"
  smtpEnabled: "integration.smtp.enabled", // "true" | "false"
  smtpUrl: "integration.smtp.url", // smtp://user:pass@host:port — env SMTP_URL wins; never returned by the API
  smtpFrom: "integration.smtp.from", // From address for notifications
} as const;
// Per-integration keys live with their module: GITHUB_SETTING_KEYS,
// AZURE_SETTING_KEYS, MCP_SETTING_KEYS, EGRESS_SETTING_KEYS…

// ---------------------------------------------------------------------------
// KPI endpoint response (GET /api/kpis)
// ---------------------------------------------------------------------------

export interface KpiResponse {
  totals: {
    open: number; // tickets not RESOLVED/CLOSED
    resolvedLast30d: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
    aiResolutionRate: number; // 0..1 over resolved tickets last 30d
    pendingApprovals: number;
    slaBreached: number; // open tickets past their active SLA target
  };
  createdByDay: { date: string; created: number; resolved: number }[]; // last 30 days, date = "YYYY-MM-DD"
  byCategory: { category: Category; count: number }[]; // open + in-flight tickets
  byPriority: { priority: Priority; count: number }[];
  aiVsHuman: { resolver: "AI" | "HUMAN"; count: number }[]; // resolved last 30d
  approvalStats: { approved: number; rejected: number; pending: number };
  // AI reply drafts, last 30 days by decision date (pending = right now).
  // sentAsIs vs edited is the AI acceptance signal for drafted replies.
  draftStats: { pending: number; sentAsIs: number; edited: number; discarded: number };
  topRequesters: { name: string; count: number }[]; // last 30d, top 5
  // Skill KPIs (reb-06). null = "not applicable" (no runs / no enabled
  // skills), rendered "n/a" - never NaN.
  skills: {
    skillInformedRunRate: number | null; // share of completed resolver runs (30d) with >=1 read_skill step
    skillsDistilledThisMonth: number; // Skill rows with sourceTicketId created this calendar month
    skillCoverage: number | null; // share of ticket categories claimed by >=1 enabled skill
  };
}
