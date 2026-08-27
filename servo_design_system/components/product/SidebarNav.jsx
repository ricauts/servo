import React from "react";
import { Icon } from "../core/Icon.jsx";

export function SidebarNav({ items = [], active, onNavigate }) {
  return (
    <nav className="svo-nav">
      {items.map((it) => (
        <button
          key={it.href ?? it.label}
          type="button"
          className={["svo-navitem", (active === (it.href ?? it.label)) ? "is-active" : ""].filter(Boolean).join(" ")}
          aria-current={active === (it.href ?? it.label) ? "page" : undefined}
          onClick={() => onNavigate && onNavigate(it.href ?? it.label)}
        >
          <Icon name={it.icon} size={16} />
          <span>{it.label}</span>
          {it.count ? <span className={["svo-navitem-count", it.attention ? "is-attention" : ""].filter(Boolean).join(" ")}>{it.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}
