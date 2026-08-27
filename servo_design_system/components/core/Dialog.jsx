import React from "react";
import { Button } from "./Button.jsx";
import { Icon } from "./Icon.jsx";

export function Dialog({ title, description, children, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, tone = "primary", inline = false }) {
  const panel = (
    <div className="svo-dialog">
      <header className="svo-dialog-head">
        <div>
          <div className="svo-card-title">{title}</div>
          {description && <div className="svo-card-desc">{description}</div>}
        </div>
        <Button variant="ghost" size="sm" icon onClick={onCancel} aria-label="Close"><Icon name="x" size={14} /></Button>
      </header>
      {children && <div className="svo-dialog-body">{children}</div>}
      <footer className="svo-dialog-foot">
        <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
      </footer>
    </div>
  );
  if (inline) return panel;
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "var(--space-8)" }}>
      <div className="svo-scrim" onClick={onCancel} />
      {panel}
    </div>
  );
}
