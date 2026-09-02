// Color-contrast audit for Servo's theme tokens (light + dark + banner).
// Converts oklch() to sRGB and computes WCAG 2.1 contrast ratios for every
// foreground/background pairing the UI actually uses.
// Usage: node scripts/color-audit.mjs

// ---- oklch -> sRGB ----------------------------------------------------------
function oklchToSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  // OKLab -> LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  // LMS -> linear sRGB
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  return [clamp(r), clamp(g), clamp(bl)];
}

function hexToLinear(hex) {
  const n = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return v;
}

function toHex(rgb) {
  return (
    "#" +
    rgb
      .map((x) => {
        const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

function luminanceFromLinear([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function luminanceFromHex(hex) {
  const srgb = hexToLinear(hex);
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return luminanceFromLinear(lin);
}

function contrast(l1, l2) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

// alpha-composite fg over bg (both linear rgb triples)
function composite(fg, alpha, bg) {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
}

// ---- token definitions (mirror globals.css) --------------------------------
const okl = (L, C, H) => ({ type: "oklch", L, C, H });
const hex = (v) => ({ type: "hex", v });

const LIGHT = {
  background: okl(0.988, 0.004, 160),
  foreground: okl(0.35, 0.02, 165.48),
  card: okl(1, 0, 0),
  primary: okl(0.64, 0.165, 154),
  "primary-foreground": okl(0.16, 0.035, 168),
  "primary-strong": okl(0.46, 0.12, 157),
  secondary: okl(0.9, 0.02, 238.66),
  "secondary-foreground": okl(0.2, 0.02, 266.02),
  muted: okl(0.9, 0.02, 240.73),
  "muted-foreground": okl(0.47, 0.03, 268.53),
  accent: okl(0.93, 0.045, 158),
  "accent-foreground": okl(0.32, 0.06, 163),
  destructive: okl(0.55, 0.22, 22),
  border: okl(0.94, 0.01, 238.46),
  input: okl(0.85, 0.02, 240.75),
  sidebar: okl(0.26, 0.055, 158),
  "sidebar-foreground": okl(0.94, 0.014, 160),
  "sidebar-accent": okl(0.33, 0.065, 158),
  "sidebar-accent-foreground": okl(0.97, 0.014, 160),
  "chart-1": okl(0.62, 0.16, 154),
  "chart-2": okl(0.5, 0.1, 270.06),
  "chart-3": okl(0.58, 0.11, 202),
  "chart-4": okl(0.63, 0.11, 90),
  "chart-5": okl(0.6, 0.15, 300.14),
  good: okl(0.45, 0.13, 155),
  "good-soft": okl(0.94, 0.05, 153),
  warn: okl(0.49, 0.1, 78),
  "warn-soft": okl(0.96, 0.06, 90),
  serious: okl(0.5, 0.14, 42),
  "serious-soft": okl(0.95, 0.04, 45),
  critical: okl(0.5, 0.2, 25),
  "critical-soft": okl(0.95, 0.03, 20),
  violet: okl(0.48, 0.15, 295),
  "violet-soft": okl(0.94, 0.04, 295),
};

const DARK = {
  background: okl(0.15, 0.006, 170),
  foreground: okl(0.95, 0.008, 165),
  card: okl(0.2, 0.007, 170),
  primary: okl(0.64, 0.165, 154),
  "primary-foreground": okl(0.15, 0.006, 170),
  "primary-strong": okl(0.75, 0.15, 155),
  secondary: okl(0.3, 0.012, 170),
  "secondary-foreground": okl(0.95, 0.008, 165),
  muted: okl(0.3, 0.012, 170),
  "muted-foreground": okl(0.68, 0.015, 170),
  accent: okl(0.32, 0.05, 168),
  "accent-foreground": okl(0.95, 0.02, 160),
  destructive: okl(0.64, 0.25, 19.69),
  sidebar: okl(0.2, 0.042, 162),
  "sidebar-foreground": okl(0.94, 0.014, 160),
  "sidebar-accent": okl(0.27, 0.055, 160),
  "sidebar-accent-foreground": okl(0.97, 0.014, 160),
  "chart-1": okl(0.67, 0.17, 153.85),
  "chart-2": okl(0.6, 0.1, 269.83),
  "chart-3": okl(0.72, 0.12, 201.79),
  "chart-4": okl(0.8, 0.1, 100.65),
  "chart-5": okl(0.6, 0.15, 300.14),
  good: okl(0.8, 0.14, 155),
  "good-soft": okl(0.26, 0.05, 155),
  warn: okl(0.85, 0.11, 90),
  "warn-soft": okl(0.28, 0.05, 85),
  serious: okl(0.8, 0.12, 50),
  "serious-soft": okl(0.27, 0.05, 45),
  critical: okl(0.82, 0.14, 22),
  "critical-soft": okl(0.28, 0.08, 25),
  violet: okl(0.82, 0.09, 295),
  "violet-soft": okl(0.29, 0.06, 295),
};

const BANNER = {
  "bg-top": hex("#0B1512"),
  "bg-bottom": hex("#10231B"),
  headline: hex("#F3FBF6"),
  tagline: hex("#9DB8A9"),
  monoline: hex("#7FA893"),
  green: hex("#12B76A"),
  grid: hex("#1C3A2C"),
};

function resolve(tok) {
  if (tok.type === "hex") {
    const lin = hexToLinear(tok.v).map((c) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return { lin, hexv: tok.v };
  }
  const lin = oklchToSrgb(tok.L, tok.C, tok.H);
  return { lin, hexv: toHex(lin) };
}

function pair(theme, fgName, bgName, need, note = "", alpha = 1) {
  const fg = resolve(theme[fgName]);
  const bgTok = resolve(theme[bgName]);
  let fgLin = fg.lin;
  if (alpha < 1) fgLin = composite(fg.lin, alpha, bgTok.lin);
  const ratio = contrast(luminanceFromLinear(fgLin), luminanceFromLinear(bgTok.lin));
  const ok = ratio >= need;
  return {
    pairing: `${fgName}${alpha < 1 ? `@${alpha}` : ""} on ${bgName}`,
    fg: fg.hexv,
    bg: bgTok.hexv,
    ratio: ratio.toFixed(2),
    need,
    result: ok ? "PASS" : "FAIL",
    note,
  };
}

function bannerPair(fgName, bgName, need, note = "") {
  const fg = resolve(BANNER[fgName]);
  const bg = resolve(BANNER[bgName]);
  const ratio = contrast(luminanceFromLinear(fg.lin), luminanceFromLinear(bg.lin));
  return {
    pairing: `${fgName} on ${bgName}`,
    fg: fg.hexv,
    bg: bg.hexv,
    ratio: ratio.toFixed(2),
    need,
    result: ratio >= need ? "PASS" : "FAIL",
    note,
  };
}

const checks = [];
for (const [name, theme] of [["LIGHT", LIGHT], ["DARK", DARK]]) {
  const rows = [
    pair(theme, "foreground", "background", 4.5, "body text"),
    pair(theme, "foreground", "card", 4.5, "card text"),
    pair(theme, "muted-foreground", "background", 4.5, "secondary text"),
    pair(theme, "muted-foreground", "card", 4.5, "secondary text on card"),
    pair(theme, "muted-foreground", "muted", 4.5, "text inside muted chips/pre"),
    pair(theme, "primary-foreground", "primary", 4.5, "BUTTON TEXT (Approve/New ticket)"),
    pair(theme, "primary", "background", 3.0, "primary fills (buttons, bars)"),
    pair(theme, "primary-strong", "card", 4.5, "green as TEXT (links/hover)"),
    pair(theme, "primary-strong", "background", 4.5, "green as TEXT on page bg"),
    pair(theme, "accent-foreground", "accent", 4.5, "menu hover text"),
    pair(theme, "secondary-foreground", "secondary", 4.5, "secondary button text"),
    pair(theme, "sidebar-foreground", "sidebar", 4.5, "sidebar nav text"),
    pair(theme, "sidebar-foreground", "sidebar", 4.5, "sidebar 65% captions", 0.65),
    pair(theme, "sidebar-foreground", "sidebar", 3.0, "sidebar 50% micro-captions", 0.5),
    pair(theme, "sidebar-accent-foreground", "sidebar-accent", 4.5, "active nav item"),
    pair(theme, "good", "good-soft", 4.5, "badge: resolved/QA pass"),
    pair(theme, "warn", "warn-soft", 4.5, "badge: waiting approval"),
    pair(theme, "serious", "serious-soft", 4.5, "badge: open/high"),
    pair(theme, "critical", "critical-soft", 4.5, "badge: urgent/failed"),
    pair(theme, "violet", "violet-soft", 4.5, "badge: in progress"),
    pair(theme, "good", "card", 4.5, "tone as text on card"),
    pair(theme, "warn", "card", 4.5, "tone as text on card"),
    pair(theme, "critical", "card", 4.5, "tone as text on card"),
    pair(theme, "chart-1", "card", 3.0, "chart series marks"),
    pair(theme, "chart-2", "card", 3.0, "chart series marks"),
    pair(theme, "chart-4", "card", 3.0, "chart series marks"),
    pair(theme, "destructive", "card", 4.5, "destructive as text/alert"),
  ];
  checks.push([name, rows]);
}
checks.push([
  "BANNER",
  [
    bannerPair("headline", "bg-top", 4.5, "wordmark"),
    bannerPair("tagline", "bg-bottom", 4.5, "tagline small text"),
    bannerPair("monoline", "bg-bottom", 4.5, "mono footer line"),
    bannerPair("green", "bg-top", 3.0, "green accent dot"),
  ],
]);

for (const [name, rows] of checks) {
  console.log(`\n=== ${name} ===`);
  for (const r of rows) {
    console.log(
      `${r.result === "FAIL" ? "❌" : "✅"} ${r.ratio.padStart(6)} (need ${r.need})  ${r.pairing}  [${r.fg} / ${r.bg}]  ${r.note}`,
    );
  }
}
