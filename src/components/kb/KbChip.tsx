import type { ReactNode } from "react";

/**
 * The chip the knowledge surfaces share (library, graph, sources, packs).
 *
 * The design system's badge recipe: an OPAQUE tinted surface, a tinted
 * hairline and the tone's own ink — three tokens per tone, never an alpha
 * tint, so the chip reads the same on paper and on graphite. The status
 * vocabulary is fixed: good is green, critical is red, and nothing here
 * reassigns a hue. No hooks, no "use client": server pages and client
 * components import the same file.
 */
export type ChipTone = "neutral" | "brand" | "good" | "warn" | "serious" | "critical" | "info";

export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-(--neutral-chip) border-(--neutral-chip-line) text-(--neutral-chip-ink)",
  brand: "bg-(--brand-chip) border-(--brand-chip-line) text-(--brand-chip-ink)",
  good: "bg-(--good-chip) border-(--good-chip-line) text-(--good-chip-ink)",
  warn: "bg-(--warn-chip) border-(--warn-chip-line) text-(--warn-chip-ink)",
  serious: "bg-(--serious-chip) border-(--serious-chip-line) text-(--serious-chip-ink)",
  critical: "bg-(--critical-chip) border-(--critical-chip-line) text-(--critical-chip-ink)",
  info: "bg-(--info-chip) border-(--info-chip-line) text-(--info-chip-ink)",
};

const CHIP_BASE =
  "inline-flex h-5 max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 leading-none [&>svg]:shrink-0";

/**
 * The class string for a chip. `caps` is the mono micro-label form (status,
 * kind, visibility); without it the chip carries data as written — a
 * keyword stays lowercase, a topic keeps its Title Case in the heading face.
 */
export function chipClass(tone: ChipTone, opts: { caps?: boolean; face?: "mono" | "ui" } = {}): string {
  const face = opts.face ?? "mono";
  return [
    CHIP_BASE,
    CHIP_TONE_CLASS[tone],
    face === "mono" ? "font-mono text-[10.5px] font-semibold" : "font-heading text-[11px] font-medium",
    opts.caps ? "uppercase tracking-[0.06em]" : "tracking-normal",
  ].join(" ");
}

export function Chip({
  tone = "neutral",
  caps = false,
  face = "mono",
  icon,
  title,
  className,
  children,
}: {
  tone?: ChipTone;
  caps?: boolean;
  face?: "mono" | "ui";
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${chipClass(tone, { caps, face })}${className ? ` ${className}` : ""}`} title={title}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Document.visibility → tone. Public is the open state (good), staff the
 *  guarded one (warn), private the default (neutral). The graph paints its
 *  file nodes with the same three chip surfaces. */
export function visibilityTone(visibility: string): ChipTone {
  switch (visibility) {
    case "PUBLIC":
      return "good";
    case "STAFF":
      return "warn";
    default:
      return "neutral";
  }
}

/** Document.textStatus → tone, matching statusCopy() in lib/kb/library. */
export function textStatusTone(textStatus: string): ChipTone {
  switch (textStatus) {
    case "EXTRACTED":
      return "good";
    case "FAILED":
      return "critical";
    case "UNSUPPORTED":
      return "warn";
    default:
      return "neutral";
  }
}

/** DataSource.status → tone. Disabled is the reversible kill switch, so it
 *  is neutral; purged destroyed bytes, so it is critical. */
export function sourceStatusTone(status: string): ChipTone {
  switch (status) {
    case "READY":
      return "good";
    case "SYNCING":
      return "info";
    case "UNREACHABLE":
      return "warn";
    case "ERROR":
      return "serious";
    case "PURGED":
      return "critical";
    default:
      return "neutral";
  }
}

/** A pack's install state on this desk → tone. Configured is the settled
 *  state (good); available is a next step (info); planned is named but not
 *  built, so it takes the quietest tone — a planned card must read quieter
 *  than an installable one, never louder. */
export function packStateTone(state: "configured" | "available" | "planned"): ChipTone {
  return state === "configured" ? "good" : state === "available" ? "info" : "neutral";
}
