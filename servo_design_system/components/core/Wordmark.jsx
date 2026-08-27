import React from "react";

/**
 * The Servo wordmark: the name set in Chivo Black with the signal-green
 * period. There is no separate icon mark in the sources — never draw one.
 */
export function Wordmark({ size = 26, tagline, color = "var(--text-strong)" }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: "-0.04em", color }}>
        Servo<span style={{ color: "var(--brand)" }}>.</span>
      </span>
      {tagline && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-mono-xs)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-faint)" }}>
          {tagline}
        </span>
      )}
    </span>
  );
}
