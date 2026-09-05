// The control row the knowledge surfaces share. Design system: controls are
// 32px in the app, 8px corners, a hairline border, an opaque hover fill
// (--surface-hover through the `accent` alias) and the 3px focus ring. One
// set of strings so the library toolbar, the graph toolbar and the packs
// filter row line up pixel for pixel.

export const INPUT =
  "h-8 w-full rounded-lg border border-input bg-background text-[12.5px] text-foreground outline-none placeholder:text-(--text-faint) focus:border-ring focus:ring-[3px] focus:ring-ring/50";

export const SELECT =
  "h-8 rounded-lg border border-input bg-background px-2 font-mono text-[10.5px] uppercase tracking-wider text-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50";

/** A select whose options are sentence-case text (a shelf name, a visibility
 *  with its explanation): the same 32px control, in the UI face rather than
 *  the mono micro-label. */
export const SELECT_TEXT =
  "h-8 max-w-full rounded-lg border border-input bg-background px-2 text-[12.5px] text-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50";

export const SEGMENT_GROUP = "flex h-8 overflow-hidden rounded-lg border border-input bg-background";

/** One button of a segmented group; the active segment takes the pressed surface. */
export function segmentClass(active: boolean): string {
  return `h-full px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ${
    active ? "bg-(--surface-active) text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
}

export const BTN_OUTLINE =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 font-heading text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export const BTN_OUTLINE_SM =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-heading text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export const BTN_PRIMARY =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 font-heading text-[12.5px] font-medium text-primary-foreground transition-colors hover:bg-(--brand-hover) active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export const BTN_ICON =
  "inline-flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/** Mono micro-label: the design system's uppercase tracked label. */
export const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground";

/** Inline notices in the chip recipe: opaque surface, hairline, the tone's ink. */
export const NOTE_WARN =
  "rounded-lg border border-(--warn-chip-line) bg-(--warn-chip) px-3 py-2 font-mono text-[11px] leading-relaxed text-(--warn-chip-ink)";
export const NOTE_CRITICAL =
  "rounded-lg border border-(--critical-chip-line) bg-(--critical-chip) px-3 py-2 font-mono text-[11px] leading-relaxed text-(--critical-chip-ink)";
