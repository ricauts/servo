import React from "react";

export function Tabs({ tabs = [], value, onChange }) {
  const active = value ?? (tabs[0] && (tabs[0].value ?? tabs[0]));
  return (
    <div className="svo-tabs" role="tablist">
      {tabs.map((t) => {
        const v = t.value ?? t;
        const label = t.label ?? t;
        return (
          <button key={v} role="tab" type="button" aria-selected={v === active} className="svo-tab" onClick={() => onChange && onChange(v)}>
            {label}
            {t.count != null && <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", color: "var(--text-faint)" }}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
