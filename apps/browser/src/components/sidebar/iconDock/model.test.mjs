import assert from "node:assert/strict";
import { test } from "node:test";

const { DockColumn, ICON_DOCK_WIDTH, dockTile, isIconDock, pageItems, rootItems, snapSidebarWidth } = await import("./model.ts");

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

test("the root page lists the pins in sidebar order, folders among them, then New Tab and the open tabs", () => {
  assert.deepEqual(keys(rootItems(source)), ["t:a", "t:b", "t:row", "f:tax", "t:g1", "t:g2", "separator", "new-tab", "t:x", "t:y"]);
  assert.deepEqual(keys(rootItems({ tiles: [], nodes: [], open: ["x"] })), ["new-tab", "t:x"]);
  assert.deepEqual(keys(rootItems({ tiles: ["a"], nodes: [], open: [] })), ["t:a", "separator", "new-tab"]);
});

test("folders open as pages that keep the open tabs below", () => {
  assert.deepEqual(keys(pageItems(source, { kind: "folder", id: "tax" })), ["t:t1", "t:t2", "f:inner", "separator", "new-tab", "t:x", "t:y"]);
  assert.deepEqual(keys(pageItems(source, { kind: "folder", id: "inner" })), ["t:deep", "separator", "new-tab", "t:x", "t:y"]);
  assert.deepEqual(keys(pageItems({ ...source, open: [] }, { kind: "folder", id: "inner" })), ["t:deep", "separator", "new-tab"]);
  assert.equal(pageItems(source, { kind: "folder", id: "gone" }), null);
});

test("at most twelve icons fit a screen, within the tile limits", () => {
  assert.equal(dockTile(2000), 52);
  assert.equal(dockTile(300), 38);
  const tile = dockTile(700);
  assert.ok(tile * 12 + 8 * 11 + 16 <= 700);
});

test("the pointer picks the nearest icon, never a separator", () => {
  const dock = new DockColumn([false, true, false], 800);
  assert.equal(dock.index(dock.rest[1].center), 0);
  assert.equal(dock.index(dock.rest[2].center + 3), 2);
  assert.equal(dock.index(dock.restHeight + 100), null);
});
