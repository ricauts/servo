"use client";

// Renders whatever entries arrive as props — the registry in nav-items.ts,
// filtered once by the server, is the single owner of what appears here.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import type { NavEntry } from "@/components/shell/nav-items";

const SECTION_LABELS: Partial<Record<NavEntry["section"], string>> = {
  fleet: "Fleet",
  admin: "Admin",
};

export default function SidebarNav({
  entries,
  counts,
  onNavigate,
}: {
  entries: NavEntry[];
  counts?: { tickets: number; approvals?: number };
  /** Called when a nav link is clicked (used to close the mobile sheet). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  let lastSection: NavEntry["section"] | null = null;

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {entries.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const showSection = item.section !== "work" && item.section !== lastSection;
        lastSection = item.section;
        const count =
          item.href === "/tickets"
            ? counts?.tickets
            : item.href === "/approvals"
              ? counts?.approvals
              : undefined;
        return (
          <div key={item.href}>
            {showSection && (
              <p className="mt-3 px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45">
                {SECTION_LABELS[item.section]}
              </p>
            )}
            <Link
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
              <Icon size={16} strokeWidth={2} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4",
                    item.href === "/approvals"
                      ? // Pending approvals read as critical: the ds chip triple.
                        "border-[color:var(--critical-chip-line)] bg-[color:var(--critical-chip)] font-semibold text-[color:var(--critical-chip-ink)]"
                      : "border-transparent bg-sidebar-accent text-sidebar-foreground/70",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
