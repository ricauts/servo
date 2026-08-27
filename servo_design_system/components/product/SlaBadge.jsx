import React from "react";
import { Badge } from "../core/Badge.jsx";

const TONE = { met: "good", ok: "neutral", at_risk: "warn", breached: "critical" };

export function SlaBadge({ state = "ok", label, kind }) {
  if (state === "none") return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return <Badge tone={TONE[state] || "neutral"}>SLA {label}{kind ? " · " + kind : ""}</Badge>;
}
