import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Sparkline from "@/components/dashboard/Sparkline";
import type { DeltaChip, DeltaTone } from "@/components/dashboard/kpi-delta";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CHIP: Record<DeltaTone, string> = {
  good: "bg-(--good-chip) text-(--good-chip-ink) ring-(--good-chip-line)",
  critical: "bg-(--critical-chip) text-(--critical-chip-ink) ring-(--critical-chip-line)",
  neutral: "bg-(--neutral-chip) text-(--neutral-chip-ink) ring-(--neutral-chip-line)",
};

const ARROW = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/**
 * KPI tile: mono uppercase label, hero number with its unit, and under it
 * either the movement against the previous 30 days (an opaque status chip)
 * or a plain caption for snapshot numbers. `highlight` turns the whole tile
 * into a chip surface; `tone` says how urgent (amber waiting, red missed).
 */
export default function StatTile({
  label,
  value,
  unit,
  highlight = false,
  tone = "warn",
  delta,
  caption,
  sparkline,
  sparklineLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
  tone?: "warn" | "critical";
  /** Movement vs the previous window; null/undefined renders the caption instead. */
  delta?: DeltaChip | null;
  caption?: string;
  /** Last 14 daily values; drawn 64x22 beside the number. */
  sparkline?: number[];
  sparklineLabel?: string;
}) {
  const critical = tone === "critical";
  const ink = highlight
    ? critical
      ? "text-(--critical-chip-ink)"
      : "text-(--warn-chip-ink)"
    : null;
  const Arrow = delta ? ARROW[delta.direction] : null;

  return (
    <Card
      className={cn(
        "gap-2 px-4 py-3",
        highlight &&
          (critical
            ? "bg-(--critical-chip) ring-(--critical-chip-line)"
            : "bg-(--warn-chip) ring-(--warn-chip-line)"),
      )}
    >
      <div
        className={cn(
          "truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]",
          ink ?? "text-(--text-faint)",
        )}
      >
        {label}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-heading text-[28px] font-semibold leading-none tracking-tight tabular-nums",
              ink ?? "text-(--text-strong)",
            )}
          >
            {value}
          </span>
          {unit && (
            <span className={cn("font-sans text-[13px] font-medium", ink ?? "text-muted-foreground")}>
              {unit}
            </span>
          )}
        </div>
        {sparkline && sparklineLabel && <Sparkline points={sparkline} label={sparklineLabel} />}
      </div>
      <div className="flex h-[18px] items-center gap-1.5">
        {delta && Arrow ? (
          <>
            <span
              className={cn(
                "inline-flex h-[18px] items-center gap-0.5 rounded-full pl-1 pr-1.5 font-mono text-[10.5px] font-semibold tabular-nums ring-1",
                CHIP[delta.tone],
              )}
            >
              <Arrow size={11} strokeWidth={2.25} aria-hidden="true" />
              {delta.label}
            </span>
            <span className={cn("font-mono text-[10.5px]", ink ?? "text-(--text-faint)")}>
              vs prev 30d
            </span>
          </>
        ) : (
          caption && (
            <span className={cn("truncate font-mono text-[10.5px]", ink ?? "text-(--text-faint)")}>
              {caption}
            </span>
          )
        )}
      </div>
    </Card>
  );
}
