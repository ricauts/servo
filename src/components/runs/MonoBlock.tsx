"use client";

// A tool payload as a mono block on the inset surface: pretty-printed JSON
// (or the raw text when it is not JSON), a six-line preview, and "Show all"
// for the rest. The only stateful piece of the run trace, kept as a small
// client island so the timeline around it can render on the server.

import { useState } from "react";
import { prettyJson } from "@/components/tickets/format";
import { cn } from "@/lib/utils";

const PREVIEW_LINES = 6;

const TONE = {
  neutral: "border-(--line) bg-(--surface-inset) text-(--text-body)",
  critical: "border-(--critical-chip-line) bg-(--critical-chip) text-(--critical-chip-ink)",
} as const;

export default function MonoBlock({
  raw,
  tone = "neutral",
  className,
}: {
  raw: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = prettyJson(raw);
  const lines = text.split("\n");
  const overflow = lines.length > PREVIEW_LINES + 1;
  const shown = open || !overflow ? text : lines.slice(0, PREVIEW_LINES).join("\n");

  return (
    <div className={cn("min-w-0", className)}>
      <pre
        className={cn(
          "overflow-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2 font-mono text-[11.5px] leading-relaxed",
          open && "max-h-96",
          TONE[tone],
        )}
      >
        {shown}
        {overflow && !open && <span className="text-(--text-faint)">{"\n…"}</span>}
      </pre>
      {overflow && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 inline-flex h-6 items-center gap-1 rounded px-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-(--text-brand) transition-colors hover:bg-(--surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
        >
          {open ? "Show less" : `Show all · ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
