import assert from "node:assert/strict";
import { test } from "node:test";
import { appUrlOrigin, appUrlRoute, toAppUrl, toEngineUrl } from "./appUrls.ts";
import { breadcrumb, fixupUrl, resolveInput, urlForDisplay } from "./omnibox.ts";

test("internal pages show and open as orbit://", () => {
  assert.equal(toAppUrl("chrome://settings/passwords"), "orbit://settings/passwords");
  assert.equal(toAppUrl("about:version"), "orbit://version");
  assert.equal(toEngineUrl("orbit://flags"), "chrome://flags");
  assert.equal(toEngineUrl("view-source:orbit://version"), "view-source:chrome://version");
  assert.equal(appUrlOrigin("orbit://history?q=a"), "orbit://history");
  assert.deepEqual(appUrlRoute("orbit://downloads"), { kind: "page", page: "downloads" });
  assert.equal(resolveInput("orbit://settings"), "orbit://settings");
  assert.equal(fixupUrl("orbit://settings"), "orbit://settings");
});

test("stored and typed ardia:// URLs keep working and show as orbit://", () => {
  assert.equal(toAppUrl("ardia://settings/passwords"), "orbit://settings/passwords");
  assert.equal(toAppUrl("view-source:ARDIA://Version"), "view-source:orbit://version");
  assert.equal(toEngineUrl("ardia://flags"), "chrome://flags");
  assert.equal(appUrlOrigin("ardia://history?q=a"), "orbit://history");
  assert.deepEqual(appUrlRoute("ardia://history"), { kind: "page", page: "history" });
  assert.deepEqual(appUrlRoute("ardia://settings/sync"), { kind: "settings", section: "sync" });
  assert.deepEqual(appUrlRoute("ardia://newtab"), { kind: "newTab" });
  assert.deepEqual(appUrlRoute("ardia://gpu"), { kind: "engine", url: "chrome://gpu" });
  assert.equal(urlForDisplay("ardia://history/?q=a"), "orbit://history?q=a");
  assert.deepEqual(breadcrumb("ardia://version/", "About Version"), { host: "orbit://version", trail: ["About Version"] });
  assert.equal(resolveInput("ardia://settings"), "orbit://settings");
});
