import { cn } from "@/lib/utils";

export interface Segment {
  key: string;
  value: number;
  /** A design-system token, e.g. "var(--good)". */
  fill: string;
}

/**
 * A single proportion bar: one 8px track, the segments sized by value with a
 * hairline gap between them. Zero-value segments are not drawn; an all-zero
 * set leaves the empty track, which is the honest picture.
 */
export default function SegmentBar({
  segments,
  label,
  className,
}: {
  segments: Segment[];
  /** Accessible summary ("Approvals: 3 pending, 12 approved, 1 rejected"). */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex h-2 w-full gap-px overflow-hidden rounded-full bg-(--surface-2)",
        className,
      )}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span
            key={s.key}
            className="h-full min-w-0 basis-0"
            style={{ flexGrow: s.value, background: s.fill }}
          />
        ))}
    </div>
  );
}
