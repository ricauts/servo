import React from "react";
import { Badge } from "../core/Badge.jsx";
import { Button } from "../core/Button.jsx";
import { Input } from "../core/Input.jsx";
import { Icon } from "../core/Icon.jsx";

const RISK = { LOW: { tone: "good", label: "Low risk" }, MEDIUM: { tone: "warn", label: "Medium risk" }, HIGH: { tone: "critical", label: "High risk" } };

const LEVEL = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export function ApprovalCard({ ticketNumber, ticketTitle, toolName, toolInput, risk = "MEDIUM", requestedAt, agentName, blockedFor, impact, diff, canDecide = true, onApprove, onReject }) {
  const r = RISK[risk] || RISK.MEDIUM;
  const lvl = LEVEL[risk] || 2;
  return (
    <article className="svo-approval">
      <div className="svo-approval-top">
        <div>
          <div className="svo-approval-ticket"><span className="no">#{ticketNumber}</span> · {ticketTitle}</div>
          <div className="svo-approval-meta">Requested {requestedAt}{agentName ? " by " + agentName : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <span className="svo-risk" title={r.label}>
            {[1, 2, 3].map((i) => <span key={i} className={i <= lvl ? "on t-" + r.tone : ""} />)}
          </span>
          <Badge tone={r.tone}>{r.label}</Badge>
          {blockedFor && <Badge tone="warn" icon={<Icon name="clock" size={11} />}>Blocked {blockedFor}</Badge>}
        </div>
      </div>

      <div className="svo-approval-tool">
        <div className="svo-approval-tool-name">Tool call: <b>{toolName}</b></div>
        <div className="svo-approval-tool-note">{impact || "This action is paused until a human approves or rejects it."}</div>
        <pre className="svo-code" style={{ marginTop: "var(--space-5)" }}>{toolInput}</pre>
        {diff && diff.length > 0 && (
          <pre className="svo-code svo-diff" style={{ marginTop: "var(--space-4)" }}>
            {diff.map((d, i) => <span key={i} className={d.op === "+" ? "add" : d.op === "-" ? "del" : ""}>{d.op} {d.text}{"\n"}</span>)}
          </pre>
        )}
      </div>

      {canDecide && <Input placeholder="Why are you approving or rejecting this action?" />}

      <div className="svo-approval-actions">
        <Button variant="primary" size="sm" onClick={onApprove} disabled={!canDecide} iconStart={<Icon name="check" size={14} />}>Approve</Button>
        <Button variant="danger" size="sm" onClick={onReject} disabled={!canDecide} iconStart={<Icon name="x" size={14} />}>Reject</Button>
        {!canDecide && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>HIGH-risk approvals require an admin.</span>}
      </div>
    </article>
  );
}
