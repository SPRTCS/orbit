import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../store/browser.ts");
const { flushPersistence, startPersistence } = await import("../persist.ts");
const store = await import("./store.ts");
const stub = await import("../../test-native-stub.mjs");

const S = () => useBrowser.getState();
startPersistence();
S().hydrate({
  profiles: {
    default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
    work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
  },
  profileOrder: ["default", "work"],
  windows: {},
  tabs: {},
});
const linkProfile = () => JSON.parse(stub.docs.get("session.json")).linkProfile;

test("a rule change alone rewrites session.json, so the next launch doesn't pre-open links in the old space", () => {
  store.resetAirTrafficForTests();
  S().updateSettings({ showFullUrl: !S().settings.showFullUrl });
  flushPersistence();
  assert.equal(linkProfile(), "");
  const id = store.addRule({ match: "domain", pattern: "github.com", fromApp: null, destination: { kind: "space", spaceId: "work" } });
  flushPersistence();
  assert.equal(linkProfile(), null);
  store.updateRule(id, { enabled: false });
  flushPersistence();
  assert.equal(linkProfile(), "");
  store.setFallback({ kind: "little" });
  flushPersistence();
  assert.equal(linkProfile(), null);
  store.setFallback(null);
  flushPersistence();
  assert.equal(linkProfile(), "");
});
