import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { activeTabId, viewTabIds } = await import("../store/model.ts");
const { splitOf } = await import("../store/splits.ts");
const { PEEK_SITE_SOURCE, SHARED_SUFFIXES, peekLinkScript, siteOf, siteOfHost } = await import("./peekSites.ts");
const { closePeek, notePeekPage, openPeek, openPeekAsTab, opensInPeek, peekConfig, peekFromPage, usePeeks } = await import("./peek.ts");

const S = () => useBrowser.getState();
const peekIn = (w) => usePeeks.getState().peeks[w];

function pinnedWindow() {
  S().hydrate({});
  usePeeks.setState({ peeks: {} });
  const w = S().createWindow({ url: "https://mail.google.com/mail/u/0/" });
  const pin = S().windows[w].tabIds[0];
  S().pinTabs([pin], true);
  const other = S().newTab(w, { url: "https://news.ycombinator.com/" });
  S().activate(pin);
  return { w, pin, other };
}

test("sites are registrable domains: subdomains, shared suffixes, ports, IPs", () => {
  assert.equal(siteOf("https://mail.google.com/x"), "google.com");
  assert.equal(siteOf("https://accounts.google.com:443/"), "google.com");
  assert.equal(siteOf("https://www.bbc.co.uk/news"), "bbc.co.uk");
  assert.equal(siteOf("https://user:pw@a.b.example.com/"), "example.com");
  assert.equal(siteOf("https://foo.github.io/bar"), "foo.github.io");
  assert.equal(siteOf("http://192.168.1.10:8080/"), "192.168.1.10");
  assert.equal(siteOf("http://localhost:3000/"), "localhost");
  assert.equal(siteOf("ardia://settings"), "");
});

test("the page's copy of the site rule agrees with the app's", () => {
  const pageSite = new Function(`return (${PEEK_SITE_SOURCE})`)()(SHARED_SUFFIXES);
  for (const host of ["mail.google.com", "www.bbc.co.uk", "a.b.c.example.org", "x.vercel.app", "10.0.0.1", "[::1]", "LOCALHOST", "example.com.", "co.uk"]) {
    assert.equal(pageSite(host), siteOfHost(host), host);
  }
});

function pageWith(config) {
  const listeners = new Map();
  const posted = [];
  class HTMLAnchorElement {
    constructor(href, attrs = {}) {
      const u = new URL(href);
      Object.assign(this, { href: u.href, protocol: u.protocol, hostname: u.hostname, attrs: { href, ...attrs } });
    }
    hasAttribute(name) {
      return name in this.attrs;
    }
  }
  class HTMLAreaElement {}
  const env = {
    HTMLAnchorElement,
    HTMLAreaElement,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    dispatchEvent: (e) => (listeners.get(e.type) ?? []).slice().forEach((fn) => fn(e)),
  };
  const run = () => new Function(...Object.keys(env), "post", peekLinkScript(config, "sig"))(...Object.values(env), (kind, json) => posted.push([kind, JSON.parse(json)]));
  const click = (href, options = {}) => {
    const { attrs, ...rest } = options;
    const event = { isTrusted: true, defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...rest };
    event.composedPath = () => [{}, new HTMLAnchorElement(href, attrs)];
    let stopped = false;
    event.preventDefault = () => (stopped = event.defaultPrevented = true);
    (listeners.get("click") ?? []).slice().forEach((fn) => fn(event));
    return stopped;
  };
  return { run, click, posted, listeners };
}

test("the page script stops a plain click to another site only for pinned tabs, and any ⇧-click", () => {
  const pinned = pageWith({ sites: ["google.com"], shift: true });
  pinned.run();
  assert.equal(pinned.click("https://accounts.google.com/"), false, "same site navigates in the pinned tab");
  assert.equal(pinned.click("https://example.com/", { metaKey: true }), false, "⌘-click keeps Chrome's background tab");
  assert.equal(pinned.click("https://example.com/", { attrs: { download: "" } }), false, "downloads stay downloads");
  assert.equal(pinned.click("https://example.com/", { isTrusted: false }), false, "synthetic clicks don't peek");
  assert.equal(pinned.click("https://example.com/", { defaultPrevented: true }), false, "links the page handled itself stay the page's");
  assert.equal(pinned.click("https://example.com/a"), true);
  assert.deepEqual(pinned.posted, [["result", { url: "https://example.com/a", shift: false }]]);
  assert.equal(pinned.click("https://example.com/b"), false, "one answer per arming; the app arms again");

  const regular = pageWith({ sites: null, shift: true });
  regular.run();
  assert.equal(regular.click("https://example.com/"), false);
  assert.equal(regular.click("https://news.ycombinator.com/item", { shiftKey: true }), true);
  assert.deepEqual(regular.posted, [["result", { url: "https://news.ycombinator.com/item", shift: true }]]);
});

test("arming again replaces the previous listener instead of stacking a second one", () => {
  const page = pageWith({ sites: ["google.com"], shift: true });
  page.run();
  page.run();
  assert.deepEqual(page.posted, [["result", { replaced: true }]]);
  assert.equal(page.listeners.get("click").length, 1);
  assert.equal(page.click("https://example.com/"), true);
  assert.equal(page.posted.length, 2);
});

test("pinned tabs peek at other sites, regular tabs and Little Orbit don't, and the setting turns it off", () => {
  const { w, pin, other } = pinnedWindow();
  S().navigate(pin, "https://calendar.google.com/");
  assert.deepEqual(peekConfig(S(), pin), { sites: ["google.com"], shift: true });
  assert.deepEqual(peekConfig(S(), other), { sites: null, shift: true });
  assert.equal(opensInPeek(S(), pin, "https://example.com/"), true);
  assert.equal(opensInPeek(S(), pin, "https://drive.google.com/"), false);
  assert.equal(opensInPeek(S(), other, "https://example.com/"), false);
  S().updateSettings({ openPinnedLinksInPeek: false });
  assert.deepEqual(peekConfig(S(), pin), { sites: null, shift: true });
  S().updateSettings({ openPinnedLinksInPeek: true });
  const small = S().createWindow({ small: true, url: "https://example.com/" });
  assert.equal(peekConfig(S(), S().windows[small].tabIds[0]), null);
  assert.ok(S().windows[w]);
});

test("a new-tab link from a pinned tab to another site opens in Peek; ⌘-click and same-site links don't", () => {
  const { w, pin } = pinnedWindow();
  const tab = S().tabs[pin];
  assert.equal(peekFromPage({ url: "https://example.com/", disposition: "background", adoptId: "tab:1" }, tab), false);
  assert.equal(peekFromPage({ url: "https://docs.google.com/", disposition: "foreground", adoptId: "tab:2" }, tab), false);
  assert.equal(peekFromPage({ url: "https://example.com/", disposition: "foreground", adoptId: "tab:3" }, tab), true);
  const peek = peekIn(w);
  assert.equal(peek.adoptId, "tab:3");
  assert.equal(peek.sourceTabId, pin);
  assert.ok(!S().tabs[peek.id], "a peek is no sidebar tab");
  assert.equal(S().windows[w].tabIds.length, 2);
});

test("switching tabs closes the peek and leaves nothing behind", () => {
  const { w, pin, other } = pinnedWindow();
  const tabsBefore = Object.keys(S().tabs).length;
  assert.equal(openPeek(pin, "https://example.com/"), true);
  S().updateTab(pin, { title: "Inbox" });
  assert.ok(peekIn(w), "updates to the page under it keep it");
  S().activate(other);
  assert.equal(peekIn(w), undefined);
  assert.equal(Object.keys(S().tabs).length, tabsBefore);
  assert.equal(S().closedTabs.length, 0);
});

test("Open as Tab turns the peek's page into a foreground tab with the same id and its current page", () => {
  const { w, pin } = pinnedWindow();
  openPeek(pin, "https://example.com/");
  const peek = peekIn(w);
  notePeekPage(w, peek.id, { url: "https://example.com/next", title: "Next" });
  assert.equal(openPeekAsTab(w), peek.id);
  assert.equal(peekIn(w), undefined);
  const tab = S().tabs[peek.id];
  assert.equal(tab.url, "https://example.com/next");
  assert.equal(tab.navigation.url, "https://example.com/next", "the moved page is the page already loaded, so nothing reloads");
  assert.equal(tab.title, "Next");
  assert.equal(tab.openerId, pin);
  assert.equal(tab.pinned, false);
  assert.equal(activeTabId(S(), w), peek.id);
  assert.ok(viewTabIds(S(), w).includes(peek.id));
  assert.equal(viewTabIds(S(), w).length, 3);
});

test("Open in Split View puts the page beside the pinned tab", () => {
  const { w, pin } = pinnedWindow();
  openPeek(pin, "https://example.com/");
  const peek = peekIn(w);
  openPeekAsTab(w, { split: true });
  const split = splitOf(S(), peek.id);
  assert.ok(split, "the peek's tab is in a split");
  assert.deepEqual(split.tabIds, [pin, peek.id]);
});

test("Esc / backdrop close drops the peek without touching the window", () => {
  const { w, pin } = pinnedWindow();
  const before = S().windows[w];
  openPeek(pin, "https://example.com/");
  closePeek(w);
  assert.equal(peekIn(w), undefined);
  assert.equal(S().windows[w], before);
});
