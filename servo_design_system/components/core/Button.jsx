import React from "react";

export function Button({ variant = "primary", size = "md", iconStart, iconEnd, icon, children, className = "", ...rest }) {
  const cls = ["svo-btn", "v-" + variant, "sz-" + size, icon ? "is-icon" : "", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {icon || iconStart}
      {children}
      {iconEnd}
    </button>
  );
}
