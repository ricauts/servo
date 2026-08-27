import React from "react";
import { Icon } from "./Icon.jsx";

export function Select({ options = [], className = "", ...rest }) {
  return (
    <span className="svo-selectwrap">
      <select className={["svo-selectel", className].filter(Boolean).join(" ")} {...rest}>
        {options.map((o) => {
          const value = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? o : o.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}
