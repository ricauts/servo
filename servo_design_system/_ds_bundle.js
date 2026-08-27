/* @ds-bundle: {"format":4,"namespace":"ServoDesignSystem_824c45","components":[{"name":"Alert","sourcePath":"components/core/Alert.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Dialog","sourcePath":"components/core/Dialog.jsx"},{"name":"EmptyState","sourcePath":"components/core/EmptyState.jsx"},{"name":"Field","sourcePath":"components/core/Field.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Separator","sourcePath":"components/core/Separator.jsx"},{"name":"Skeleton","sourcePath":"components/core/Skeleton.jsx"},{"name":"Spinner","sourcePath":"components/core/Spinner.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Table","sourcePath":"components/core/Table.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"Textarea","sourcePath":"components/core/Textarea.jsx"},{"name":"Tooltip","sourcePath":"components/core/Tooltip.jsx"},{"name":"Wordmark","sourcePath":"components/core/Wordmark.jsx"},{"name":"ApprovalCard","sourcePath":"components/product/ApprovalCard.jsx"},{"name":"CommandPalette","sourcePath":"components/product/CommandPalette.jsx"},{"name":"PageHeader","sourcePath":"components/product/PageHeader.jsx"},{"name":"ReplyDraftCard","sourcePath":"components/product/ReplyDraftCard.jsx"},{"name":"RunSummary","sourcePath":"components/product/RunSummary.jsx"},{"name":"RunStep","sourcePath":"components/product/RunSummary.jsx"},{"name":"SidebarNav","sourcePath":"components/product/SidebarNav.jsx"},{"name":"SlaBadge","sourcePath":"components/product/SlaBadge.jsx"},{"name":"StatTile","sourcePath":"components/product/StatTile.jsx"},{"name":"TicketsTable","sourcePath":"components/product/TicketsTable.jsx"},{"name":"TimelineEntry","sourcePath":"components/product/TimelineEntry.jsx"}],"sourceHashes":{"components/core/Alert.jsx":"c21207976c38","components/core/Avatar.jsx":"0fc686c18e38","components/core/Badge.jsx":"19b6d6064502","components/core/Button.jsx":"62c002a16cae","components/core/Card.jsx":"68604aa3a2d4","components/core/Dialog.jsx":"476585a52349","components/core/EmptyState.jsx":"4698ac056657","components/core/Field.jsx":"420980d93d2c","components/core/Icon.jsx":"1e590b7a571e","components/core/Input.jsx":"6c14b6e5d167","components/core/Select.jsx":"cf9d8a1b3536","components/core/Separator.jsx":"32293eac8422","components/core/Skeleton.jsx":"81445eb6adea","components/core/Spinner.jsx":"72ee0e910b71","components/core/Switch.jsx":"4f4d09618421","components/core/Table.jsx":"57648fd98710","components/core/Tabs.jsx":"70b6d6efdc3f","components/core/Textarea.jsx":"1511d7badef4","components/core/Tooltip.jsx":"6bc0a67f0f98","components/core/Wordmark.jsx":"29dd30a7efe6","components/product/ApprovalCard.jsx":"20f513a32461","components/product/CommandPalette.jsx":"1cd0d3492b05","components/product/PageHeader.jsx":"cd3f24cd9030","components/product/ReplyDraftCard.jsx":"6146919bb1ba","components/product/RunSummary.jsx":"84c15829351b","components/product/SidebarNav.jsx":"7cd58ed35423","components/product/SlaBadge.jsx":"6badf9dd46ea","components/product/StatTile.jsx":"e714b252646c","components/product/TicketsTable.jsx":"0d6cff5c9bed","components/product/TimelineEntry.jsx":"cacc1c9515e6","ui_kits/desk/AppShell.jsx":"415cec39492a","ui_kits/desk/Charts.jsx":"62096fdf5916","ui_kits/desk/Screens.jsx":"31e65c36b73d","ui_kits/desk/data.js":"2cb278fa7508","ui_kits/site/Landing.jsx":"9b78fb97d971","ui_kits/site/doc-page.js":"371bab66f42d","ui_kits/site/image-slot.js":"fff26d081c8d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ServoDesignSystem_824c45 = window.ServoDesignSystem_824c45 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
const PALETTE = ["#4E66E4", "#62BFD1", "#66C79A", "#E0B84E", "#F0894F", "#8C7BE8"];
function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function Avatar({
  name = "",
  color,
  size = 24,
  isAi = false
}) {
  const bg = color || PALETTE[(name.charCodeAt(0) || 0) % PALETTE.length];
  return /*#__PURE__*/React.createElement("span", {
    className: ["svo-avatar", isAi ? "is-ai" : ""].filter(Boolean).join(" "),
    title: name,
    style: {
      width: size,
      height: size,
      fontSize: Math.max(9, Math.round(size * 0.38)),
      background: isAi ? undefined : bg
    }
  }, isAi ? "AI" : initials(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function Badge({
  tone = "neutral",
  quiet = false,
  solid = false,
  square = false,
  icon,
  children,
  className = ""
}) {
  const cls = ["svo-badge", "t-" + tone, quiet ? "is-quiet" : "", solid ? "is-solid" : "", square ? "is-square" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", {
    className: cls
  }, icon, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  variant = "primary",
  size = "md",
  iconStart,
  iconEnd,
  icon,
  children,
  className = "",
  ...rest
}) {
  const cls = ["svo-btn", "v-" + variant, "sz-" + size, icon ? "is-icon" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls
  }, rest), icon || iconStart, children, iconEnd);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  title,
  description,
  action,
  footer,
  padded = true,
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    className: ["svo-card", className].filter(Boolean).join(" ")
  }, rest), (title || action) && /*#__PURE__*/React.createElement("header", {
    className: "svo-card-head"
  }, /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("div", {
    className: "svo-card-title"
  }, title), description && /*#__PURE__*/React.createElement("div", {
    className: "svo-card-desc"
  }, description)), action), padded ? /*#__PURE__*/React.createElement("div", {
    className: "svo-card-body"
  }, children) : children, footer && /*#__PURE__*/React.createElement("footer", {
    className: "svo-card-foot"
  }, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Field.jsx
try { (() => {
function Field({
  label,
  hint,
  error,
  htmlFor,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "svo-field-label",
    htmlFor: htmlFor
  }, label), children, error ? /*#__PURE__*/React.createElement("span", {
    className: "svo-field-error"
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    className: "svo-field-hint"
  }, hint) : null);
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Field.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
/**
 * Lucide glyph. Servo uses Lucide everywhere (the app sets
 * iconLibrary: "lucide"); this wrapper renders one by name and lets the
 * Lucide UMD script swap in the real SVG.
 */
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  color = "currentColor",
  className = "",
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const draw = () => window.lucide && window.lucide.createIcons({
      nameAttr: "data-lucide",
      root: ref.current
    });
    draw();
    const t = setTimeout(draw, 300);
    return () => clearTimeout(t);
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    className: className,
    style: {
      display: "inline-flex",
      width: size,
      height: size,
      color,
      ...style
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    style: {
      width: size,
      height: size
    },
    "data-stroke": strokeWidth
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Alert.jsx
try { (() => {
const GLYPH = {
  warn: "alert-triangle",
  critical: "octagon-alert",
  good: "check-circle-2",
  brand: "info"
};
function Alert({
  tone = "brand",
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-alert t-" + tone
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: GLYPH[tone] || "info",
    size: 15
  }), /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("div", {
    className: "svo-alert-title"
  }, title), children && /*#__PURE__*/React.createElement("div", {
    className: "svo-alert-body"
  }, children)));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Alert.jsx", error: String((e && e.message) || e) }); }

// components/core/Dialog.jsx
try { (() => {
function Dialog({
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  tone = "primary",
  inline = false
}) {
  const panel = /*#__PURE__*/React.createElement("div", {
    className: "svo-dialog"
  }, /*#__PURE__*/React.createElement("header", {
    className: "svo-dialog-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "svo-card-title"
  }, title), description && /*#__PURE__*/React.createElement("div", {
    className: "svo-card-desc"
  }, description)), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    icon: true,
    onClick: onCancel,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  }))), children && /*#__PURE__*/React.createElement("div", {
    className: "svo-dialog-body"
  }, children), /*#__PURE__*/React.createElement("footer", {
    className: "svo-dialog-foot"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    onClick: onCancel
  }, cancelLabel), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: tone === "danger" ? "danger" : "primary",
    size: "sm",
    onClick: onConfirm
  }, confirmLabel)));
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "grid",
      placeItems: "center",
      padding: "var(--space-8)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-scrim",
    onClick: onCancel
  }), panel);
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/core/EmptyState.jsx
try { (() => {
function EmptyState({
  icon = "inbox",
  title,
  children,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-empty"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  }), title && /*#__PURE__*/React.createElement("div", {
    className: "svo-empty-title"
  }, title), children && /*#__PURE__*/React.createElement("div", {
    className: "svo-empty-body"
  }, children), action);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  mono = false,
  invalid = false,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    className: ["svo-input", mono ? "is-mono" : "", invalid ? "is-invalid" : "", className].filter(Boolean).join(" ")
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  options = [],
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "svo-selectwrap"
  }, /*#__PURE__*/React.createElement("select", _extends({
    className: ["svo-selectel", className].filter(Boolean).join(" ")
  }, rest), options.map(o => {
    const value = typeof o === "string" ? o : o.value;
    const label = typeof o === "string" ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: value,
      value: value
    }, label);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Separator.jsx
try { (() => {
function Separator({
  vertical = false,
  style
}) {
  return /*#__PURE__*/React.createElement("hr", {
    className: ["svo-sep", vertical ? "is-vertical" : ""].filter(Boolean).join(" "),
    style: style
  });
}
Object.assign(__ds_scope, { Separator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Separator.jsx", error: String((e && e.message) || e) }); }

// components/core/Skeleton.jsx
try { (() => {
function Skeleton({
  width = "100%",
  height = 12,
  radius = "var(--radius-2)"
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "svo-skel",
    style: {
      display: "block",
      width,
      height,
      borderRadius: radius
    }
  });
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/core/Spinner.jsx
try { (() => {
function Spinner({
  size = 14
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "svo-spin",
    style: {
      width: size,
      height: size
    },
    "aria-label": "Loading"
  });
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function Switch({
  checked = false,
  onChange,
  disabled = false,
  label
}) {
  const el = /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    className: "svo-switch",
    onClick: () => onChange && onChange(!checked)
  }, /*#__PURE__*/React.createElement("span", null));
  if (!label) return el;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-5)"
    }
  }, el, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-ui)",
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Table.jsx
try { (() => {
function Table({
  columns = [],
  rows = [],
  onRowClick
}) {
  return /*#__PURE__*/React.createElement("table", {
    className: "svo-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      width: c.width,
      textAlign: c.align || "left"
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: r.id ?? i,
    onClick: onRowClick ? () => onRowClick(r) : undefined,
    style: {
      cursor: onRowClick ? "pointer" : undefined
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      textAlign: c.align || "left"
    },
    className: c.mono ? "num" : undefined
  }, c.render ? c.render(r) : r[c.key]))))));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Table.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  value,
  onChange
}) {
  const active = value ?? (tabs[0] && (tabs[0].value ?? tabs[0]));
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-tabs",
    role: "tablist"
  }, tabs.map(t => {
    const v = t.value ?? t;
    const label = t.label ?? t;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      role: "tab",
      type: "button",
      "aria-selected": v === active,
      className: "svo-tab",
      onClick: () => onChange && onChange(v)
    }, label, t.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 6,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-mono-xs)",
        color: "var(--text-faint)"
      }
    }, t.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/core/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Textarea({
  invalid = false,
  className = "",
  rows = 4,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    className: ["svo-textarea", invalid ? "is-invalid" : "", className].filter(Boolean).join(" ")
  }, rest));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/core/Tooltip.jsx
try { (() => {
/** Static tooltip surface (positioning is the consumer's job). */
function Tooltip({
  children,
  kbd
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "svo-tip"
  }, children, kbd && /*#__PURE__*/React.createElement("span", {
    className: "svo-kbd"
  }, kbd));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/core/Wordmark.jsx
try { (() => {
/**
 * The Servo wordmark: the name set in Chivo Black with the signal-green
 * period. There is no separate icon mark in the sources — never draw one.
 */
function Wordmark({
  size = 26,
  tagline,
  color = "var(--text-strong)"
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 900,
      fontSize: size,
      lineHeight: 1,
      letterSpacing: "-0.04em",
      color
    }
  }, "Servo", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--brand)"
    }
  }, ".")), tagline && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      letterSpacing: "var(--tracking-label)",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, tagline));
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/product/ApprovalCard.jsx
try { (() => {
const RISK = {
  LOW: {
    tone: "good",
    label: "Low risk"
  },
  MEDIUM: {
    tone: "warn",
    label: "Medium risk"
  },
  HIGH: {
    tone: "critical",
    label: "High risk"
  }
};
const LEVEL = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3
};
function ApprovalCard({
  ticketNumber,
  ticketTitle,
  toolName,
  toolInput,
  risk = "MEDIUM",
  requestedAt,
  agentName,
  blockedFor,
  impact,
  diff,
  canDecide = true,
  onApprove,
  onReject
}) {
  const r = RISK[risk] || RISK.MEDIUM;
  const lvl = LEVEL[risk] || 2;
  return /*#__PURE__*/React.createElement("article", {
    className: "svo-approval"
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-top"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-ticket"
  }, /*#__PURE__*/React.createElement("span", {
    className: "no"
  }, "#", ticketNumber), " \xB7 ", ticketTitle), /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-meta"
  }, "Requested ", requestedAt, agentName ? " by " + agentName : "")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "svo-risk",
    title: r.label
  }, [1, 2, 3].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: i <= lvl ? "on t-" + r.tone : ""
  }))), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: r.tone
  }, r.label), blockedFor && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "warn",
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "clock",
      size: 11
    })
  }, "Blocked ", blockedFor))), /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-tool"
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-tool-name"
  }, "Tool call: ", /*#__PURE__*/React.createElement("b", null, toolName)), /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-tool-note"
  }, impact || "This action is paused until a human approves or rejects it."), /*#__PURE__*/React.createElement("pre", {
    className: "svo-code",
    style: {
      marginTop: "var(--space-5)"
    }
  }, toolInput), diff && diff.length > 0 && /*#__PURE__*/React.createElement("pre", {
    className: "svo-code svo-diff",
    style: {
      marginTop: "var(--space-4)"
    }
  }, diff.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: d.op === "+" ? "add" : d.op === "-" ? "del" : ""
  }, d.op, " ", d.text, "\n")))), canDecide && /*#__PURE__*/React.createElement(__ds_scope.Input, {
    placeholder: "Why are you approving or rejecting this action?"
  }), /*#__PURE__*/React.createElement("div", {
    className: "svo-approval-actions"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "primary",
    size: "sm",
    onClick: onApprove,
    disabled: !canDecide,
    iconStart: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 14
    })
  }, "Approve"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "danger",
    size: "sm",
    onClick: onReject,
    disabled: !canDecide,
    iconStart: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "x",
      size: 14
    })
  }, "Reject"), !canDecide && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, "HIGH-risk approvals require an admin.")));
}
Object.assign(__ds_scope, { ApprovalCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/ApprovalCard.jsx", error: String((e && e.message) || e) }); }

// components/product/CommandPalette.jsx
try { (() => {
function CommandPalette({
  query = "",
  onQueryChange,
  groups = [],
  activeIndex = 0,
  onSelect
}) {
  let i = -1;
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-cmdk"
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-cmdk-input"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 16,
    color: "var(--text-faint)"
  }), /*#__PURE__*/React.createElement("input", {
    value: query,
    placeholder: "Search tickets or jump to a page\u2026",
    onChange: onQueryChange ? e => onQueryChange(e.target.value) : undefined
  }), /*#__PURE__*/React.createElement("span", {
    className: "svo-kbd"
  }, "Esc")), groups.map(g => /*#__PURE__*/React.createElement("div", {
    className: "svo-cmdk-group",
    key: g.label
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-cmdk-grouplabel"
  }, g.label), g.items.map(it => {
    i += 1;
    const idx = i;
    return /*#__PURE__*/React.createElement("div", {
      key: it.label,
      className: ["svo-cmdk-item", idx === activeIndex ? "is-active" : ""].filter(Boolean).join(" "),
      onClick: () => onSelect && onSelect(it)
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon || "corner-down-right",
      size: 15,
      color: "var(--text-faint)"
    }), it.number != null && /*#__PURE__*/React.createElement("span", {
      className: "no"
    }, "#", it.number), /*#__PURE__*/React.createElement("span", {
      style: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, it.label));
  }))));
}
Object.assign(__ds_scope, { CommandPalette });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/CommandPalette.jsx", error: String((e && e.message) || e) }); }

// components/product/PageHeader.jsx
try { (() => {
function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "svo-pagehead"
  }, /*#__PURE__*/React.createElement("div", null, eyebrow && /*#__PURE__*/React.createElement("div", {
    className: "svo-pagehead-eyebrow"
  }, eyebrow), /*#__PURE__*/React.createElement("h1", null, title), subtitle && /*#__PURE__*/React.createElement("div", {
    className: "svo-pagehead-sub"
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-4)"
    }
  }, actions));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/product/ReplyDraftCard.jsx
try { (() => {
function ReplyDraftCard({
  draftedBy,
  when,
  value,
  recipient,
  onChange,
  onApprove,
  onRegenerate,
  onDiscard
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "svo-draft"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "svo-draft-title"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "pencil-line",
    size: 15,
    color: "var(--brand)"
  }), "AI reply draft \u2014 review before sending"), /*#__PURE__*/React.createElement("div", {
    className: "svo-draft-by"
  }, "Drafted by ", draftedBy, " ", when)), /*#__PURE__*/React.createElement(__ds_scope.Textarea, {
    rows: 8,
    value: value,
    onChange: onChange ? e => onChange(e.target.value) : undefined
  }), /*#__PURE__*/React.createElement("div", {
    className: "svo-draft-note"
  }, "Approving posts this as a public comment and emails it to ", recipient, ". Their reply threads back onto this ticket."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "primary",
    size: "sm",
    onClick: onApprove,
    iconStart: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "mail",
      size: 14
    })
  }, "Approve & send"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "outline",
    size: "sm",
    onClick: onRegenerate,
    iconStart: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "refresh-cw",
      size: 14
    })
  }, "Regenerate"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    onClick: onDiscard
  }, "Discard")));
}
Object.assign(__ds_scope, { ReplyDraftCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/ReplyDraftCard.jsx", error: String((e && e.message) || e) }); }

// components/product/RunSummary.jsx
try { (() => {
const STATUS = {
  COMPLETED: {
    tone: "good",
    label: "completed"
  },
  RUNNING: {
    tone: "brand",
    label: "running"
  },
  WAITING_APPROVAL: {
    tone: "warn",
    label: "waiting for approval"
  },
  FAILED: {
    tone: "critical",
    label: "failed"
  }
};
function RunSummary({
  agentName,
  status = "COMPLETED",
  qaVerdict,
  qaNotes,
  took,
  when,
  stepCount = 0,
  summary,
  toolTrail = [],
  decisions = [],
  open,
  children
}) {
  const s = STATUS[status] || STATUS.COMPLETED;
  const isOpen = open ?? (status === "RUNNING" || status === "WAITING_APPROVAL");
  return /*#__PURE__*/React.createElement("details", {
    className: "svo-run",
    open: isOpen
  }, /*#__PURE__*/React.createElement("summary", null, /*#__PURE__*/React.createElement("div", {
    className: "svo-run-top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "svo-run-agent"
  }, agentName), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "brand",
    solid: true
  }, "AI"), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: s.tone
  }, s.label), qaVerdict && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: qaVerdict === "PASS" ? "good" : "critical"
  }, "QA ", qaVerdict), /*#__PURE__*/React.createElement("span", {
    className: "svo-run-time"
  }, took ? took + " · " : "", when), /*#__PURE__*/React.createElement("span", {
    className: "svo-run-steps"
  }, stepCount, " steps", /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 14,
    className: "svo-run-chev"
  }))), summary && /*#__PURE__*/React.createElement("div", {
    className: "svo-run-summary"
  }, summary), qaVerdict && qaNotes && /*#__PURE__*/React.createElement("div", {
    className: "svo-run-qa"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "clipboard-check",
    size: 14,
    color: "var(--info)"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      letterSpacing: "var(--tracking-label)",
      textTransform: "uppercase",
      color: "var(--info)"
    }
  }, "QA review"), " ", qaNotes)), (toolTrail.length > 0 || decisions.length > 0) && /*#__PURE__*/React.createElement("div", {
    className: "svo-run-trail"
  }, toolTrail.join("  ·  "), decisions.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i
  }, "  ·  ", /*#__PURE__*/React.createElement("span", {
    className: d.approved ? "ok" : "no"
  }, d.approved ? "approved" : "rejected", d.by ? " by " + d.by : ""))))), children && /*#__PURE__*/React.createElement("div", {
    className: "svo-run-body"
  }, children));
}
function RunStep({
  kind = "text",
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "svo-step"
  }, /*#__PURE__*/React.createElement("span", {
    className: "svo-step-kind"
  }, kind), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1,
      color: "var(--text-muted)",
      lineHeight: "var(--leading-relaxed)"
    }
  }, children));
}
Object.assign(__ds_scope, { RunSummary, RunStep });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/RunSummary.jsx", error: String((e && e.message) || e) }); }

// components/product/SidebarNav.jsx
try { (() => {
function SidebarNav({
  items = [],
  active,
  onNavigate
}) {
  return /*#__PURE__*/React.createElement("nav", {
    className: "svo-nav"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.href ?? it.label,
    type: "button",
    className: ["svo-navitem", active === (it.href ?? it.label) ? "is-active" : ""].filter(Boolean).join(" "),
    "aria-current": active === (it.href ?? it.label) ? "page" : undefined,
    onClick: () => onNavigate && onNavigate(it.href ?? it.label)
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 16
  }), /*#__PURE__*/React.createElement("span", null, it.label), it.count ? /*#__PURE__*/React.createElement("span", {
    className: ["svo-navitem-count", it.attention ? "is-attention" : ""].filter(Boolean).join(" ")
  }, it.count) : null)));
}
Object.assign(__ds_scope, { SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/SidebarNav.jsx", error: String((e && e.message) || e) }); }

// components/product/SlaBadge.jsx
try { (() => {
const TONE = {
  met: "good",
  ok: "neutral",
  at_risk: "warn",
  breached: "critical"
};
function SlaBadge({
  state = "ok",
  label,
  kind
}) {
  if (state === "none") return /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-faint)"
    }
  }, "\u2014");
  return /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: TONE[state] || "neutral"
  }, "SLA ", label, kind ? " · " + kind : "");
}
Object.assign(__ds_scope, { SlaBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/SlaBadge.jsx", error: String((e && e.message) || e) }); }

// components/product/StatTile.jsx
try { (() => {
function StatTile({
  label,
  value,
  unit,
  highlight
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: ["svo-stat", highlight ? "h-" + highlight : ""].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-stat-label"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "svo-stat-value"
  }, value, unit && /*#__PURE__*/React.createElement("span", {
    className: "svo-stat-unit"
  }, unit)));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/product/TicketsTable.jsx
try { (() => {
const STATUS = {
  OPEN: ["serious", "Open"],
  TRIAGED: ["brand", "Triaged"],
  IN_PROGRESS: ["info", "In progress"],
  WAITING_APPROVAL: ["warn", "Waiting approval"],
  RESOLVED: ["good", "Resolved"],
  CLOSED: ["neutral", "Closed"]
};
const PRIORITY = {
  LOW: ["neutral", "Low"],
  MEDIUM: ["brand", "Medium"],
  HIGH: ["serious", "High"],
  URGENT: ["critical", "Urgent"]
};
function TicketsTable({
  rows = [],
  onRowClick
}) {
  return /*#__PURE__*/React.createElement("table", {
    className: "svo-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: 72
    }
  }, "#"), /*#__PURE__*/React.createElement("th", {
    style: {
      minWidth: 240
    }
  }, "Title"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 150
    }
  }, "Status"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 104
    }
  }, "Priority"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 140
    }
  }, "SLA"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 140
    }
  }, "Category"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 170
    }
  }, "Assignee"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: 100,
      textAlign: "right"
    }
  }, "Updated"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(t => {
    const st = STATUS[t.status] || ["neutral", t.status];
    const pr = PRIORITY[t.priority] || ["neutral", t.priority];
    return /*#__PURE__*/React.createElement("tr", {
      key: t.number,
      onClick: onRowClick ? () => onRowClick(t) : undefined,
      style: {
        cursor: onRowClick ? "pointer" : undefined
      }
    }, /*#__PURE__*/React.createElement("td", {
      className: "num"
    }, "#", t.number), /*#__PURE__*/React.createElement("td", {
      style: {
        maxWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-strong)"
      }
    }, t.title), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: "var(--text-sm)",
        color: "var(--text-muted)"
      }
    }, t.requester)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: st[0]
    }, st[1])), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: pr[0]
    }, pr[1])), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(__ds_scope.SlaBadge, {
      state: t.slaState,
      label: t.slaLabel
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        color: "var(--text-muted)"
      }
    }, t.category), /*#__PURE__*/React.createElement("td", null, t.assignee ? /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)"
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
      name: t.assignee,
      size: 20,
      isAi: t.assigneeIsAi
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-muted)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, t.assignee)) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-faint)"
      }
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      style: {
        textAlign: "right",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-mono-xs)"
      }
    }, t.updated));
  })));
}
Object.assign(__ds_scope, { TicketsTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/TicketsTable.jsx", error: String((e && e.message) || e) }); }

// components/product/TimelineEntry.jsx
try { (() => {
function TimelineEntry({
  author,
  isAi = false,
  badge,
  action = "commented",
  when,
  system = false,
  children,
  last = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: ["svo-tl", system ? "is-system" : ""].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-tl-rail"
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: author,
    size: 26,
    isAi: isAi
  }), !last && /*#__PURE__*/React.createElement("span", {
    className: "svo-tl-line"
  })), /*#__PURE__*/React.createElement("div", {
    className: "svo-tl-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-tl-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "svo-tl-author"
  }, author), badge && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: badge.tone
  }, badge.label), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)"
    }
  }, action), /*#__PURE__*/React.createElement("span", {
    className: "svo-tl-time"
  }, when)), /*#__PURE__*/React.createElement("div", {
    className: "svo-tl-content"
  }, children)));
}
Object.assign(__ds_scope, { TimelineEntry });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/product/TimelineEntry.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desk/AppShell.jsx
try { (() => {
const {
  SidebarNav,
  Wordmark,
  Icon,
  Avatar,
  Button,
  CommandPalette
} = window.ServoDesignSystem_824c45;
function AppShell({
  route,
  onRoute,
  children
}) {
  const [cmdk, setCmdk] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    document.body.classList.toggle("servo-light", !dark);
  }, [dark]);
  React.useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdk(v => !v);
      }
      if (e.key === "Escape") setCmdk(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      minHeight: "100vh",
      background: "var(--bg)"
    }
  }, /*#__PURE__*/React.createElement("aside", {
    className: "svo-sidepanel",
    style: {
      width: "var(--sidebar-w)",
      flex: "none",
      display: "flex",
      flexDirection: "column",
      borderRight: "1px solid var(--line)",
      position: "sticky",
      top: 0,
      height: "100vh"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      padding: "20px 20px 22px"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 26,
    tagline: "open-source ticketing",
    color: "var(--text-strong)"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: true,
    title: dark ? "Light mode" : "Dark mode",
    "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    onClick: () => setDark(v => !v)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: dark ? "sun" : "moon",
    size: 14
  }))), /*#__PURE__*/React.createElement(SidebarNav, {
    items: window.DESK.nav,
    active: route,
    onNavigate: onRoute
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      borderTop: "1px solid var(--line)",
      padding: 12,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setCmdk(true),
    className: "svo-navitem",
    style: {
      justifyContent: "flex-start"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 15
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-sm)",
      whiteSpace: "nowrap"
    }
  }, "Search & jump"), /*#__PURE__*/React.createElement("span", {
    className: "svo-kbd",
    style: {
      marginLeft: "auto",
      whiteSpace: "nowrap"
    }
  }, "Ctrl K")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "2px 8px"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: window.DESK.user.name,
    size: 28
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-ui)",
      fontWeight: 500,
      color: "var(--text-strong)"
    }
  }, window.DESK.user.name), /*#__PURE__*/React.createElement("span", {
    className: "lbl",
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: ".14em",
      color: "var(--text-faint)"
    }
  }, window.DESK.user.role)), /*#__PURE__*/React.createElement(Icon, {
    name: "log-out",
    size: 15,
    color: "var(--text-faint)"
  })))), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, children), cmdk && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      display: "grid",
      placeItems: "start center",
      paddingTop: "12vh",
      zIndex: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-scrim",
    style: {
      position: "fixed"
    },
    onClick: () => setCmdk(false)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: "min(560px,90vw)"
    }
  }, /*#__PURE__*/React.createElement(CommandPalette, {
    query: "",
    activeIndex: 0,
    onSelect: it => {
      setCmdk(false);
      if (it.route) onRoute(it.route);
    },
    groups: [{
      label: "Tickets",
      items: window.DESK.tickets.slice(0, 3).map(t => ({
        number: t.number,
        label: t.title,
        route: "ticket"
      }))
    }, {
      label: "Jump to",
      items: [{
        label: "Approvals",
        icon: "shield-check",
        route: "approvals"
      }, {
        label: "Agents",
        icon: "bot",
        route: "agents"
      }, {
        label: "Dashboard",
        icon: "layout-dashboard",
        route: "dashboard"
      }]
    }]
  }))));
}
Object.assign(window, {
  AppShell
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desk/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desk/Charts.jsx
try { (() => {
// Small hand-rolled SVG charts: the app uses Recharts, these are cosmetic
// stand-ins that read the same --chart-* tokens and keep the fixed series order.
function AreaFlow({
  data,
  height = 210
}) {
  const w = 640,
    pad = 24;
  const max = Math.max(...data.flat(), 4);
  const x = i => pad + i * (w - pad * 2) / (data.length - 1);
  const y = v => height - 28 - v / max * (height - 56);
  const path = idx => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[idx]).toFixed(1)}`).join(" ");
  const area = idx => `${path(idx)} L${x(data.length - 1)},${height - 28} L${pad},${height - 28} Z`;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${height}`,
    width: "100%",
    height: height,
    role: "img",
    "aria-label": "Ticket flow, last 30 days"
  }, [0, 0.5, 1].map(t => /*#__PURE__*/React.createElement("line", {
    key: t,
    x1: pad,
    x2: w - pad,
    y1: y(max * t),
    y2: y(max * t),
    stroke: "var(--chart-grid)"
  })), /*#__PURE__*/React.createElement("path", {
    d: area(0),
    fill: "var(--chart-2)",
    opacity: ".13"
  }), /*#__PURE__*/React.createElement("path", {
    d: area(1),
    fill: "var(--chart-1)",
    opacity: ".13"
  }), /*#__PURE__*/React.createElement("path", {
    d: path(0),
    fill: "none",
    stroke: "var(--chart-2)",
    strokeWidth: "1.75"
  }), /*#__PURE__*/React.createElement("path", {
    d: path(1),
    fill: "none",
    stroke: "var(--chart-1)",
    strokeWidth: "1.75"
  }), ["Jul 13", "Jul 21", "Jul 29", "Aug 6"].map((l, i) => /*#__PURE__*/React.createElement("text", {
    key: l,
    x: pad + i * ((w - pad * 2) / 3.2),
    y: height - 8,
    fill: "var(--chart-axis)",
    fontFamily: "var(--font-mono)",
    fontSize: "10"
  }, l)));
}
function BarList({
  rows,
  color = "var(--chart-1)"
}) {
  const max = Math.max(...rows.map(r => r.n), 1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.label,
    style: {
      display: "grid",
      gridTemplateColumns: "116px 1fr 24px",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)",
      textAlign: "right"
    }
  }, r.label), /*#__PURE__*/React.createElement("span", {
    style: {
      height: 12,
      borderRadius: 2,
      background: color,
      width: `${r.n / max * 100}%`,
      minWidth: 8
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      color: "var(--text-muted)"
    }
  }, r.n))));
}
function Donut({
  ai,
  human,
  size = 168
}) {
  const total = ai + human,
    r = size / 2 - 14,
    c = 2 * Math.PI * r;
  const aiLen = ai / total * c;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`
  }, /*#__PURE__*/React.createElement("g", {
    transform: `rotate(-90 ${size / 2} ${size / 2})`
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--chart-2)",
    strokeWidth: "18"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--chart-1)",
    strokeWidth: "18",
    strokeDasharray: `${aiLen} ${c - aiLen}`
  })), /*#__PURE__*/React.createElement("text", {
    x: "50%",
    y: "48%",
    textAnchor: "middle",
    fill: "var(--text-strong)",
    fontSize: "26",
    fontWeight: "600",
    fontFamily: "var(--font-core)"
  }, total), /*#__PURE__*/React.createElement("text", {
    x: "50%",
    y: "62%",
    textAnchor: "middle",
    fill: "var(--text-muted)",
    fontSize: "11",
    fontFamily: "var(--font-mono)"
  }, "resolved")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 2,
      background: "var(--chart-1)"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--text-strong)"
    }
  }, ai), " AI agents"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 2,
      background: "var(--chart-2)"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--text-strong)"
    }
  }, human), " Humans")));
}
Object.assign(window, {
  AreaFlow,
  BarList,
  Donut
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desk/Charts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desk/Screens.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  PageHeader,
  StatTile,
  Card,
  TicketsTable,
  ApprovalCard,
  ReplyDraftCard,
  RunSummary,
  RunStep,
  TimelineEntry,
  Badge,
  Button,
  Icon,
  Select,
  Field,
  Switch,
  Tabs,
  EmptyState,
  Avatar,
  Table,
  Separator,
  Input
} = window.ServoDesignSystem_824c45;
const D = window.DESK;
const PAD = {
  padding: "var(--page-pad)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-7)"
};
function DashboardScreen() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "Last 30 days",
    title: "Dashboard",
    subtitle: "Operational KPIs across tickets, agents and approvals."
  }), /*#__PURE__*/React.createElement("div", {
    style: PAD
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(7,1fr)",
      gap: 10
    }
  }, D.kpis.map(k => /*#__PURE__*/React.createElement(StatTile, _extends({
    key: k.label
  }, k)))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--line)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.6fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Ticket flow \u2014 last 30 days",
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        gap: 14,
        fontSize: "var(--text-sm)",
        color: "var(--text-muted)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 2,
        background: "var(--chart-2)"
      }
    }), "Created"), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 2,
        background: "var(--chart-1)"
      }
    }), "Resolved"))
  }, /*#__PURE__*/React.createElement(AreaFlow, {
    data: D.flow
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Open load by category"
  }, /*#__PURE__*/React.createElement(BarList, {
    rows: D.categories
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "By priority"
  }, /*#__PURE__*/React.createElement(BarList, {
    rows: D.priorities
  })), /*#__PURE__*/React.createElement(Card, {
    title: "AI vs human resolutions"
  }, /*#__PURE__*/React.createElement(Donut, {
    ai: D.split.ai,
    human: D.split.human
  })), /*#__PURE__*/React.createElement(Card, {
    title: "AI replies \u2014 30d",
    description: "How much typing the desk saved."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: "-.02em",
      color: "var(--text-brand)"
    }
  }, "67%"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, "accepted as-is")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, D.replies.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.label,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: "var(--text-ui)",
      color: "var(--text-muted)",
      borderTop: "1px solid var(--line)",
      paddingTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: r.tone
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, r.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--text-strong)"
    }
  }, r.n))))))));
}
function TicketsScreen({
  onOpen
}) {
  const [status, setStatus] = React.useState("All statuses");
  const rows = D.tickets.filter(t => status === "All statuses" || t.status === status.toUpperCase().replace(/ /g, "_"));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Tickets",
    subtitle: "Every request in the desk, human- and AI-assigned.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "md",
      iconStart: /*#__PURE__*/React.createElement(Icon, {
        name: "filter",
        size: 14
      })
    }, "Filters"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "md",
      iconStart: /*#__PURE__*/React.createElement(Icon, {
        name: "plus",
        size: 14
      })
    }, "New ticket"))
  }), /*#__PURE__*/React.createElement("div", {
    style: PAD
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 210
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search by number, title or text\u2026"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 170
    }
  }, /*#__PURE__*/React.createElement(Select, {
    value: status,
    onChange: e => setStatus(e.target.value),
    options: ["All statuses", "Open", "Triaged", "In progress", "Waiting approval", "Resolved", "Closed"]
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 150
    }
  }, /*#__PURE__*/React.createElement(Select, {
    options: ["All priorities", "Urgent", "High", "Medium", "Low"]
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, rows.length, " of ", D.tickets.length, " shown")), /*#__PURE__*/React.createElement(Card, {
    padded: false,
    style: {
      overflow: "hidden"
    }
  }, rows.length ? /*#__PURE__*/React.createElement(TicketsTable, {
    rows: rows,
    onRowClick: t => onOpen(t)
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "inbox",
    title: "No tickets match"
  }, "Clear a filter to see the rest of the queue.")))));
}
function TicketDetailScreen({
  ticket,
  onBack
}) {
  const t = ticket || D.tickets[0];
  const [draft, setDraft] = React.useState("Hi Dana,\n\nThanks for flagging the contrast issue with the \"Star on GitHub\" button — the label was rendering grey instead of the intended dark ink, which is why it was so hard to read. The fix is committed on a branch and a screenshot of the result is attached to this ticket, so you can see it before it ships.\n\nI'll follow up here once it's merged and live.");
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--space-8) var(--page-pad) 0"
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "svo-btn v-ghost sz-sm",
    onClick: onBack,
    style: {
      paddingLeft: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 14
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      letterSpacing: ".14em",
      textTransform: "uppercase"
    }
  }, "Tickets"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--space-6) var(--page-pad) var(--space-8)",
      borderBottom: "1px solid var(--line)"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: "var(--text-2xl)",
      fontWeight: 600,
      letterSpacing: "-.015em"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--text-brand)",
      marginRight: 12
    }
  }, "#", t.number), t.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "good"
  }, "Resolved"), /*#__PURE__*/React.createElement(Badge, {
    tone: "brand"
  }, "Medium"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Software"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Development"), /*#__PURE__*/React.createElement(Badge, {
    tone: "good"
  }, "SLA met \xB7 resolution"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      marginLeft: 8,
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: t.requester,
    size: 20
  }), t.requester, " \xB7 opened 2h ago \xB7 updated 2h ago"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 320px",
      gap: "var(--space-8)",
      padding: "var(--page-pad)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Screenshots (2)",
    description: "Captured by an agent while working this ticket \u2014 review these before approving a change."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, [["Before — live site: the button label is barely readable", "var(--text-faint)"], ["After — rendered from the fix branch, before it is merged", "var(--brand-ink)"]].map(([cap, ink], i) => /*#__PURE__*/React.createElement("figure", {
    key: i,
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-sidepanel",
    style: {
      height: 132,
      borderRadius: "var(--radius-3)",
      border: "1px solid var(--line)",
      background: "var(--ink-950)",
      backgroundImage: "var(--dot-grid)",
      backgroundSize: "18px 18px",
      padding: 12,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 900,
      fontSize: 13,
      letterSpacing: "-.04em",
      color: "var(--text-strong)"
    }
  }, "Servo", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--brand)"
    }
  }, ".")), /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--brand)",
      color: ink,
      fontSize: 9,
      padding: "3px 7px",
      borderRadius: 4,
      fontWeight: 600
    }
  }, "\u2605 Star on GitHub")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-.02em",
      color: "var(--text-strong)",
      lineHeight: 1.15
    }
  }, "Ticketing your whole team", /*#__PURE__*/React.createElement("br", null), "works in \u2014 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--brand)"
    }
  }, "with nobody waiting."))), /*#__PURE__*/React.createElement("figcaption", {
    style: {
      marginTop: 8,
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, cap, " \xB7 2h ago"))))), !sent ? /*#__PURE__*/React.createElement(ReplyDraftCard, {
    draftedBy: "Developer Agent",
    when: "2h ago",
    recipient: t.requester,
    value: draft,
    onChange: setDraft,
    onApprove: () => setSent(true),
    onDiscard: () => setSent(true)
  }) : /*#__PURE__*/React.createElement(TimelineEntry, {
    author: "Ana Rodr\xEDguez",
    action: "sent the AI reply",
    when: "just now"
  }, draft), /*#__PURE__*/React.createElement(TimelineEntry, {
    author: t.requester,
    action: "opened this ticket",
    when: "2h ago"
  }, "Hi team,\n\nOn the servoai.org landing page the \"Star on GitHub\" button in the top navigation has text I can barely read - it looks like grey text on the green button. Everything else on the page reads fine."), /*#__PURE__*/React.createElement(TimelineEntry, {
    author: "Servo Triage",
    isAi: true,
    badge: {
      tone: "brand",
      label: "AI"
    },
    action: "triaged this ticket",
    when: "2h ago",
    system: true
  }, "Category Software \xB7 priority Medium \xB7 routed to the Frontend Agent (matches available tools)."), /*#__PURE__*/React.createElement(RunSummary, {
    agentName: "Frontend Agent",
    status: "COMPLETED",
    qaVerdict: "PASS",
    qaNotes: "Contrast fix verified at 9.4:1; no unrelated files touched.",
    took: "42s",
    when: "2h ago",
    stepCount: 9,
    open: false,
    summary: "Read the nav styles, found the rule overriding the dark label ink, committed the fix on a branch, captured before/after screenshots and opened a PR.",
    toolTrail: ["github_read_file ×2", "github_edit_file", "take_screenshot ×2", "github_open_pr"],
    decisions: [{
      approved: true,
      by: "Ana"
    }]
  }, /*#__PURE__*/React.createElement(RunStep, {
    kind: "thought"
  }, "The .nav-links colour rule cascades over the button label; scope it to links only."), /*#__PURE__*/React.createElement(RunStep, {
    kind: "tool"
  }, /*#__PURE__*/React.createElement("pre", {
    className: "svo-code"
  }, "github_edit_file \xB7 servoai-site/styles.css")), /*#__PURE__*/React.createElement(RunStep, {
    kind: "result"
  }, "Committed on fix/nav-contrast \xB7 1 file changed"))), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-7)",
      position: "sticky",
      top: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Properties"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Status"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ["Open", "Triaged", "In progress", "Waiting approval", "Resolved", "Closed"],
    defaultValue: "Resolved"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Priority"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ["Low", "Medium", "High", "Urgent"],
    defaultValue: "Medium"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Category"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ["Software", "Hardware", "Network", "Database"],
    defaultValue: "Software"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Assignee"
  }, /*#__PURE__*/React.createElement(Select, {
    options: ["Servo Resolver (AI)", "Ana Rodríguez", "Bruno Chen"],
    defaultValue: "Servo Resolver (AI)"
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Group & escalation",
    action: /*#__PURE__*/React.createElement(Badge, {
      tone: "neutral"
    }, "Junior tier")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-ui)",
      color: "var(--text-body)"
    }
  }, "Development"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    iconStart: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-up-right",
      size: 14
    })
  }, "Escalate a tier")), /*#__PURE__*/React.createElement(Card, {
    title: "AI resolver",
    description: "Works the ticket with tools and pauses for human approval on risky actions."
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconStart: /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 14
    })
  }, "Run AI resolver")))));
}
function ApprovalsScreen() {
  const [tab, setTab] = React.useState("pending");
  const [decided, setDecided] = React.useState([]);
  const pending = D.approvals.filter(a => !decided.includes(a.ticketNumber));
  const st = D.approvalStats;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: pending.length + " runs paused · oldest waiting 18m",
    title: "Approvals",
    subtitle: "Work stops here until a human decides. Everything on this page is time somebody is waiting.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "md",
      iconStart: /*#__PURE__*/React.createElement(Icon, {
        name: "bell",
        size: 14
      })
    }, "Notify deciders"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "md",
      iconStart: /*#__PURE__*/React.createElement(Icon, {
        name: "check-check",
        size: 14
      })
    }, "Approve all low risk"))
  }), /*#__PURE__*/React.createElement("div", {
    style: PAD
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: "pending",
      label: "Pending",
      count: pending.length
    }, {
      value: "history",
      label: "History",
      count: st.decidedToday
    }]
  }), tab === "pending" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 300px",
      gap: "var(--space-7)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-7)"
    }
  }, pending.length ? pending.map(a => /*#__PURE__*/React.createElement(ApprovalCard, _extends({
    key: a.ticketNumber
  }, a, {
    onApprove: () => setDecided(d => [...d, a.ticketNumber]),
    onReject: () => setDecided(d => [...d, a.ticketNumber])
  }))) : /*#__PURE__*/React.createElement(EmptyState, {
    icon: "shield-check",
    title: "Nothing waiting"
  }, "Approvals land here when an agent reaches a gated tool, or drafts a reply.")), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-7)",
      position: "sticky",
      top: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "What's blocked",
    description: "Average wait " + st.avgWait + " · " + st.approvedRate + "% approved"
  }, /*#__PURE__*/React.createElement("div", {
    className: "svo-meter"
  }, st.byRisk.filter(b => b.n).map(b => /*#__PURE__*/React.createElement("span", {
    key: b.label,
    style: {
      background: b.tone,
      flex: b.n
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, st.byRisk.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.label,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: "var(--text-ui)",
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: b.tone,
      opacity: b.n ? 1 : .3
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, b.label, " risk"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: b.n ? "var(--text-strong)" : "var(--text-faint)"
    }
  }, b.n))))), /*#__PURE__*/React.createElement(Card, {
    title: "Who can decide"
  }, D.deciders.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: p.name,
    size: 24
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-ui)",
      color: "var(--text-strong)"
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)"
    }
  }, p.scope)), /*#__PURE__*/React.createElement(Badge, {
    tone: p.role === "ADMIN" ? "brand" : "neutral",
    quiet: true
  }, p.role)))), /*#__PURE__*/React.createElement(Card, {
    title: "Recently decided"
  }, D.decided.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.n,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: "var(--text-sm)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--text-faint)"
    }
  }, "#", h.n), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: "var(--text-muted)",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-mono-xs)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, h.tool), /*#__PURE__*/React.createElement(Badge, {
    tone: h.tone,
    quiet: true
  }, h.outcome)))))) : /*#__PURE__*/React.createElement(Card, {
    padded: false,
    style: {
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement(Table, {
    columns: [{
      key: "n",
      label: "#",
      mono: true
    }, {
      key: "tool",
      label: "Tool"
    }, {
      key: "risk",
      label: "Risk",
      render: r => /*#__PURE__*/React.createElement(Badge, {
        tone: r.riskTone
      }, r.risk)
    }, {
      key: "outcome",
      label: "Outcome",
      render: r => /*#__PURE__*/React.createElement(Badge, {
        tone: r.tone
      }, r.outcome)
    }, {
      key: "by",
      label: "Decided by"
    }, {
      key: "when",
      label: "When",
      align: "right"
    }],
    rows: D.decided.map(h => ({
      ...h,
      n: "#" + h.n,
      risk: h.tool === "cloud_apply" ? "High" : "Medium",
      riskTone: h.tool === "cloud_apply" ? "critical" : "warn"
    }))
  }))));
}
function AgentsScreen() {
  const [agents, setAgents] = React.useState(D.agents);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Agents",
    subtitle: "Specialised resolver personas, their tools and their throughput.",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "md",
      iconStart: /*#__PURE__*/React.createElement(Icon, {
        name: "plus",
        size: 14
      })
    }, "New agent")
  }), /*#__PURE__*/React.createElement("div", {
    style: PAD
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, agents.map((a, i) => /*#__PURE__*/React.createElement(Card, {
    key: a.name,
    title: a.name,
    description: a.categories,
    action: /*#__PURE__*/React.createElement(Switch, {
      checked: a.enabled,
      onChange: v => setAgents(prev => prev.map((p, j) => j === i ? {
        ...p,
        enabled: v
      } : p))
    }),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Badge, {
      tone: "neutral"
    }, a.tools, " tools"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-mono-xs)",
        color: "var(--text-faint)"
      }
    }, a.key), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-mono-xs)",
        color: "var(--text-muted)"
      }
    }, a.tokens, " tok \xB7 7d"))
  }, /*#__PURE__*/React.createElement("pre", {
    className: "svo-code",
    style: {
      fontSize: "var(--text-mono-xs)"
    }
  }, "---\nname: " + a.name + "\ncategories: [" + a.categories + "]\n---"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6
    }
  }, ["github_read_file", "github_edit_file", "take_screenshot", "sql_read"].map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    tone: t.includes("edit") ? "warn" : "good",
    square: true
  }, t))))))));
}
function StubScreen({
  title
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHeader, {
    title: title,
    subtitle: "Not recreated in this kit."
  }), /*#__PURE__*/React.createElement("div", {
    style: PAD
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "construction",
    title: title + " is out of scope for this kit"
  }, "Only the desk's core surfaces \u2014 dashboard, queue, ticket detail, approvals and agents \u2014 are recreated here.")));
}
Object.assign(window, {
  DashboardScreen,
  TicketsScreen,
  TicketDetailScreen,
  ApprovalsScreen,
  AgentsScreen,
  StubScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desk/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desk/data.js
try { (() => {
// Fictional desk data mirroring the demo dataset shipped by npm run demo.
window.DESK = {
  user: {
    name: "Ana Rodríguez",
    role: "ADMIN"
  },
  nav: [{
    href: "dashboard",
    label: "Dashboard",
    icon: "layout-dashboard"
  }, {
    href: "tickets",
    label: "Tickets",
    icon: "inbox",
    count: 15
  }, {
    href: "approvals",
    label: "Approvals",
    icon: "shield-check",
    count: 2,
    attention: true
  }, {
    href: "groups",
    label: "Groups",
    icon: "users-2"
  }, {
    href: "agents",
    label: "Agents",
    icon: "bot"
  }, {
    href: "integrations",
    label: "Integrations",
    icon: "plug"
  }, {
    href: "settings",
    label: "Settings",
    icon: "settings-2"
  }],
  kpis: [{
    label: "Open tickets",
    value: "15"
  }, {
    label: "Resolved · 30d",
    value: "24"
  }, {
    label: "Avg first response",
    value: "37",
    unit: "min"
  }, {
    label: "Avg resolution",
    value: "3.6",
    unit: "h"
  }, {
    label: "AI resolution rate",
    value: "54",
    unit: "%"
  }, {
    label: "Pending approvals",
    value: "2",
    highlight: "warn"
  }, {
    label: "SLA breached",
    value: "15",
    highlight: "critical"
  }],
  flow: [[1, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0], [0, 1], [1, 1], [0, 0], [1, 1], [2, 1], [1, 2], [0, 1], [1, 1], [1, 0], [2, 1], [1, 1], [0, 1], [1, 2], [1, 1], [2, 1], [1, 1], [3, 2], [4, 3], [4, 4], [5, 4], [4, 4], [3, 3], [2, 2], [2, 2]],
  categories: [{
    label: "Hardware",
    n: 3
  }, {
    label: "Software",
    n: 3
  }, {
    label: "Network",
    n: 3
  }, {
    label: "Access & identity",
    n: 2
  }, {
    label: "Database",
    n: 2
  }, {
    label: "DevOps & cloud",
    n: 1
  }, {
    label: "Other",
    n: 1
  }],
  priorities: [{
    label: "Urgent",
    n: 1
  }, {
    label: "High",
    n: 4
  }, {
    label: "Medium",
    n: 8
  }, {
    label: "Low",
    n: 2
  }],
  split: {
    ai: 13,
    human: 11
  },
  replies: [{
    label: "Sent as-is",
    n: 2,
    tone: "var(--chart-1)"
  }, {
    label: "Edited & sent",
    n: 1,
    tone: "var(--chart-4)"
  }, {
    label: "Discarded",
    n: 0,
    tone: "var(--critical)"
  }, {
    label: "Awaiting review",
    n: 6,
    tone: "var(--text-faint)"
  }],
  tickets: [{
    number: 1061,
    title: "Star on GitHub button is unreadable on servoai.org",
    requester: "Dana Whitfield",
    status: "RESOLVED",
    priority: "MEDIUM",
    category: "Software",
    assignee: "Servo Resolver",
    assigneeIsAi: true,
    slaState: "met",
    slaLabel: "met",
    updated: "2h ago"
  }, {
    number: 1058,
    title: "Account locked — can't sign in",
    requester: "Carla Méndez",
    status: "WAITING_APPROVAL",
    priority: "URGENT",
    category: "Access & identity",
    assignee: "Servo Resolver",
    assigneeIsAi: true,
    slaState: "at_risk",
    slaLabel: "22m left",
    updated: "8m ago"
  }, {
    number: 1054,
    title: "Warehouse scanner drops Wi-Fi every few minutes",
    requester: "Hiro Tanaka",
    status: "IN_PROGRESS",
    priority: "HIGH",
    category: "Network",
    assignee: "Iris Volkov",
    slaState: "ok",
    slaLabel: "3h left",
    updated: "40m ago"
  }, {
    number: 1049,
    title: "Add read-only reporting user to the billing database",
    requester: "Farid Khan",
    status: "WAITING_APPROVAL",
    priority: "MEDIUM",
    category: "Database",
    assignee: "Servo Resolver",
    assigneeIsAi: true,
    slaState: "ok",
    slaLabel: "5h left",
    updated: "1h ago"
  }, {
    number: 1046,
    title: "Laptop replacement for the new analyst",
    requester: "Gabriela Torres",
    status: "TRIAGED",
    priority: "LOW",
    category: "Hardware",
    assignee: "Elena Duarte",
    slaState: "ok",
    slaLabel: "2d left",
    updated: "3h ago"
  }, {
    number: 1041,
    title: "Nightly ETL job failed with a timeout",
    requester: "Bruno Chen",
    status: "OPEN",
    priority: "HIGH",
    category: "DevOps & cloud",
    assignee: null,
    slaState: "breached",
    slaLabel: "35m over",
    updated: "5h ago"
  }, {
    number: 1038,
    title: "Shared mailbox not receiving external email",
    requester: "Diego Fontaine",
    status: "CLOSED",
    priority: "MEDIUM",
    category: "Software",
    assignee: "Bruno Chen",
    slaState: "met",
    slaLabel: "met",
    updated: "yesterday"
  }],
  approvals: [{
    ticketNumber: 1061,
    ticketTitle: "Star on GitHub button is unreadable on servoai.org",
    toolName: "github_merge_pr",
    risk: "HIGH",
    requestedAt: "4m ago",
    blockedFor: "4m",
    agentName: "Frontend Agent",
    canDecide: false,
    impact: "Merging deploys to production through the repo's existing workflow.",
    toolInput: '{\n  "repo": "ricauts/servo",\n  "pr": 412,\n  "title": "fix(nav): restore dark label on Star on GitHub button"\n}',
    diff: [{
      op: "-",
      text: ".nav-links a, .nav-cta { color: var(--muted); }"
    }, {
      op: "+",
      text: ".nav-links a { color: var(--muted); }"
    }]
  }, {
    ticketNumber: 1049,
    ticketTitle: "Add read-only reporting user to the billing database",
    toolName: "sql_write",
    risk: "MEDIUM",
    requestedAt: "18m ago",
    blockedFor: "18m",
    agentName: "Analytics Agent",
    canDecide: true,
    impact: "Creates one read-only role on the ops database. No data is modified.",
    toolInput: '{\n  "database": "ops",\n  "statement": "CREATE USER reporting_ro WITH PASSWORD :pw;\\nGRANT SELECT ON billing.* TO reporting_ro;"\n}'
  }],
  approvalStats: {
    pending: 2,
    avgWait: "11m",
    decidedToday: 6,
    approvedRate: 83,
    byRisk: [{
      label: "High",
      n: 1,
      tone: "var(--critical-chip-ink)"
    }, {
      label: "Medium",
      n: 1,
      tone: "var(--warn-chip-ink)"
    }, {
      label: "Low",
      n: 0,
      tone: "var(--good-chip-ink)"
    }]
  },
  deciders: [{
    name: "Ana Rodríguez",
    role: "ADMIN",
    scope: "Any risk level"
  }, {
    name: "Bruno Chen",
    role: "AGENT",
    scope: "Low & medium"
  }, {
    name: "Iris Volkov",
    role: "AGENT",
    scope: "Low & medium"
  }],
  decided: [{
    n: 1061,
    tool: "github_edit_file",
    outcome: "Approved",
    by: "Ana Rodríguez",
    when: "2h ago",
    tone: "good"
  }, {
    n: 1055,
    tool: "password_reset",
    outcome: "Approved",
    by: "Bruno Chen",
    when: "5h ago",
    tone: "good"
  }, {
    n: 1052,
    tool: "cloud_apply",
    outcome: "Rejected",
    by: "Ana Rodríguez",
    when: "yesterday",
    tone: "critical"
  }],
  agents: [{
    name: "Frontend Agent",
    categories: "Software",
    tools: 9,
    key: "anthropic · desk-frontend",
    tokens: "412k",
    enabled: true
  }, {
    name: "Analytics Agent",
    categories: "Database, Other",
    tools: 6,
    key: "zai · glm-analytics",
    tokens: "268k",
    enabled: true
  }, {
    name: "Developer Agent",
    categories: "Software, DevOps & cloud",
    tools: 11,
    key: "anthropic · desk-dev",
    tokens: "731k",
    enabled: true
  }, {
    name: "Cybersecurity Agent",
    categories: "Access & identity, Network",
    tools: 7,
    key: "anthropic · desk-sec",
    tokens: "94k",
    enabled: false
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desk/data.js", error: String((e && e.message) || e) }); }

// ui_kits/site/Landing.jsx
try { (() => {
const {
  Wordmark,
  Button,
  Badge,
  Icon,
  Card
} = window.ServoDesignSystem_824c45;
const LABEL = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-mono-xs)",
  letterSpacing: "var(--tracking-label)",
  textTransform: "uppercase",
  color: "var(--text-faint)"
};
const WRAP = {
  width: "min(var(--container),100% - 48px)",
  margin: "0 auto"
};
function CropFrame({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      ...style
    }
  }, ["top:-1px;left:-1px;border-top:1px solid var(--brand);border-left:1px solid var(--brand)", "top:-1px;right:-1px;border-top:1px solid var(--brand);border-right:1px solid var(--brand)", "bottom:-1px;left:-1px;border-bottom:1px solid var(--brand);border-left:1px solid var(--brand)", "bottom:-1px;right:-1px;border-bottom:1px solid var(--brand);border-right:1px solid var(--brand)"].map((css, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: "absolute",
      width: 10,
      height: 10,
      pointerEvents: "none",
      ...cssToObj(css)
    }
  })), children);
}
function cssToObj(css) {
  const o = {};
  css.split(";").forEach(d => {
    const [k, v] = d.split(":");
    o[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
  });
  return o;
}
function SiteNav() {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 10,
      borderBottom: "1px solid var(--line)",
      background: "var(--bg-elevated)",
      backdropFilter: "var(--blur-panel)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 64
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 22
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      gap: 28,
      fontSize: "var(--text-md)"
    }
  }, ["Features", "How it works", "Permissions", "Docs"].map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      color: "var(--text-muted)",
      textDecoration: "none"
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "lg"
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    iconStart: /*#__PURE__*/React.createElement(Icon, {
      name: "star",
      size: 14
    })
  }, "Star on GitHub"))));
}
function TicketDemo() {
  const steps = [{
    tag: "INTAKE",
    body: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--text-strong)",
        fontFamily: "var(--font-mono)"
      }
    }, "user@acme.com"), " \u2014 \u201CAccount locked \u2014 can\u2019t sign in\u201D")
  }, {
    tag: "ROUTED",
    body: /*#__PURE__*/React.createElement(React.Fragment, null, "ACCESS \xB7 URGENT \xB7 ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--text-brand)"
      }
    }, "Engineering"), " \xB7 senior tier \xB7 Iris Volkov")
  }, {
    tag: "WORK",
    body: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-mono-xs)"
      }
    }, "directory_lookup \xB7 unlock_account", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--warn)"
      }
    }, " \xB7 paused for approval"))
  }, {
    tag: "APPROVAL",
    body: /*#__PURE__*/React.createElement(React.Fragment, null, "Ana signs it off. The work resumes where it stopped, and the reply goes out.")
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--line-strong)",
      borderRadius: "var(--radius-5)",
      background: "var(--surface)",
      boxShadow: "var(--shadow-3),var(--inset-top)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 14px",
      borderBottom: "1px solid var(--line)",
      background: "var(--surface-2)"
    }
  }, ["var(--critical)", "var(--warn)", "var(--brand)"].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      width: 9,
      height: 9,
      borderRadius: 999,
      background: c,
      opacity: .75
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      marginLeft: 8
    }
  }, "servo \xB7 ticket #1058")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, steps.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.tag,
    style: {
      display: "grid",
      gridTemplateColumns: "78px 1fr",
      gap: 12,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      color: "var(--text-faint)",
      paddingTop: 2
    }
  }, s.tag), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-ui)",
      color: "var(--text-muted)",
      lineHeight: "var(--leading-relaxed)"
    }
  }, s.body))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      borderTop: "1px solid var(--line)",
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    iconStart: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 14
    })
  }, "Approve & send"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm"
  }, "Edit draft"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      borderBottom: "1px solid var(--line)",
      backgroundImage: "var(--dot-grid)",
      backgroundSize: "var(--dot-grid-size)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      display: "grid",
      gridTemplateColumns: "1.05fr .95fr",
      gap: 56,
      alignItems: "center",
      padding: "88px 0 96px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      display: "inline-flex",
      alignItems: "center",
      whiteSpace: "nowrap",
      gap: 8,
      padding: "5px 10px",
      borderRadius: "var(--radius-2)",
      background: "var(--brand-chip)",
      border: "1px solid var(--brand-chip-line)",
      color: "var(--brand-chip-ink)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "git-branch",
    size: 12
  }), "open-source ticketing \xB7 ai integrated"), /*#__PURE__*/React.createElement("h1", {
    style: {
      marginTop: 22,
      fontSize: "var(--display-md)",
      lineHeight: 1.02,
      letterSpacing: "var(--tracking-display)",
      fontWeight: 600,
      color: "var(--text-strong)"
    }
  }, "Ticketing your whole team", /*#__PURE__*/React.createElement("br", null), "works in \u2014 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-brand)"
    }
  }, "with nobody waiting.")), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 22,
      maxWidth: "52ch",
      fontSize: "var(--text-lg)",
      lineHeight: "var(--leading-relaxed)",
      color: "var(--text-muted)"
    }
  }, "Open-source ticketing with roles, assignment groups and approval gates in one self-hostable desk \u2014 and AI integrated exactly where it saves time: triage, drafted replies, and tool work that always stops for a human. Less time lost to handoffs, sign-offs and status chasing."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      marginTop: 30
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "xl",
    iconStart: /*#__PURE__*/React.createElement(Icon, {
      name: "terminal",
      size: 15
    })
  }, "Self-host in one command"), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "xl"
  }, "Read the docs")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 22,
      marginTop: 26,
      ...LABEL
    }
  }, /*#__PURE__*/React.createElement("span", null, "MIT licensed"), /*#__PURE__*/React.createElement("span", null, "Self-hosted"), /*#__PURE__*/React.createElement("span", null, "Bring your own model"))), /*#__PURE__*/React.createElement(CropFrame, {
    style: {
      padding: 10
    }
  }, /*#__PURE__*/React.createElement(TicketDemo, null))));
}
const STEPS = [{
  n: "01",
  t: "Intake",
  d: "Email, a form or an API call opens a ticket. Unknown senders become requesters; a subject carrying #1029 files as a comment on that ticket instead."
}, {
  n: "02",
  t: "Routing",
  d: "Assignment groups own categories and members carry junior→senior tiers. Priority sets the minimum tier; anyone can escalate up a tier or across a group."
}, {
  n: "03",
  t: "Work",
  d: "Humans and AI agents work the same queue. Agents triage, draft replies and operate real tools — every step lands on the ticket timeline, verbatim."
}, {
  n: "04",
  t: "Approval",
  d: "Anything risky pauses for a named human. On approval the work resumes exactly where it stopped; a rejection is logged with its reason and flows back."
}];
const FEATURES = [{
  i: "users-2",
  t: "Roles & permissions",
  d: "Admin, agent and requester roles with a permission matrix. Requesters only ever see their own tickets; group management and high-risk sign-offs are admin-only."
}, {
  i: "shield-check",
  t: "Approval gates",
  d: "Every action carries a risk level and an editable approval policy. Gated work waits in one queue with its exact input, for whoever is allowed to decide it."
}, {
  i: "git-branch",
  t: "Groups & escalation",
  d: "Groups own categories, members carry tiers. Escalate up a tier or across to another group and the least-loaded eligible member picks it up — logged on the timeline."
}, {
  i: "timer",
  t: "SLA targets",
  d: "Per-priority response and resolution targets, live SLA state on every ticket, and a scan that escalates missed targets before anyone has to chase them."
}, {
  i: "list",
  t: "Readable audit trail",
  d: "Who acted, what ran, who approved what — folded into one line per run, never truncated. Unfold it and every step is there verbatim."
}, {
  i: "plug",
  t: "AI where it pays",
  d: "Triage, reply drafts and tool work, on Anthropic, Z.AI GLM or any OpenAI-compatible endpoint — or the deterministic mock provider, entirely offline."
}];
function Landing() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SiteNav, null), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement("section", {
    style: {
      borderBottom: "1px solid var(--line)",
      background: "var(--bg-elevated)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      padding: "56px 0 64px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: LABEL
  }, "the loop"), /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      color: "var(--text-muted)"
    }
  }, "intake \u2192 routing \u2192 work \u2192 approval \u2192 resolved")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      border: "1px solid var(--line-strong)",
      borderRadius: "var(--radius-5)",
      overflow: "hidden",
      background: "var(--surface)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 14px",
      borderBottom: "1px solid var(--line)",
      background: "var(--surface-2)"
    }
  }, ["var(--critical)", "var(--warn)", "var(--brand)"].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      width: 9,
      height: 9,
      borderRadius: 999,
      background: c,
      opacity: .75
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: LABEL
  }, "servo \u2014 ticket #1061 \xB7 frontend agent"), /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      marginLeft: "auto"
    }
  }, "the loop")), /*#__PURE__*/React.createElement("image-slot", {
    id: "site-hero-film",
    shape: "rect",
    style: {
      display: "block",
      width: "100%",
      height: 460
    },
    placeholder: "Drop the product film or a full-bleed desk screenshot"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 12,
      marginTop: 12
    }
  }, [["queue", "site-shot-queue"], ["approvals", "site-shot-approvals"], ["run trace", "site-shot-run"]].map(([cap, id]) => /*#__PURE__*/React.createElement("figure", {
    key: id,
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("image-slot", {
    id: id,
    shape: "rounded",
    radius: "10",
    style: {
      display: "block",
      width: "100%",
      height: 180
    },
    placeholder: "Drop the " + cap + " screenshot"
  }), /*#__PURE__*/React.createElement("figcaption", {
    style: {
      ...LABEL,
      marginTop: 8
    }
  }, cap)))))), /*#__PURE__*/React.createElement("section", {
    style: {
      borderBottom: "1px solid var(--line)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      padding: "72px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: LABEL
  }, "how it works"), /*#__PURE__*/React.createElement("h2", {
    style: {
      marginTop: 14,
      fontSize: "var(--display-sm)",
      letterSpacing: "var(--tracking-display)",
      fontWeight: 600
    }
  }, "One ticket, end to end"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 1,
      marginTop: 40,
      background: "var(--line)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-4)",
      overflow: "hidden"
    }
  }, STEPS.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.n,
    style: {
      background: "var(--surface)",
      padding: 22,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...LABEL,
      color: "var(--text-brand)"
    }
  }, s.n), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-xl)",
      fontWeight: 600,
      letterSpacing: "var(--tracking-heading)",
      color: "var(--text-strong)"
    }
  }, s.t), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-md)",
      lineHeight: "var(--leading-relaxed)",
      color: "var(--text-muted)"
    }
  }, s.d)))))), /*#__PURE__*/React.createElement("section", {
    style: {
      borderBottom: "1px solid var(--line)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      padding: "72px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: LABEL
  }, "features"), /*#__PURE__*/React.createElement("h2", {
    style: {
      marginTop: 14,
      fontSize: "var(--display-sm)",
      letterSpacing: "var(--tracking-display)",
      fontWeight: 600
    }
  }, "Built so nothing sits waiting"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 12,
      marginTop: 40
    }
  }, FEATURES.map(x => /*#__PURE__*/React.createElement(Card, {
    key: x.t,
    title: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: x.i,
      size: 16,
      color: "var(--text-brand)"
    }), x.t)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-md)",
      lineHeight: "var(--leading-relaxed)",
      color: "var(--text-muted)"
    }
  }, x.d)))))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      padding: "80px 0",
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 40,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: "var(--display-sm)",
      letterSpacing: "var(--tracking-display)",
      fontWeight: 600
    }
  }, "Run it on your own hardware."), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 16,
      maxWidth: "56ch",
      fontSize: "var(--text-lg)",
      color: "var(--text-muted)",
      lineHeight: "var(--leading-relaxed)"
    }
  }, "SQLite, real OIDC sign-in, secrets encrypted at rest, and a first-run wizard that takes a clean install to a working desk in one screen.")), /*#__PURE__*/React.createElement("pre", {
    className: "svo-code",
    style: {
      fontSize: "var(--text-mono-md)",
      padding: "var(--space-8)",
      whiteSpace: "pre",
      overflow: "visible",
      lineHeight: 1.9
    }
  }, "$ docker compose up --build\n$ open http://localhost:3000"))), /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: "1px solid var(--line)",
      background: "var(--bg-elevated)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...WRAP,
      padding: "34px 0",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 20,
    tagline: "MIT licensed \xB7 2026"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 24,
      ...LABEL
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "var(--text-muted)"
    }
  }, "GitHub"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "var(--text-muted)"
    }
  }, "Docs"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "var(--text-muted)"
    }
  }, "Security"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "var(--text-muted)"
    }
  }, "Roadmap")))));
}
Object.assign(window, {
  Landing
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/site/Landing.jsx", error: String((e && e.message) || e) }); }

// ui_kits/site/doc-page.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <doc-page> — paged-document shell for printable HTML.
 *
 * FIRST, decide how the document paginates — up front, before building:
 *
 * - FLOWING document (the default): write the whole document as one
 *   normal HTML flow inside <doc-page>; the browser's print engine
 *   splits it onto pages at export. Use for long-form documents with a
 *   single text flow: reports, memos, letters, essays.
 * - EXPLICIT pagination: a fixed set of pre-paginated pages, one
 *   <section class="page"> child per page. Use when the user asks for a
 *   specific page count, or the design implies one: a one-page resume, a
 *   two-sided flier, a poster, a certificate, a brochure — any richly
 *   laid-out document without a single text flow.
 * - If in doubt, ask the user as part of the build.
 *
 * PAGE SIZING — paper differs by country (letter vs A4), so the printed
 * sheet is not one fixed truth:
 * - FLOWING documents pin NO paper size: the print engine paginates
 *   onto the user's real paper, and the content reflows to it.
 * - EXPLICITLY PAGINATED documents print each page at a FIXED page box
 *   with overflow hidden — letter by default, size="a4" for a clearly
 *   metric user, the user's chosen paper when they export. Design each
 *   page to FILL that box, fitting letter and A4 alike without overlap.
 * - width/height pin an explicit fixed size, ONLY when the user gives
 *   one.
 * Never write your own @page rule or hard-code paper dimensions in the
 * content.
 *
 * Sizing modes (attributes):
 *   (none)                      — portrait: flowing docs use the user's
 *           paper; explicitly paginated pages use the named size box
 *           (letter unless size="a4")
 *   orientation="landscape"     — the same, landscape
 *   width / height              — explicit fixed size, ONLY when the user
 *           gives one (e.g. width="22in" height="30in" for a 22×30
 *           poster): the page IS the design's size, printed at true
 *           dimensions (or scaled onto the user's paper at print time).
 *           Any absolute CSS length: px/in/mm/cm/pt/pc.
 * The component announces the chosen mode to the host app at runtime (a
 * meta tag it injects), so the print path can inject the user's true
 * paper size.
 *
 * On screen the document renders on a desk background: a flowing
 * document as one tall scrolling sheet (Google Docs' pageless view);
 * explicitly paginated documents as one card per page.
 *
 * EXPLICIT pagination usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page>
 *     <section class="page" id="p1">…one page's design…</section>
 *     <section class="page" id="p2">…</section>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * How the page box works, concretely: each .page prints as ONE full-bleed
 * sheet at a FIXED physical size — letter by default (set size="a4" for
 * a clearly metric user), the user's chosen paper when they export —
 * with overflow hidden. Nothing scrolls and nothing reflows onto a next
 * sheet: content that misses the box is CLIPPED. Design each page to
 * FILL that page box, and to fit it — letter and A4 alike — without
 * overlap. Each page is a size container; don't size anything in
 * viewport units (they track the window, not the page), and never set
 * width or height on the .page section itself (the component sizes the
 * page box; an authored height like 100% is meaningless at print and is
 * overridden). The component owns the page box, the screen card chrome,
 * and the page breaks (never add your own break-before/after). Don't mix
 * .page sections with flowing content or header/footer slots in the same
 * document.
 *
 * FLOWING usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page margin="0.75in">
 *     <h1>Title</h1>
 *     <p>…body…</p>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * There is no manual page-splitting — the browser's print engine
 * paginates at export. Standard break-hygiene rules (`break-inside:
 * avoid` on figures, code blocks, images and table rows; `orphans/
 * widows: 3`) are applied so paragraphs and groups split cleanly. On
 * screen and at print, headings default to `text-wrap: balance` and
 * body text to `text-wrap: pretty`; the defaults have zero specificity,
 * so any text-wrap you declare wins.
 *
 * Other attributes:
 *   size    — letter | a4 | legal (default letter). Flowing documents:
 *           preview proportion only — it does NOT pin their printed
 *           paper (the print dialog's paper governs); leave it alone
 *           there. Explicitly paginated documents: it sets the page box
 *           the cards and the pinned @page share (the export dialog's
 *           choice overrides both at print) — set size="a4" for a
 *           clearly metric user. Scaled-fit: names the sheet the fit is
 *           computed against, same a4-for-metric-users advice.
 *   content-width / content-height — the design's own fixed dimensions
 *           (CSS lengths), for scaling a fixed-size design ONTO the
 *           named sheet: content lays out at exactly this size, and the
 *           component scales it to fit that sheet's printable area
 *           (centered horizontally, top-aligned; the export dialog
 *           re-fits to the user's actual paper choice where available).
 *           Both must be set; they do not change the page box. For pages
 *           WITHOUT running header/footer slots.
 *   margin  — printable inset on every page of a FLOWING document
 *           (default 0.75in); margin="0" makes pages full-bleed.
 *           Explicitly paginated pages are always full-bleed.
 *
 * Running header/footer (flowing documents only): give an element
 * `slot="header"` or `slot="footer"` and it repeats on every printed
 * page via `position: fixed`. To keep body text from sliding under it,
 * the component prints inside a single-cell table whose <thead>/<tfoot>
 * are spacers sized to the header/footer height — browsers repeat
 * thead/tfoot on every page, so each sheet's content starts below the
 * header and ends above the footer. On screen the header/footer render
 * once at the top/bottom of the sheet.
 *
 * At print the component injects `@page { margin: 0 }` (which leaves
 * Chrome no margin box to draw its date/URL/page-count header in) and
 * moves the visual margin onto the sheet's own padding. It also marks
 * the document as owning its print CSS (a
 * `meta[name="omelette-owns-print"]` it injects at runtime), so the
 * PDF export never injects page-geometry CSS of its own on top.
 *
 * Print best practices for the content you author:
 * - Multi-column text: use CSS columns (`column-count` +
 *   `column-gap`), never side-by-side flex/grid columns — only real
 *   CSS columns flow and break across pages. `column-span: all` lets
 *   a heading span the columns; `hyphens: auto` (needs `lang` on
 *   the html element) keeps narrow columns readable.
 * - Page breaks in flowing documents: `break-before: page` on an
 *   element that must start a new page (a chapter, an appendix). Add
 *   your own kept-together blocks (callouts, stat tiles, cards) to a
 *   `break-inside: avoid` rule, and keep each one shorter than a page.
 * - Extend `orphans: 3; widows: 3` to any custom text blocks you add
 *   (p and li are covered by default).
 * - Give long tables a <thead> — browsers repeat it on every printed
 *   page.
 * - No `position: fixed`/`sticky` and no viewport units in content:
 *   fixed elements stamp every printed page (running headers/footers go
 *   in the component's slots) and `100vh` mis-sizes at print.
 *
 * Author content as static HTML so the user can click-to-edit any text
 * directly. Do not set width/padding/background on the document body —
 * the component owns the sheet box.
 */
/* END USAGE */

(() => {
  const PAPER = {
    letter: ['8.5in', '11in'],
    a4: ['210mm', '297mm'],
    legal: ['8.5in', '14in']
  };
  const CSS_LENGTH = /^\d+(\.\d+)?(px|in|mm|cm|pt|pc)$/;
  // Unitless "0" is a valid CSS length and the natural way to write
  // margin="0"; normalise it to 0px so max()/calc() (which reject a bare
  // number) keep working.
  const safeLen = (v, fb) => {
    v = (v || '').trim();
    return v === '0' ? '0px' : CSS_LENGTH.test(v) ? v : fb;
  };
  // WebKit (Safari and every iOS browser shell) never repeats a table's
  // thead/tfoot on printed pages (WebKit bug 17205), so the spacer-borne
  // vertical margins of a FLOWING document reach only the first page
  // there. Engine check, not browser check: vendor is 'Apple Computer,
  // Inc.' exactly for WebKit and 'Google Inc.' for Blink.
  const WK_PRINT = /apple/i.test(navigator.vendor || '');
  // CSS length → px number (CSS absolute units are exact: 1in = 96px).
  // Returns NaN for anything safeLen would reject — callers gate on it.
  const PX_PER = {
    px: 1,
    in: 96,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16
  };
  const toPx = v => {
    const m = /^(\d+(?:\.\d+)?)(px|in|mm|cm|pt|pc)$/.exec((v || '').trim());
    return m ? parseFloat(m[1]) * PX_PER[m[2]] : NaN;
  };
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      /* When the viewport is narrower than the page, grow to wrap the
       * sheet (plus this padding) instead of staying viewport-width, so
       * the desk background and right margin reach the sheet's far edge
       * in the horizontal scroll. */
      min-width: max-content;
      min-height: 100vh;
      background: #f5f5f4;
      padding: 48px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      --doc-page-w: 8.5in;
      --doc-page-h: 11in;
      --doc-page-margin: 0.75in;
      --doc-hdr-h: 0px;
      --doc-ftr-h: 0px;
      --doc-hdr-pad: 0px;
      --doc-ftr-pad: 0px;
    }
    .sheet {
      width: var(--doc-page-w);
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 2px 10px rgba(20, 20, 19, 0.12);
      border-radius: 7px;
      box-sizing: border-box;
      padding: var(--doc-page-margin);
    }
    .frame { width: 100%; border-collapse: collapse; }
    /* Scaled-fit mode (content-width/content-height): the inner .fit box
     * lays the content out at its authored fixed size and scales it onto
     * the printable area; .fit-box reserves the scaled footprint in flow
     * (transforms don't affect layout) and centers it. Without the mode,
     * both divs are unstyled block pass-throughs. */
    /* Explicit pagination: direct .page children are the pages. The sheet
     * becomes a transparent stack and each page carries the card look on
     * screen; at print each page is exactly one full-bleed sheet. The
     * ::slotted defaults are deliberately weak (document CSS wins), so
     * authored page styling can override any of this. */
    .sheet.paginated {
      background: transparent;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
    }
    .paginated ::slotted(.page) {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: var(--doc-page-ar);
      container-type: size;
      overflow: hidden;
      box-sizing: border-box;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
      break-inside: avoid;
    }
    .paginated ::slotted(.page:not(:first-child)) { margin-top: 1rem; }
    @media print {
      .sheet.paginated { padding: 0; }
      /* The flowing-document vertical inset lives on the repeating
       * thead/tfoot spacers, not the sheet padding — they must go too,
       * or each full-sheet .page is pushed ~margin down and spills onto
       * a second sheet. Paginated pages are full-bleed by definition
       * (content owns its insets). */
      .sheet.paginated .hdr-space,
      .sheet.paginated .ftr-space { height: 0; }
      .paginated ::slotted(.page) {
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        /* Physical page-box sizing, no viewport units: Safari resolves
         * 100vh against the window, not the page box, so a vh-sized card
         * paginates wrong there. --doc-page-w/h are the named size by
         * default and are overridden to the user's chosen paper by the
         * export path, so every card is exactly one sheet either way.
         * Width + height (same source values as @page size) rather than
         * width + aspect-ratio: the ratio is a 6-decimal rounding of the
         * same division, and a few millionths of overflow would spill a
         * blank sheet after every page. The screen-only aspect-ratio
         * (preview proportions) must not leak into print. cqh typography
         * tracks the same box.
         *
         * Every declaration is !important: per CSS Scoping, unimportant
         * shadow ::slotted rules LOSE to the document context, so a page
         * section's authored inline style would silently beat this print
         * geometry. A model-authored height:100% did exactly that — the
         * percentage resolves as auto in the all-auto print ancestry, the
         * base rule's size containment turns auto into ZERO, and
         * overflow:hidden then paints nothing: a blank PDF with perfect
         * page boxes. At print the component's geometry is the design's
         * whole contract, so it must win over any authored sizing. */
        aspect-ratio: auto !important;
        width: var(--doc-page-w) !important;
        height: var(--doc-page-h) !important;
        overflow: hidden !important;
      }
      .paginated ::slotted(.page:not(:first-child)) {
        break-before: page !important;
        margin-top: 0 !important;
      }
    }
    .fit-mode .fit-box {
      width: calc(var(--doc-fit-w) * var(--doc-fit-scale));
      height: calc(var(--doc-fit-h) * var(--doc-fit-scale));
      margin: 0 auto;
      break-inside: avoid;
    }
    .fit-mode .fit {
      width: var(--doc-fit-w);
      height: var(--doc-fit-h);
      transform: scale(var(--doc-fit-scale));
      transform-origin: top left;
    }
    .frame td, .frame th { padding: 0; text-align: left; font-weight: inherit; }
    .hdr-space { height: var(--doc-hdr-h); }
    .ftr-space { height: var(--doc-ftr-h); }
    ::slotted([slot="header"]),
    ::slotted([slot="footer"]) { display: block; box-sizing: border-box; }
    @media print {
      :host { background: none; padding: 0; min-width: 0; min-height: 0; }
      .sheet {
        width: auto; margin: 0; box-shadow: none; border-radius: 0;
        padding: 0 var(--doc-page-margin);
      }
      /* The thead/tfoot spacers repeat on every page, so they carry the
       * vertical page margin (which the sheet's own padding cannot, since
       * that padding is consumed once on the first/last page). The running
       * header/footer are fixed inside that band. */
      /* The 0.35in is breathing room between a running header/footer and
       * the body; without one the spacer is exactly the page margin, so a
       * margin="0" full-bleed document gets truly full-bleed pages. */
      .hdr-space { height: max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))); }
      .ftr-space { height: max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))); }
      /* WebKit flowing documents: @page carries the vertical margin (see
       * _syncPrintPageRule), so the spacers keep only whatever a running
       * header/footer needs BEYOND it — page 1 would otherwise double its
       * top inset. Paginated sheets already zero their spacers above. */
      .sheet.wk-print:not(.paginated) .hdr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))) - var(--doc-page-margin))); }
      .sheet.wk-print:not(.paginated) .ftr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))) - var(--doc-page-margin))); }
      ::slotted([slot="header"]) {
        position: fixed; top: 0; left: 0; right: 0; margin: 0;
        padding: calc(var(--doc-page-margin) * 0.45) var(--doc-page-margin) 0;
      }
      ::slotted([slot="footer"]) {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0;
        padding: 0 var(--doc-page-margin) calc(var(--doc-page-margin) * 0.45);
      }
    }
  `;
  class DocPage extends HTMLElement {
    static get observedAttributes() {
      return ['size', 'width', 'height', 'margin', 'orientation', 'content-width', 'content-height'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._mo = typeof MutationObserver === 'function' ? new MutationObserver(() => this._scheduleMeasure()) : null;
    }

    /** The named paper's [w, h], swapped when orientation="landscape".
     *  Only the named size swaps — explicit width/height are exact values
     *  the author already oriented. */
    _paperSize() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()] || PAPER.letter;
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? [named[1], named[0]] : named;
    }
    get pageWidth() {
      return safeLen(this.getAttribute('width'), this._paperSize()[0]);
    }
    get pageHeight() {
      return safeLen(this.getAttribute('height'), this._paperSize()[1]);
    }
    get pageMargin() {
      return safeLen(this.getAttribute('margin'), '0.75in');
    }

    /** Scaled-fit mode's content box [w, h] as CSS lengths, or null when
     *  the mode is off (either attribute missing/invalid/zero — a partial
     *  declaration falls back to normal flow rather than guessing). */
    _contentFit() {
      const w = safeLen(this.getAttribute('content-width'), null);
      const h = safeLen(this.getAttribute('content-height'), null);
      if (!w || !h) return null;
      const wPx = toPx(w),
        hPx = toPx(h);
      return wPx > 0 && hPx > 0 ? [w, h, wPx, hPx] : null;
    }
    connectedCallback() {
      if (!this._sheet) this._render();
      this._syncSize();
      this._syncPrintPageRule();
      this._ensureTextWrapDefaults();
      this._ensureOwnsPrintMeta();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      if (this._mo) this._mo.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      this._onResize = () => this._scheduleMeasure();
      window.addEventListener('resize', this._onResize);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._scheduleMeasure());
      }
      this._scheduleMeasure();
    }
    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      if (this._mo) this._mo.disconnect();
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      // Drop the head rules when the last doc-page leaves, so a deleted
      // document's @page geometry and text-wrap defaults can't apply to
      // whatever replaces it.
      const survivor = document.querySelector('doc-page');
      if (!survivor) {
        ['doc-page-print', 'doc-page-text-wrap', 'doc-page-owns-print', 'doc-page-fixed-size', 'doc-page-print-sizing'].forEach(id => {
          const tag = document.getElementById(id);
          if (tag) tag.remove();
        });
        // A live deck-stage deferred its own print-sizing meta to ours —
        // hand the page-global meta over so the deck isn't left unmarked.
        const deck = document.querySelector('deck-stage');
        if (deck && typeof deck._ensurePrintSizingMeta === 'function') {
          deck._ensurePrintSizingMeta();
        }
      } else {
        // A departed owner hands each page-global meta to whatever
        // doc-page remains (or it's removed).
        if (typeof survivor._syncFixedSizeMeta === 'function') {
          survivor._syncFixedSizeMeta();
        }
        if (typeof survivor._syncPrintSizingMeta === 'function') {
          survivor._syncPrintSizingMeta();
        }
      }
    }
    attributeChangedCallback() {
      if (!this._sheet) return;
      this._syncSize();
      this._syncPrintPageRule();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      this._scheduleMeasure();
    }
    _render() {
      this._root.innerHTML = `
        <style>${stylesheet}</style>
        <style id="vars"></style>
        <div class="sheet" data-screen-label="Document">
          <table class="frame" role="presentation">
            <thead><tr><th><div class="hdr-space"><slot name="header"></slot></div></th></tr></thead>
            <tbody><tr><td class="body"><div class="fit-box"><div class="fit"><slot></slot></div></div></td></tr></tbody>
            <tfoot><tr><td><div class="ftr-space"><slot name="footer"></slot></div></td></tr></tfoot>
          </table>
        </div>`;
      this._sheet = this._root.querySelector('.sheet');
      this._vars = this._root.getElementById('vars');
    }

    /** Runtime sizing lives in a shadow <style> :host rule, never on the
     *  light-DOM host element, so serialize-persist can't write it back. */
    _syncSize(hdrH, ftrH) {
      // Scaled-fit mode: content at its authored size, scaled onto the
      // printable area (page minus margins on both axes). The factor is a
      // plain number var so calc(length * number) stays valid; 4 decimals
      // keeps the shadow style stable across re-measures. Upscaling is
      // allowed — print transforms are vector, so text and CSS stay crisp
      // (raster images soften, which the catalog bullet warns about).
      const fit = this._contentFit();
      let fitVars = '';
      if (fit) {
        const marginPx = toPx(this.pageMargin) || 0;
        const availW = toPx(this.pageWidth) - 2 * marginPx;
        const availH = toPx(this.pageHeight) - 2 * marginPx;
        const scale = Math.min(availW / fit[2], availH / fit[3]);
        if (scale > 0 && Number.isFinite(scale)) {
          fitVars = '--doc-fit-w:' + fit[0] + ';' + '--doc-fit-h:' + fit[1] + ';' + '--doc-fit-scale:' + scale.toFixed(4) + ';';
        }
      }
      this._sheet.classList.toggle('fit-mode', !!fitVars);
      // Numeric w/h ratio for the paginated page cards' aspect-ratio —
      // aspect-ratio takes a number, not a length ratio, so compute it
      // here (CSS length division isn't portable). 6 decimals keeps the
      // shadow style stable across re-syncs.
      const arW = toPx(this.pageWidth);
      const arH = toPx(this.pageHeight);
      const ar = arW > 0 && arH > 0 ? (arW / arH).toFixed(6) : '0.772727';
      this._vars.textContent = ':host{' + fitVars + '--doc-page-ar:' + ar + ';' + '--doc-page-w:' + this.pageWidth + ';' + '--doc-page-h:' + this.pageHeight + ';' + '--doc-page-margin:' + this.pageMargin + ';' + '--doc-hdr-h:' + (hdrH || 0) + 'px;' + '--doc-ftr-h:' + (ftrH || 0) + 'px;' + '--doc-hdr-pad:' + (hdrH ? '0.35in' : '0px') + ';' + '--doc-ftr-pad:' + (ftrH ? '0.35in' : '0px') + '}';
    }

    /** @page is a no-op inside shadow DOM, so the rule lives in <head>.
     *  Re-appended on every sync so it stays last in source order — the
     *  @page cascade is source-order per descriptor, so this rule wins
     *  over any other @page rule in the document.
     *
     *  The @page SIZE is pinned where the page box IS part of the design:
     *  explicit-fixed-size mode (width + height authored), scaled-fit
     *  mode (the named sheet the fit targets), and explicit pagination
     *  (the named size the cards share — so card and sheet agree on
     *  every print path, and the export path's chosen paper overrides
     *  BOTH with one later rule). For FLOWING documents no paper size is
     *  emitted at all — the true size comes from the user's preference,
     *  injected by the export path or chosen in the print dialog — so a
     *  flowing document never fights the paper it lands on.
     *  margin: 0 is emitted in every mode: it leaves Chrome no margin box
     *  to draw its date/URL/page-count header in, and the visual margin
     *  lives on the sheet's own padding. */
    _syncPrintPageRule() {
      const id = 'doc-page-print';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      document.head.appendChild(tag);
      // Three print-geometry regimes:
      // - true-size: the page IS the design — pin its exact size.
      // - scaled-fit (content-width/height): the fit factor is computed
      //   against the NAMED paper's printable area, so that paper must
      //   stay pinned or the scaled content overflows a smaller sheet
      //   (the export path re-fits and re-pins at print time on top).
      // - default modes: no paper size — but landscape still needs the
      //   paper-agnostic 'size: landscape' keyword, because the size
      //   descriptor is what carries orientation; without it a landscape
      //   document prints portrait whenever nothing injects a size.
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      // Explicit pagination pins the page box to the SAME values that
      // size the cards (the named size by default, the export path's
      // chosen paper when its later rule overrides both) — card and
      // sheet agree on every print path, and a mismatched real paper
      // shrinks-to-fit in the dialog instead of clipping a Letter card
      // on A4. Declared before the paginated read below so both derive
      // from one check.
      const paginatedNow = this.querySelector(':scope > .page') !== null;
      const sizeDescriptor = this._trueSizePx() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : this._contentFit() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : paginatedNow ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : landscape ? 'size: landscape; ' : '';
      // WebKit never repeats the thead/tfoot spacers that carry a flowing
      // document's vertical page margins (see WK_PRINT above), so pages
      // after the first print edge-to-edge there. Carry the VERTICAL
      // margins on @page for WebKit instead, and the shadow print CSS
      // trims the first-page spacers by the same amount (.sheet.wk-print
      // rules). Horizontal inset stays on the sheet's own padding in
      // every engine. Blink keeps margin: 0 (a nonzero margin there
      // re-opens the box Chrome draws its header furniture in). One cost,
      // learned in testing: Safari's own date/URL headers are a USER
      // dialog setting ("Print headers and footers") that renders in the
      // margin area when room exists — margin: 0 only suppressed it by
      // leaving no room, and no CSS controls it. The export dialog's
      // Safari guide teaches turning the setting off for flowing
      // documents. Explicitly paginated and fixed-size documents keep
      // margin: 0 everywhere: their pages ARE the sheet.
      const wkFlowing = WK_PRINT && !paginatedNow && !this._trueSizePx() && !this._contentFit();
      const marginDescriptor = wkFlowing ? 'margin: ' + this.pageMargin + ' 0; ' : 'margin: 0; ';
      // Shadow-internal marker (never serialized), kept in lockstep with
      // the @page decision above: the print CSS trims the first-page
      // spacers ONLY while @page actually carries the margins — a
      // true-size or scaled-fit sheet keeps margin: 0 and must keep its
      // spacers too. Re-synced here so attribute changes and pagination
      // flips move both together.
      if (this._sheet) this._sheet.classList.toggle('wk-print', wkFlowing);
      tag.textContent = '@page { ' + sizeDescriptor + marginDescriptor + '} ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; height: auto !important; overflow: visible !important; } ' + 'h1,h2,h3,h4,h5,h6 { break-after: avoid; } ' + 'figure,pre,blockquote,img,svg,tr { break-inside: avoid; } ' + 'p,li { orphans: 3; widows: 3; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; ' + 'backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }

    /** Typographic defaults for document text: balance headings, avoid
     *  widowed/orphaned words in body copy (browsers without text-wrap
     *  support drop the declarations). Zero-specificity via :where() so
     *  any text-wrap authored on those elements wins; document-level so the
     *  rules reach the slotted (light DOM) content — shadow styles can't.
     *  data-omelette-injected marks the tag for the host editor to strip
     *  at serialize, so it is never written back as authored source. */
    _ensureTextWrapDefaults() {
      if (document.getElementById('doc-page-text-wrap')) return;
      const tag = document.createElement('style');
      tag.id = 'doc-page-text-wrap';
      tag.setAttribute('data-omelette-injected', '');
      tag.textContent = ':where(h1,h2,h3,h4,h5,h6){text-wrap:balance}' + ':where(p,li,blockquote,figcaption){text-wrap:pretty}';
      document.head.appendChild(tag);
    }

    /** Declares that this document owns its print CSS. The instant-PDF
     *  export checks for the meta by NAME PRESENCE alone (content is
     *  ignored) and skips its automatic print-CSS injections, so the
     *  component's @page geometry is never overridden by a heuristic.
     *  data-omelette-injected keeps it out of serialized source. */
    _ensureOwnsPrintMeta() {
      if (document.getElementById('doc-page-owns-print')) return;
      const tag = document.createElement('meta');
      tag.id = 'doc-page-owns-print';
      tag.name = 'omelette-owns-print';
      tag.content = 'true';
      tag.setAttribute('data-omelette-injected', '');
      document.head.appendChild(tag);
    }

    /** This page's valid true-size page box (explicit width AND height)
     *  as [w, h] px ints, or null when the mode is off. */
    _trueSizePx() {
      if (!safeLen(this.getAttribute('width'), null) || !safeLen(this.getAttribute('height'), null)) return null;
      const w = Math.round(toPx(this.pageWidth));
      const h = Math.round(toPx(this.pageHeight));
      return w > 0 && h > 0 ? [w, h] : null;
    }

    /** True-size pages (explicit width AND height) also declare the page
     *  box as the preview size: the in-app preview reads
     *  meta[name="omelette-fixed-size"] (content "W,H" in px ints) and
     *  scales the sheet into view — without it an 18in poster previews at
     *  true size with scrollbars. Never overrides an author-set meta
     *  (only the component's own id is managed). The meta is page-global
     *  while doc-page instances are not, so every sync recomputes the
     *  page-wide owner — the first connected true-size doc-page — and a
     *  non-true-size sibling's sync can never delete the owner's meta.
     *  Removed when no true-size page remains (the owner's disconnect
     *  re-syncs via any survivor) or when an author-set meta exists. */
    _syncFixedSizeMeta() {
      const id = 'doc-page-fixed-size';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-fixed-size"]:not([data-omelette-injected])');
      // The page-wide owner, not this instance: an upgraded true-size page
      // anywhere in the document keeps the meta alive and sized.
      let box = null;
      for (const el of document.querySelectorAll('doc-page')) {
        box = typeof el._trueSizePx === 'function' ? el._trueSizePx() : null;
        if (box) break;
      }
      if (!box || authored) {
        if (own) own.remove();
        return;
      }
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-fixed-size';
      tag.content = box[0] + ',' + box[1];
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }

    /** This page's print-sizing mode: 'fixed' when an explicit width AND
     *  height are authored (the page is the design's own size), else the
     *  default paper in the authored orientation. */
    _printSizingMode() {
      if (this._trueSizePx()) return 'fixed';
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? 'default-landscape' : 'default-portrait';
    }

    /** Announces the print-sizing mode to the host app:
     *  meta[name="omelette-print-sizing"] with content 'default-portrait',
     *  'default-landscape', or 'fixed' (fixed pages also carry the
     *  omelette-fixed-size meta with the page box in px). The export path
     *  probes it to decide what true paper size to inject at print time —
     *  in the default modes the component emits no paper size of its own.
     *  Same page-global ownership rules as the fixed-size meta above:
     *  first connected doc-page owns it, an authored meta is never
     *  overridden, removed when no doc-page remains. */
    _syncPrintSizingMeta() {
      const id = 'doc-page-print-sizing';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-print-sizing"]:not([data-omelette-injected])');
      // A fixed page wins outright (mirroring the fixed-size loop above,
      // so the two metas can never contradict each other in a mixed
      // multi-page document); otherwise the first page's mode holds.
      let mode = null;
      for (const el of document.querySelectorAll('doc-page')) {
        if (typeof el._printSizingMode !== 'function') continue;
        const m = el._printSizingMode();
        if (m === 'fixed') {
          mode = m;
          break;
        }
        if (mode === null) mode = m;
      }
      if (!mode || authored) {
        if (own) own.remove();
        return;
      }
      // A deck-stage that connected first injected its own meta and
      // defers to any existing one — take it over, or the document ends
      // up with two conflicting injected metas (a doc-page page is the
      // document; the deck re-ensures its meta if every doc-page leaves).
      const deckMeta = document.getElementById('deck-stage-print-sizing');
      if (deckMeta) deckMeta.remove();
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-print-sizing';
      tag.content = mode;
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }
    _scheduleMeasure() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._measure();
      });
    }

    /** Slot heights feed the print spacers (--doc-hdr-h / --doc-ftr-h), so
     *  they re-measure on content mutation, resize, and font load. The
     *  same pass detects explicit pagination (direct .page children) and
     *  toggles the sheet between the flowing-document card and the
     *  page-per-card stack — content edits can add or remove pages at any
     *  time, so this tracks the same mutations the measurement does. */
    _measure() {
      const hdr = this.querySelector(':scope > [slot="header"]');
      const ftr = this.querySelector(':scope > [slot="footer"]');
      const wasPaginated = this._sheet.classList.contains('paginated');
      this._sheet.classList.toggle('paginated', this.querySelector(':scope > .page') !== null);
      // The WebKit @page margin is flowing-only, so a pagination flip
      // must re-emit the rule (content edits can add or remove .page
      // sections at any time).
      if (this._sheet.classList.contains('paginated') !== wasPaginated) {
        this._syncPrintPageRule();
      }
      this._syncSize(hdr ? hdr.offsetHeight : 0, ftr ? ftr.offsetHeight : 0);
    }
  }
  if (!customElements.get('doc-page')) {
    customElements.define('doc-page', DocPage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/site/doc-page.js", error: String((e && e.message) || e) }); }

// ui_kits/site/image-slot.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever a design needs an image.
 * You control the slot's shape; it sizes to its container by default. When the search_stock_photos tool
 * is available, prefill the slot by default — write the photo's URL into
 * src (with credit/credit-href); the user can still fill or replace it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The sidecar is a SIBLING of the HTML file that uses this component: the
 * read is a document-relative fetch, and the host resolves the bridge's
 * sidecar writes into the previewed file's directory to match (same
 * contract as design_canvas.jsx). Pages in the same directory share one
 * sidecar; keep slot ids distinct across them.
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          Initial framing baseline: cover | contain.   (default 'cover')
 *                cover starts the image filling the frame (overflow cropped);
 *                contain starts it fully visible (letterboxed). Either way the
 *                user can always pan/scale from there — double-click, or the
 *                Edit control, enters reframe mode (drag to move, scroll or
 *                corner-handles to scale; Escape / click-out commits). The
 *                crop persists alongside the image in the sidecar.
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. Prefill it with a real
 *                photo via search_stock_photos when that tool is available
 *                (set credit/credit-href from the result). A user drop
 *                overrides it; clearing the drop reveals src again.
 *   credit       Attribution text shown as a small overlay at the
 *                bottom-left of the filled slot. REQUIRED whenever src
 *                points at any Unsplash host (images.unsplash.com,
 *                plus.unsplash.com, …): an Unsplash src with no credit
 *                renders an error tile INSTEAD of the photo (Unsplash
 *                terms forbid showing their photos unattributed). Use the
 *                exact form 'Photo by {photographer name} on Unsplash' —
 *                the overlay then links the name to credit-href and
 *                'Unsplash' to the Unsplash homepage, and links back to
 *                unsplash.com automatically get the required utm referral
 *                params appended at render time. The credit belongs to
 *                the src image, so it only shows while src is what's
 *                displayed — a user-dropped image hides it.
 *   credit-href  Link for the photographer's name in the credit overlay
 *                (their Unsplash profile URL from the stock-photo search
 *                results). http(s) URLs only — anything else renders the
 *                name as plain text.
 *
 * Sizing: the slot fills its container by default (width/height 100%).
 * Put it in a sized wrapper — absolutely positioned, a grid cell, a fixed
 * frame — and it takes exactly that box. When the parent's height is
 * indefinite (ordinary flow), it falls back to full width at a 3:2 aspect
 * ratio instead of collapsing. In a shrink-to-fit parent (a float,
 * width:max-content, an unsized absolute wrapper), percentages have
 * nothing to resolve against — size the slot or its wrapper explicitly
 * there. For a fixed-size slot, set
 * width/height on the element itself (inline style), which overrides the
 * default. When
 * layering content above a slot (full-bleed layouts), make the overlay
 * click-through — pointer-events: none on scrims/text plates, re-enabled
 * on interactive children — so the slot's hover controls stay reachable.
 * Keep the slot's bottom-left corner visually clear as well: the credit
 * overlay renders there, and a dark fade or text plate covering it hides
 * the attribution Unsplash's terms require — end the fade above that
 * corner, or keep it nearly transparent where the credit sits.
 *
 * Usage:
 *   <div style="position:relative;width:100%;height:100%">      <!-- full-bleed: -->
 *     <image-slot id="bg" shape="rect"></image-slot>            <!-- fills the wrapper -->
 *   </div>
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';

  // Unsplash terms require visible attribution wherever their photos
  // display, and every link back to unsplash.com must carry utm referral
  // params. Two render-time rules enforce that here:
  //  - an Unsplash-src slot with NO credit attribute renders an error
  //    tile INSTEAD of the photo (an uncredited Unsplash photo on screen
  //    is itself the terms violation, so it never renders bare);
  //  - rendered credit links pointing at unsplash.com get the referral
  //    params appended when absent (credit-href values live in page
  //    content that can't be edited after the fact).
  // Keep the utm_source value in sync with UTM_SOURCE in
  // platform/web-agent/unsplash.ts — this file is a project-local
  // artifact and cannot import it (equality is pinned by tests).
  const UNSPLASH_HOMEPAGE_HREF = 'https://unsplash.com/?utm_source=claude_design&utm_medium=referral';
  // Host rule mirrors the hotlink validator that admits Unsplash srcs into
  // pages in the first place (cdn$ in unsplash.ts: apex or any subdomain)
  // — Unsplash+ results serve from plus.unsplash.com, not just images.*,
  // and an admitted-but-uncredited photo must error whatever unsplash
  // host it rides on.
  // Trailing-dot FQDNs (images.unsplash.com.) are the same host to the
  // browser but would miss the regex — strip one dot so the check fails
  // CLOSED (unrecognized-but-real Unsplash srcs must error, not render).
  const isUnsplashHost = u => {
    try {
      return /(^|\.)unsplash\.com$/.test(new URL(u, document.baseURI).hostname.replace(/\.$/, ''));
    } catch {
      return false;
    }
  };
  // Render-time referral normalization for links back to Unsplash:
  // appends utm_source/utm_medium when absent, preserves every existing
  // query param, never overwrites an existing utm_source, and passes
  // non-Unsplash URLs through untouched. Input is an ABSOLUTE validated
  // http(s) URL (the credit render funnel resolves + validates first).
  const withReferral = href => {
    try {
      const u = new URL(href);
      if (!/(^|\.)unsplash\.com$/.test(u.hostname.replace(/\.$/, ''))) {
        return href;
      }
      if (!u.searchParams.has('utm_source')) {
        u.searchParams.set('utm_source', 'claude_design');
      }
      if (!u.searchParams.has('utm_medium')) {
        u.searchParams.set('utm_medium', 'referral');
      }
      return u.toString();
    } catch (e) {
      return href;
    }
  };
  // 2× a ~600px slot in a 1920-wide deck — retina-sharp without making the
  // sidecar enormous. A 1200px WebP at q=0.85 is ~150-300KB.
  const MAX_DIM = 1200;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;
  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE).then(r => r.ok ? r.json() : null).then(j => {
      // Merge: sidecar loses to any in-memory change that raced ahead of
      // the fetch (drop or clear) so neither is clobbered by hydration.
      if (j && typeof j === 'object') {
        const merged = Object.assign({}, j, slots);
        // A framing-only write that raced ahead of hydration must not
        // drop a user image that's only on disk — inherit u from the
        // sidecar for any in-memory entry that lacks one.
        for (const k in slots) {
          if (merged[k] && !merged[k].u && j[k]) {
            merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
          }
        }
        for (const id of tombstones) delete merged[id];
        slots = merged;
      }
      tombstones.clear();
    }).catch(() => {}).then(() => {
      loaded = true;
      subs.forEach(fn => fn());
    });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  // Unload-time flush: save()'s serialization defers a mid-RTT re-fire to a
  // .then that never runs in an unloading document, silently dropping a
  // pagehide commit. Post the current slots immediately instead — content
  // is a superset snapshot of any in-flight save's, the write is a
  // whole-file last-writer-wins replace, and postMessage FIFO delivers it
  // to the host after the in-flight one, so a backend-side reorder at
  // worst reproduces the dropped-commit outcome this flush improves on.
  // Guarded on the initial sidecar read: pre-hydration slots can miss
  // other slots' persisted entries, and flushing it would clobber them —
  // that narrow case stays best-effort (the in-memory merge in load()
  // cannot happen in an unloading document anyway).
  function flushNow() {
    if (!loaded) return;
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    try {
      Promise.resolve(w(STATE_FILE, JSON.stringify(slots))).catch(() => {});
    } catch (e) {}
  }
  function save() {
    if (saving) {
      saveDirty = true;
      return;
    }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots))).catch(() => {}).then(() => {
      saving = false;
      if (saveDirty) {
        saveDirty = false;
        save();
      }
    });
  }
  const S_MAX = 5;
  const clampS = s => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? {
      u: v,
      s: 1,
      x: 0,
      y: 0
    } : v;
  }
  function setSlot(id, val) {
    if (!id) return;
    if (val) {
      slots[id] = val;
      tombstones.delete(id);
    } else {
      delete slots[id];
      if (!loaded) tombstones.add(id);
    }
    subs.forEach(fn => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save();else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the
  // raw upload. Longest side is capped at 2× the slot's rendered width
  // (retina) and at MAX_DIM. WebP keeps alpha and is ~10× smaller than PNG
  // for photos, so there's no need for per-image format picking.
  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
  // Fill the container by default: slots are usually placed inside a
  // sized wrapper (a hero frame, a grid cell, an inset:0 layer) and are
  // expected to take that box — a fixed intrinsic size would render as
  // a small tile in the corner of a full-bleed wrapper instead.
  // aspect-ratio is the companion fallback that keeps a bare slot
  // visible when the parent's height is indefinite: height:100%
  // resolves to auto there, and the ratio then derives height from
  // width instead of letting the slot collapse to zero height.
  // Explicit width/height on the element override all of this.
  // color:inherit (not a fixed near-black): the placeholder chrome —
  // empty-state icon/caption (currentColor) and the dashed ring — must
  // read on dark decks too, and the slide's own text color is the one
  // color guaranteed to contrast with the slide background. The soft
  // look comes from opacity on those parts, not from a baked-in alpha.
  ':host{display:block;position:relative;' + '  font:13px/1.3 system-ui,-apple-system,sans-serif;' + '  width:100%;height:100%;aspect-ratio:3/2}' + '.empty .cap,.empty .sub{opacity:.75}' + '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(127,127,127,.08)}' +
  // .frame img (clipped) and .spill (unclipped ghost + handles) share the
  // same left/top/width/height in frame-%, computed by _applyView(), so the
  // inside-mask crop and the outside-mask spill stay pixel-aligned.
  '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' + '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
  // Reframe mode (double-click): the full image spills past the mask. The
  // spill layer is sized to the IMAGE bounds so its corners are where the
  // resize handles belong. The ghost <img> inside is translucent; the real
  // clipped <img> underneath shows the opaque in-mask crop.
  // popover=manual promotes the spill to the top layer on reframe, so it is
  // not clipped by any overflow:hidden / clip-path / scroll-container
  // ancestor (a plain z-index can't escape overflow clipping). UA popover
  // defaults (inset:0;margin:auto) are reset; _applyView sets viewport px.
  '.spill{position:fixed;margin:0;inset:auto;border:0;padding:0;background:transparent;' + '  overflow:visible;transform:translate(-50%,-50%);z-index:1;cursor:grab;touch-action:none}' + ':host([data-panning]) .spill{cursor:grabbing}' + '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' + '  pointer-events:none;-webkit-user-drag:none;user-select:none;' + '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' + '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' + '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' + '  transform:translate(-50%,-50%)}' + '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' + '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' + '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' + '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' + ':host([data-reframe]){z-index:10}' + ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' + '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' + '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' + '  cursor:pointer;user-select:none}' + '.empty svg{opacity:.45}' + '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' + '.empty .sub{font-size:11px}' + '.empty .sub u{text-underline-offset:2px}' + '.empty:hover .sub{opacity:1}' + ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' + '  background:rgba(201,100,66,.10)}' + '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed currentColor;' + '  opacity:.35;transition:border-color .12s,opacity .12s}' + ':host([data-over]) .ring{border-color:#c96442;opacity:1}' + ':host([data-filled]) .ring{display:none}' +
  // Controls overlay INSIDE the frame, pinned to the top-right corner, so
  // a full-bleed slot in an overflow:hidden container still shows them
  // (the old below-mask placement got clipped). Credit sits bottom-left,
  // so top-right avoids collision. The blurred pill background keeps them
  // legible over the image.
  // The UA [popover] base rule styles the element in EVERY state (only
  // display:none is gated on :not(:popover-open), and the display:flex
  // below overrides that) — so the UA resets live HERE, like .spill's,
  // or the ordinary hover-state strip renders as a bordered Canvas box
  // centered by margin:auto. inset:auto precedes top/right (shorthand).
  '.ctl{position:absolute;inset:auto;top:8px;right:8px;margin:0;border:0;padding:0;' + '  background:transparent;overflow:visible;' + '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' + '  white-space:nowrap}' +
  // While reframing, the spill owns the top layer and would swallow every
  // click on the in-frame controls. Promoting .ctl into the top layer
  // ABOVE the spill (shown after it — later popovers stack higher) keeps
  // Edit-as-toggle and Replace clickable mid-reframe. _applyView pins it
  // to the frame's top-right in viewport px (translateX(-100%)
  // right-aligns against the computed left edge); inset:auto clears the
  // base rule's top/right so the inline left/top position it alone.
  '.ctl:popover-open{position:fixed;inset:auto;transform:translateX(-100%)}' + ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' + '  {opacity:1;pointer-events:auto}' + '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' + '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' + '  backdrop-filter:blur(6px)}' + '.ctl button:hover{background:rgba(0,0,0,.8)}' + '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' + '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}' +
  // Replacement in flight: after a src swap the browser keeps painting
  // the PREVIOUS image until the new one decodes, so a Replace would
  // flash the old photo and then pop. Hide the stale frame (visibility,
  // not display — _applyView geometry still applies) and spin until the
  // new image reports in (load/error clears data-swapping).
  ':host([data-swapping]) .frame img{visibility:hidden}' + '.loading{position:absolute;inset:0;display:none;align-items:center;' + '  justify-content:center;pointer-events:none}' + ':host([data-swapping]) .loading{display:flex}' + '.loading::after{content:"";width:22px;height:22px;border-radius:50%;' + '  border:2px solid rgba(127,127,127,.25);border-top-color:currentColor;' + '  animation:om-slot-spin .7s linear infinite}' + '@keyframes om-slot-spin{to{transform:rotate(360deg)}}' +
  // Reduced motion: the static two-tone ring still reads as "working".
  '@media (prefers-reduced-motion:reduce){.loading::after{animation:none}}' + '.credit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:none;' + '  padding:3px 7px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;' + '  font:10px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;' + '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px)}' +
  // The credit is a SPAN holding one or two <a>s (Unsplash's prescribed
  // form links the photographer AND Unsplash) — anchors style inline so
  // the overlay reads as one line of text.
  '.credit a{color:inherit;text-decoration:none}' + '.credit a:hover,.credit a:focus-visible{text-decoration:underline}' + ':host([data-filled][data-credit]) .credit{display:block}' +
  // Exports must ship JUST the image — no hover controls, no credit chip
  // (the host marks <html data-om-exporting> for the capture window; the
  // page-level hide script can't reach shadow DOM, this rule can).
  ':host-context([data-om-exporting]) .ctl,' + ':host-context([data-om-exporting]) .credit{display:none !important}' +
  // Print must ship just the image too: the hover-gated controls can be
  // mid-hover when print() fires, and the credit chip is screen chrome —
  // the same rule the capture window gets, keyed on print media instead
  // of the host's data-om-exporting mark (the print path sets no mark).
  '@media print{.ctl,.credit{display:none !important}}' +
  // No export-window mask rules here on purpose: the export capture
  // releases the replacement mask by REMOVING data-swapping (the
  // shadow-root pass in pages/export/shared.ts HIDE_EXPORT_CHROME_SCRIPT)
  // — attribute removal works in every engine (:host-context is
  // Chromium-only), is scoped by construction to slots actually
  // mid-swap, and hides the spinner through the same gate. A masked img
  // would otherwise be silently dropped from PPTX decks (the capture
  // walk skips visibility:hidden imgs).
  // Attribution error tile: REPLACES the photo when an Unsplash src has
  // no credit attribute — rendering the photo uncredited is the terms
  // violation, so the photo must not appear at all.
  // Calm and neutral on purpose (review feedback): the tile informs the
  // user; the fix instructions are machine-facing (usage docblock, tool
  // description, and the turn-end scan's bounce copy name the attributes
  // for the agent).
  '.attr-error{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' + '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' + '  background:#f2f1ef;color:#6e6c66;user-select:none;' + '  font:13px/1.45 system-ui,-apple-system,sans-serif}' + '.attr-error svg{opacity:.55}' + '.attr-error .cap{max-width:92%;font-weight:500;letter-spacing:.01em}' + ':host([data-attribution-error]) .attr-error{display:flex}' + ':host([data-attribution-error]) .ring{display:none}';
  const icon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' + '<path d="m21 15-5-5L5 21"/></svg>';
  const warnIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' + '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'placeholder', 'src', 'id', 'credit', 'credit-href'];
    }

    /** Duplicate-slide hook (called by deck-stage, see its
     *  _remintDuplicateIds): copy this id's stored image, if any, under a
     *  freshly minted key and return that key — so a duplicated slide's
     *  slot keeps its dropped photo instead of reverting to the
     *  placeholder. 'isFree' is the caller's uniqueness check (document
     *  ids); candidates must ALSO be unused in the sidecar, which can
     *  hold keys from other pages sharing the project root. (An EMPTY
     *  slot on another page leaves no sidecar entry, so its id is not
     *  detectable here — a minted key can collide with it and that slot
     *  would show this photo. Same blast radius as two pages reusing an
     *  id by hand, which the shared sidecar already permits.) Returns null
     *  when no id could be minted (caller strips the id, today's
     *  behavior). */
    static cloneSlot(fromId, isFree) {
      if (typeof fromId !== 'string' || !fromId) return null;
      // Pre-hydration the store can't veto candidates or source the copy
      // — degrade to the strip (today's behavior) rather than mint
      // against keys we can't see yet. Any rendered (= droppable) slot
      // means load() has already settled.
      if (!loaded) return null;
      const stem = fromId.replace(/-\d+$/, '') || fromId;
      for (let n = 2; n < 100; n++) {
        const toId = stem + '-' + n;
        if (toId === fromId) continue;
        if (slots[toId] !== undefined) {
          // Reuse a key holding this exact value (bytes AND crop) if no
          // live element here owns it — a duplicate op the host refused
          // after minting leaves such a key behind, and reusing keeps
          // refused retries from accumulating one orphaned copy per
          // attempt. Full equality (not just bytes) so a byte-identical
          // key another PAGE owns with its own crop is stepped past, not
          // adopted or rewritten. (Entries without .u never match.)
          const prev = getSlot(toId);
          const cur = getSlot(fromId);
          if (!(prev && cur && prev.u && prev.u === cur.u && prev.s === cur.s && prev.x === cur.x && prev.y === cur.y && (typeof isFree !== 'function' || isFree(toId)))) continue;
          return toId;
        }
        if (typeof isFree === 'function' && !isFree(toId)) continue;
        const v = getSlot(fromId);
        if (v) setSlot(toId, Object.assign({}, v));
        return toId;
      }
      return null;
    }
    constructor() {
      super();
      // clonable: rail thumbnails deep-clone slides and carry this shadow
      // along; reuse an already-cloned root so upgrade-after-clone works.
      // (Deliberately NOT serializable — a getHTML consumer would embed
      // multi-MB sidecar data-URLs into serialized page HTML.)
      const root = this.shadowRoot || this.attachShadow({
        mode: 'open',
        clonable: true
      });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML = '<style>' + stylesheet + '</style>' + '<div class="frame" part="frame">' + '  <img part="image" alt="" draggable="false" style="display:none">' + '  <div class="empty" part="empty">' + icon + '    <div class="cap"></div>' + '    <div class="sub">or <u>browse files</u></div></div>' + '  <div class="attr-error" part="attribution-error">' + warnIcon + '    <div class="cap">This photo needs attribution</div></div>' + '  <div class="loading" part="loading"></div>' + '  <div class="ring" part="ring"></div>' + '</div>' +
      // Outside .frame, like .spill/.ctl — the frame's overflow:hidden +
      // border-radius/clip-path would cut the credit off on circle/pill/mask.
      // A SPAN, not an <a>: the prescribed Unsplash credit holds two links
      // (photographer + Unsplash), built per-render in _render().
      '<span class="credit" part="credit"></span>' + '<div class="spill" popover="manual" data-dc-edit-transparent>' + '  <img class="ghost" alt="" draggable="false">' + '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' + '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' + '</div>' +
      // data-dc-edit-transparent: the DC editor's edit-mode picker lets
      // clicks through for chrome marked with it (EDIT_TRANSPARENT_SEL)
      // — without it, Replace/Edit clicks in Edit mode are swallowed by
      // element selection and the controls look dead.
      '<div class="ctl" popover="manual" data-dc-edit-transparent><button data-act="replace" title="Replace image">Replace</button>' + '  <button data-act="edit" title="Reframe image">Edit</button></div>' + '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._ctl = root.querySelector('.ctl');
      this._credit = root.querySelector('.credit');
      this._attrError = root.querySelector('.attr-error');
      // Credit clicks open the link, not browse/reframe.
      this._credit.addEventListener('click', e => e.stopPropagation());
      this._credit.addEventListener('dblclick', e => e.stopPropagation());
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      // Encode-in-flight marker (the owning _ingest generation): while set,
      // the same-src "nothing in flight" clear in _render must not fire —
      // the stored value still points at the OLD image until the encode
      // lands, so that clear would unmask the stale image mid-replace.
      this._swapGen = 0;
      // Render-owned swap in flight: set when _render assigns a new src,
      // cleared only by the img's own load/error (or the empty branch).
      // img.complete CANNOT stand in for this — setting src only QUEUES
      // the current-request swap (a microtask), so synchronously after an
      // assignment, complete still reports the OLD settled request. The
      // pick path does exactly that: the host sets src, credit, and
      // credit-href back-to-back in one task, and renders #2/#3 would
      // read the stale complete === true and drop the mask one render
      // after it was set.
      this._loadPending = false;
      // See _render's empty branch: a transient attribution-error wipe of a
      // showing image must make the follow-up render a replacement (spinner),
      // not a first fill (blank frame).
      this._hidShowing = false;
      this._view = {
        s: 1,
        x: 0,
        y: 0
      };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', e => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        // The hidden controls are opacity-0 but still tabbable — without
        // this gate a keyboard user could drive them on a read-only share
        // link (mirrors the dblclick handler's editable gate).
        if (!this.hasAttribute('data-editable')) return;
        if (act === 'replace') {
          this._exitReframe(true);
          // Host-owned picker (Unsplash modal; it also offers local import).
          this.dispatchEvent(new CustomEvent('image-slot:pick', {
            bubbles: true,
            composed: true,
            detail: {
              id: this.id || null
            }
          }));
        }
        if (act === 'edit') {
          if (!this._reframes()) return;
          if (this.hasAttribute('data-reframe')) this._exitReframe(true);else this._enterReframe();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      // load/error also release the replacement-in-flight mask (via the
      // single discipline in _releaseMask): the swap is only revealed once
      // the new image can actually paint (on error the frame shows its
      // background, same as a fresh slot with a broken src).
      this._img.addEventListener('load', () => {
        this._loadPending = false;
        this._releaseMask(true);
        this._applyView();
      });
      this._img.addEventListener('error', () => {
        this._loadPending = false;
        this._releaseMask(true);
      });
      // Gated only on editable — any filled slot can be repositioned/scaled,
      // regardless of fit. Share links (no writeFile) stay static.
      this.addEventListener('dblclick', e => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1,
          fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1,
            ih = this._img.naturalHeight || 1;
          const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
          const base = contain ? Math.min(fw / iw, fh / ih) : Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0,
            h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2,
            oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0,
            uy = sy * h0 / diag0;
          move = ev => {
            const proj = (ev.clientX - rect.left - ox) * ux + (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = {
            px: e.clientX,
            py: e.clientY,
            x: this._view.x,
            y: this._view.y
          };
          move = ev => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try {
            this._spill.releasePointerCapture(e.pointerId);
          } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', e => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, {
        passive: false
      });
    }
    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // The host may inject window.omelette.writeFile AFTER the first render;
      // re-render on hover so the editable-gated controls reliably appear.
      this.addEventListener('pointerenter', this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }
    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('pointerenter', this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) {
        this._ro.disconnect();
        this._ro = null;
      }
      // commit=false: a disconnect is not a user intent — committing here
      // would persist whatever half-finished drag a React remount or DOM
      // splice happened to interrupt. Deliberate exits commit on their own
      // paths (Escape/click-out/toggle), and unloads commit via pagehide.
      this._exitReframe(false);
    }
    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._signalReframe(true);
      // Best-effort commit when the document unloads mid-reframe (a host
      // navigation racing the enter signal, a manual reload, tab close):
      // the sidecar write rides the host bridge, which outlives this
      // document, so the crop survives even though the mode dies with the
      // DOM. Held on the instance so _exitReframe detaches exactly what
      // was attached.
      this._pagehide = () => {
        this._exitReframe(true);
        flushNow();
      };
      window.addEventListener('pagehide', this._pagehide);
      // Promote spill to the top layer, then keep it pinned over the frame:
      // scroll/resize cover the common cases, and a per-frame rect check
      // catches layout shifts that fire neither (an image above finishing
      // load, streamed DOM pushing the slot down, an ancestor transform
      // change) so the overlay can't detach from the frame.
      try {
        this._spill.showPopover();
      } catch {}
      // After the spill, so the controls stack above it in the top layer.
      try {
        this._ctl.showPopover();
      } catch {}
      this._reposition = () => {
        if (this.hasAttribute('data-reframe')) this._applyView();
      };
      window.addEventListener('scroll', this._reposition, true);
      window.addEventListener('resize', this._reposition);
      this._lastRect = '';
      this._watch = () => {
        if (!this.hasAttribute('data-reframe')) return;
        const r = this.getBoundingClientRect();
        const key = r.left + ',' + r.top + ',' + r.width + ',' + r.height;
        if (key !== this._lastRect) {
          this._lastRect = key;
          this._applyView();
        }
        this._watchId = requestAnimationFrame(this._watch);
      };
      this._watchId = requestAnimationFrame(this._watch);
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = e => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = e => {
        if (e.key === 'Escape') this._exitReframe(true);
      };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }
    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (this._reposition) {
        window.removeEventListener('scroll', this._reposition, true);
        window.removeEventListener('resize', this._reposition);
        this._reposition = null;
      }
      if (this._watchId) {
        cancelAnimationFrame(this._watchId);
        this._watchId = 0;
      }
      if (this._pagehide) {
        window.removeEventListener('pagehide', this._pagehide);
        this._pagehide = null;
      }
      try {
        this._spill.hidePopover();
      } catch {}
      try {
        this._ctl.hidePopover();
      } catch {}
      this._ctl.style.left = '';
      this._ctl.style.top = '';
      if (commit) this._commitView();
      this._signalReframe(false);
    }

    // Reframe state lives only in this DOM until commit, invisible to the
    // host's dirty signals — announce enter/exit so the host can hold
    // auto-reloads for exactly the gesture (the guest bundle forwards
    // image-slot:reframe to the host as imageSlotReframe). Dispatched on
    // the element (composed, so it escapes shadow roots) while connected;
    // a disconnected exit (disconnectedCallback) falls back to document so
    // the host still hears it.
    _signalReframe(active) {
      const target = this.isConnected ? this : document;
      target.dispatchEvent(new CustomEvent('image-slot:reframe', {
        bubbles: true,
        composed: true,
        detail: {
          active: active,
          id: this.id || null
        }
      }));
    }

    // Public: host's "Import from computer" calls this to run local browse.
    openFilePicker() {
      this._exitReframe(true);
      this._input.click();
    }

    // A src write is a newer intent for this slot's content — the host
    // pick path (setImageSlotImage) or an agent edit — so it must win
    // over any encode still in flight from an earlier drop: left live,
    // that encode lands later, passes _ingest's gen guard, and its
    // setSlot silently overwrites the pick (the stored value shadows
    // src in _render). Bumping _gen kills the encode before its own
    // _swapGen clear runs, so clear the dead claim here too — otherwise
    // _releaseMask (gated on !_swapGen) never fires and the pick's
    // spinner is stranded. src ONLY: the pick sets credit/credit-href
    // in the same task, and clearing _swapGen on those would let the
    // same-src branch unmask the old image mid-encode.
    attributeChangedCallback(name, oldVal, newVal) {
      if (name === 'src' && oldVal !== newVal) {
        this._gen++;
        this._swapGen = 0;
      }
      if (this.shadowRoot) this._render();
    }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) {
          this._depth = 0;
          this.removeAttribute('data-over');
        }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }
    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      // Replacing a shown image: surface the swap through the encode too,
      // not just the decode — otherwise the old photo sits there with no
      // feedback while the canvas re-encode runs. An empty slot keeps its
      // placeholder (no spinner) until the encode lands, as before.
      // _swapGen guards the mask against re-renders DURING the encode
      // (pointerenter, ResizeObserver, another slot's store write): the
      // stored value still resolves to the old image there, so _render's
      // same-src clear would otherwise unmask it mid-replace.
      if (this.hasAttribute('data-filled')) {
        this.setAttribute('data-swapping', '');
        this._swapGen = gen;
      }
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        // Clear BEFORE setSlot: its synchronous re-render must see no
        // pending encode, so a byte-identical re-upload (same data URL, no
        // load event coming) still clears the mask via the complete branch.
        this._swapGen = 0;
        const val = {
          u: url,
          s: 1,
          x: 0,
          y: 0
        };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) {
          this._local = val;
          this._render();
        }
      } catch (err) {
        if (gen !== this._gen) return;
        this._swapGen = 0;
        // Reveal the kept old image — unless another replacement (a
        // remote pick's src swap) is still in flight, in which case the
        // mask stays until THAT image settles (its load/error releases).
        this._releaseMask();
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }
    _setError(msg) {
      if (this._err) {
        this._err.remove();
        this._err = null;
      }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => {
        if (this._err === d) {
          d.remove();
          this._err = null;
        }
      }, 3000);
    }

    // Reframing (pan/resize) is available on any filled slot — the user can
    // always reposition/scale. `fit` only sets the initial baseline (see
    // _geom): contain starts fully-visible, cover starts frame-filling.
    _reframes() {
      return this.hasAttribute('data-filled');
    }

    // The single release discipline for the replacement-in-flight mask
    // (data-swapping). The mask comes off only when BOTH hold:
    //  - no encode is pending (_swapGen) — mid-encode the stored value
    //    still resolves to the old image, so any reveal paints it;
    //  - the frame img has settled on its current src — an unsettled src
    //    means some replacement is still in flight (e.g. a remote pick),
    //    whoever started it, and revealing would paint the previous
    //    frame. The load/error listeners pass settled=true (the event IS
    //    the settlement signal, per spec complete is true by then);
    //    other callers rely on the complete flag (covers loaded AND
    //    failed).
    // Every release path funnels through here EXCEPT _render's empty
    // branch (the img is being cleared — nothing will ever settle).
    _releaseMask(settled) {
      if (!this._swapGen && !this._loadPending && (settled || this._img.complete)) {
        this.removeAttribute('data-swapping');
      }
    }

    // Baseline geometry, shared by clamp/apply/resize. `base` is the scale at
    // view-scale s=1: cover = fill the frame (overflow on the looser axis),
    // contain = fit fully inside (letterboxed). Zooming a contain image past
    // s where it overflows naturally becomes a crop. Null until the img has
    // loaded (naturalWidth is 0 before that) or when the slot has no layout
    // box — ResizeObserver fires with a 0×0 rect under display:none, and
    // clamping against a degenerate 1×1 frame would silently pull the stored
    // pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth,
        ih = this._img.naturalHeight;
      const fw = this.clientWidth,
        fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
      const base = contain ? Math.min(fw / iw, fh / ih) : Math.max(fw / iw, fh / ih);
      return {
        iw,
        ih,
        fw,
        fh,
        base
      };
    }
    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }
    _applyView() {
      const g = this._geom();
      // Top-layer controls: pin to the frame's top-right in viewport px
      // (the same 8px inset as the in-frame layout; unscaled — top-layer UI
      // reads as chrome, not page content). BEFORE the geometry branch:
      // placement needs only the frame rect, and a not-yet-loaded or broken
      // src must not leave the promoted strip floating unpositioned. Gated
      // on the popover actually being open: without the Popover API,
      // showPopover() threw (swallowed in _enterReframe), .ctl stays in
      // its in-frame absolute layout, and viewport-px coordinates would
      // shove it off-frame — and matches(':popover-open') itself throws
      // there (unknown pseudo-class), hence the try/catch.
      if (this.hasAttribute('data-reframe')) {
        let onTop = false;
        try {
          onTop = this._ctl.matches(':popover-open');
        } catch {}
        if (onTop) {
          const r = this.getBoundingClientRect();
          this._ctl.style.left = r.right - 8 + 'px';
          this._ctl.style.top = r.top + 8 + 'px';
        }
      }
      if (!g) {
        // Dimensions not known yet (before img load) — centered fit so there
        // is no flash of an unpositioned image before the geometry lands.
        const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = contain ? 'contain' : 'cover';
        return;
      }
      // Baseline (cover-fill or contain-fit) × view scale. Width/height and
      // left/top are all frame-% — depends only on the frame aspect ratio, so
      // a responsive resize keeps the same crop. The spill layer mirrors the
      // same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = g.iw * k / g.fw * 100 + '%';
      const h = g.ih * k / g.fh * 100 + '%';
      const l = 50 + this._view.x + '%';
      const t = 50 + this._view.y + '%';
      this._img.style.width = w;
      this._img.style.height = h;
      this._img.style.left = l;
      this._img.style.top = t;
      this._img.style.objectFit = '';
      if (this.hasAttribute('data-reframe')) {
        // Top-layer spill: position in viewport px over the frame. The top
        // layer escapes ancestor transforms entirely, so EVERY term must be
        // in viewport units: getBoundingClientRect gives the frame's scaled
        // origin AND size, and the rect/layout ratio rescales the ghost —
        // sizing from layout px alone renders it 1/scale too large under a
        // scaled deck slide. Inner ghost + handles stay box-relative.
        const r = this.getBoundingClientRect();
        const sx = g.fw ? r.width / g.fw : 1;
        const sy = g.fh ? r.height / g.fh : 1;
        this._spill.style.width = g.iw * k * sx + 'px';
        this._spill.style.height = g.ih * k * sy + 'px';
        this._spill.style.left = r.left + (50 + this._view.x) / 100 * r.width + 'px';
        this._spill.style.top = r.top + (50 + this._view.y) / 100 * r.height + 'px';
      }
    }
    _commitView() {
      const v = {
        s: this._view.s,
        x: this._view.x,
        y: this._view.y
      };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);else {
        this._local = v;
      }
    }
    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';else if (shape === 'pill') radius = '9999px';else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = stored && stored.u || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        this._view = {
          s: stored && Number.isFinite(stored.s) ? clampS(stored.s) : 1,
          x: stored && Number.isFinite(stored.x) ? stored.x : 0,
          y: stored && Number.isFinite(stored.y) ? stored.y : 0
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      // An Unsplash src with no credit attribute must NOT render — showing
      // the photo uncredited is the Unsplash-terms violation itself. The
      // error tile replaces the photo until the credit is written. A
      // user-dropped image is the user's own content and always renders.
      // Trimmed: credit is agent/user-editable content, and a whitespace-
      // only value must count as missing — otherwise it would suppress the
      // error tile AND render an empty credit box (no text, no links),
      // exactly the unattributed state this gate exists to prevent.
      const credit = (this.getAttribute('credit') || '').trim();
      const attrError = !!(!credit && !this._userUrl && srcAttr && isUnsplashHost(srcAttr));
      this.toggleAttribute('data-attribution-error', attrError);
      if (url && !attrError) {
        const prev = this._img.getAttribute('src');
        if (prev !== url) {
          // Replacing an already-shown image: mark the swap BEFORE setting
          // src so the stale frame is never revealed (see the data-swapping
          // stylesheet rules). First fill (prev empty) keeps the existing
          // placeholder-until-load behavior — no spinner. _hidShowing
          // covers the pick path's transient attribution-error wipe: prev
          // is gone, but an image WAS showing, so this is a replacement.
          if (prev || this._hidShowing) this.setAttribute('data-swapping', '');
          // Mark the swap BEFORE assigning src: complete keeps reporting
          // the old settled request until the browser's
          // update-the-image-data microtask runs, so same-task re-renders
          // (the pick path's credit/credit-href setAttributes) need this
          // flag, not complete, to know a load is in flight.
          this._loadPending = true;
          this._img.src = url;
          this._ghost.src = url;
        } else {
          // Same-src re-render — release if settled, so an ingest-set
          // spinner can't stick after a byte-identical re-upload (same
          // data URL, no further load event ever fires).
          this._releaseMask();
        }
        this._hidShowing = false;
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this.removeAttribute('data-swapping');
        // The src is being removed — no load/error will ever fire for it.
        this._loadPending = false;
        // A transient attribution-error wipe of a showing image happens on
        // the pick path: the host sets src one setAttribute before credit,
        // so render N hides the old image (attrError) and render N+1
        // restores a URL. Remember the wipe so that restore renders as a
        // replacement (spinner), not a first fill (blank frame).
        this._hidShowing = attrError && !!this._img.getAttribute('src');
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        // The error tile owns the blocked-photo state; .empty stays for
        // the genuinely-empty slot.
        this._empty.style.display = attrError ? 'none' : 'flex';
        this.removeAttribute('data-filled');
      }

      // Credit belongs to the author src, so a user drop hides it.
      // textContent + the http(s)-only funnel keep external strings inert.
      const showCredit = !!(url && credit && !this._userUrl && !attrError);
      this._credit.textContent = '';
      if (showCredit) {
        // Validate once (resolved against the document, http(s) only),
        // then append the terms-required utm referral params to links
        // that point back at unsplash.com.
        let href = '';
        const rawHref = this.getAttribute('credit-href') || '';
        if (rawHref) {
          try {
            const u = new URL(rawHref, document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              href = withReferral(u.href);
            }
          } catch {}
        }
        const mkLink = (text, linkHref) => {
          const a = document.createElement('a');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          a.setAttribute('href', linkHref);
          a.textContent = text;
          return a;
        };
        // Unsplash's prescribed credit is TWO links — the photographer's
        // name to their profile (credit-href) and 'Unsplash' to the
        // homepage. Render that split whenever the text has the canonical
        // shape; other text keeps the legacy single-link rendering.
        const m = /^Photo by (.+) on Unsplash$/.exec(credit);
        if (m) {
          this._credit.appendChild(document.createTextNode('Photo by '));
          this._credit.appendChild(href ? mkLink(m[1], href) : document.createTextNode(m[1]));
          this._credit.appendChild(document.createTextNode(' on '));
          this._credit.appendChild(mkLink('Unsplash', UNSPLASH_HOMEPAGE_HREF));
        } else if (href) {
          this._credit.appendChild(mkLink(credit, href));
        } else {
          this._credit.textContent = credit;
        }
      }
      this.toggleAttribute('data-credit', showCredit);
    }
  }
  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/site/image-slot.js", error: String((e && e.message) || e) }); }

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Separator = __ds_scope.Separator;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.ApprovalCard = __ds_scope.ApprovalCard;

__ds_ns.CommandPalette = __ds_scope.CommandPalette;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.ReplyDraftCard = __ds_scope.ReplyDraftCard;

__ds_ns.RunSummary = __ds_scope.RunSummary;

__ds_ns.RunStep = __ds_scope.RunStep;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.SlaBadge = __ds_scope.SlaBadge;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.TicketsTable = __ds_scope.TicketsTable;

__ds_ns.TimelineEntry = __ds_scope.TimelineEntry;

})();
