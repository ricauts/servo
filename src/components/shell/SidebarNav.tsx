"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bot,
  LayoutDashboard,
  Inbox,
  ShieldCheck,
  Plug,
  Settings2,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  countTone?: "neutral" | "attention";
}

export default function SidebarNav({
  counts,
  showTeamNav = false,
  showIntegrations = false,
  onNavigate,
}: {
  counts: { tickets: number; approvals: number };
  /** Groups/Agents are only visible to admin and agent roles. */
  showTeamNav?: boolean;
  /** Integrations are admin-only. */
  showIntegrations?: boolean;
  /** Called when a nav link is clicked (used to close the mobile sheet). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    {
      href: "/tickets",
      label: "Tickets",
      icon: Inbox,
      count: counts.tickets,
      countTone: "neutral",
    },
    {
      href: "/approvals",
      label: "Approvals",
      icon: ShieldCheck,
      count: counts.approvals,
      countTone: "attention",
    },
    ...(showTeamNav
      ? [
          { href: "/groups", label: "Groups", icon: Users2 } as NavItem,
          { href: "/agents", label: "Agents", icon: Bot } as NavItem,
          { href: "/skills", label: "Skills", icon: BookOpen } as NavItem,
        ]
      : []),
    ...(showIntegrations
      ? [{ href: "/integrations", label: "Integrations", icon: Plug } as NavItem]
      : []),
    { href: "/settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-2 font-heading text-[13.5px] font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <item.icon size={16} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4",
                  item.countTone === "attention"
                    ? // Pending approvals read as critical: the ds chip triple.
                      "border-[color:var(--critical-chip-line)] bg-[color:var(--critical-chip)] font-semibold text-[color:var(--critical-chip-ink)]"
                    : "border-transparent bg-sidebar-accent text-sidebar-foreground/70",
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
