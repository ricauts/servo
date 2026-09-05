import SegmentBar from "@/components/dashboard/SegmentBar";

const ROWS = [
  { key: "pending", label: "Pending", fill: "var(--warn)" },
  { key: "approved", label: "Approved", fill: "var(--good)" },
  { key: "rejected", label: "Rejected", fill: "var(--critical)" },
] as const;

/**
 * Approvals mini-tile: how the gated actions were decided. The hero is the
 * approval share over decided gates; the bar and rows carry the split
 * including what is still waiting on a person.
 */
export default function ApprovalsTile({
  approved,
  rejected,
  pending,
}: {
  approved: number;
  rejected: number;
  pending: number;
}) {
  const values = { approved, rejected, pending };
  const total = approved + rejected + pending;
  const decided = approved + rejected;
  const approvalRate = decided === 0 ? null : Math.round((approved / decided) * 100);

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex items-baseline gap-2 pb-2">
        <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-(--text-strong)">
          {approvalRate === null ? "—" : `${approvalRate}%`}
        </span>
        <span className="text-xs text-muted-foreground">approved when decided</span>
      </div>
      <SegmentBar
        segments={ROWS.map((r) => ({ key: r.key, value: values[r.key], fill: r.fill }))}
        label={`Approvals: ${pending} pending, ${approved} approved, ${rejected} rejected`}
        className="mb-1"
      />
      <div className="divide-y divide-border">
        {ROWS.map((r) => (
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
              <span className="font-semibold text-foreground">{values[r.key]}</span>
              <span className="w-8 text-right text-[11px] text-(--text-faint)">
                {total === 0 ? "—" : `${Math.round((values[r.key] / total) * 100)}%`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
