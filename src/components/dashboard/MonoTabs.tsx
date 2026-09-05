"use client";

import { cn } from "@/lib/utils";

export interface MonoTab {
  id: string;
  label: string;
}

/**
 * The small mono tab strip the dashboard cards use to switch views inside a
 * card without adding routes: a hairline group of uppercase mono labels, the
 * active one lifted onto the card surface. Arrow keys move the selection so
 * it behaves like a real tablist, not three buttons.
 */
export default function MonoTabs({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly MonoTab[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the strip ("Breakdown", "Flow view"). */
  label: string;
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === value);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`#tab-${tabs[next].id}`);
    el?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-(--surface-inset) p-0.5",
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "h-6 rounded-[4px] px-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
