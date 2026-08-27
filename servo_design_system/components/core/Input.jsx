import React from "react";

export function Input({ mono = false, invalid = false, className = "", ...rest }) {
  return <input className={["svo-input", mono ? "is-mono" : "", invalid ? "is-invalid" : "", className].filter(Boolean).join(" ")} {...rest} />;
}
