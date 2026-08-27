// Small hand-rolled SVG charts: the app uses Recharts, these are cosmetic
// stand-ins that read the same --chart-* tokens and keep the fixed series order.
function AreaFlow({ data, height = 210 }) {
  const w = 640, pad = 24;
  const max = Math.max(...data.flat(), 4);
  const x = (i) => pad + (i * (w - pad * 2)) / (data.length - 1);
  const y = (v) => height - 28 - (v / max) * (height - 56);
  const path = (idx) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[idx]).toFixed(1)}`).join(" ");
  const area = (idx) => `${path(idx)} L${x(data.length - 1)},${height - 28} L${pad},${height - 28} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Ticket flow, last 30 days">
      {[0, 0.5, 1].map((t) => <line key={t} x1={pad} x2={w - pad} y1={y(max * t)} y2={y(max * t)} stroke="var(--chart-grid)" />)}
      <path d={area(0)} fill="var(--chart-2)" opacity=".13" />
      <path d={area(1)} fill="var(--chart-1)" opacity=".13" />
      <path d={path(0)} fill="none" stroke="var(--chart-2)" strokeWidth="1.75" />
      <path d={path(1)} fill="none" stroke="var(--chart-1)" strokeWidth="1.75" />
      {["Jul 13", "Jul 21", "Jul 29", "Aug 6"].map((l, i) => (
        <text key={l} x={pad + i * ((w - pad * 2) / 3.2)} y={height - 8} fill="var(--chart-axis)" fontFamily="var(--font-mono)" fontSize="10">{l}</text>
      ))}
    </svg>
  );
}

function BarList({ rows, color = "var(--chart-1)" }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "116px 1fr 24px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textAlign: "right" }}>{r.label}</span>
          <span style={{ height: 12, borderRadius: 2, background: color, width: `${(r.n / max) * 100}%`, minWidth: 8 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", color: "var(--text-muted)" }}>{r.n}</span>
        </div>
      ))}
    </div>
  );
}

function Donut({ ai, human, size = 168 }) {
  const total = ai + human, r = size / 2 - 14, c = 2 * Math.PI * r;
  const aiLen = (ai / total) * c;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-2)" strokeWidth="18" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-1)" strokeWidth="18" strokeDasharray={`${aiLen} ${c - aiLen}`} />
        </g>
        <text x="50%" y="48%" textAnchor="middle" fill="var(--text-strong)" fontSize="26" fontWeight="600" fontFamily="var(--font-core)">{total}</text>
        <text x="50%" y="62%" textAnchor="middle" fill="var(--text-muted)" fontSize="11" fontFamily="var(--font-mono)">resolved</text>
      </svg>
      <div style={{ display: "flex", gap: 18, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-1)" }} /><b style={{ fontFamily: "var(--font-mono)", color: "var(--text-strong)" }}>{ai}</b> AI agents</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-2)" }} /><b style={{ fontFamily: "var(--font-mono)", color: "var(--text-strong)" }}>{human}</b> Humans</span>
      </div>
    </div>
  );
}
Object.assign(window, { AreaFlow, BarList, Donut });
