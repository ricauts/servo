import { SERIES } from "@/lib/chart-series";

const W = 64;
const H = 22;
const PAD = 1.5;

/**
 * A 64x22 inline sparkline for a KPI tile: the brand series at 1.5px with a
 * 12% area under it. No axes, no dots — the tile's number is the reading,
 * the line is the shape of the last two weeks.
 */
export default function Sparkline({
  points,
  label,
}: {
  points: number[];
  /** Accessible name ("Resolved per day, last 14 days"). */
  label: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const stepX = W / (points.length - 1);
  const y = (v: number) => (max === 0 ? H - PAD : H - PAD - (v / max) * (H - 2 * PAD));
  const coords = points.map((v, i) => `${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`);
  const line = `M${coords.join(" L")}`;
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      <title>{label}</title>
      <path d={area} fill={SERIES.created} fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={SERIES.created}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
