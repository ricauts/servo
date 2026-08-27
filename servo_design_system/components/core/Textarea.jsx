import React from "react";

export function Textarea({ invalid = false, className = "", rows = 4, ...rest }) {
  return <textarea rows={rows} className={["svo-textarea", invalid ? "is-invalid" : "", className].filter(Boolean).join(" ")} {...rest} />;
}
