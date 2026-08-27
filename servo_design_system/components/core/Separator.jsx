import React from "react";

export function Separator({ vertical = false, style }) {
  return <hr className={["svo-sep", vertical ? "is-vertical" : ""].filter(Boolean).join(" ")} style={style} />;
}
