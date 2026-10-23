import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const model = await import("./model.ts");
const { compileBoosts, boostsFolder, isBoostsExtension, styleLoader, scriptWrapper } = await import("./compile.ts");
const { ZAP_SELECTOR_SOURCE, liveStyleScript, zapScript } = await import("./pageScripts.ts");
const { useBoosts, addBoost, addZap, removeZap, newBoost, siteBoostFor, updateBoost } = await import("../../store/boosts.ts");

const site = (host, extra = {}) => ({ host, subdomains: true, path: "", ...extra });
const boost = (extra = {}) => ({ ...newBoost(site("example.com")), ...extra });

test("hosts are normalized: URLs, ports, wildcards, IDN, junk", () => {
  assert.deepEqual(model.normalizeHost("https://News.Example.com:8443/path?q#x"), { host: "news.example.com", subdomains: false });
  assert.deepEqual(model.normalizeHost("*.example.com"), { host: "example.com", subdomains: true });
  assert.deepEqual(model.normalizeHost("bücher.de"), { host: "xn--bcher-kva.de", subdomains: false });
  assert.deepEqual(model.normalizeHost("localhost:3000"), { host: "localhost", subdomains: false });
  assert.equal(model.normalizeHost("exa mple.com"), null);
  assert.equal(model.normalizeHost(""), null);
  assert.equal(model.normalizeHost("-bad-.com"), null);
});

test("paths are prefixes; empty means the whole site", () => {
  assert.equal(model.normalizePath(""), "");
  assert.equal(model.normalizePath("/"), "");
  assert.equal(model.normalizePath("news"), "/news");
  assert.equal(model.normalizePath("/docs/*"), "/docs/");
  assert.equal(model.normalizePath("/a b"), null);
});

test("sites match URLs the way the content script patterns do", () => {
  const s = site("example.com");
  assert.ok(model.siteMatchesUrl(s, "https://example.com/"));
  assert.ok(model.siteMatchesUrl(s, "http://www.example.com:8080/x"));
  assert.ok(!model.siteMatchesUrl(s, "https://notexample.com/"));
  assert.ok(!model.siteMatchesUrl({ ...s, subdomains: false }, "https://www.example.com/"));
  assert.ok(model.siteMatchesUrl({ ...s, path: "/news" }, "https://example.com/news/today"));
  assert.ok(!model.siteMatchesUrl({ ...s, path: "/news" }, "https://example.com/sport"));
  assert.ok(model.siteMatchesUrl({ ...s, path: "/a/*/c" }, "https://example.com/a/b/c"));
  assert.ok(!model.siteMatchesUrl(s, "file:///example.com/"));
  assert.deepEqual(model.matchPatterns(s), ["*://*.example.com/*"]);
  assert.deepEqual(model.matchPatterns({ ...s, path: "/news" }), ["*://*.example.com/news*"]);
  assert.deepEqual(model.matchPatterns(site("127.0.0.1")), ["*://127.0.0.1/*"]);
  assert.ok(model.siteMatchesUrl(site("127.0.0.1"), "http://127.0.0.1:8123/page.html"));
});

test("site for a URL drops www and keeps IPs and localhost exact", () => {
  assert.deepEqual(model.siteForUrl("https://www.youtube.com/watch?v=1"), { host: "youtube.com", subdomains: true, path: "" });
  assert.deepEqual(model.siteForUrl("http://localhost:3000/"), { host: "localhost", subdomains: false, path: "" });
  assert.deepEqual(model.siteForUrl("http://10.0.0.2/"), { host: "10.0.0.2", subdomains: false, path: "" });
  assert.equal(model.siteForUrl("about:blank"), null);
});

test("style options compile to CSS; zaps hide with !important", () => {
  const b = boost({ zaps: [{ selector: "#ad", label: "" }], css: "p { color: red }", style: { font: "ui-monospace, Menlo, monospace", tint: 90, dark: true } });
  const css = model.boostCss(b);
  assert.match(css, /font-family: ui-monospace, Menlo, monospace !important/);
  assert.match(css, /html \{ filter: invert\(1\) hue-rotate\(180deg\) hue-rotate\(90deg\) !important; \}/);
  assert.match(css, /img, video[^{]*\{ filter: hue-rotate\(-90deg\) hue-rotate\(180deg\) invert\(1\) !important; \}/);
  assert.match(css, /#ad \{ display: none !important; \}/);
  assert.ok(css.endsWith("p { color: red }"));
  assert.equal(model.cleanFont('Comic; } body { x'), "Comic  body  x");
  const zaps = model.readBoost({ site: site("example.com"), zaps: [{ selector: "a /*" }, { selector: "a { color: red }" }, { selector: "b; @import x" }, { selector: ".ok" }] }, "i").zaps;
  assert.deepEqual(zaps.map((z) => z.selector), [".ok"]);
});

test("boosts round-trip through the document and drop invalid entries", () => {
  const good = boost({ name: "Mine", css: "a{}" });
  const json = model.writeBoosts([good, { ...good, id: "x", site: { host: "bad host", subdomains: false, path: "" } }]);
  let n = 0;
  const back = model.readBoosts(json, () => `fresh-${++n}`);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], good);
  assert.deepEqual(model.readBoosts("{nope", () => "x"), []);
  assert.deepEqual(model.readBoosts(JSON.stringify({ version: 99, boosts: [good] }), () => "x"), []);
});

test("export and import: summary, JS needs consent, local fields reset", () => {
  const b = boost({ name: "Calm", css: "a{}\nb{}", js: "console.log(1)", zaps: [{ selector: ".x", label: "div" }], profileId: "p1", incognito: true });
  const text = model.exportBoost(b);
  const shared = JSON.parse(text);
  assert.equal(shared.orbitBoost, 1);
  assert.equal(shared.profileId, undefined);
  assert.equal(shared.jsAllowed, undefined);
  const imported = model.importBoost(text, "new-id", 5);
  assert.ok(!("error" in imported));
  assert.equal(imported.boost.id, "new-id");
  assert.equal(imported.boost.jsAllowed, false);
  assert.equal(imported.boost.incognito, false);
  assert.equal(imported.boost.profileId, null);
  assert.equal(imported.hasJs, true);
  assert.deepEqual(imported.summary, [
    "Applies to example.com and its subdomains",
    "Custom CSS (2 lines)",
    "Hides 1 element",
    "JavaScript (1 line) that runs on the site",
  ]);
  assert.ok("error" in model.importBoost("hello", "i"));
  assert.ok("error" in model.importBoost(JSON.stringify({ orbitBoost: 2 }), "i"));
  assert.ok("error" in model.importBoost(JSON.stringify({ orbitBoost: 1, site: { host: "%%%" } }), "i"));
  assert.equal(model.exportFileName({ ...b, name: "a/b:c" }), "a b c.orbitboost");
});

test("applies-to respects enabled, private windows, spaces and live content", () => {
  const engineOf = (id) => (id === "default" ? "" : id);
  const b = boost({ css: "a{}" });
  assert.ok(model.boostAppliesTo(b, "https://example.com/", "", false, engineOf));
  assert.ok(!model.boostAppliesTo({ ...b, enabled: false }, "https://example.com/", "", false, engineOf));
  assert.ok(!model.boostAppliesTo(b, "https://example.com/", "", true, engineOf));
  assert.ok(model.boostAppliesTo({ ...b, incognito: true }, "https://example.com/", "", true, engineOf));
  assert.ok(!model.boostAppliesTo({ ...b, profileId: "work" }, "https://example.com/", "", false, engineOf));
  assert.ok(model.boostAppliesTo({ ...b, profileId: "work" }, "https://example.com/", "work", false, engineOf));
  assert.ok(!model.boostAppliesTo({ ...b, css: "" }, "https://example.com/", "", false, engineOf));
  assert.ok(!model.boostAppliesTo({ ...b, css: "", js: "x()", jsAllowed: false }, "https://example.com/", "", false, engineOf));
});

test("compile writes a content-scripts-only manifest, gated JS and incognito", () => {
  const a = boost({ id: "boost-a", css: "a{}" });
  const js = boost({ id: "boost-b", js: "run()", jsAllowed: true, incognito: true });
  const gated = boost({ id: "boost-c", js: "evil()", jsAllowed: false });
  const off = boost({ id: "boost-d", css: "x{}", enabled: false });
  const ext = compileBoosts([a, js, gated, off]);
  const manifest = JSON.parse(ext.files["manifest.json"]);
  assert.deepEqual(Object.keys(manifest).sort(), ["content_scripts", "description", "manifest_version", "name", "version"]);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Orbit Boosts");
  assert.deepEqual(manifest.content_scripts, [
    { matches: ["*://*.example.com/*"], js: ["boosts/boost-a.style.js"], run_at: "document_start", all_frames: true, world: "ISOLATED" },
    { matches: ["*://*.example.com/*"], js: ["boosts/boost-b.script.js"], run_at: "document_end", all_frames: true, world: "ISOLATED" },
  ]);
  assert.deepEqual(Object.keys(ext.files).sort(), ["boosts/boost-a.style.js", "boosts/boost-b.script.js", "manifest.json"]);
  assert.equal(ext.incognito, true);
  assert.ok(!Object.values(ext.files).some((f) => f.includes("evil()")));
  assert.match(ext.files["boosts/boost-a.style.js"], /inIncognitoContext\) return;/);
  assert.doesNotMatch(ext.files["boosts/boost-b.script.js"], /inIncognitoContext/);
  assert.equal(compileBoosts([off, gated]), null);
  assert.equal(compileBoosts([a]).incognito, false);
  assert.equal(boostsFolder(""), "default");
  assert.equal(boostsFolder("Profile 2/x"), "p_Profile_2_x");
  assert.ok(isBoostsExtension({ name: "Orbit Boosts", path: "/tmp/d/Boosts/default/extension" }));
  assert.ok(!isBoostsExtension({ name: "Orbit Boosts", path: "/tmp/elsewhere" }));
  assert.ok(!isBoostsExtension({ name: "uBlock", path: "/tmp/d/Boosts/default/extension" }));
});

function fakeChrome(incognito) {
  return { extension: { inIncognitoContext: incognito } };
}

test("the style loader injects at document start and keeps its style attached", () => {
  const appended = [];
  const observers = [];
  const root = { appendChild: (el) => (appended.push(el), (el.isConnected = true)) };
  const env = {
    document: { head: null, documentElement: root, createElement: () => ({ isConnected: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe() {}
      disconnect() {}
    },
  };
  const run = (incognito, allowed) => {
    appended.length = 0;
    new Function("document", "MutationObserver", "globalThis", "chrome", styleLoader("b1", "a{color:red}", allowed))(env.document, env.MutationObserver, { chrome: fakeChrome(incognito) }, fakeChrome(incognito));
    return appended.slice();
  };
  const [style] = run(false, false);
  assert.equal(style.attrs["data-orbit-boost"], "b1");
  assert.equal(style.textContent, "a{color:red}");
  style.isConnected = false;
  observers.at(-1).fn();
  assert.equal(appended.length, 2);
  assert.equal(run(true, false).length, 0);
  assert.equal(run(true, true).length, 1);
});

test("user JS is wrapped without extension globals and survives a trailing comment", () => {
  const seen = [];
  const src = scriptWrapper("x", "seen.push(typeof chrome, typeof browser) // done", false);
  new Function("seen", "window", "globalThis", "chrome", src)(seen, {}, { chrome: fakeChrome(false) }, fakeChrome(false));
  assert.deepEqual(seen, ["undefined", "undefined"]);
});

test("zap and live scripts parse as evaluate bodies", () => {
  new Function("post", zapScript("k", { host: "example.com" }));
  new Function("post", zapScript("k", { stop: true }));
  new Function("post", liveStyleScript({ a: "b{}" }));
});

class El {
  constructor(name, attrs = {}, children = []) {
    this.nodeType = 1;
    this.localName = name;
    this.attrs = { ...attrs };
    this.id = attrs.id ?? "";
    this.classList = (attrs.class ?? "").split(/\s+/).filter(Boolean);
    this.children = [];
    this.parentElement = null;
    for (const c of children) this.append(c);
  }
  append(c) {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
}

function unescapeIdent(s) {
  return s.replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
}

function parseCompound(text) {
  const re = /^(?:([a-z][a-z0-9-]*)|#((?:\\.|[^.#[:\s>])+)|\.((?:\\.|[^.#[:\s>])+)|\[([a-z-]+)="((?:\\.|[^"])*)"\]|:nth-of-type\((\d+)\))/i;
  const parts = [];
  while (text) {
    const m = text.match(re);
    if (!m) throw new SyntaxError(`bad selector part ${text}`);
    if (m[1]) parts.push({ tag: m[1] });
    if (m[2]) parts.push({ id: unescapeIdent(m[2]) });
    if (m[3]) parts.push({ cls: unescapeIdent(m[3]) });
    if (m[4]) parts.push({ attr: m[4], value: m[5].replace(/\\a /g, "\n").replace(/\\(.)/g, "$1") });
    if (m[6]) parts.push({ nth: Number(m[6]) });
    text = text.slice(m[0].length);
  }
  return parts;
}

function matchesCompound(el, parts) {
  return parts.every((p) => {
    if (p.tag) return el.localName === p.tag;
    if (p.id) return el.id === p.id;
    if (p.cls) return el.classList.includes(p.cls);
    if (p.attr) return el.getAttribute(p.attr) === p.value;
    const same = el.parentElement ? el.parentElement.children.filter((c) => c.localName === el.localName) : [el];
    return same.indexOf(el) + 1 === p.nth;
  });
}

function makeDoc(html) {
  const all = [];
  const walk = (el) => {
    all.push(el);
    el.children.forEach(walk);
  };
  walk(html);
  const steps = (sel) => {
    const tokens = [];
    let cur = "";
    let inAttr = false;
    let inQuote = false;
    const src = sel.trim();
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") {
        cur += ch + src[++i];
        continue;
      }
      if (inQuote) {
        if (ch === '"') inQuote = false;
        cur += ch;
      } else if (ch === '"' && inAttr) {
        inQuote = true;
        cur += ch;
      } else if (ch === "[") {
        inAttr = true;
        cur += ch;
      } else if (ch === "]") {
        inAttr = false;
        cur += ch;
      } else if (!inAttr && (ch === " " || ch === ">")) {
        if (cur) tokens.push(cur);
        cur = "";
        if (ch === ">") tokens.push(">");
      } else cur += ch;
    }
    if (cur) tokens.push(cur);
    const out = [];
    let comb = " ";
    for (const t of tokens) {
      if (t === ">") comb = ">";
      else {
        out.push({ comb, parts: parseCompound(t) });
        comb = " ";
      }
    }
    return out;
  };
  const matchFrom = (el, list, i) => {
    if (!matchesCompound(el, list[i].parts)) return false;
    if (i === 0) return true;
    if (list[i].comb === ">") return !!el.parentElement && matchFrom(el.parentElement, list, i - 1);
    for (let p = el.parentElement; p; p = p.parentElement) if (matchFrom(p, list, i - 1)) return true;
    return false;
  };
  return {
    querySelectorAll(sel) {
      const list = steps(sel);
      return all.filter((el) => matchFrom(el, list, list.length - 1));
    },
  };
}

function page() {
  const ad = new El("div", { class: "ad-slot css-1x2y3z is-visible" });
  const promo = new El("aside", { "data-testid": "promo-banner", class: "banner" });
  const rows = [1, 2, 3].map((n) => new El("li", { class: "row" }, [new El("span", { class: "label" })]));
  const hashed = new El("div", { id: "react-123456", class: "sc-bdfBwQ" });
  const label = new El("button", { "aria-label": 'Say "hi"' });
  const main = new El("main", { id: "main" }, [ad, new El("ul", { class: "feed" }, rows), hashed, label]);
  const body = new El("body", {}, [promo, main, new El("div", { class: "footer" })]);
  const html = new El("html", {}, [new El("head"), body]);
  return { html, body, main, ad, promo, rows, hashed, label };
}

const selectorFor = (html) => new Function(`return (${ZAP_SELECTOR_SOURCE})`)()(makeDoc(html));

test("zap selectors prefer stable ids and data attributes", () => {
  const p = page();
  const find = selectorFor(p.html);
  assert.equal(find(p.main), "#main");
  assert.equal(find(p.promo), 'aside[data-testid="promo-banner"]');
  assert.equal(find(p.label), 'button[aria-label="Say \\"hi\\""]');
});

test("zap selectors skip volatile classes and fall back to structure", () => {
  const p = page();
  const doc = makeDoc(p.html);
  const find = selectorFor(p.html);
  const ad = find(p.ad);
  assert.equal(ad, "div.ad-slot");
  const second = find(p.rows[1].children[0]);
  assert.equal(doc.querySelectorAll(second).length, 1);
  assert.equal(doc.querySelectorAll(second)[0], p.rows[1].children[0]);
  assert.doesNotMatch(second, /css-|is-visible/);
  const hashed = find(p.hashed);
  assert.doesNotMatch(hashed, /react-123456|sc-bdfBwQ/);
  assert.equal(doc.querySelectorAll(hashed)[0], p.hashed);
  assert.equal(find(p.body), null);
  assert.equal(find(p.html), null);
});

test("every element on a page gets a selector that finds exactly it", () => {
  const p = page();
  const doc = makeDoc(p.html);
  const find = selectorFor(p.html);
  const all = [];
  const walk = (el) => {
    if (!["html", "body", "head"].includes(el.localName)) all.push(el);
    el.children.forEach(walk);
  };
  walk(p.html);
  for (const el of all) {
    const sel = find(el);
    const hits = doc.querySelectorAll(sel);
    assert.equal(hits.length, 1, sel);
    assert.equal(hits[0], el, sel);
  }
});

test("site boost store: zaps go into one boost per site, undo removes the last copy", () => {
  useBoosts.setState({ boosts: [], loaded: true });
  const b = siteBoostFor("https://www.example.com/page", true);
  assert.equal(b.site.host, "example.com");
  assert.equal(siteBoostFor("https://news.example.com/", false), null);
  assert.equal(siteBoostFor("https://example.com/other", true).id, b.id);
  updateBoost(b.id, { enabled: false });
  addZap(b.id, { selector: ".a", label: "a" });
  addZap(b.id, { selector: ".a", label: "dupe" });
  addZap(b.id, { selector: ".b", label: "b" });
  let now = useBoosts.getState().boosts[0];
  assert.equal(now.enabled, true);
  assert.deepEqual(now.zaps.map((z) => z.selector), [".a", ".b"]);
  removeZap(b.id, ".b");
  now = useBoosts.getState().boosts[0];
  assert.deepEqual(now.zaps.map((z) => z.selector), [".a"]);
  updateBoost(b.id, { site: { host: "bad host", subdomains: false, path: "" } });
  assert.equal(useBoosts.getState().boosts[0].site.host, "example.com");
  assert.ok(addBoost(newBoost(site("other.org"))));
  assert.equal(useBoosts.getState().boosts.length, 2);
});
