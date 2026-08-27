// The single owner of navigation (spec item ux-01, §9.2). Every page Servo
// has is one NavEntry here; navForUser is the pure filter the shell renders
// from. After ux-01 NO item may add a navigation entry by editing a
// component — adding a page means adding one NavEntry (and declaring
// depends-on: ux-01). The registry is a plain shared module so server
// components can compute the filtered list and pass it down as props.

import {
  Bot,
  BookOpen,
  Inbox,
  LayoutDashboard,
  Plug,
  Plus,
  Settings2,
  ShieldCheck,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { can, type Action } from "@/lib/permissions";
import type { User } from "@prisma/client";

export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  section: "work" | "fleet" | "admin";
  /** Omitted = visible to every signed-in human role. */
  action?: Action;
  /** For pages gated by role, not action (e.g. /integrations). */
  adminOnly?: boolean;
}

export const NAV_ENTRIES: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "work", action: "kpi.view" },
  { href: "/tickets", label: "Tickets", icon: Inbox, section: "work" },
  { href: "/tickets/new", label: "New request", icon: Plus, section: "work" },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck, section: "work", action: "approval.view" },
  { href: "/groups", label: "Groups", icon: Users2, section: "work", action: "group.view" },
  { href: "/agents", label: "Agents", icon: Bot, section: "fleet", action: "agents.view" },
  { href: "/skills", label: "Skills", icon: BookOpen, section: "fleet", action: "skills.view" },
  { href: "/integrations", label: "Integrations", icon: Plug, section: "admin", adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings2, section: "admin", adminOnly: true },
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
