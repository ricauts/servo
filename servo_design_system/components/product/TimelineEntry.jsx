import React from "react";
import { Avatar } from "../core/Avatar.jsx";
import { Badge } from "../core/Badge.jsx";

export function TimelineEntry({ author, isAi = false, badge, action = "commented", when, system = false, children, last = false }) {
  return (
    <div className={["svo-tl", system ? "is-system" : ""].filter(Boolean).join(" ")}>
      <div className="svo-tl-rail">
        <Avatar name={author} size={26} isAi={isAi} />
        {!last && <span className="svo-tl-line" />}
      </div>
      <div className="svo-tl-body">
        <div className="svo-tl-head">
          <span className="svo-tl-author">{author}</span>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          <span style={{ color: "var(--text-muted)" }}>{action}</span>
          <span className="svo-tl-time">{when}</span>
        </div>
        <div className="svo-tl-content">{children}</div>
      </div>
    </div>
  );
}
