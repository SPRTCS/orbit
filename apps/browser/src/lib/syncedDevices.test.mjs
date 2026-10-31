import assert from "node:assert/strict";
import { test } from "node:test";
const D = await import("./syncedDevices.ts");
const V = await import("../store/syncedDevices.ts");
const { useBrowser } = await import("../store/browser.ts");
const stub = await import("../test-native-stub.mjs");

const tab = (url, title = "") => ({ url, title });

test("device kind comes from a kind field first, then the name", () => {
  assert.equal(D.deviceKindOf("Arman’s iPhone"), "iphone");
  assert.equal(D.deviceKindOf("iPad Pro von Arman"), "ipad");
  assert.equal(D.deviceKindOf("Arman’s MacBook Pro"), "laptop");
  assert.equal(D.deviceKindOf("Studio iMac"), "imac");
  assert.equal(D.deviceKindOf("Office Mac mini"), "macmini");
  assert.equal(D.deviceKindOf("Render Mac Studio"), "macstudio");
  assert.equal(D.deviceKindOf("Lab Mac Pro"), "macpro");
  assert.equal(D.deviceKindOf("Work"), "laptop");
  assert.equal(D.deviceKindOf("Work", "iphone"), "iphone");
  assert.equal(D.deviceKindOf("Arman’s iPhone", "ipad"), "ipad");
  assert.equal(D.deviceKindOf("Arman’s iPhone", "unknown-thing"), "iphone");
  assert.equal(D.deviceSymbol("iphone"), "iphone");
  assert.equal(D.deviceSymbol("ipad"), "ipad.landscape");
  assert.equal(D.deviceSymbol("laptop"), "laptopcomputer");
});

test("a record's kind is read from k or kind and only when it is a short string", () => {
  assert.deepEqual(D.recordKind({ n: "x", tabs: [], k: "iphone" }), { kind: "iphone" });
  assert.deepEqual(D.recordKind({ kind: "ipad" }), { kind: "ipad" });
  assert.deepEqual(D.recordKind({ n: "x", tabs: [] }), {});
  assert.deepEqual(D.recordKind({ k: 3 }), {});
  assert.deepEqual(D.recordKind({ k: "x".repeat(40) }), {});
  assert.deepEqual(D.recordKind(null), {});
});

test("hosts drop www, credentials and ports; file URLs read as File", () => {
  assert.equal(D.hostOf("https://www.example.com/a?b#c"), "example.com");
  assert.equal(D.hostOf("http://user:pw@Sub.Example.org:8080/x"), "sub.example.org");
  assert.equal(D.hostOf("file:///Users/a/b.pdf"), "File");
  assert.equal(D.hostOf("not a url"), "not a url");
});

test("devices are sorted by recency, unseen last, and their tabs deduplicated", () => {
  const remote = [
    { deviceId: "a", name: "Old Mac", tabs: [tab("https://a.com", "A")] },
    { deviceId: "b", name: "Arman’s iPhone", kind: undefined, tabs: [tab("https://b.com", "B"), tab("https://b.com", "B again"), tab("https://www.c.com/x", "  ")] },
    { deviceId: "c", name: "Never Seen", tabs: [tab("https://d.com", "D")] },
    { deviceId: "d", name: "Empty", tabs: [] },
    { deviceId: "e", name: "Also Never", tabs: [tab("https://e.com", "E")] },
  ];
  const seen = [
    { id: "a", lastSeen: 1_000 },
    { id: "b", lastSeen: 5_000 },
    { id: "c", lastSeen: null },
  ];
  const devices = D.sidebarDevices(remote, seen);
  assert.deepEqual(devices.map((d) => d.id), ["b", "a", "e", "c"]);
  assert.equal(devices[0].kind, "iphone");
  assert.equal(devices[0].symbol, "iphone");
  assert.deepEqual(devices[0].tabs, [
    { url: "https://b.com", title: "B", host: "b.com" },
    { url: "https://www.c.com/x", title: "c.com", host: "c.com" },
  ]);
  assert.equal(devices[1].kind, "laptop");
  assert.deepEqual(D.sidebarDevices(undefined, seen), []);
  assert.deepEqual(D.sidebarDevices([], seen), []);
});

test("the collapsed row shows up to four device icons and counts the rest", () => {
  const remote = ["iPhone", "iPad", "MacBook", "iMac", "Mac mini", "Work"].map((name, i) => ({ deviceId: `d${i}`, name, tabs: [tab(`https://${i}.com`)] }));
  const seen = remote.map((d, i) => ({ id: d.deviceId, lastSeen: 100 - i }));
  const { symbols, more } = D.deviceSymbols(D.sidebarDevices(remote, seen));
  assert.deepEqual(symbols, ["iphone", "ipad.landscape", "laptopcomputer", "desktopcomputer"]);
  assert.equal(more, 2);
  assert.deepEqual(D.deviceSymbols(D.sidebarDevices(remote, seen), 3), { symbols: ["iphone", "ipad.landscape", "laptopcomputer"], more: 3 });
});

test("ages and details read short", () => {
  const now = 10_000_000_000;
  assert.equal(D.shortAgo(null, now), null);
  assert.equal(D.shortAgo(now - 20_000, now), "just now");
  assert.equal(D.shortAgo(now + 5_000, now), "just now");
  assert.equal(D.shortAgo(now - 5 * 60_000, now), "5 min ago");
  assert.equal(D.shortAgo(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(D.shortAgo(now - 30 * 3_600_000, now), "yesterday");
  assert.equal(D.shortAgo(now - 4 * 86_400_000, now), "4 days ago");
  const device = { id: "x", name: "X", kind: "laptop", symbol: "laptopcomputer", lastSeen: now - 120_000, tabs: [{ url: "u", title: "t", host: "h" }] };
  assert.equal(D.deviceDetail(device, now), "1 tab · 2 min ago");
  assert.equal(D.deviceDetail({ ...device, lastSeen: null, tabs: [...device.tabs, ...device.tabs] }, now), "2 tabs");
});

test("body rows and section height follow the view and are capped by the sidebar", () => {
  const devices = D.sidebarDevices(
    [
      { deviceId: "a", name: "A", tabs: [tab("https://1.com"), tab("https://2.com")] },
      { deviceId: "b", name: "B", tabs: [tab("https://3.com")] },
    ],
    [],
  );
  assert.equal(D.devicesBodyRows(devices, D.CLOSED_VIEW), 0);
  assert.equal(D.devicesBodyRows(devices, { open: true, devices: {} }), 2);
  assert.equal(D.devicesBodyRows(devices, { open: true, devices: { a: true } }), 4);
  const single = devices.slice(1);
  assert.equal(D.deviceOpen({ open: true, devices: {} }, "b", 1), true);
  assert.equal(D.deviceOpen({ open: true, devices: { b: false } }, "b", 1), false);
  assert.equal(D.devicesBodyRows(single, { open: true, devices: {} }), 2);
  const m = { rowHeight: 34, rowGap: 3, padTop: 6, padBottom: 2 };
  assert.deepEqual(D.devicesSectionHeight(0, 800, m), { height: 42, body: 0, scrolls: false });
  assert.deepEqual(D.devicesSectionHeight(2, 800, m), { height: 42 + 74, body: 74, scrolls: false });
  const capped = D.devicesSectionHeight(30, 800, m);
  assert.equal(capped.scrolls, true);
  assert.equal(capped.height, Math.floor(800 * 0.45));
  assert.deepEqual(D.devicesSectionHeight(30, 0, m), { height: 42 + 30 * 37, body: 30 * 37, scrolls: false });
  assert.equal(D.devicesSectionHeight(30, 50, m).body, 37);
});

test("the sidebar setting is on unless turned off", () => {
  assert.equal(D.showsSyncedDevices({}), true);
  assert.equal(D.showsSyncedDevices({ showSyncedDevices: true }), true);
  assert.equal(D.showsSyncedDevices({ showSyncedDevices: false }), false);
});

test("view state is kept per window and space and saved without closed windows", () => {
  stub.docs.clear();
  stub.docs.set("synced-devices.json", JSON.stringify({ version: 1, views: { "w1|p1": { open: true, devices: { a: false, bad: "x" } } } }));
  V.loadDevicesViews();
  assert.deepEqual(V.devicesView("w1", "p1"), { open: true, devices: { a: false } });
  assert.deepEqual(V.devicesView("w1", "p2"), D.CLOSED_VIEW);
  V.setDevicesOpen("w1", "p2", true);
  V.setDeviceOpen("w1", "p2", "b", true);
  V.setDevicesOpen("w9", "p1", true);
  assert.deepEqual(V.devicesView("w1", "p2"), { open: true, devices: { b: true } });
  assert.deepEqual(V.devicesView("w1", "p1"), { open: true, devices: { a: false } });
  useBrowser.setState({ windows: { w1: { id: "w1" } } });
  V.saveDevicesViews();
  const saved = JSON.parse(stub.docs.get("synced-devices.json"));
  assert.deepEqual(Object.keys(saved.views).sort(), ["w1|p1", "w1|p2"]);
  V.setDevicesOpen("w1", "p2", false);
  V.setDeviceOpen("w1", "p2", "b", false);
  V.saveDevicesViews();
  assert.deepEqual(Object.keys(JSON.parse(stub.docs.get("synced-devices.json")).views), ["w1|p1", "w1|p2"]);
  V.setSidebarHeight("w1", 700);
  assert.equal(V.useSyncedDevicesView.getState().sidebarHeights.w1, 700);
});
