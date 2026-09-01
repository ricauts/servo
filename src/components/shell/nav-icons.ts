// The only place a NavEntry's icon becomes a component. Entries travel from
// server components (layout, Sidebar) into client ones (SidebarNav,
// CommandPalette) as props, and React refuses to serialize functions — a
// NavEntry that held the lucide component itself crashed every authenticated
// page with "Functions cannot be passed directly to Client Components".
// nav-items.ts therefore stores icon NAMES; this map is imported only where
// an icon is actually rendered.

import {
  Activity,
  Bot,
  BookOpen,
  Database,
  Inbox,
  LayoutDashboard,
  Plug,
  ServerCog,
  Plus,
  Settings2,
  ShieldCheck,
  Users2,
  type LucideIcon,
} from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  tickets: Inbox,
  "new-ticket": Plus,
  approvals: ShieldCheck,
  groups: Users2,
  agents: Bot,
  runs: Activity,
  skills: BookOpen,
  knowledge: Database,
  integrations: Plug,
  sources: ServerCog,
  settings: Settings2,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
