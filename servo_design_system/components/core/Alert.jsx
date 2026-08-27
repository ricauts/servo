import React from "react";
import { Icon } from "./Icon.jsx";

const GLYPH = { warn: "alert-triangle", critical: "octagon-alert", good: "check-circle-2", brand: "info" };

export function Alert({ tone = "brand", title, children }) {
  return (
    <div className={"svo-alert t-" + tone}>
      <Icon name={GLYPH[tone] || "info"} size={15} />
      <div>
        {title && <div className="svo-alert-title">{title}</div>}
        {children && <div className="svo-alert-body">{children}</div>}
      </div>
    </div>
  );
}
