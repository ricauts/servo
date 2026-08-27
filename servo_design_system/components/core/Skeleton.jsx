import React from "react";

export function Skeleton({ width = "100%", height = 12, radius = "var(--radius-2)" }) {
  return <span className="svo-skel" style={{ display: "block", width, height, borderRadius: radius }} />;
}
