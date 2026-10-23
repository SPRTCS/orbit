import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const F = await import("../store/pinnedFolders.ts");
const L = await import("./pinnedFolders.ts");
const { pinnedTreeDrop, registerPinnedTree } = await import("../components/sidebar/pinnedFolderDrop.ts");
const { arcPinnedFolders } = await import("../components/import/arcFolders.ts");
const { importTabs } = await import("../components/import/apply.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const P = () => F.usePinnedFolders.getState();
const tree = () => P().trees.default;
const urlOf = (ref) => {
  const key = ref.slice(2);
  const t = S().tabs[key] ?? Object.values(S().tabs).find((x) => x.pinKey === key);
  return t ? new URL(t.pinnedUrl || t.url).host : ref;
};
const shape = (nodes) => nodes.map((n) => (n.children ? { [P().trees.default.folders[n.ref.slice(2)].name]: shape(n.children) } : urlOf(n.ref)));
const view = () => shape(F.resolveTree(tree(), F.pinnedRefs(S(), "default")));

function setup(...hosts) {
  stub.docs.clear();
  S().hydrate({});
  const stop = L.startPinnedFolders();
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids, stop };
}

test("folders self-heal as upstream pins, unpins and reorders", () => {
  const { w, ids: [a, b, c, d], stop } = setup("a", "b", "c", "d");
  S().pinTabs([a, b, c], true, true);
  assert.equal(tree(), undefined, "no tree until a folder exists");
  const folder = L.newPinnedFolder(w, { name: "Work", contents: [F.tabRef(S().tabs[b])], rename: false });
  assert.deepEqual(view(), ["a.com", { Work: ["b.com"] }, "c.com"]);
  S().pinTabs([d], true, true);
  assert.deepEqual(view(), ["a.com", { Work: ["b.com"] }, "c.com", "d.com"], "a new pin appears at root");
  S().pinTabs([b], false);
  assert.deepEqual(view(), ["a.com", { Work: [] }, "c.com", "d.com"], "an unpinned tab leaves its folder");
  assert.equal(F.refsIn(tree()).has(`t:${b}`), false, "and the overlay forgets it");
  S().moveTab(d, S().windows[w].tabIds.indexOf(c));
  assert.deepEqual(view(), ["a.com", { Work: [] }, "d.com", "c.com"], "an upstream reorder among root siblings is followed");
  L.setPinnedFolderCollapsed("default", folder, true);
  assert.equal(tree().folders[folder].collapsed, true);
  L.deletePinnedFolder("default", folder);
  assert.equal(tree(), undefined, "deleting the last folder drops the overlay");
  stop();
});

test("pins are mirrored per space: a second window shows the same tree through its own copies", () => {
  const { w, ids: [a, b], stop } = setup("a", "b");
  S().pinTabs([a, b], true, true);
  const folder = L.newPinnedFolder(w, { name: "Docs", contents: [F.tabRef(S().tabs[a])], rename: false });
  const w2 = S().createWindow({ url: "https://z.com/" });
  const rows = S().windows[w2].tabIds.filter((id) => S().tabs[id].pinned && S().tabs[id].pinnedAsRow);
  assert.equal(rows.length, 2, "the second window has its own copies of the pinned rows");
  const local = F.windowRefs(S(), rows, []);
  assert.deepEqual(new Set(local.refs), new Set([`t:${a}`, `t:${b}`]), "copies carry the first window's pin keys");
  const nodes = F.resolveTree(tree(), local.refs);
  assert.equal(nodes[0].ref, F.folderRef(folder));
  assert.notEqual(local.idOf.get(`t:${a}`), a, "and render their own tab ids");
  stop();
});

test("drag and drop: a list tab dropped on a folder header is pinned into that folder", () => {
  const { w, ids: [a, b, c], stop } = setup("a", "b", "c");
  S().pinTabs([a], true, true);
  const folder = L.newPinnedFolder(w, { name: "Inbox", rename: false });
  const controller = {};
  const headers = new Map([[folder, { x: 0, y: 100, w: 200, h: 34 }]]);
  const unregister = registerPinnedTree(controller, { windowId: w, profileId: "default", headers, showInto: () => {} });
  const claimed = pinnedTreeDrop(controller, [{ tabIds: [b] }], { type: "tabs", placement: { pinned: true, row: true, beforeId: null } }, { x: 50, y: 117 });
  assert.equal(claimed, true);
  assert.equal(S().tabs[b].pinnedAsRow, true);
  assert.deepEqual(view(), ["a.com", { Inbox: ["b.com"] }]);
  const between = pinnedTreeDrop(controller, [{ tabIds: [c] }], { type: "tabs", placement: { pinned: true, row: true, beforeId: b } }, { x: 50, y: 10 });
  assert.equal(between, true);
  assert.deepEqual(view(), ["a.com", { Inbox: ["c.com", "b.com"] }], "dropped before a row inside the folder joins the folder");
  assert.equal(pinnedTreeDrop(controller, [{ tabIds: [c] }], { type: "tabs", placement: { pinned: false, beforeId: null } }, { x: 0, y: 0 }), false, "drops into the list stay upstream's");
  assert.equal(pinnedTreeDrop({}, [{ tabIds: [c] }], { type: "tabs", placement: { pinned: true, row: true } }, { x: 0, y: 0 }), false, "a sidebar without folders stays upstream's");
  unregister();
  stop();
});

test("Arc import: pinned folders become overlay folders in Arc's order, not bookmarks", () => {
  const { stop } = setup("x");
  const space = {
    pinned: [
      { type: "url", title: "Top", url: "https://top.com/" },
      {
        type: "folder",
        title: "Work",
        children: [
          { type: "url", title: "W1", url: "https://w1.com/" },
          { type: "folder", title: "Deep", children: [{ type: "url", title: "D1", url: "https://d1.com/" }] },
          { type: "url", title: "W2", url: "https://w2.com/" },
        ],
      },
      { type: "url", title: "Last", url: "https://last.com/" },
    ],
    tabs: [],
  };
  const rest = arcPinnedFolders("default", space);
  assert.deepEqual(rest.pinned.map((n) => n.url), ["https://top.com/", "https://w1.com/", "https://d1.com/", "https://w2.com/", "https://last.com/"]);
  importTabs("default", rest.pinned.map((n) => ({ url: n.url, title: n.title, pinned: true, row: true })), null);
  assert.deepEqual(view(), ["top.com", { Work: ["w1.com", { Deep: ["d1.com"] }, "w2.com"] }, "last.com"]);
  assert.deepEqual(P().plans, {}, "the plan is used up");
  stop();
});

test("the overlay persists and comes back after a relaunch", () => {
  const { w, ids: [a], stop } = setup("a");
  S().pinTabs([a], true, true);
  const folder = L.newPinnedFolder(w, { name: "Kept", contents: [F.tabRef(S().tabs[a])], rename: false });
  L.renamePinnedFolder("default", folder, "Renamed");
  L.savePinnedFoldersNow();
  stop();
  F.usePinnedFolders.setState({ trees: {} });
  const again = L.startPinnedFolders();
  assert.equal(tree().folders[folder].name, "Renamed");
  assert.deepEqual(tree().folders[folder].children, [`t:${a}`]);
  again();
});
