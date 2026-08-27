import React from "react";

export function Badge({ tone = "neutral", quiet = false, solid = false, square = false, icon, children, className = "" }) {
  const cls = ["svo-badge", "t-" + tone, quiet ? "is-quiet" : "", solid ? "is-solid" : "", square ? "is-square" : "", className].filter(Boolean).join(" ");
  return <span className={cls}>{icon}{children}</span>;
}
