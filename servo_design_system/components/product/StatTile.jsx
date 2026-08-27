import React from "react";

export function StatTile({ label, value, unit, highlight }) {
  return (
    <div className={["svo-stat", highlight ? "h-" + highlight : ""].filter(Boolean).join(" ")}>
      <div className="svo-stat-label">{label}</div>
      <div className="svo-stat-value">
        {value}
        {unit && <span className="svo-stat-unit">{unit}</span>}
      </div>
    </div>
  );
}
