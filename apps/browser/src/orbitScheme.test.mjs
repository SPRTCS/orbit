import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/components/pages/urls.ts") || specifier !== "../../lib/actions") return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent("export const focus = () => {};")}`, shortCircuit: true };
  },
});
const { fromLegacy, fromLegacyUrl } = await import("./legacy.ts");
const { internalPageOf } = await import("./components/pages/urls.ts");

test("ardia:// URLs move to orbit://", () => {
  assert.equal(fromLegacyUrl("ardia://history"), "orbit://history");
  assert.equal(fromLegacyUrl("ARDIA://Settings/sync"), "orbit://Settings/sync");
  assert.equal(fromLegacyUrl("view-source:ardia://version"), "view-source:orbit://version");
  assert.equal(fromLegacyUrl("netnyahoo://downloads"), "orbit://downloads");
  assert.equal(fromLegacyUrl("orbit://history"), "orbit://history");
  assert.equal(fromLegacyUrl("https://ardia.dev/"), "https://ardia.dev/");
  assert.deepEqual(fromLegacy({ url: "ardia://bookmarks", title: "Bookmarks" }), { url: "orbit://bookmarks", title: "Bookmarks" });
});

test("internal pages open from both schemes", () => {
  assert.equal(internalPageOf("orbit://history?q=a"), "history");
  assert.equal(internalPageOf("ardia://downloads"), "downloads");
  assert.equal(internalPageOf("ARDIA://Bookmarks"), "bookmarks");
  assert.equal(internalPageOf("orbit://settings"), null);
  assert.equal(internalPageOf("https://history.example.com/"), null);
  assert.equal(internalPageOf(null), null);
});
