import assert from "node:assert/strict";
import { test } from "node:test";

const { DEVICES_DOCK, devicesDockHeight, devicesDockLayout } = await import("./devicesDock.ts");

const phone = { id: "phone", tabs: [{ url: "https://a.test/" }, { url: "https://b.test/" }] };
const pad = { id: "pad", tabs: [{ url: "https://c.test/" }] };
const m = DEVICES_DOCK;

test("devices stack upward from the Devices icon, the first one nearest to it", () => {
  const { rows, groups, height } = devicesDockLayout([phone, pad], () => false);
  assert.deepEqual(rows.map((r) => r.key), ["device|pad", "device|phone"]);
  assert.deepEqual(groups, []);
  assert.equal(rows[0].y, m.pad);
  assert.equal(rows[1].y, m.pad + m.row + m.gap);
  assert.equal(height, m.pad * 2 + m.row * 2 + m.gap);
});

test("an open device fans its tabs out above itself, first tab nearest", () => {
  const { rows, groups } = devicesDockLayout([phone, pad], (id) => id === "phone");
  assert.deepEqual(rows.map((r) => r.key), ["device|pad", "phone|1|https://b.test/", "phone|0|https://a.test/", "device|phone"]);
  const phoneRow = rows.find((r) => r.key === "device|phone");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].deviceId, "phone");
  assert.equal(groups[0].top + groups[0].height, phoneRow.y + m.row + m.groupPad);
  assert.equal(groups[0].height, m.row * 3 + m.groupPad * 2);
});

test("a device without tabs never opens, and no devices take no room", () => {
  const empty = { id: "mac", tabs: [] };
  assert.deepEqual(devicesDockLayout([empty], () => true).groups, []);
  assert.equal(devicesDockLayout([], () => true).height, 0);
});

test("the section takes at most half the dock and scrolls beyond", () => {
  assert.equal(devicesDockHeight(120, 800), 120);
  assert.equal(devicesDockHeight(900, 800), 400);
  assert.equal(devicesDockHeight(50, -10), 0);
});
