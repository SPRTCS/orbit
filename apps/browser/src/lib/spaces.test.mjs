import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const F = await import("../store/pinnedFolders.ts");
const L = await import("./pinnedFolders.ts");
const X = await import("../store/spaceSnapshot.ts");
const A = await import("../store/spaceApply.ts");
const S2 = await import("./spaces.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const host = (url) => new URL(url).host.replace(/\.com$/, "");
const shape = (nodes) =>
  nodes.map((n) => (n.kind === "folder" ? { [n.name]: shape(n.children) } : n.kind === "group" ? { [`[${n.name}]`]: n.tabs.map((t) => host(t.url)) } : host(n.url)));
const docShape = (doc) => ({ tiles: doc.tiles.map((t) => host(t.url)), pinned: shape(doc.pinned), today: doc.today ? shape(doc.today) : undefined });
const snap = (profileId = "default", options = {}) => S2.spaceDocument(profileId, options);

function setup() {
  stub.docs.clear();
  S().hydrate({});
  const stop = L.startPinnedFolders();
  const w = S().createWindow({ url: "https://tile1.com/" });
  const open = (h) => S().newTab(w, { url: `https://${h}.com/` });
  const [t1] = S().windows[w].tabIds;
  const t2 = open("tile2");
  S().pinTabs([t1, t2], true, false);
  const rows = ["a", "b", "c", "d"].map(open);
  S().pinTabs(rows, true, true);
  const members = ["g1", "g2"].map(open);
  const g = S().groupTabs(members, { pinned: true, name: "Docs" });
  S().updateGroup(g, { color: "blue", icon: "📄" });
  const today = ["x", "y"].map(open);
  const loose = ["z1", "z2"].map(open);
  S().createGroup(loose, { name: "Reading", color: "green" });
  S().updateTab(rows[0], { customTitle: "Alpha", customIcon: "🅰️" });
  const ref = (id) => F.tabRef(S().tabs[id]);
  const work = L.newPinnedFolder(w, { name: "Work", contents: [ref(rows[1]), ref(rows[2])], rename: false });
  L.newPinnedFolder(w, { name: "Deep", target: { parent: work }, contents: [F.groupRef(S().groups[g])], rename: false });
  return { w, rows, g, today, stop };
}

const BUILT = {
  tiles: ["tile1", "tile2"],
  pinned: ["a", { Work: ["b", "c", { Deep: [{ "[Docs]": ["g1", "g2"] }] }] }, "d"],
};

test("a space snapshot holds tiles, pins, groups and nested folders, and nothing private", () => {
  const { stop } = setup();
  const doc = snap();
  assert.equal(doc.format, "orbit-space");
  assert.equal(doc.version, 1);
  assert.equal(doc.name, "Personal");
  assert.deepEqual(docShape(doc), { ...BUILT, today: undefined });
  assert.deepEqual(doc.pinned[0], { kind: "tab", url: "https://a.com/", customTitle: "Alpha", customIcon: "🅰️" });
  const group = doc.pinned[1].children[2].children[0];
  assert.deepEqual({ name: group.name, color: group.color, icon: group.icon }, { name: "Docs", color: "blue", icon: "📄" });
  const withToday = snap("default", { today: true });
  assert.deepEqual(shape(withToday.today), ["x", "y", { "[Reading]": ["z1", "z2"] }]);
  const text = X.serializeSpace(withToday);
  for (const word of ["cookie", "password", "history", "navigation", "lastActiveAt", "windowId", "profileId"]) assert.equal(text.includes(`"${word}`), false, `no ${word} in the file`);
  stop();
});

test("serialization round-trips, including nested folders, through parse", () => {
  const { stop } = setup();
  const doc = snap("default", { today: true });
  const back = X.parseSpace(X.serializeSpace(doc));
  assert.deepEqual(back, doc);
  assert.equal(X.spaceSignature(back), X.spaceSignature(doc));
  stop();
});

test("version handling: newer files are refused with a clear message, damaged ones too, unknown fields are ignored", () => {
  const base = { format: "orbit-space", version: 1, kind: "space", name: "S", tiles: [], pinned: [{ kind: "tab", url: "https://a.com/" }] };
  assert.throws(() => X.parseSpace(JSON.stringify({ ...base, version: 2 })), /newer version of Orbit/);
  assert.throws(() => X.parseSpace(JSON.stringify({ ...base, version: 0 })), /no valid version/);
  assert.throws(() => X.parseSpace(JSON.stringify({ ...base, version: "1" })), /no valid version/);
  assert.throws(() => X.parseSpace(JSON.stringify({ ...base, format: "arc" })), /isn't an Orbit space/);
  assert.throws(() => X.parseSpace("{nope"), /isn't an Orbit space/);
  const doc = X.parseSpace(JSON.stringify({ ...base, futureField: { x: 1 }, pinned: [{ kind: "tab", url: "https://a.com/", extra: 1 }, { kind: "widget" }] }));
  assert.deepEqual(doc.pinned, [{ kind: "tab", url: "https://a.com/" }]);
  assert.equal("futureField" in doc, false);
});

test("parsing a shared file drops unsafe links and caps what it reads", () => {
  const doc = X.parseSpace({
    format: "orbit-space",
    version: 1,
    name: "  Mixed  ",
    color: "chartreuse",
    theme: { stops: "nope" },
    tiles: [{ url: "javascript:alert(1)" }, { url: "https://ok.com/" }, { url: "file:///Users/me/secret.txt" }, "junk"],
    pinned: [{ kind: "folder", name: "F", children: [{ kind: "group", name: "G", color: "magenta", tabs: [{ url: "data:text/html,hi" }] }, { kind: "tab", url: "http://x.com/" }] }],
  });
  assert.equal(doc.name, "Mixed");
  assert.equal(doc.color, undefined);
  assert.equal(doc.theme, undefined);
  assert.deepEqual(doc.tiles, [{ url: "https://ok.com/" }]);
  assert.deepEqual(doc.pinned, [{ kind: "folder", name: "F", children: [{ kind: "tab", url: "http://x.com/" }] }], "an empty group is dropped");
  const local = X.parseSpace({ format: "orbit-space", version: 1, tiles: [{ url: "file:///tmp/a.html" }], pinned: [] }, { local: true });
  assert.equal(local.tiles.length, 1, "local sessions may keep file links");
  let deep = { kind: "tab", url: "https://leaf.com/" };
  for (let i = 0; i < 60; i++) deep = { kind: "folder", name: `L${i}`, children: [deep] };
  let depth = 0;
  for (let n = X.parseSpace({ format: "orbit-space", version: 1, tiles: [], pinned: [deep] }).pinned[0]; n?.kind === "folder"; n = n.children[0]) depth++;
  assert.ok(depth <= 33, "folders nest to a bounded depth");
});

test("importing into a new space recreates tiles, pins, groups and folders with upstream's pins", () => {
  const { w, stop } = setup();
  const doc = snap("default", { today: true });
  const id = S2.importAsNewSpace(doc, { name: "Copy", today: true, windowId: w });
  assert.equal(S().profiles[id].name, "Copy");
  assert.equal(S().profiles[id].dataId, undefined, "own data unless asked to share");
  const pins = Object.values(S().tabs).filter((t) => t.profileId === id && t.pinned);
  assert.equal(pins.length, 0, "a space nobody shows yet keeps its pins parked");
  assert.equal(S().parkedPins[id].tabs.length, 8);
  assert.deepEqual(docShape(snap(id, { today: true })), docShape(doc), "the copy reads back the same, today tabs included");
  S().switchProfile(w, id);
  assert.equal(S().parkedPins[id], undefined, "switching to it adopts the parked pins");
  assert.deepEqual(docShape(snap(id, { today: true })), docShape(doc));
  const rows = S().windows[w].tabIds.map((t) => S().tabs[t]).filter((t) => t.profileId === id && t.pinned && t.pinnedAsRow);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((t) => t.unloaded && !t.navigation), "imported pins don't load until opened");
  const shared = S2.importAsNewSpace(doc, { shareWith: "default", windowId: w });
  assert.equal(S().profiles[shared].dataId, "default", "or shares data with the chosen space");
  stop();
});

test("merge adds missing pins and folders without duplicating what's there", () => {
  const { w, stop } = setup();
  const incoming = {
    ...X.parseSpace(JSON.stringify(snap())),
    tiles: [{ url: "https://tile1.com/" }, { url: "https://tile3.com/" }],
    pinned: [
      { kind: "tab", url: "https://a.com/" },
      { kind: "folder", name: "New", children: [{ kind: "tab", url: "https://n.com/" }, { kind: "group", name: "docs", tabs: [{ url: "https://g1.com/" }, { url: "https://g3.com/" }] }] },
    ],
  };
  S2.applyPins("default", incoming, "merge");
  assert.deepEqual(docShape(snap()), {
    tiles: ["tile1", "tile2", "tile3"],
    pinned: ["a", { Work: ["b", "c", { Deep: [{ "[Docs]": ["g1", "g2", "g3"] }] }] }, "d", { New: ["n"] }],
    today: undefined,
  });
  assert.ok(S().windows[w], "the window stays");
  stop();
});

test("replace swaps the pins and folders; open pinned tabs stay as today tabs", () => {
  const { w, rows, stop } = setup();
  S().activate(rows[3]);
  S().navigate(rows[3], "https://d.com/page");
  S().updateTab(rows[0], { navigation: null, unloaded: true });
  const incoming = X.parseSpace({ format: "orbit-space", version: 1, tiles: [{ url: "https://t.com/" }], pinned: [{ kind: "folder", name: "Only", children: [{ kind: "tab", url: "https://o.com/" }] }] });
  S2.applyPins("default", incoming, "replace");
  assert.deepEqual(docShape(snap()), { tiles: ["t"], pinned: [{ Only: ["o"] }], today: undefined });
  const kept = S().tabs[rows[3]];
  assert.ok(kept && !kept.pinned, "the loaded pinned tab is kept, unpinned");
  assert.equal(S().windows[w].activeTabIds.default, rows[3]);
  assert.ok(!S().tabs[rows[0]], "unloaded pins are removed");
  assert.deepEqual(Object.keys(F.usePinnedFolders.getState().trees.default.folders).length, 1, "the old folders are gone");
  stop();
});

test("pins mirror to a second window after an import", () => {
  const { stop } = setup();
  S().createWindow({ url: "https://other.com/" });
  const incoming = X.parseSpace({ format: "orbit-space", version: 1, tiles: [], pinned: [{ kind: "tab", url: "https://m.com/" }] });
  S2.applyPins("default", incoming, "merge");
  for (const w of Object.values(S().windows)) {
    const has = w.tabIds.some((id) => S().tabs[id].pinnedUrl === "https://m.com/");
    assert.ok(has, `window ${w.id} shows the new pin`);
  }
  stop();
});

test("sharing a folder exports just its subtree, and importing it adds that folder", () => {
  const { stop } = setup();
  const tree = F.usePinnedFolders.getState().trees.default;
  const work = Object.values(tree.folders).find((f) => f.name === "Work").id;
  const doc = S2.folderDocument("default", work);
  assert.equal(doc.kind, "folder");
  assert.equal(doc.name, "Work");
  assert.deepEqual(docShape(doc), { tiles: [], pinned: [{ Work: ["b", "c", { Deep: [{ "[Docs]": ["g1", "g2"] }] }] }], today: undefined });
  const other = S().createProfile({ name: "Other" });
  S2.applyPins(other, X.parseSpace(X.serializeSpace(doc)), "merge");
  assert.deepEqual(docShape(snap(other)), { tiles: [], pinned: [{ Work: ["b", "c", { Deep: [{ "[Docs]": ["g1", "g2"] }] }] }], today: undefined });
  stop();
});

test("today tabs reopen into a window, or replace its today tabs", () => {
  const { w, today, stop } = setup();
  const items = [{ kind: "tab", url: "https://r1.com/" }, { kind: "group", name: "Later", tabs: [{ url: "https://r2.com/" }, { url: "https://r3.com/" }] }];
  S2.openToday("default", items, { windowId: w });
  assert.deepEqual(shape(snap("default", { today: true }).today), ["x", "y", { "[Reading]": ["z1", "z2"] }, "r1", { "[Later]": ["r2", "r3"] }]);
  S2.openToday("default", items, { windowId: w, replace: true });
  assert.deepEqual(shape(snap("default", { today: true }).today), ["r1", { "[Later]": ["r2", "r3"] }]);
  assert.ok(!S().tabs[today[0]], "the replaced today tabs are closed");
  assert.ok(S().closedTabs.some((c) => c.tab.url === "https://x.com/"), "and can be reopened");
  assert.ok(A.todayTabIds(S(), w, "default").includes(S().windows[w].activeTabIds.default), "a today tab is shown");
  stop();
});

test("share text is readable and imports back", () => {
  const { stop } = setup();
  const doc = snap();
  const text = X.shareText(doc);
  assert.match(text, /^Personal\n/);
  assert.match(text, /📁 Work/);
  assert.deepEqual(X.parseSpace(X.extractSpaceJson(text)), doc);
  stop();
});
