import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/lib/cliControl.ts") || specifier !== "../components/pages") return next(specifier, context);
    const stub = "export const isInternalTab = () => false;";
    return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
  },
});
const shell = await import("@ardia/shell");
const { buildAgentSpacesDoc, dataPartners, effectiveSpaces, AGENT_SPACES_DOC } = await import("./agentSpaces.ts");

const profile = (id, name) => ({ id, name, color: "blue", icon: null, createdAt: 0 });
const tab = (id, profileId, extra = {}) => ({ id, profileId, windowId: "w", url: `https://${id}.test/`, pinned: false, ...extra });
const state = {
  profiles: { default: profile("default", "Personal"), work: profile("work", "Work"), side: profile("side", "Side"), twin: profile("twin", "Twin") },
  profileOrder: ["default", "work", "side", "twin"],
  tabs: {
    a: tab("a", "default"),
    b: tab("b", "work", { pinned: true }),
    c: tab("c", "work"),
    d: tab("d", "incognito:w@work"),
    e: tab("e", "side"),
    f: tab("f", "twin"),
  },
  groups: { g: { id: "g", windowId: "w", profileId: "work", name: "Folder", pinned: true, tabIds: ["c"] } },
};
const engines = { default: "", work: "work", side: "shared", twin: "shared" };
const engineOf = (id) => (id.startsWith("incognito:") ? `incognito@${id}` : engines[id]);
const targets = new Map([
  ["a", { targetId: "TA", browserContextId: "CTX-P", profileId: "default" }],
  ["b", { targetId: "TB", browserContextId: "CTX-W", profileId: "work" }],
  ["c", { targetId: "TC", browserContextId: "CTX-W", profileId: "work" }],
  ["d", { targetId: "TD", browserContextId: "CTX-INCOGNITO", profileId: "incognito:w@work" }],
  ["e", { targetId: "TE", browserContextId: "CTX-S", profileId: "side" }],
  ["f", { targetId: "TF", browserContextId: "CTX-S", profileId: "twin" }],
]);

test("nothing is allowed by default", () => {
  const doc = buildAgentSpacesDoc(state, { allowed: [], closeAnyTab: false }, targets, true, engineOf);
  assert.deepEqual(doc.spaces.map((s) => [s.id, s.allowed, s.contexts]), [
    ["default", false, []],
    ["work", false, []],
    ["side", false, []],
    ["twin", false, []],
  ]);
  assert.deepEqual(doc.tabs, {});
});

test("an allowed space publishes its contexts and tabs, and only its own", () => {
  const doc = buildAgentSpacesDoc(state, { allowed: ["work"], closeAnyTab: false }, targets, true, engineOf);
  const work = doc.spaces.find((s) => s.id === "work");
  assert.equal(work.allowed, true);
  assert.deepEqual(work.contexts, ["CTX-W"]);
  assert.deepEqual(doc.tabs, { TB: { space: "work", pinned: true }, TC: { space: "work", pinned: true } });
  assert.equal(doc.spaces.find((s) => s.id === "default").allowed, false);
});

test("private windows never show up, even when their space is allowed", () => {
  const doc = buildAgentSpacesDoc(state, { allowed: ["work", "incognito:w@work"], closeAnyTab: false }, targets, true, engineOf);
  assert.ok(!JSON.stringify(doc.spaces).includes("CTX-INCOGNITO"));
  assert.equal(doc.tabs.TD, undefined);
  assert.ok(!doc.spaces.some((s) => s.id.startsWith("incognito:")));
});

test("spaces that share data need every partner allowed", () => {
  assert.deepEqual(dataPartners(state, "side", engineOf), ["twin"]);
  assert.deepEqual([...effectiveSpaces(state, ["side"], engineOf)], []);
  assert.deepEqual([...effectiveSpaces(state, ["side", "twin"], engineOf)], ["side", "twin"]);
  const half = buildAgentSpacesDoc(state, { allowed: ["side"], closeAnyTab: false }, targets, true, engineOf);
  assert.ok(!JSON.stringify(half).includes("CTX-S"));
  const both = buildAgentSpacesDoc(state, { allowed: ["side", "twin"], closeAnyTab: false }, targets, true, engineOf);
  assert.deepEqual(both.spaces.find((s) => s.id === "side").contexts, ["CTX-S"]);
});

test("a tab moved to another space doesn't carry its old space's context along", () => {
  const moved = { ...state, tabs: { ...state.tabs, a: { ...state.tabs.a, profileId: "work" } } };
  const doc = buildAgentSpacesDoc(moved, { allowed: ["work"], closeAnyTab: false }, targets, true, engineOf);
  assert.deepEqual(doc.spaces.find((s) => s.id === "work").contexts, ["CTX-W"]);
  assert.equal(doc.tabs.TA, undefined);
});

test("contexts learned earlier stay published while their space is allowed", () => {
  const seen = new Map([["work", new Set(["CTX-W"])], ["default", new Set(["CTX-P"])]]);
  const doc = buildAgentSpacesDoc(state, { allowed: ["work"], closeAnyTab: false }, new Map(), true, engineOf, seen);
  assert.deepEqual(doc.spaces.find((s) => s.id === "work").contexts, ["CTX-W"]);
  assert.deepEqual(doc.spaces.find((s) => s.id === "default").contexts, []);
});

test("with control off nothing is published, but the choices are kept", () => {
  const doc = buildAgentSpacesDoc(state, { allowed: ["default", "work"], closeAnyTab: true }, targets, false, engineOf);
  assert.ok(doc.spaces.every((s) => !s.allowed && s.contexts.length === 0));
  assert.deepEqual(doc.tabs, {});
  assert.deepEqual(doc.allowed, ["default", "work"]);
  assert.equal(doc.closeAnyTab, true);
});

test("the app publishes the document once control is on", async () => {
  const { useBrowser } = await import("../store/browser.ts");
  const { useCli } = await import("./cliControl.ts");
  const { webviews } = await import("./webviews.ts");
  const agents = await import("./agentSpaces.ts");
  const windowId = useBrowser.getState().createWindow({ profileId: "default" });
  const tabId = useBrowser.getState().newTab(windowId, { url: "https://example.com/" });
  webviews.set(tabId, { devToolsTarget: async () => ({ targetId: "T1", browserContextId: "CTX-DEFAULT" }) });
  agents.startAgentSpaces();
  agents.allowAgentsIn("default", true);
  useBrowser.getState().updateSettings({ cliControl: true });
  useCli.setState({ server: { state: "on", connections: 0 } });
  for (let i = 0; i < 3; i++) {
    agents.flushAgentSpaces();
    await new Promise((r) => setTimeout(r, 10));
  }
  const doc = JSON.parse(shell.readDocument(AGENT_SPACES_DOC));
  assert.deepEqual(doc.allowed, ["default"]);
  assert.deepEqual(doc.spaces.find((x) => x.id === "default").contexts, ["CTX-DEFAULT"]);
  assert.deepEqual(doc.tabs.T1, { space: "default", pinned: false });
  useCli.setState({ server: { state: "off" } });
  agents.flushAgentSpaces();
  const off = JSON.parse(shell.readDocument(AGENT_SPACES_DOC));
  assert.deepEqual(off.tabs, {});
  assert.deepEqual(off.allowed, ["default"]);
  webviews.delete(tabId);
});
