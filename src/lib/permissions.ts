import type { User } from "@prisma/client";
import type { RiskLevel, Role } from "@/lib/types";

export type Action =
  | "ticket.create"
  | "ticket.update"
  | "ticket.assign"
  | "ticket.escalate"
  | "ticket.comment"
  | "group.view"
  | "group.manage"
  | "agents.view"
  | "agents.manage"
  | "skills.view"
  | "skills.manage"
  | "agent.run"
  | "approval.view"
  | "approval.decide"
  | "settings.manage"
  | "kpi.view"
  // Knowledge base (kb-*): requesters meet the KB only as cited answers.
  | "kb.view"
  | "kb.upload"
  | "kb.share"
  | "kb.manage"
  // External data sources (xds-01): viewing a connection is a staff read;
  // creating or editing one is an admin act, because a source's scope is the
  // whole security model of the connection.
  | "kb.sources.view"
  | "kb.sources.manage"
  // Packs (kb-lib-5): the curated catalog of connectors and local plugin
  // bundles. Browsing is a staff read; promoting pack content is an admin
  // act (docs/design/marketplace.md fixes the names and the trust model).
  | "packs.view"
  | "packs.manage";

const MATRIX: Record<Action, Role[]> = {
  "ticket.create": ["ADMIN", "AGENT", "REQUESTER"],
  "ticket.update": ["ADMIN", "AGENT"],
  "ticket.assign": ["ADMIN", "AGENT"],
  "ticket.escalate": ["ADMIN", "AGENT"],
  "ticket.comment": ["ADMIN", "AGENT", "REQUESTER"],
  "group.view": ["ADMIN", "AGENT"],
  "group.manage": ["ADMIN"],
  "agents.view": ["ADMIN", "AGENT"],
  "agents.manage": ["ADMIN"],
  "skills.view": ["ADMIN", "AGENT"],
  "skills.manage": ["ADMIN"],
  "agent.run": ["ADMIN", "AGENT"],
  "approval.view": ["ADMIN", "AGENT"],
  "approval.decide": ["ADMIN", "AGENT"],
  "settings.manage": ["ADMIN"],
  "kpi.view": ["ADMIN", "AGENT"],
  // The KB actions are additive by design (rbac-01): never REQUESTER, never
  // AI_AGENT. Agents act through grants, not through the permission matrix.
  "kb.view": ["ADMIN", "AGENT"],
  "kb.upload": ["ADMIN", "AGENT"],
  "kb.share": ["ADMIN", "AGENT"],
  "kb.manage": ["ADMIN"],
  // Additive exactly as rbac-01's rows are: never REQUESTER, never AI_AGENT.
  "kb.sources.view": ["ADMIN", "AGENT"],
  "kb.sources.manage": ["ADMIN"],
  "packs.view": ["ADMIN", "AGENT"],
  "packs.manage": ["ADMIN"],
};

export function can(user: Pick<User, "role">, action: Action): boolean {
  return MATRIX[action].includes(user.role as Role);
}

/** HIGH-risk approvals are admin-only; agents may decide LOW/MEDIUM. */
export function canDecideApproval(
  user: Pick<User, "role">,
  riskLevel: RiskLevel | string,
): boolean {
  if (user.role === "ADMIN") return true;
  return user.role === "AGENT" && riskLevel !== "HIGH";
}

/** Helper for API routes: returns a Response when the check fails, else null. */
export function forbid(user: Pick<User, "role">, action: Action): Response | null {
  if (can(user, action)) return null;
  return Response.json(
    { error: `Your role (${user.role}) is not allowed to perform ${action}.` },
    { status: 403 },
  );
}
