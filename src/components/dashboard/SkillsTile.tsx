// The skills KPI tile (reb-06): three ring gauges with "n/a" for the
// not-applicable cases — no completed resolver runs in the window means the
// informed rate is undefined, no enabled skills means coverage is undefined.
// shareAsPct (labels.ts) is the discipline: null renders a word, never NaN.

import { SERIES } from "@/lib/chart-series";
import { shareAsPct } from "@/lib/labels";

const SIZE = 44;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * A small SVG ring: the brand arc over a quiet track, the reading in the
 * middle. `share` null draws the track only — a count, or an n/a, has no
 * arc to show.
 */
function RingGauge({ share, text, label }: { share: number | null; text: string; label: string }) {
  const filled = share === null ? 0 : Math.min(Math.max(share, 0), 1);
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${label}: ${text}`}
      className="shrink-0"
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
      {filled > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={SERIES.brand}
          strokeWidth={STROKE}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - filled)}
          strokeLinecap="butt"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-(--text-strong) font-mono text-[10.5px] font-semibold"
      >
        {text}
      </text>
    </svg>
  );
}

export default function SkillsTile({
  skills,
}: {
  skills: {
    skillInformedRunRate: number | null;
    skillsDistilledThisMonth: number;
    skillCoverage: number | null;
  };
}) {
  const rows = [
    {
      key: "informed",
      label: "Informed runs",
      hint: "completed resolver runs that read a skill",
      share: skills.skillInformedRunRate,
      text: shareAsPct(skills.skillInformedRunRate),
    },
    {
      key: "distilled",
      label: "Distilled · month",
      hint: "skills distilled from tickets this calendar month",
      share: null,
      text: String(skills.skillsDistilledThisMonth),
    },
    {
      key: "coverage",
      label: "Coverage",
      hint: "ticket categories an enabled skill claims",
      share: skills.skillCoverage,
      text: shareAsPct(skills.skillCoverage),
    },
  ];

  return (
    <dl className="flex h-full min-h-0 flex-col justify-center divide-y divide-border font-sans">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <RingGauge share={r.share} text={r.text} label={r.label} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-(--text-faint)">
              {r.label}
            </dt>
            <dd className="truncate text-[12.5px] leading-snug text-muted-foreground">{r.hint}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
