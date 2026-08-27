import React from "react";

export function Card({ title, description, action, footer, padded = true, className = "", children, ...rest }) {
  return (
    <section className={["svo-card", className].filter(Boolean).join(" ")} {...rest}>
      {(title || action) && (
        <header className="svo-card-head">
          <div>
            {title && <div className="svo-card-title">{title}</div>}
            {description && <div className="svo-card-desc">{description}</div>}
          </div>
          {action}
        </header>
      )}
      {padded ? <div className="svo-card-body">{children}</div> : children}
      {footer && <footer className="svo-card-foot">{footer}</footer>}
    </section>
  );
}
