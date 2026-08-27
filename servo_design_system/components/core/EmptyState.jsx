import React from "react";
import { Icon } from "./Icon.jsx";

export function EmptyState({ icon = "inbox", title, children, action }) {
  return (
    <div className="svo-empty">
      <Icon name={icon} size={20} />
      {title && <div className="svo-empty-title">{title}</div>}
      {children && <div className="svo-empty-body">{children}</div>}
      {action}
    </div>
  );
}
