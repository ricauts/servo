import React from "react";

export function Table({ columns = [], rows = [], onRowClick }) {
  return (
    <table className="svo-table">
      <thead>
        <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align || "left" }}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={{ cursor: onRowClick ? "pointer" : undefined }}>
            {columns.map((c) => (
              <td key={c.key} style={{ textAlign: c.align || "left" }} className={c.mono ? "num" : undefined}>
                {c.render ? c.render(r) : r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
