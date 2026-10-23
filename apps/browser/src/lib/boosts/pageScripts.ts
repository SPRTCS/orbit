import { BOOST_STYLE_ATTRIBUTE } from "./compile";

export const ZAP_SELECTOR_SOURCE = `(doc) => {
  const ATTRIBUTES = ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy", "data-component", "data-module", "data-section", "data-region", "data-ad", "aria-label", "role", "name", "itemprop"];
  const STATE = /(^|[-_])(active|selected|current|open|opened|closed|hover|hovered|focus|focused|focus-visible|visible|invisible|hidden|show|shown|showing|expanded|collapsed|loading|loaded|disabled|enabled|checked|animating|animated|in|out|enter|leave|sticky|stuck|fixed|scrolled|dragging)($|[-_])/i;
  const esc = (value) => {
    const s = String(value);
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const ch = s.charAt(i);
      if (c === 0) out += "\\uFFFD";
      else if ((c >= 1 && c <= 31) || c === 127 || (i === 0 && c >= 48 && c <= 57) || (i === 1 && c >= 48 && c <= 57 && s.charCodeAt(0) === 45)) out += "\\\\" + c.toString(16) + " ";
      else if (i === 0 && c === 45 && s.length === 1) out += "\\\\" + ch;
      else if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += ch;
      else out += "\\\\" + ch;
    }
    return out;
  };
  const attrValue = (v) => '"' + String(v).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\a ") + '"';
  const hashed = (t) =>
    /\\d{3,}/.test(t) ||
    /(?=[0-9a-f]*\\d)[0-9a-f]{5,}/i.test(t) ||
    /^(css|sc|jsx|emotion|svelte|astro)-/.test(t) ||
    /__[A-Za-z0-9-]{5,}$/.test(t) && /[0-9A-Z]/.test(t.slice(t.lastIndexOf("__") + 2)) ||
    t.split(/[-_]/).some((part) => part.length >= 4 && part.length <= 8 && /[a-z]/.test(part) && (part.slice(1).match(/[A-Z]/g) || []).length >= 2 && /[A-Z][a-z]?[A-Z]/.test(part));
  const stableClass = (c) =>
    c.length >= 2 && c.length <= 40 && !/[:\\[\\]/.@!%#]/.test(c) && !/^(is|has|was|ng|v)-/.test(c) && !STATE.test(c) && !hashed(c);
  const stableId = (id) => id.length >= 2 && id.length <= 64 && !/[:\\s]/.test(id) && !/^(ember|react|radix|headlessui|mui|rc-|yui|ext-gen|uid|id-)/i.test(id) && !hashed(id);
  const stableValue = (v) => v.length >= 1 && v.length <= 80 && !/\\d{4,}/.test(v) && !/[\\n\\r]/.test(v);
  const count = (sel) => {
    try {
      return doc.querySelectorAll(sel).length;
    } catch (e) {
      return -1;
    }
  };
  const unique = (sel) => count(sel) === 1;
  const tag = (el) => esc(String(el.localName || el.tagName || "").toLowerCase());
  const own = (el) => {
    if (el.id && stableId(el.id)) {
      const sel = "#" + esc(el.id);
      if (unique(sel)) return sel;
    }
    for (const name of ATTRIBUTES) {
      const v = el.getAttribute(name);
      if (v && stableValue(v)) {
        const sel = tag(el) + "[" + name + "=" + attrValue(v) + "]";
        if (unique(sel)) return sel;
      }
    }
    return null;
  };
  const loose = (el) =>
    tag(el) +
    Array.from(el.classList || [])
      .filter(stableClass)
      .slice(0, 2)
      .map((c) => "." + esc(c))
      .join("");
  const strict = (el) => {
    const base = loose(el);
    const parent = el.parentElement;
    if (!parent) return base;
    const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
    if (same.length < 2) return base;
    return base + ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
  };
  return (target) => {
    if (!target || target.nodeType !== 1) return null;
    const name = String(target.localName || "").toLowerCase();
    if (name === "html" || name === "body" || name === "head") return null;
    const direct = own(target);
    if (direct) return direct;
    const looseChain = [];
    const strictChain = [];
    for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
      const n = String(el.localName || "").toLowerCase();
      if (el !== target) {
        const anchor = n === "body" || n === "html" ? null : own(el);
        if (anchor) {
          const tries = [
            anchor + " " + looseChain[0],
            anchor + " " + strictChain[0],
            anchor + " > " + looseChain.join(" > "),
            anchor + " > " + strictChain.join(" > "),
          ];
          for (const sel of tries) if (unique(sel)) return sel;
          return tries[3];
        }
      }
      looseChain.unshift(loose(el));
      strictChain.unshift(strict(el));
      if (n !== "html" && n !== "body") {
        if (unique(looseChain.join(" > "))) return looseChain.join(" > ");
        if (unique(strictChain.join(" > "))) return strictChain.join(" > ");
      }
      if (n === "html") return strictChain.join(" > ");
    }
    return strictChain.join(" > ");
  };
}`;

export type ZapAnswer =
  | { kind: "zap"; selector: string; label: string }
  | { kind: "undo"; selector: string }
  | { kind: "done" }
  | { kind: "superseded" }
  | { kind: "stopped" };

export function zapScript(key: string, options: { stop?: boolean; host?: string }): string {
  return `const key = ${JSON.stringify(key)};
const options = ${JSON.stringify(options)};
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
if (!s) {
  const selectorFor = (${ZAP_SELECTOR_SOURCE})(document);
  const host = document.createElement("orbit-zap");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
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
    .box { position: fixed; pointer-events: none; display: none; border: 2px solid #FF453A; background: rgba(255, 69, 58, 0.14); border-radius: 4px; box-sizing: border-box; transition: all 60ms linear; }
    .tag { position: fixed; pointer-events: none; display: none; font: 600 11px/16px -apple-system, system-ui, sans-serif; color: #fff; background: #FF453A; padding: 1px 6px; border-radius: 4px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 14px; border-radius: 12px; background: rgba(30, 30, 30, 0.92); color: #fff; font: 500 13px/18px -apple-system, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); white-space: nowrap; }
    .count { color: rgba(255, 255, 255, 0.6); font-variant-numeric: tabular-nums; }
    button { all: unset; cursor: default; padding: 4px 10px; border-radius: 7px; font: 500 13px/18px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(255, 255, 255, 0.14); }
    button:hover { background: rgba(255, 255, 255, 0.22); }
    button.done { background: #0A84FF; }
    button.done:hover { background: #3396FF; }
    button[disabled] { opacity: 0.4; }
  \`;
  const box = make("div", "box");
  const tag = make("div", "tag");
  const bar = make("div", "bar");
  const title = make("span", "", "Click elements to zap them" + (options.host ? " on " + options.host : ""));
  const counter = make("span", "count");
  const undo = make("button", "undo", "Undo");
  const done = make("button", "done", "Done");
  bar.append(title, counter, undo, done);
  root.append(css, box, tag, bar);
  (document.body || document.documentElement).appendChild(host);
  const stack = [];
  const queue = [];
  let hovered = null;
  const labelFor = (el) => {
    const text = (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.textContent || "").replace(/\\s+/g, " ").trim();
    const name = String(el.localName || "element").toLowerCase();
    return text ? name + " “" + (text.length > 40 ? text.slice(0, 40) + "…" : text) + "”" : name;
  };
  const refresh = () => {
    counter.textContent = stack.length ? stack.length + " zapped" : "";
    undo.disabled = !stack.length;
  };
  const emit = (value) => {
    if (s.pending) {
      const pending = s.pending;
      s.pending = null;
      answer(pending, value);
    } else queue.push(value);
  };
  const ours = (e) => e.composedPath().includes(host);
  const pick = (e) => {
    const target = e.target;
    if (!target || target.nodeType !== 1 || target === host) return null;
    const n = String(target.localName).toLowerCase();
    return n === "html" || n === "body" ? null : target;
  };
  const show = (el) => {
    hovered = el;
    if (!el) {
      box.style.display = "none";
      tag.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tag.textContent = labelFor(el);
    Object.assign(tag.style, { display: "block", left: Math.max(4, r.left) + "px", top: (r.top > 22 ? r.top - 20 : r.bottom + 4) + "px" });
  };
  const zap = (el) => {
    const selector = selectorFor(el);
    if (!selector) return;
    const before = { value: el.style.getPropertyValue("display"), priority: el.style.getPropertyPriority("display") };
    el.style.setProperty("display", "none", "important");
    stack.push({ el, before, selector });
    show(null);
    refresh();
    emit({ kind: "zap", selector, label: labelFor(el) });
  };
  const unzap = () => {
    const last = stack.pop();
    if (!last) return;
    if (last.before.value) last.el.style.setProperty("display", last.before.value, last.before.priority);
    else last.el.style.removeProperty("display");
    refresh();
    emit({ kind: "undo", selector: last.selector });
  };
  const finish = () => emit({ kind: "done" });
  const swallow = (e) => {
    if (ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onMove = (e) => {
    if (ours(e)) return show(null);
    const el = pick(e);
    if (el !== hovered) show(el);
  };
  const onClick = (e) => {
    if (ours(e)) return;
    swallow(e);
    if (e.button !== 0 || !e.isTrusted) return;
    const el = pick(e);
    if (el) zap(el);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      swallow(e);
      finish();
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && String(e.key).toLowerCase() === "z") {
      swallow(e);
      unzap();
    }
  };
  const onScroll = () => hovered && show(hovered);
  const blocked = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend", "submit"];
  addEventListener("mousemove", onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("keydown", onKey, true);
  addEventListener("scroll", onScroll, true);
  for (const type of blocked) addEventListener(type, swallow, true);
  undo.addEventListener("click", (e) => {
    e.stopPropagation();
    unzap();
  });
  done.addEventListener("click", (e) => {
    e.stopPropagation();
    finish();
  });
  refresh();
  s = {
    pending: null,
    queue,
    teardown() {
      removeEventListener("mousemove", onMove, true);
      removeEventListener("click", onClick, true);
      removeEventListener("keydown", onKey, true);
      removeEventListener("scroll", onScroll, true);
      for (const type of blocked) removeEventListener(type, swallow, true);
      host.remove();
      delete window[key];
    },
  };
  Object.defineProperty(window, key, { value: s, configurable: true, writable: true, enumerable: false });
}
s.pending = post;
if (s.queue.length) {
  const next = s.queue.shift();
  s.pending = null;
  answer(post, next);
}`;
}

export function liveStyleScript(want: Record<string, string>): string {
  return `const want = ${JSON.stringify(want)};
const attribute = ${JSON.stringify(BOOST_STYLE_ATTRIBUTE)};
const seen = new Set();
for (const el of document.querySelectorAll("style[" + attribute + "]")) {
  const id = el.getAttribute(attribute);
  if (Object.prototype.hasOwnProperty.call(want, id)) {
    seen.add(id);
    if (el.textContent !== want[id]) el.textContent = want[id];
    if (el.hasAttribute("media")) el.removeAttribute("media");
  } else if (el.getAttribute("media") !== "not all") el.setAttribute("media", "not all");
}
for (const id of Object.keys(want)) {
  if (seen.has(id) || !want[id]) continue;
  const el = document.createElement("style");
  el.setAttribute(attribute, id);
  el.textContent = want[id];
  (document.head || document.documentElement).appendChild(el);
}
post("result", "true");`;
}
