// The single owner of navigation (spec item ux-01, §9.2). Every page Servo
// has is one NavEntry here; navForUser is the pure filter the shell renders
// from. After ux-01 NO item may add a navigation entry by editing a
// component — adding a page means adding one NavEntry (and declaring
// depends-on: ux-01). The registry is a plain shared module so server
// components can compute the filtered list and pass it down as props.

import { can, type Action } from "@/lib/permissions";
import type { NavIconName } from "@/components/shell/nav-icons";
import type { User } from "@prisma/client";

export interface NavEntry {
  href: string;
  label: string;
  /** A NAV_ICONS key, never a component: entries cross the server/client
   * boundary as props, and functions are not serializable. */
  icon: NavIconName;
  section: "work" | "fleet" | "admin";
  /** Omitted = visible to every signed-in human role. */
  action?: Action;
  /** For pages gated by role, not action (e.g. /integrations). */
  adminOnly?: boolean;
}

export const NAV_ENTRIES: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "work", action: "kpi.view" },
  { href: "/tickets", label: "Tickets", icon: "tickets", section: "work" },
  { href: "/tickets/new", label: "New request", icon: "new-ticket", section: "work" },
  { href: "/approvals", label: "Approvals", icon: "approvals", section: "work", action: "approval.view" },
  { href: "/groups", label: "Groups", icon: "groups", section: "work", action: "group.view" },
  { href: "/agents", label: "Agents", icon: "agents", section: "fleet", action: "agents.view" },
  // The runs console (ux-05): the "monitor agents" surface, same gate as
  // /agents — a cross-ticket read-only view of every run and its steps.
  { href: "/runs", label: "Runs", icon: "runs", section: "fleet", action: "agents.view" },
  { href: "/skills", label: "Skills", icon: "skills", section: "fleet", action: "skills.view" },
  // The Knowledge entry (kb-16): kb.view excludes REQUESTER and AI_AGENT, so
  // the entry is absent from their nav — they meet the KB as cited answers.
  { href: "/kb", label: "Knowledge", icon: "knowledge", section: "fleet", action: "kb.view" },
  // External data sources (xds-09): admins manage, kb.view roles browse.
  { href: "/kb/sources", label: "Sources", icon: "sources", section: "fleet", action: "kb.sources.manage" },
  { href: "/integrations", label: "Integrations", icon: "integrations", section: "admin", adminOnly: true },
  { href: "/settings", label: "Settings", icon: "settings", section: "admin", adminOnly: true },
];

/**
 * The visible nav tree for a user. AI agents never sign into the UI and get
 * an empty list; a REQUESTER sees only their own queue (the operator tree);
 * the fleet/admin sections open up with the roles the permission matrix
 * already enforces. Pure — unit-testable without a database.
 */
export function navForUser(
  user: Pick<User, "role">,
  items: NavEntry[] = NAV_ENTRIES,
): NavEntry[] {
  if (user.role === "AI_AGENT") return [];
  const visible = items.filter((entry) => {
    if (entry.adminOnly) return user.role === "ADMIN";
    if (!entry.action) return true;
    return can(user, entry.action);
  });
  // Operator copy: for a requester the queue IS their own requests (§9.2).
  if (user.role === "REQUESTER") {
    return visible.map((entry) =>
      entry.href === "/tickets" ? { ...entry, label: "My tickets" } : entry,
    );
  }
  return visible;
}
