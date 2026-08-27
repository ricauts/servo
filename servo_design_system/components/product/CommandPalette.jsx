import React from "react";
import { Icon } from "../core/Icon.jsx";

export function CommandPalette({ query = "", onQueryChange, groups = [], activeIndex = 0, onSelect }) {
  let i = -1;
  return (
    <div className="svo-cmdk">
      <div className="svo-cmdk-input">
        <Icon name="search" size={16} color="var(--text-faint)" />
        <input value={query} placeholder="Search tickets or jump to a page…" onChange={onQueryChange ? (e) => onQueryChange(e.target.value) : undefined} />
        <span className="svo-kbd">Esc</span>
      </div>
      {groups.map((g) => (
        <div className="svo-cmdk-group" key={g.label}>
          <div className="svo-cmdk-grouplabel">{g.label}</div>
          {g.items.map((it) => {
            i += 1;
            const idx = i;
            return (
              <div key={it.label} className={["svo-cmdk-item", idx === activeIndex ? "is-active" : ""].filter(Boolean).join(" ")} onClick={() => onSelect && onSelect(it)}>
                <Icon name={it.icon || "corner-down-right"} size={15} color="var(--text-faint)" />
                {it.number != null && <span className="no">#{it.number}</span>}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
