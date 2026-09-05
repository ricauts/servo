// A visible pointer that is not the OS cursor (headless has none), plus eased
// scrolling and a click pulse. Injected with evaluateOnNewDocument so it exists
// before any page script and survives navigation.
export const CURSOR = () => {
  const dot = document.createElement("div");
  dot.style.cssText =
    "position:fixed;z-index:2147483647;width:14px;height:14px;border-radius:50%;" +
    "background:#FFFFFF;opacity:.85;pointer-events:none;left:1200px;top:700px;transform:translate(-50%,-50%);" +
    "box-shadow:0 0 0 1px rgba(0,0,0,.35)";
  const ring = document.createElement("div");
  ring.style.cssText =
    "position:fixed;z-index:2147483646;width:14px;height:14px;border-radius:50%;" +
    "border:2px solid #4E66E4;pointer-events:none;opacity:0;transform:translate(-50%,-50%)";
  const mount = () => document.body && document.body.append(dot, ring);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount);
  else mount();

  const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  const anim = (ms, step) =>
    new Promise((done) => {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        step(ease(p));
        p < 1 ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });

  window.__moveTo = async (x, y, ms = 620) => {
    const x0 = parseFloat(dot.style.left);
    const y0 = parseFloat(dot.style.top);
    await anim(ms, (p) => {
      dot.style.left = x0 + (x - x0) * p + "px";
      dot.style.top = y0 + (y - y0) * p + "px";
    });
  };

  window.__pulse = async (x, y) => {
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    await anim(420, (p) => {
      ring.style.opacity = String(0.9 * (1 - p));
      ring.style.width = ring.style.height = 14 + 34 * p + "px";
    });
    ring.style.opacity = "0";
  };

  // Returns false instead of throwing: a missing button should shorten the take,
  // not kill a recording that is already 15 seconds in.
  window.__clickText = async (text) => {
    const el = [...document.querySelectorAll("button,a,[role='button']")].find(
      (c) => c.textContent.trim() === text || c.textContent.trim().startsWith(text),
    );
    if (!el) {
      console.warn("record: no control matching", text);
      return false;
    }
    el.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise((r) => setTimeout(r, 120));
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    await window.__moveTo(x, y);
    await new Promise((r2) => setTimeout(r2, 600));
    window.__pulse(x, y);
    el.click();
    return true;
  };

  window.__smoothScroll = (dy, ms) => {
    const y0 = scrollY;
    return anim(ms, (p) => scrollTo(0, y0 + dy * p));
  };

  window.__scrollTop = (y, ms) => {
    const y0 = scrollY;
    return anim(ms, (p) => scrollTo(0, y0 + (y - y0) * p));
  };
};
