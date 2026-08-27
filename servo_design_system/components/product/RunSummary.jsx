import React from "react";
import { Badge } from "../core/Badge.jsx";
import { Icon } from "../core/Icon.jsx";

const STATUS = {
  COMPLETED: { tone: "good", label: "completed" },
  RUNNING: { tone: "brand", label: "running" },
  WAITING_APPROVAL: { tone: "warn", label: "waiting for approval" },
  FAILED: { tone: "critical", label: "failed" },
};

export function RunSummary({ agentName, status = "COMPLETED", qaVerdict, qaNotes, took, when, stepCount = 0, summary, toolTrail = [], decisions = [], open, children }) {
  const s = STATUS[status] || STATUS.COMPLETED;
  const isOpen = open ?? (status === "RUNNING" || status === "WAITING_APPROVAL");
  return (
    <details className="svo-run" open={isOpen}>
      <summary>
        <div className="svo-run-top">
          <span className="svo-run-agent">{agentName}</span>
          <Badge tone="brand" solid>AI</Badge>
          <Badge tone={s.tone}>{s.label}</Badge>
          {qaVerdict && <Badge tone={qaVerdict === "PASS" ? "good" : "critical"}>QA {qaVerdict}</Badge>}
          <span className="svo-run-time">{took ? took + " · " : ""}{when}</span>
          <span className="svo-run-steps">{stepCount} steps<Icon name="chevron-right" size={14} className="svo-run-chev" /></span>
        </div>
        {summary && <div className="svo-run-summary">{summary}</div>}
        {qaVerdict && qaNotes && (
          <div className="svo-run-qa">
            <Icon name="clipboard-check" size={14} color="var(--info)" />
            <div><span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--info)" }}>QA review</span> {qaNotes}</div>
          </div>
        )}
        {(toolTrail.length > 0 || decisions.length > 0) && (
          <div className="svo-run-trail">
            {toolTrail.join("  ·  ")}
            {decisions.map((d, i) => (
              <span key={i}>{"  ·  "}<span className={d.approved ? "ok" : "no"}>{d.approved ? "approved" : "rejected"}{d.by ? " by " + d.by : ""}</span></span>
            ))}
          </div>
        )}
      </summary>
      {children && <div className="svo-run-body">{children}</div>}
    </details>
  );
}

export function RunStep({ kind = "text", children }) {
  return (
    <div className="svo-step">
      <span className="svo-step-kind">{kind}</span>
      <div style={{ minWidth: 0, flex: 1, color: "var(--text-muted)", lineHeight: "var(--leading-relaxed)" }}>{children}</div>
    </div>
  );
}
