export type PageRect = { x: number; y: number; width: number; height: number };

export type PageView = { scrollX: number; scrollY: number; innerWidth: number; innerHeight: number; dpr: number };

export type CaptureAnswer =
  | ({ kind: "region" | "element"; rect: PageRect } & PageView)
  | { kind: "visible" }
  | { kind: "fullPage" }
  | { kind: "cancel" }
  | { kind: "superseded" }
  | { kind: "stopped" };

export const MIN_DRAG = 4;

export function captureScript(key: string, options: { stop?: boolean }): string {
  return `const key = ${JSON.stringify(key)};
const options = ${JSON.stringify(options)};
const MIN_DRAG = ${MIN_DRAG};
const answer = (fn, value) => fn("result", JSON.stringify(value));
let s = window[key];
if (s && s.pending) {
  const pending = s.pending;
  s.pending = null;
  answer(pending, { kind: "superseded" });
}
if (options.stop) {
  if (s) s.teardown();
  answer(post, { kind: "stopped" });
  return;
}
if (s) {
  if (s.queued) {
    const value = s.queued;
    delete window[key];
    answer(post, value);
  } else s.pending = post;
  return;
}
const host = document.createElement("orbit-capture");
host.setAttribute("tabindex", "-1");
host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; display: block; cursor: crosshair; outline: none;";
const root = host.attachShadow({ mode: "closed" });
const make = (name, cls, text) => {
  const el = document.createElement(name);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};
const css = make("style");
css.textContent = \`
  :host { all: initial; }
  .shade { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.3); pointer-events: none; }
  .hole { position: fixed; display: none; pointer-events: none; box-sizing: border-box; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.3); }
  .hole.element { border: 2px solid #0A84FF; border-radius: 3px; background: rgba(10, 132, 255, 0.08); }
  .hole.region { border: 1px solid rgba(255, 255, 255, 0.95); outline: 1px solid rgba(0, 0, 0, 0.35); }
  .size { position: fixed; display: none; pointer-events: none; font: 600 11px/16px -apple-system, system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #fff; background: rgba(20, 20, 20, 0.85); padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
  .bar { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); cursor: default; display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 14px; border-radius: 12px; background: rgba(30, 30, 30, 0.92); color: #fff; font: 500 13px/18px -apple-system, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); white-space: nowrap; }
  .hint { margin-right: 6px; color: rgba(255, 255, 255, 0.85); }
  button { all: unset; cursor: default; padding: 4px 10px; border-radius: 7px; font: 500 13px/18px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(255, 255, 255, 0.14); }
  button:hover { background: rgba(255, 255, 255, 0.22); }
\`;
const shade = make("div", "shade");
const hole = make("div", "hole");
const size = make("div", "size");
const bar = make("div", "bar");
const hint = make("span", "hint", "Drag to capture an area, or click an element");
const visible = make("button", "", "Visible Area");
const full = make("button", "", "Full Page");
const cancel = make("button", "", "Cancel");
bar.append(hint, visible, full, cancel);
root.append(css, shade, hole, size, bar);
const previousFocus = document.activeElement;
(document.body || document.documentElement).appendChild(host);
try {
  host.focus({ preventScroll: true });
} catch (e) {}
let drag = null;
let hovered = null;
let finished = false;
const ours = (e) => {
  const r = bar.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};
const place = (r, kind) => {
  if (!r) {
    hole.style.display = "none";
    shade.style.display = "block";
    size.style.display = "none";
    return;
  }
  shade.style.display = "none";
  hole.className = "hole " + kind;
  Object.assign(hole.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
  if (kind !== "region") {
    size.style.display = "none";
    return;
  }
  size.textContent = Math.round(r.width) + " × " + Math.round(r.height);
  size.style.display = "block";
  const below = r.y + r.height + 6;
  const top = below + 20 > innerHeight ? Math.max(4, r.y - 26) : below;
  const left = Math.min(Math.max(4, r.x + r.width - size.offsetWidth), innerWidth - size.offsetWidth - 4);
  Object.assign(size.style, { left: left + "px", top: top + "px" });
};
const REPLACED = new Set(["img", "video", "canvas", "svg", "iframe", "picture", "embed", "object"]);
const pickable = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 24 || r.height < 16) return false;
  if (REPLACED.has(String(el.localName).toLowerCase())) return true;
  const display = getComputedStyle(el).display;
  return display !== "inline" && display !== "contents";
};
const elementAt = (x, y) => {
  const hit = document.elementsFromPoint(x, y).find((el) => el !== host && el !== document.documentElement && el !== document.body);
  let el = hit || null;
  while (el && el !== document.body && el !== document.documentElement && !pickable(el)) el = el.parentElement;
  return el && el !== document.body && el !== document.documentElement ? el : null;
};
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};
const dragRect = (d) => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) });
const view = () => ({ scrollX, scrollY, innerWidth, innerHeight, dpr: devicePixelRatio });
const frames = () =>
  new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 120);
  });
const finish = (value) => {
  if (finished) return;
  finished = true;
  const v = value.rect ? { ...value, ...view() } : value;
  teardown();
  frames().then(() => {
    if (window[key] !== s) return;
    if (s.pending) {
      const pending = s.pending;
      s.pending = null;
      delete window[key];
      answer(pending, v);
    } else s.queued = v;
  });
};
const swallow = (e) => {
  if (ours(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
};
const onDown = (e) => {
  if (ours(e)) return;
  swallow(e);
  if (e.button !== 0 || !e.isTrusted) return;
  drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false, element: hovered };
};
const onMove = (e) => {
  if (!drag && ours(e)) return;
  if (drag) {
    drag.x1 = Math.min(Math.max(0, e.clientX), innerWidth);
    drag.y1 = Math.min(Math.max(0, e.clientY), innerHeight);
    if (Math.abs(drag.x1 - drag.x0) >= MIN_DRAG || Math.abs(drag.y1 - drag.y0) >= MIN_DRAG) drag.moved = true;
    if (drag.moved) place(dragRect(drag), "region");
    return;
  }
  hovered = elementAt(e.clientX, e.clientY);
  place(hovered ? rectOf(hovered) : null, "element");
};
const onUp = (e) => {
  if (!drag && ours(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const d = drag;
  drag = null;
  if (!d || e.button !== 0 || !e.isTrusted) return;
  if (d.moved) {
    const r = dragRect(d);
    if (r.width >= MIN_DRAG && r.height >= MIN_DRAG) return finish({ kind: "region", rect: r });
    return place(null, "region");
  }
  const el = d.element || elementAt(e.clientX, e.clientY);
  if (el) finish({ kind: "element", rect: rectOf(el) });
};
const onKey = (e) => {
  if (e.key !== "Escape") return;
  swallow(e);
  if (drag && drag.moved) {
    drag = null;
    place(null, "region");
    return;
  }
  finish({ kind: "cancel" });
};
const onScroll = () => {
  if (!drag && hovered) place(rectOf(hovered), "element");
};
const blocked = ["click", "dblclick", "auxclick", "contextmenu", "mousedown", "mouseup", "touchstart", "touchend"];
addEventListener("pointerdown", onDown, true);
addEventListener("pointermove", onMove, true);
addEventListener("pointerup", onUp, true);
addEventListener("keydown", onKey, true);
addEventListener("scroll", onScroll, true);
for (const type of blocked) addEventListener(type, swallow, true);
const button = (el, value) =>
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.isTrusted) finish(value);
  });
button(visible, { kind: "visible" });
button(full, { kind: "fullPage" });
button(cancel, { kind: "cancel" });
function teardown() {
  removeEventListener("pointerdown", onDown, true);
  removeEventListener("pointermove", onMove, true);
  removeEventListener("pointerup", onUp, true);
  removeEventListener("keydown", onKey, true);
  removeEventListener("scroll", onScroll, true);
  for (const type of blocked) removeEventListener(type, swallow, true);
  host.remove();
  try {
    if (previousFocus && previousFocus !== document.body && previousFocus.focus) previousFocus.focus({ preventScroll: true });
  } catch (e) {}
}
place(null, "region");
s = {
  pending: post,
  queued: null,
  teardown() {
    if (!finished) teardown();
    finished = true;
    delete window[key];
  },
};
Object.defineProperty(window, key, { value: s, configurable: true, writable: true, enumerable: false });`;
}
