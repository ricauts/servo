// The QA reviewer's note as one callout, shared by the ticket's folded run
// entry and the console's trace panel so a verdict reads the same on both.
// The info chip triple — opaque surface, hairline, ink — never a tint.

import { ClipboardCheck } from "lucide-react";

export default function QaNote({ notes }: { notes: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-(--info-chip-line) bg-(--info-chip) px-3 py-2 font-sans text-[12.5px] leading-relaxed text-(--text-muted)">
      <ClipboardCheck size={14} className="mt-0.5 shrink-0 text-(--info-chip-ink)" aria-hidden />
      <div className="min-w-0">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-(--info-chip-ink)">
          QA review
        </span>{" "}
        {notes}
      </div>
    </div>
  );
}
