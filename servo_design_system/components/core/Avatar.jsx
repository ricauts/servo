import React from "react";

const PALETTE = ["#4E66E4", "#62BFD1", "#66C79A", "#E0B84E", "#F0894F", "#8C7BE8"];

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function Avatar({ name = "", color, size = 24, isAi = false }) {
  const bg = color || PALETTE[(name.charCodeAt(0) || 0) % PALETTE.length];
  return (
    <span
      className={["svo-avatar", isAi ? "is-ai" : ""].filter(Boolean).join(" ")}
      title={name}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)), background: isAi ? undefined : bg }}
    >
      {isAi ? "AI" : initials(name)}
    </span>
  );
}
