import assert from "node:assert/strict";
import { test } from "node:test";
const F = await import("./pinnedFolders.ts");
const { useBrowser } = await import("./browser.ts");

const tree = (root, folders = {}) => ({
  root,
  folders: Object.fromEntries(Object.entries(folders).map(([id, children]) => [id, { id, name: id, collapsed: false, children }])),
});
const shape = (nodes) => nodes.map((n) => (n.children ? { [n.ref]: shape(n.children) } : n.ref));

test("an empty tree shows the pinned items in upstream order", () => {
  assert.deepEqual(shape(F.resolveTree(F.EMPTY_TREE, ["t:a", "t:b", "g:c"])), ["t:a", "t:b", "g:c"]);
});

test("self-healing: unknown ids appear at root next to their upstream neighbour, removed ids vanish", () => {
  const t = tree(["t:a", "f:x", "g:c"], { x: ["t:b", "t:gone"] });
  assert.deepEqual(shape(F.resolveTree(t, ["t:a", "t:b", "t:new", "g:c"])), ["t:a", { "f:x": ["t:b"] }, "t:new", "g:c"]);
  assert.deepEqual(shape(F.resolveTree(t, ["t:first", "t:a", "g:c"])), ["t:first", "t:a", { "f:x": [] }, "g:c"]);
  assert.deepEqual(shape(F.resolveTree(t, [])), [{ "f:x": [] }], "folders stay when every pin is gone");
});

test("folders unreachable from the root are shown at root instead of lost", () => {
  const t = tree(["t:a"], { lost: ["t:b"] });
  assert.deepEqual(shape(F.resolveTree(t, ["t:a", "t:b"])), ["t:a", { "f:lost": ["t:b"] }]);
});

test("move into and out of folders", () => {
  let t = tree(["t:a", "t:b", "f:x", "t:c"], { x: [] });
  t = F.moveNodes(t, ["t:a"], { parent: "x" });
  assert.deepEqual(t.root, ["t:b", "f:x", "t:c"]);
  assert.deepEqual(t.folders.x.children, ["t:a"]);
  t = F.moveNodes(t, ["t:c", "t:b"], { parent: "x", before: "t:a" });
  assert.deepEqual(t.folders.x.children, ["t:c", "t:b", "t:a"]);
  assert.deepEqual(t.root, ["f:x"]);
  t = F.moveNodes(t, ["t:b"], { parent: null, before: "f:x" });
  assert.deepEqual(t.root, ["t:b", "f:x"]);
  assert.deepEqual(t.folders.x.children, ["t:c", "t:a"]);
  t = F.moveNodes(t, ["t:a"], { parent: null });
  assert.deepEqual(t.root, ["t:b", "f:x", "t:a"]);
});

test("moving before an item that is itself moving lands before its next sibling", () => {
  const t = F.moveNodes(tree(["t:a", "t:b", "t:c", "t:d"]), ["t:d", "t:b"], { parent: null, before: "t:b" });
  assert.deepEqual(t.root, ["t:a", "t:d", "t:b", "t:c"]);
});

test("nesting: folders hold folders to any depth", () => {
  let t = F.createFolder(F.EMPTY_TREE, "x", "Work");
  t = F.createFolder(t, "y", "Projects", { parent: "x" });
  t = F.createFolder(t, "z", "Orbit", { parent: "y" }, ["t:a"]);
  assert.deepEqual(shape(F.resolveTree(t, ["t:a", "t:b"])), [{ "f:x": [{ "f:y": [{ "f:z": ["t:a"] }] }] }, "t:b"]);
  assert.equal(F.folderDepth(t, "z"), 2);
  assert.equal(F.isWithin(t, "x", "z"), true);
  assert.equal(F.isWithin(t, "z", "x"), false);
  t = F.moveNodes(t, ["f:z"], { parent: null, before: "f:x" });
  assert.deepEqual(shape(F.resolveTree(t, ["t:a"])), [{ "f:z": ["t:a"] }, { "f:x": [{ "f:y": [] }] }]);
});

test("cycle prevention: a folder can't move into itself or a descendant", () => {
  let t = F.createFolder(F.EMPTY_TREE, "x", "X");
  t = F.createFolder(t, "y", "Y", { parent: "x" });
  assert.equal(F.moveNodes(t, ["f:x"], { parent: "x" }), t);
  assert.equal(F.moveNodes(t, ["f:x"], { parent: "y" }), t);
  assert.equal(F.moveNodes(t, ["t:a", "f:x"], { parent: "y" }), t, "a mixed move with a cycle is refused whole");
  assert.equal(F.moveNodes(t, ["t:a"], { parent: "missing" }), t);
  assert.notEqual(F.moveNodes(t, ["f:y"], { parent: null }), t);
});

test("deleting a folder moves its contents up into its place", () => {
  let t = tree(["t:a", "f:x", "t:d"], { x: ["t:b", "f:y"], y: ["t:c"] });
  t = F.deleteFolder(t, "x");
  assert.deepEqual(t.root, ["t:a", "t:b", "f:y", "t:d"]);
  assert.equal(t.folders.x, undefined);
  assert.deepEqual(t.folders.y.children, ["t:c"]);
  t = F.deleteFolder(t, "y");
  assert.deepEqual(t.root, ["t:a", "t:b", "t:c", "t:d"]);
  assert.equal(F.hasFolders(t), false);
});

test("rename and collapse keep the tree when nothing changes", () => {
  const t = F.createFolder(F.EMPTY_TREE, "x", "X");
  assert.equal(F.renameFolder(t, "x", "X"), t);
  assert.equal(F.renameFolder(t, "x", "Work").folders.x.name, "Work");
  assert.equal(F.setFolderCollapsed(t, "x", true).folders.x.collapsed, true);
  assert.equal(F.setFolderCollapsed(t, "nope", true), t);
});

test("reconcile: follows upstream reorders among siblings, drops removed pins, places new ones", () => {
  let t = tree(["t:a", "t:b", "t:c"]);
  t = F.reconcileTree(t, ["t:a", "t:b", "t:c"], ["t:b", "t:a", "t:c"]);
  assert.deepEqual(t.root, ["t:b", "t:a", "t:c"]);
  t = F.reconcileTree(t, ["t:b", "t:a", "t:c"], ["t:b", "t:c"]);
  assert.deepEqual(t.root, ["t:b", "t:c"]);
  t = F.reconcileTree(t, ["t:b", "t:c"], ["t:b", "t:n", "t:c"]);
  assert.deepEqual(t.root, ["t:b", "t:n", "t:c"]);
  assert.equal(F.reconcileTree(t, ["t:b", "t:n", "t:c"], []), t, "an empty observation never prunes");
});

test("reconcile keeps folder contents in their folders when upstream order changes across folders", () => {
  let t = tree(["t:a", "f:x"], { x: ["t:b", "t:c"] });
  t = F.reconcileTree(t, ["t:a", "t:b", "t:c"], ["t:c", "t:a", "t:b"]);
  assert.deepEqual(t.root, ["t:a", "f:x"]);
  assert.deepEqual(t.folders.x.children, ["t:c", "t:b"]);
});

test("pinnedRefs: pinned rows then pinned groups, keyed by pin key across mirrored windows", () => {
  const S = () => useBrowser.getState();
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com/" });
  const c = S().newTab(w, { url: "https://c.com/" });
  const d = S().newTab(w, { url: "https://d.com/" });
  S().pinTabs([a, b], true, true);
  S().pinTabs([c], true, false);
  S().groupTabs([d]);
  const g = Object.values(S().groups)[0];
  const refs = F.pinnedRefs(S(), "default");
  assert.deepEqual(refs, [`t:${a}`, `t:${b}`, ...(g.pinned ? [`g:${g.id}`] : [])]);
  const view = F.windowRefs(S(), [a, b], g.pinned ? [g.id] : []);
  assert.deepEqual(view.refs, refs);
  assert.equal(view.idOf.get(`t:${a}`), a);
});

test("Arc import plan puts imported pins into their folders in Arc's order", () => {
  let t = F.createFolder(tree(["t:old"]), "work", "Work");
  t = F.createFolder(t, "deep", "Deep", { parent: "work" });
  const plan = {
    urls: ["https://top.com/", "https://w1.com/", "https://d1.com/", "https://w2.com/"],
    layout: [
      { parent: null, items: [0, "f:work"] },
      { parent: "work", items: [1, "f:deep", 3] },
      { parent: "deep", items: [2] },
    ],
    expires: Infinity,
  };
  t = F.reconcileTree(t, null, ["t:old", "t:1", "t:2", "t:3", "t:4"]);
  const { tree: out, matched } = F.applyImportPlan(t, plan, [
    { ref: "t:1", url: "https://top.com" },
    { ref: "t:2", url: "https://w1.com/" },
    { ref: "t:3", url: "https://d1.com/" },
    { ref: "t:4", url: "https://w2.com/" },
  ]);
  assert.equal(matched, 4);
  assert.deepEqual(shape(F.resolveTree(out, ["t:old", "t:1", "t:2", "t:3", "t:4"])), [
    "t:old",
    "t:1",
    { "f:work": ["t:2", { "f:deep": ["t:3"] }, "t:4"] },
  ]);
});
