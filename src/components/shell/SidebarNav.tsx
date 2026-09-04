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
              <p className="mt-4 px-2.5 pb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                {SECTION_LABELS[item.section]}
              </p>
            )}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 font-heading text-[13.5px] font-medium transition-colors",
                active
                  ? // The ds active item: a quiet brand-soft wash and a 2px brand
                    // bar down the left edge — no filled pill.
                    "bg-brand-soft text-text-strong before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-strong",
              )}
            >
              <Icon
                size={16}
                strokeWidth={2}
                className={cn("shrink-0", active && "text-primary-strong")}
              />
              <span className="flex-1">{item.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "inline-flex h-[18px] items-center rounded-full border px-1.5 font-mono text-[10.5px] font-semibold leading-none",
                    item.href === "/approvals"
                      ? // Pending approvals are the one count that blocks a run:
                        // the ds critical chip triple. Every other count is neutral.
                        "border-critical-chip-line bg-critical-chip text-critical-chip-ink"
                      : "border-neutral-chip-line bg-neutral-chip text-neutral-chip-ink",
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
