import type { ReactNode } from "react";

// The ds page header: a hairline-separated band on the page ground — not a
// card. Chivo title, an optional mono eyebrow above it, the description in
// muted ink, actions flush right.
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Mono caps micro-label above the title (a section or an id). */
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-5 md:px-8 md:py-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-faint">
            {eyebrow}
          </p>
        )}
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-text-strong">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl font-sans text-[13.5px] leading-normal text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
