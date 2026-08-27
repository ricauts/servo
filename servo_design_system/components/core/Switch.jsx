import React from "react";

export function Switch({ checked = false, onChange, disabled = false, label }) {
  const el = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="svo-switch"
      onClick={() => onChange && onChange(!checked)}
    >
      <span />
    </button>
  );
  if (!label) return el;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-5)" }}>
      {el}
      <span style={{ fontSize: "var(--text-ui)", color: "var(--text-body)" }}>{label}</span>
    </span>
  );
}
