import React from "react";

/**
 * Lucide glyph. Servo uses Lucide everywhere (the app sets
 * iconLibrary: "lucide"); this wrapper renders one by name and lets the
 * Lucide UMD script swap in the real SVG.
 */
export function Icon({ name, size = 16, strokeWidth = 2, color = "currentColor", className = "", style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const draw = () => window.lucide && window.lucide.createIcons({ nameAttr: "data-lucide", root: ref.current });
    draw();
    const t = setTimeout(draw, 300);
    return () => clearTimeout(t);
  }, [name, size, strokeWidth]);
  return (
    <span ref={ref} className={className} style={{ display: "inline-flex", width: size, height: size, color, ...style }}>
      <i data-lucide={name} style={{ width: size, height: size }} data-stroke={strokeWidth}></i>
    </span>
  );
}
