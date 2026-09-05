// The design system's status chip, as the run surfaces use it: an OPAQUE
// tinted surface, a tinted hairline and a tinted ink — the --*-chip /
// --*-chip-line / --*-chip-ink triples from servo_design_system/tokens.
// Never an alpha tint. Mono, uppercase by default; `upper={false}` keeps
// machine words (tool names) verbatim.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "good" | "warn" | "serious" | "critical" | "info" | "neutral" | "brand";

/** The chip triple as utility classes — shared with the timeline's rail nodes. */
export const CHIP_CLASS: Record<ChipTone, string> = {
  good: "bg-(--good-chip) border-(--good-chip-line) text-(--good-chip-ink)",
  warn: "bg-(--warn-chip) border-(--warn-chip-line) text-(--warn-chip-ink)",
  serious: "bg-(--serious-chip) border-(--serious-chip-line) text-(--serious-chip-ink)",
  critical: "bg-(--critical-chip) border-(--critical-chip-line) text-(--critical-chip-ink)",
  info: "bg-(--info-chip) border-(--info-chip-line) text-(--info-chip-ink)",
  neutral: "bg-(--neutral-chip) border-(--neutral-chip-line) text-(--neutral-chip-ink)",
  brand: "bg-(--brand-chip) border-(--brand-chip-line) text-(--brand-chip-ink)",
};

/** Run status → chip tone (spec: waiting = warn, completed = good, failed = critical, running = info). */
export const RUN_STATUS_CHIP: Record<string, ChipTone> = {
  RUNNING: "info",
  WAITING_APPROVAL: "warn",
  COMPLETED: "good",
  FAILED: "critical",
};

export const RUN_STATUS_TEXT: Record<string, string> = {
  RUNNING: "running",
  WAITING_APPROVAL: "waiting approval",
  COMPLETED: "completed",
  FAILED: "failed",
};

/** Risk → chip tone: LOW neutral, MEDIUM warn, HIGH critical. */
export const RISK_CHIP: Record<string, ChipTone> = {
  LOW: "neutral",
  MEDIUM: "warn",
  HIGH: "critical",
};

export const RISK_TEXT: Record<string, string> = {
  LOW: "low risk",
  MEDIUM: "medium risk",
  HIGH: "high risk",
};

export const APPROVAL_CHIP: Record<string, ChipTone> = {
  PENDING: "warn",
  APPROVED: "good",
  REJECTED: "critical",
};

export default function RunChip({
  tone = "neutral",
  upper = true,
  title,
  className,
  children,
}: {
  tone?: ChipTone;
  upper?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 font-mono text-[10.5px] font-semibold leading-none",
        upper ? "uppercase tracking-[0.06em]" : "tracking-normal",
        CHIP_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
