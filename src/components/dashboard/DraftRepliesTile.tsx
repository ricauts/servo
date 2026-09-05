import SegmentBar from "@/components/dashboard/SegmentBar";

/**
 * AI reply drafts mini-tile: how often the AI's draft was good enough to send
 * untouched. The acceptance rate counts sent-as-is over all decided drafts —
 * the number that tells you whether drafting is actually saving agent time.
 */
export default function DraftRepliesTile({
  pending,
  sentAsIs,
  edited,
  discarded,
}: {
  pending: number;
  sentAsIs: number;
  edited: number;
  discarded: number;
}) {
  const decided = sentAsIs + edited + discarded;
  const total = decided + pending;
  const acceptance = decided === 0 ? null : Math.round((sentAsIs / decided) * 100);

  const rows = [
    { key: "sent", label: "Sent as-is", value: sentAsIs, fill: "var(--good)" },
    { key: "edited", label: "Edited & sent", value: edited, fill: "var(--warn)" },
    { key: "discarded", label: "Discarded", value: discarded, fill: "var(--critical)" },
    { key: "pending", label: "Awaiting review", value: pending, fill: "var(--text-faint)" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex items-baseline gap-2 pb-2">
        <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-(--text-strong)">
          {acceptance === null ? "—" : `${acceptance}%`}
        </span>
        <span className="text-xs text-muted-foreground">accepted as-is</span>
      </div>
      <SegmentBar
        segments={rows.map((r) => ({ key: r.key, value: r.value, fill: r.fill }))}
        label={`AI replies: ${sentAsIs} sent as-is, ${edited} edited, ${discarded} discarded, ${pending} awaiting review`}
        className="mb-1"
      />
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between py-1.5">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: r.fill }}
                aria-hidden="true"
              />
              {r.label}
            </span>
            <span className="flex items-baseline gap-2 font-mono text-[13px] tabular-nums">
              <span className="font-semibold text-foreground">{r.value}</span>
              <span className="w-8 text-right text-[11px] text-(--text-faint)">
                {total === 0 ? "—" : `${Math.round((r.value / total) * 100)}%`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
