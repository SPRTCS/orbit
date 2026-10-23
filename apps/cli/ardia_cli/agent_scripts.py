HELPERS = r"""
const visible = (el) => {
  if (!el || !el.isConnected) return false;
  if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};
const squash = (text) => String(text || "").replace(/\s+/g, " ").trim();
const labelOf = (el) => {
  const parts = [el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title")];
  if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes((el.type || "").toLowerCase())) parts.unshift(el.value);
  if (el.tagName === "IMG") parts.push(el.alt);
  return squash([el.innerText, ...parts].filter(Boolean).join(" "));
};
const fieldLabel = (el) => {
  const parts = [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.getAttribute("title")];
  if (el.id) for (const label of document.querySelectorAll("label[for]")) if (label.htmlFor === el.id) parts.push(label.innerText);
  const wrapping = el.closest("label");
  if (wrapping) parts.push(wrapping.innerText);
  const by = el.getAttribute("aria-labelledby");
  if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.innerText);
  return squash(parts.filter(Boolean).join(" "));
};
const CLICKABLE = "a[href], button, input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], summary, label, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [onclick], [tabindex]:not([tabindex='-1'])";
const FIELDS = "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=image]), textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=searchbox], [role=combobox]";
const isField = (el) => el.matches(FIELDS) && !el.disabled && !el.readOnly;
const isSecret = (el) => el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
const byText = (wanted, mode) => {
  const key = squash(wanted).toLowerCase();
  if (!key) return null;
  const pool = [...document.querySelectorAll(mode === "field" ? FIELDS : CLICKABLE)].filter(visible);
  const text = (el) => (mode === "field" ? fieldLabel(el) : labelOf(el)).toLowerCase();
  const exact = pool.find((el) => text(el) === key);
  if (exact) return exact;
  const partial = pool.filter((el) => text(el).includes(key)).sort((a, b) => text(a).length - text(b).length)[0];
  if (partial) return partial;
  if (mode === "field") return null;
  let best = null;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (!(node instanceof HTMLElement) || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(node.tagName)) continue;
    const own = squash(node.innerText).toLowerCase();
    if (own.includes(key) && visible(node) && (!best || own.length <= squash(best.innerText).length)) best = node;
  }
  return best;
};
const locate = (args, mode) => {
  if (args.selector) {
    let all;
    try {
      all = [...document.querySelectorAll(args.selector)];
    } catch (error) {
      return { error: `invalid CSS selector: ${error.message}` };
    }
    const shown = all.filter(visible);
    const el = shown[args.index || 0] || (shown.length ? null : all[args.index || 0]);
    return el ? { el } : { error: `no element matches ${args.selector}` };
  }
  if (args.text) {
    const el = byText(args.text, mode);
    return el ? { el } : { error: `no ${mode === "field" ? "field" : "element"} with the text ${JSON.stringify(args.text)} is visible` };
  }
  if (mode === "field" && document.activeElement && isField(document.activeElement)) return { el: document.activeElement };
  return { error: "give a CSS selector or the visible text" };
};
const describe = (el) => ({
  tag: el.tagName.toLowerCase(),
  text: squash(isField(el) ? fieldLabel(el) : labelOf(el)).slice(0, 120),
  href: el.href && typeof el.href === "string" ? el.href : undefined,
});
const point = (el) => {
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  const x = Math.round(rect.left + Math.min(rect.width / 2, Math.max(1, rect.width - 1)));
  const y = Math.round(rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 1)));
  const hit = document.elementFromPoint(x, y);
  return { x, y, hidden: document.visibilityState !== "visible", covered: !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) ? describe(hit) : null };
};
"""

READ = HELPERS + r"""
return ((args) => {
  const root = document.body || document.documentElement;
  if (!root) return { title: document.title, url: location.href, content: "" };
  if (args.format === "text") return { title: document.title, url: location.href, content: root.innerText || "" };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED", "HEAD", "META", "LINK", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE", "FORM", "FIELDSET", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY"]);
  const out = [];
  let budget = args.max_chars * 2 + 2000;
  const emit = (text) => {
    if (budget <= 0) return;
    out.push(text);
    budget -= text.length;
  };
  const inline = (node) => {
    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent.replace(/\s+/g, " ");
      else if (child.nodeType === Node.ELEMENT_NODE) text += element(child);
    }
    return text;
  };
  const element = (el) => {
    if (SKIP.has(el.tagName) || (el instanceof HTMLElement && !visible(el) && el.tagName !== "BR")) return "";
    const tag = el.tagName;
    if (tag === "BR") return "\n";
    if (tag === "A") {
      const text = squash(inline(el));
      const href = el.getAttribute("href") && !el.href.startsWith("javascript:") ? el.href : "";
      return text ? (href ? `[${text}](${href})` : text) : "";
    }
    if (tag === "IMG") return el.alt ? `![${squash(el.alt)}]` : "";
    if (tag === "STRONG" || tag === "B") { const t = squash(inline(el)); return t ? `**${t}**` : ""; }
    if (tag === "EM" || tag === "I") { const t = squash(inline(el)); return t ? `_${t}_` : ""; }
    if (tag === "CODE" && el.parentElement?.tagName !== "PRE") { const t = el.textContent.trim(); return t ? "`" + t + "`" : ""; }
    if (tag === "BUTTON") { const t = squash(inline(el)); return t ? `[${t}]` : ""; }
    return " " + inline(el) + " ";
  };
  const flushText = (text) => {
    const t = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (t) emit(t + "\n\n");
  };
  const block = (el, depth = 0) => {
    const tag = el.tagName;
    if (budget <= 0 || SKIP.has(tag) || (el instanceof HTMLElement && !visible(el))) return;
    if (/^H[1-6]$/.test(tag)) { const t = squash(inline(el)); if (t) emit(`${"#".repeat(Number(tag[1]))} ${t}\n\n`); return; }
    if (tag === "PRE") { emit("```\n" + el.innerText.replace(/\n+$/, "") + "\n```\n\n"); return; }
    if (tag === "HR") { emit("---\n\n"); return; }
    if (tag === "BLOCKQUOTE") { const t = squash(el.innerText); if (t) emit(`> ${t}\n\n`); return; }
    if (tag === "UL" || tag === "OL") {
      let n = 0;
      for (const li of el.children) {
        if (li.tagName !== "LI" || !visible(li)) continue;
        n++;
        const isList = (c) => c.nodeType === Node.ELEMENT_NODE && (c.tagName === "UL" || c.tagName === "OL");
        const nested = [...li.childNodes].filter(isList);
        const own = squash([...li.childNodes].filter((c) => !isList(c)).map((c) => (c.nodeType === Node.TEXT_NODE ? c.textContent : c.nodeType === Node.ELEMENT_NODE ? element(c) : "")).join(" "));
        emit(`${"  ".repeat(depth)}${tag === "OL" ? `${n}.` : "-"} ${own}\n`);
        for (const list of nested) block(list, depth + 1);
      }
      if (depth === 0) emit("\n");
      return;
    }
    if (tag === "TABLE") {
      const rows = [...el.rows].filter(visible).map((row) => [...row.cells].map((cell) => squash(cell.innerText).replace(/\|/g, "\\|")));
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        rows.forEach((r, i) => {
          emit(`| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |\n`);
          if (i === 0) emit(`|${" --- |".repeat(width)}\n`);
        });
        emit("\n");
      }
      return;
    }
    let pending = "";
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { pending += child.textContent.replace(/\s+/g, " "); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tagName = child.tagName;
      const isBlock = BLOCK.has(tagName) || /^H[1-6]$/.test(tagName) || ["UL", "OL", "LI", "PRE", "TABLE", "BLOCKQUOTE", "HR", "BODY", "MAIN"].includes(tagName) || (child instanceof HTMLElement && getComputedStyle(child).display.startsWith("block") && child.children.length > 0);
      if (isBlock) {
        flushText(pending);
        pending = "";
        block(child, depth);
      } else pending += element(child);
    }
    flushText(pending);
  };
  block(root);
  return { title: document.title, url: location.href, content: out.join("").replace(/\n{3,}/g, "\n\n").trim() };
})(ARGS);
"""

FIND = HELPERS + r"""
return ((args) => {
  const text = (document.body || document.documentElement)?.innerText || "";
  const lower = text.toLowerCase();
  const key = args.query.toLowerCase();
  const matches = [];
  let count = 0;
  for (let at = lower.indexOf(key); at >= 0 && key; at = lower.indexOf(key, at + key.length)) {
    count++;
    if (matches.length < args.limit) {
      const start = Math.max(0, at - args.context);
      const end = Math.min(text.length, at + key.length + args.context);
      matches.push((start > 0 ? "…" : "") + squash(text.slice(start, end)) + (end < text.length ? "…" : ""));
    }
  }
  return { query: args.query, count, matches };
})(ARGS);
"""

LOCATE_CLICK = HELPERS + r"""
return ((args) => {
  const found = locate(args, "click");
  if (found.error) return { error: found.error };
  const el = found.el;
  return { ...describe(el), ...point(el) };
})(ARGS);
"""

CLICK_FALLBACK = HELPERS + r"""
return ((args) => {
  const found = locate(args, "click");
  if (found.error) return { error: found.error };
  found.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  found.el.click();
  return describe(found.el);
})(ARGS);
"""

FOCUS_FIELD = HELPERS + r"""
return ((args) => {
  const found = locate(args, "field");
  if (found.error) return { error: found.error };
  const el = found.el;
  if (isSecret(el)) return { error: "that's a password field; Orbit never lets agents type passwords" };
  if (!isField(el) && !el.isContentEditable) return { error: `that element (${el.tagName.toLowerCase()}) doesn't take text` };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  el.focus();
  if (args.clear) {
    if ("value" in el && typeof el.select === "function") el.select();
    else document.getSelection()?.selectAllChildren(el);
  } else if ("value" in el && typeof el.setSelectionRange === "function") {
    try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
  }
  return { ...describe(el), focused: document.activeElement === el, hidden: document.visibilityState !== "visible" };
})(ARGS);
"""

FIELD_STATE = HELPERS + r"""
return ((args) => {
  const el = document.activeElement;
  if (!el || el === document.body) return { focused: false };
  return { focused: true, length: "value" in el ? String(el.value).length : squash(el.innerText).length, has: "value" in el ? String(el.value).includes(args.text) : el.innerText.includes(args.text) };
})(ARGS);
"""

SET_VALUE_FALLBACK = HELPERS + r"""
return ((args) => {
  const el = document.activeElement;
  if (!el || isSecret(el)) return { error: "no field has focus" };
  if ("value" in el) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const next = (args.clear ? "" : String(el.value)) + args.text;
    setter ? setter.call(el, next) : (el.value = next);
  } else if (el.isContentEditable) {
    if (args.clear) el.textContent = "";
    el.append(document.createTextNode(args.text));
  } else return { error: "the focused element doesn't take text" };
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: args.text }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
})(ARGS);
"""

SUBMIT_FALLBACK = r"""
return (() => {
  const el = document.activeElement;
  const form = el && el.form;
  if (!form) return { submitted: false };
  form.requestSubmit ? form.requestSubmit() : form.submit();
  return { submitted: true };
})();
"""

SCROLL = HELPERS + r"""
return ((args) => {
  if (args.selector || args.text) {
    const found = locate(args, "click");
    if (found.error) return { error: found.error };
    found.el.scrollIntoView({ block: "center", behavior: "instant" });
  } else {
    const page = document.scrollingElement || document.documentElement;
    const step = args.amount || Math.round(innerHeight * 0.8);
    if (args.direction === "top") scrollTo({ top: 0, behavior: "instant" });
    else if (args.direction === "bottom") scrollTo({ top: page.scrollHeight, behavior: "instant" });
    else if (args.direction === "up") scrollBy({ top: -step, behavior: "instant" });
    else if (args.direction === "left") scrollBy({ left: -step, behavior: "instant" });
    else if (args.direction === "right") scrollBy({ left: step, behavior: "instant" });
    else scrollBy({ top: step, behavior: "instant" });
  }
  const page = document.scrollingElement || document.documentElement;
  return { scroll_y: Math.round(scrollY), scroll_x: Math.round(scrollX), height: page.scrollHeight, viewport: innerHeight, at_bottom: Math.ceil(scrollY + innerHeight) >= page.scrollHeight };
})(ARGS);
"""

CHECK = HELPERS + r"""
return ((args) => {
  if (args.selector) {
    let all;
    try { all = [...document.querySelectorAll(args.selector)]; } catch (error) { return { error: `invalid CSS selector: ${error.message}` }; }
    const el = all.find(visible);
    return { found: !!el, element: el ? describe(el) : null };
  }
  const text = ((document.body || document.documentElement)?.innerText || "").toLowerCase();
  return { found: text.includes(args.text.toLowerCase()) };
})(ARGS);
"""

READY_STATE = "document.readyState"


def wrap(script: str, args: dict) -> str:
    import json

    return "(() => {" + script.replace("ARGS", json.dumps(args)) + "})()"
