import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/labels";

// The ds chip recipe (readme → "A badge is a deep tinted chip"): an opaque
// tone surface, a 1px tone hairline and tone ink — the --*-chip /
// --*-chip-line / --*-chip-ink triples, exposed as utilities by globals.css.
// Never an alpha tint: a chip must read identically on paper and on ink.
const CHIP: Record<Exclude<BadgeTone, "violet">, string> = {
  neutral: "border-neutral-chip-line bg-neutral-chip text-neutral-chip-ink",
  brand: "border-brand-chip-line bg-brand-chip text-brand-chip-ink",
  good: "border-good-chip-line bg-good-chip text-good-chip-ink",
  warn: "border-warn-chip-line bg-warn-chip text-warn-chip-ink",
  serious: "border-serious-chip-line bg-serious-chip text-serious-chip-ink",
  critical: "border-critical-chip-line bg-critical-chip text-critical-chip-ink",
  info: "border-info-chip-line bg-info-chip text-info-chip-ink",
};

const TONES: Record<BadgeTone, string> = {
  ...CHIP,
  // Legacy name kept so older call sites keep compiling — it IS the info tone.
  violet: CHIP.info,
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
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 font-mono text-[10.5px] font-semibold uppercase leading-none tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
