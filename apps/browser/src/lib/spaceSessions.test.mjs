import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const L = await import("./pinnedFolders.ts");
const SS = await import("./spaceSessions.ts");
const SP = await import("./spaces.ts");
const T = await import("../store/spaceTimeline.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const urls = (doc) => [...doc.tiles, ...doc.pinned].map((n) => n.url);

function setup() {
  stub.docs.clear();
  S().hydrate({});
  const stopFolders = L.startPinnedFolders();
  const stop = SS.startSpaceSessions(Date.now() - 120_000);
  const w = S().createWindow({ url: "https://one.com/" });
  S().pinTabs([S().windows[w].tabIds[0]], true, true);
  S().newTab(w, { url: "https://today.com/" });
  return { w, stop: () => (stop(), stopFolders()) };
}

test("a saved session keeps pins and today tabs, persists, and can be renamed and deleted", () => {
  const { stop } = setup();
  const session = SS.saveSession("default", "Morning");
  assert.equal(session.name, "Morning");
  assert.deepEqual(urls(session.doc), ["https://one.com/"]);
  assert.deepEqual(session.doc.today.map((t) => t.url), ["https://today.com/"]);
  SS.renameSession(session.id, "Evening");
  stop();
  SS.useSpaceSessions.setState({ sessions: [] });
  const again = SS.startSpaceSessions();
  assert.equal(SS.useSpaceSessions.getState().sessions[0].name, "Evening", "sessions come back after a relaunch");
  SS.deleteSession(session.id);
  assert.equal(SS.useSpaceSessions.getState().sessions.length, 0);
  again();
});

test("the timeline records a point per change at most hourly, skips repeats, and restores an older one", () => {
  const { w, stop } = setup();
  const t0 = Date.now();
  assert.equal(SS.recordTimeline("default", { now: t0 }), true);
  assert.equal(SS.recordTimeline("default", { now: t0 + T.HOUR_MS * 2 }), false, "nothing changed");
  const added = S().newTab(w, { url: "https://two.com/" });
  S().pinTabs([added], true, true);
  assert.equal(SS.recordTimeline("default", { now: t0 + 1000 }), false, "within the hour");
  assert.equal(SS.recordTimeline("default", { now: t0 + T.HOUR_MS * 2 }), true);
  const points = SS.readTimeline("default");
  assert.equal(points.length, 2);
  assert.deepEqual(urls(points[0].doc), ["https://one.com/"]);
  assert.deepEqual(urls(points[1].doc), ["https://one.com/", "https://two.com/"]);
  assert.equal(SS.useSpaceSessions.getState().heads.default.count, 2, "the index tracks the newest point");
  SP.applyPins("default", points[0].doc, "replace");
  assert.deepEqual(urls(SP.spaceDocument("default")), ["https://one.com/"], "restoring the older point brings its pins back");
  stop();
});

test("a deleted space's timeline is removed", () => {
  const { stop } = setup();
  const other = S().createProfile({ name: "Other" });
  assert.equal(SS.recordTimeline(other, { force: true }), true);
  assert.ok(stub.docs.has(`space-timeline-${other}.json`));
  S().deleteProfile(other);
  assert.equal(stub.docs.has(`space-timeline-${other}.json`), false);
  assert.equal(SS.useSpaceSessions.getState().heads[other], undefined);
  stop();
});
