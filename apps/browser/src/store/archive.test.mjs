import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const archive = await import("./archive.ts");
const { restoreArchived, startArchive } = await import("../lib/archive.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const A = () => archive.useArchive.getState().entries;
const urls = () => A().map((e) => e.url);
const DAY = 86_400_000;

const closed = (id, url, extra = {}) => ({
  kind: "tab",
  id,
  tab: { url, title: url, favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId: "default" },
  windowId: "w",
  index: 0,
  group: null,
  closedAt: 1000,
  ...extra,
});
const entry = (url, archivedAt, profileId = "default") => ({ ...archive.toArchived(closed(`ct-${url}`, url, { closedAt: archivedAt }), "closed"), profileId });

function setup() {
  stub.docs.clear();
  archive.useArchive.setState({ entries: [] });
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com" });
  const c = S().newTab(w, { url: "https://c.com" });
  S().activate(a);
  return { w, a, b, c, stop: startArchive(0) };
}

test("only regular, unpinned web tabs are archivable", () => {
  assert.equal(archive.archivable(closed("1", "https://a.com")), true);
  assert.equal(archive.archivable(closed("2", "")), false, "blank tab");
  assert.equal(archive.archivable(closed("3", "orbit://settings")), false, "internal page");
  assert.equal(archive.archivable(closed("4", "https://a.com", { pinnedTile: true })), false, "unloaded pin");
  const secret = closed("5", "https://a.com");
  secret.tab.profileId = "incognito:1";
  assert.equal(archive.archivable(secret), false, "private");
});

test("a list trimmed at its cap isn't read as tabs being restored", () => {
  const prev = [closed("1", "https://a.com"), closed("2", "https://b.com"), closed("3", "https://c.com")];
  assert.deepEqual(archive.closedChanges(prev, [...prev.slice(1), closed("4", "https://d.com")]).removed, []);
  assert.deepEqual(archive.closedChanges(prev, [prev[0], prev[2]]).removed, ["2"]);
  assert.deepEqual(archive.closedChanges(prev, prev), { added: [], removed: [] });
});

test("the archive keeps the latest copy of a page, 30 days and 1000 entries at most", () => {
  const now = 100 * DAY;
  const list = archive.addArchived([entry("https://a.com", now - 5), entry("https://b.com", now - 4)], [entry("https://a.com", now - 1)], now);
  assert.deepEqual(list.map((e) => [e.url, e.archivedAt]), [["https://b.com", now - 4], ["https://a.com", now - 1]]);
  const otherSpace = archive.addArchived(list, [entry("https://b.com", now, "work")], now);
  assert.equal(otherSpace.length, 3, "the same page in another space is its own entry");
  const old = archive.addArchived([entry("https://old.com", now - 31 * DAY)], [entry("https://new.com", now)], now);
  assert.deepEqual(old.map((e) => e.url), ["https://new.com"]);
  const many = Array.from({ length: archive.MAX_ARCHIVED + 5 }, (_, i) => entry(`https://${i}.com`, now - archive.MAX_ARCHIVED - 5 + i));
  const capped = archive.pruneArchive(many, now);
  assert.equal(capped.length, archive.MAX_ARCHIVED);
  assert.equal(capped[0].url, "https://5.com", "the oldest go first");
});

test("days list newest first and search matches title and URL", () => {
  const today = archive.dayOf(Date.now());
  const list = [entry("https://old.com", today - DAY + 1), entry("https://news.com", today + 1), entry("https://docs.com", today + 2)];
  const days = archive.archiveDays(list);
  assert.deepEqual(days.map((d) => d.entries.map((e) => e.url)), [["https://docs.com", "https://news.com"], ["https://old.com"]]);
  assert.deepEqual(archive.archiveDays(list, "NEWS").flatMap((d) => d.entries.map((e) => e.url)), ["https://news.com"]);
});

test("closing, clean-up and Clear archive tabs; undo and reopen take them back out", () => {
  const { w, a, b, c, stop } = setup();
  S().closeTab(b);
  assert.equal(A().length, 1);
  assert.ok(A()[0].url.startsWith("https://b.com"));
  assert.equal(A()[0].reason, "closed");
  assert.equal(A()[0].profileId, "default");

  S().updateTab(c, { lastActiveAt: 0 });
  assert.equal(S().cleanUpTabs(w, { inactiveForMs: 60_000 }), 1);
  assert.equal(A().at(-1).reason, "cleanUp");
  assert.equal(A().length, 2);

  S().reopenClosedTab(w);
  assert.equal(A().length, 1, "reopened from Recently Closed leaves the archive");
  assert.equal(A()[0].reason, "cleanUp");

  const cleared = S().clearUnpinnedTabs(w);
  assert.ok(cleared.entries.length >= 2);
  const afterClear = A().length;
  assert.ok(afterClear >= 3);
  S().undoClearTabs(cleared);
  assert.equal(A().length, 1, "Undo Clear takes them back out");
  assert.ok(S().tabs[a] || Object.values(S().tabs).some((t) => t.url.startsWith("https://a.com")));
  stop();
});

test("private tabs are never archived", () => {
  const { stop } = setup();
  const p = S().createWindow({ incognito: true, url: "https://secret.com" });
  S().newTab(p, { url: "https://secret2.com" });
  S().closeTab(S().windows[p].tabIds[0]);
  assert.deepEqual(A(), []);
  stop();
});

test("restoring an entry opens it in its space and removes it everywhere", () => {
  const { w, b, stop } = setup();
  S().closeTab(b);
  const [e] = A();
  const tabId = restoreArchived(e.id, { windowId: w });
  assert.ok(tabId);
  assert.ok(S().tabs[tabId].url.startsWith("https://b.com"));
  assert.equal(S().tabs[tabId].windowId, w);
  assert.deepEqual(A(), []);
  assert.equal(S().closedTabs.some((c) => c.id === e.sourceId), false, "⇧⌘T won't reopen it a second time");

  S().closeTab(tabId);
  const [again] = A();
  const shown = S().windows[w].activeTabIds.default;
  const behind = restoreArchived(again.id, { windowId: w, background: true });
  assert.ok(S().tabs[behind]);
  assert.equal(S().windows[w].activeTabIds.default, shown, "⌘-click restores behind the current tab");
  assert.equal(S().closedTabs.some((c) => c.id === again.sourceId), false);
  stop();
});

test("the archive persists in archive.json and skips entries from before launch", async () => {
  const { b, stop } = setup();
  S().closeTab(b);
  stop();
  const saved = JSON.parse(stub.docs.get("archive.json"));
  assert.equal(saved.version, 1);
  assert.equal(saved.entries.length, 1);

  archive.useArchive.setState({ entries: [] });
  const restart = startArchive();
  assert.equal(A().length, 1, "read back at launch");
  const before = S().closedTabs;
  useBrowser.setState({ closedTabs: [...before, closed("ct-stale", "https://stale.com", { closedAt: 5 })] });
  assert.equal(A().length, 1, "a session's old closed tabs aren't archived again");
  archive.clearArchive();
  restart();
  assert.deepEqual(JSON.parse(stub.docs.get("archive.json")).entries, []);
});

test("deleting a space drops its archived tabs", () => {
  const { stop } = setup();
  archive.useArchive.setState({ entries: [entry("https://a.com", Date.now()), entry("https://w.com", Date.now(), "work")] });
  useBrowser.setState((s) => ({ profiles: { ...s.profiles } }));
  assert.deepEqual(urls(), ["https://a.com"]);
  stop();
});
