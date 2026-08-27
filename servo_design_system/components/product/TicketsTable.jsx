import React from "react";
import { Badge } from "../core/Badge.jsx";
import { Avatar } from "../core/Avatar.jsx";
import { SlaBadge } from "./SlaBadge.jsx";

const STATUS = { OPEN: ["serious", "Open"], TRIAGED: ["brand", "Triaged"], IN_PROGRESS: ["info", "In progress"], WAITING_APPROVAL: ["warn", "Waiting approval"], RESOLVED: ["good", "Resolved"], CLOSED: ["neutral", "Closed"] };
const PRIORITY = { LOW: ["neutral", "Low"], MEDIUM: ["brand", "Medium"], HIGH: ["serious", "High"], URGENT: ["critical", "Urgent"] };

export function TicketsTable({ rows = [], onRowClick }) {
  return (
    <table className="svo-table">
      <thead>
        <tr>
          <th style={{ width: 72 }}>#</th>
          <th style={{ minWidth: 240 }}>Title</th>
          <th style={{ width: 150 }}>Status</th>
          <th style={{ width: 104 }}>Priority</th>
          <th style={{ width: 140 }}>SLA</th>
          <th style={{ width: 140 }}>Category</th>
          <th style={{ width: 170 }}>Assignee</th>
          <th style={{ width: 100, textAlign: "right" }}>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const st = STATUS[t.status] || ["neutral", t.status];
          const pr = PRIORITY[t.priority] || ["neutral", t.priority];
          return (
            <tr key={t.number} onClick={onRowClick ? () => onRowClick(t) : undefined} style={{ cursor: onRowClick ? "pointer" : undefined }}>
              <td className="num">#{t.number}</td>
              <td style={{ maxWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: "var(--weight-medium)", color: "var(--text-strong)" }}>{t.title}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t.requester}</div>
              </td>
              <td><Badge tone={st[0]}>{st[1]}</Badge></td>
              <td><Badge tone={pr[0]}>{pr[1]}</Badge></td>
              <td><SlaBadge state={t.slaState} label={t.slaLabel} /></td>
              <td style={{ color: "var(--text-muted)" }}>{t.category}</td>
              <td>
                {t.assignee ? (
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                    <Avatar name={t.assignee} size={20} isAi={t.assigneeIsAi} />
                    <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.assignee}</span>
                  </span>
                ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
              </td>
              <td style={{ textAlign: "right", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)" }}>{t.updated}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
