import React from "react";

/** Static tooltip surface (positioning is the consumer's job). */
export function Tooltip({ children, kbd }) {
  return (
    <span className="svo-tip">
      {children}
      {kbd && <span className="svo-kbd">{kbd}</span>}
    </span>
  );
}
