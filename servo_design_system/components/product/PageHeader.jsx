import React from "react";

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="svo-pagehead">
      <div>
        {eyebrow && <div className="svo-pagehead-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="svo-pagehead-sub">{subtitle}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: "var(--space-4)" }}>{actions}</div>}
    </header>
  );
}
