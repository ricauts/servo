import React from "react";

export function Field({ label, hint, error, htmlFor, children }) {
  return (
    <div className="svo-field">
      {label && <label className="svo-field-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="svo-field-error">{error}</span> : hint ? <span className="svo-field-hint">{hint}</span> : null}
    </div>
  );
}
