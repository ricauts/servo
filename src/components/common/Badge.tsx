import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/labels";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/15 text-primary-strong",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  serious: "bg-serious-soft text-serious",
  critical: "bg-critical-soft text-critical",
  violet: "bg-violet-soft text-violet",
};

export default function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px font-mono text-[10.5px] font-semibold uppercase tracking-wide",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
