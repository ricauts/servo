import React from "react";

export function Spinner({ size = 14 }) {
  return <span className="svo-spin" style={{ width: size, height: size }} aria-label="Loading" />;
}
