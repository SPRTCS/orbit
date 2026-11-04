import assert from "node:assert/strict";
import { test } from "node:test";

const { DockMagnification, ICON_DOCK_WIDTH, dockTile, isIconDock, pageItems, rootItems, snapSidebarWidth } = await import("./model.ts");

const keys = (items) => items?.map((i) => i.key) ?? null;
const source = {
  tiles: ["a", "b"],
  nodes: [{ tabIds: ["row"] }, { folderId: "tax", children: [{ tabIds: ["t1", "t2"] }, { folderId: "inner", children: [{ tabIds: ["deep"] }] }] }, { tabIds: ["g1", "g2"] }],
  open: ["x", "y"],
};

test("a narrow drag snaps to the icon dock and a wider one back to the sidebar", () => {
  assert.equal(snapSidebarWidth(60, 160), ICON_DOCK_WIDTH);
  assert.equal(snapSidebarWidth(127, 160), ICON_DOCK_WIDTH);
  assert.equal(snapSidebarWidth(128, 160), 160);
  assert.equal(snapSidebarWidth(250, 160), 250);
  assert.ok(isIconDock(ICON_DOCK_WIDTH));
  assert.ok(isIconDock(127));
  assert.ok(!isIconDock(128));
});

test("the root page lists the pins in sidebar order, folders among them, then open tabs", () => {
  assert.deepEqual(keys(rootItems(source)), ["t:a", "t:b", "t:row", "f:tax", "t:g1", "t:g2", "separator", "t:x", "t:y"]);
  assert.deepEqual(keys(rootItems({ tiles: [], nodes: [], open: ["x"] })), ["t:x"]);
  assert.deepEqual(keys(rootItems({ tiles: ["a"], nodes: [], open: [] })), ["t:a"]);
});

test("folders open as pages", () => {
  assert.deepEqual(keys(pageItems(source, { kind: "folder", id: "tax" })), ["t:t1", "t:t2", "f:inner"]);
  assert.deepEqual(keys(pageItems(source, { kind: "folder", id: "inner" })), ["t:deep"]);
  assert.equal(pageItems(source, { kind: "folder", id: "gone" }), null);
});

test("at most twelve icons fit a screen, within the tile limits", () => {
  assert.equal(dockTile(2000), 52);
  assert.equal(dockTile(300), 38);
  const tile = dockTile(700);
  assert.ok(tile * 12 + 8 * 11 + 16 <= 700);
});

test("magnification peaks under the pointer and falls off evenly", () => {
  const dock = new DockMagnification(Array(15).fill(false), 800);
  const middle = dock.rest[9].center;
  const grown = dock.layout(middle);
  assert.equal(grown[9].size, dock.peak);
  assert.ok(Math.abs(grown[8].size - grown[10].size) < 1e-9);
  assert.ok(Math.abs(grown[9].center - middle) < 1e-9);
  assert.ok(grown[8].size > dock.tile && grown[8].size < dock.peak);
  assert.deepEqual(dock.layout(middle, 0), dock.rest);
  assert.ok(dock.layout(middle, 0.5)[9].size < dock.peak);
});

test("the pointer picks the nearest icon, never a separator", () => {
  const dock = new DockMagnification([false, true, false], 800);
  assert.equal(dock.index(dock.rest[1].center), 0);
  assert.equal(dock.index(dock.rest[2].center + 3), 2);
  assert.equal(dock.index(dock.restHeight + 100), null);
});
