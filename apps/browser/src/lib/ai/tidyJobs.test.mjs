import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
const nativeStub = new URL("../../test-native-stub.mjs", import.meta.url).href;
const toastModule = `export const showToast = (w, title, message, options) => (globalThis.__toasts ??= []).push({ w, title, message, options });`;
const shellModule = `export * from ${JSON.stringify(nativeStub)}; export const fileExists = (p) => !!globalThis.__disk?.has(p);`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "../../components/layout/splitActions" && context.parentURL?.includes("/lib/ai/"))
      return { url: `data:text/javascript,${encodeURIComponent(toastModule)}`, shortCircuit: true };
    if (specifier === "@ardia/shell" && context.parentURL?.includes("/lib/ai/tidy"))
      return { url: `data:text/javascript,${encodeURIComponent(shellModule)}`, shortCircuit: true };
    return next(specifier, context);
  },
});

const { useBrowser } = await import("../../store/browser.ts");
const { useAiSettings } = await import("./settings.ts");
const { setAiTransport } = await import("./client.ts");
const { tidyTabs, undoTidy } = await import("./tidyTabs.ts");
const { renameDownloadWithAi } = await import("./tidyDownloads.ts");
const { tidyTitles } = await import("./tidyTitles.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 20; i++) await tick();
};

let sent = [];
function holdTransport() {
  sent = [];
  setAiTransport((request, { signal }) => {
    const call = { request, aborted: false };
    sent.push(call);
    return new Promise((resolve, reject) => {
      call.answer = (text) => resolve({ status: 200, body: JSON.stringify({ choices: [{ message: { content: text } }] }), retryAfter: null });
      signal?.addEventListener("abort", () => {
        call.aborted = true;
        reject(Object.assign(new Error("aborted"), { failure: { kind: "aborted" } }));
      });
    });
  });
}

const aiOn = () =>
  useAiSettings.setState({
    loaded: true,
    enabled: true,
    provider: "openai",
    openai: { preset: "custom", baseUrl: "http://127.0.0.1:9/v1", chatModel: "m", quickModel: "m" },
  });
const aiOff = () => useAiSettings.setState({ enabled: false });

function windowWith(n) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://h0.example/0" });
  S().updateTab(S().windows[w].tabIds[0], { title: "T0" });
  for (let i = 1; i < n; i++) {
    const id = S().newTab(w, { url: `https://h${i % 3}.example/${i}` });
    S().updateTab(id, { title: `T${i}` });
  }
  return w;
}

const groupsOf = (w) =>
  Object.values(S().groups)
    .filter((g) => g.windowId === w)
    .map((g) => ({ id: g.id, name: g.name, tabIds: g.tabIds }))
    .sort((a, b) => a.id.localeCompare(b.id));

test("turning AI off while Tidy Tabs waits sends nothing and changes no tabs", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(5);
  const before = JSON.stringify(S().windows[w].tabIds);
  const job = tidyTabs(w);
  aiOff();
  await settle();
  sent.forEach((c) => c.answer?.('{"groups":[{"name":"A","tabs":[1,2,3]}]}'));
  await job;
  await settle();
  assert.equal(sent.filter((c) => !c.aborted).length, 0, "no request went out once AI was off");
  assert.deepEqual(groupsOf(w), []);
  assert.equal(JSON.stringify(S().windows[w].tabIds), before);
});

test("turning AI off while a Tidy Tabs answer is pending aborts it and changes nothing", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(5);
  const job = tidyTabs(w);
  await settle();
  assert.equal(sent.length, 1);
  aiOff();
  sent[0].answer?.('{"groups":[{"name":"A","tabs":[1,2,3]}]}');
  await job;
  assert.equal(sent[0].aborted, true, "the request was aborted");
  assert.deepEqual(groupsOf(w), []);
});

test("turning AI off while Tidy Titles waits changes no titles", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(3);
  const ids = S().windows[w].tabIds;
  S().pinTabs(ids, true, true);
  const job = tidyTitles(w, ids);
  await settle();
  aiOff();
  sent.forEach((c) => c.answer?.('{"titles":[{"tab":1,"title":"Short"}]}'));
  await job;
  assert.deepEqual(ids.map((id) => S().tabs[id].customTitle), [null, null, null]);
});

test("Regroup All only changes tabs it sent; groups past the cap and split groups keep their tabs; Undo is exact", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(126);
  const ids = S().windows[w].tabIds;
  const early = S().createGroup([ids[0], ids[1]], { name: "Early" });
  const [s1, s2] = [ids[10], ids[11]];
  S().createSplit([s1, s2]);
  const split = S().createGroup([s1, s2, ids[12]], { name: "Split Group" });
  const late = S().createGroup([ids[124], ids[125]], { name: "Late" });
  const beforeGroups = JSON.stringify(Object.values(S().groups).sort((a, b) => a.id.localeCompare(b.id)));
  const beforeOrder = JSON.stringify(S().windows[w].tabIds);
  const job = tidyTabs(w, { regroupAll: true });
  await settle();
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].request.body).messages.at(-1).content;
  const listed = body.split("\n").filter((l) => /^\d+\. /.test(l)).length;
  assert.ok(listed <= 120, `sent ${listed}`);
  sent[0].answer('{"groups":[{"name":"Fresh","tabs":[1,3,4]}]}');
  await job;
  const after = Object.fromEntries(Object.values(S().groups).map((g) => [g.id, g]));
  assert.equal(after[late]?.name, "Late", "the group past the cap is untouched");
  assert.deepEqual(after[late].tabIds, [ids[124], ids[125]]);
  assert.equal(after[split]?.name, "Split Group");
  assert.ok(after[split].tabIds.includes(s1) && after[split].tabIds.includes(s2), "split tabs stay in their group");
  const fresh = Object.values(after).find((g) => g.name === "Fresh");
  assert.ok(fresh);
  const undo = globalThis.__toasts.at(-1).options.action;
  assert.ok(undo);
  undo.run();
  assert.equal(JSON.stringify(Object.values(S().groups).sort((a, b) => a.id.localeCompare(b.id))), beforeGroups);
  assert.equal(JSON.stringify(S().windows[w].tabIds), beforeOrder);
  assert.ok(early);
});

function downloadSetup(rename) {
  const calls = [];
  globalThis.acTestNativeModules = {
    OrbitFiles: {
      fileIdentity: async (path) => globalThis.__disk.get(path) ?? null,
      renameFile: async (path, name, identity) => {
        calls.push({ path, name, identity });
        return rename(path, name, identity);
      },
    },
  };
  return calls;
}

function addDownload(w, path) {
  const d = { id: `d${Math.random()}`, url: "https://files.example/x", filename: path.split("/").at(-1), path, state: "finished", paused: false, received: 1, total: 1, speed: 0, mimeType: "", profile: "" };
  useBrowser.setState((s) => ({ downloads: [d, ...s.downloads] }));
  return d;
}

const moveOnDisk = (from, name, identity) => {
  const id = globalThis.__disk.get(from);
  if (id === undefined || (identity !== undefined && identity !== null && identity !== id)) return null;
  const to = `${from.slice(0, from.lastIndexOf("/"))}/${name}`;
  globalThis.__disk.delete(from);
  globalThis.__disk.set(to, id);
  return to;
};

test("turning AI off while a download name is pending renames nothing", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(1);
  globalThis.__disk = new Map([["/dl/a_1.pdf", "1:100"]]);
  const calls = downloadSetup(moveOnDisk);
  const d = addDownload(w, "/dl/a_1.pdf");
  const job = renameDownloadWithAi(d, w);
  await settle();
  aiOff();
  sent.forEach((c) => c.answer?.('{"name":"Clean Name"}'));
  await job;
  assert.equal(calls.length, 0);
  assert.ok(globalThis.__disk.has("/dl/a_1.pdf"));
});

test("a file swapped in at the download's path while the name is pending isn't renamed, nor on Undo", async () => {
  holdTransport();
  aiOn();
  const w = windowWith(1);
  globalThis.__disk = new Map([["/dl/b_2.pdf", "1:200"]]);
  const calls = downloadSetup(moveOnDisk);
  const d = addDownload(w, "/dl/b_2.pdf");
  const job = renameDownloadWithAi(d, w);
  await settle();
  globalThis.__disk.delete("/dl/b_2.pdf");
  globalThis.__disk.set("/dl/elsewhere.pdf", "1:200");
  globalThis.__disk.set("/dl/b_2.pdf", "1:999");
  sent[0].answer('{"name":"Clean Name"}');
  const to = await job;
  assert.equal(to, null);
  assert.ok(calls.every((c) => c.identity === "1:200"), "the rename carries the identity captured at the start");
  assert.equal(globalThis.__disk.get("/dl/b_2.pdf"), "1:999", "the replacement keeps its name");

  globalThis.__disk = new Map([["/dl/c_3.pdf", "1:300"]]);
  const d2 = addDownload(w, "/dl/c_3.pdf");
  const job2 = renameDownloadWithAi(d2, w);
  await settle();
  sent.at(-1).answer('{"name":"Clean C"}');
  assert.equal(await job2, "/dl/Clean C.pdf");
  globalThis.__disk.delete("/dl/Clean C.pdf");
  globalThis.__disk.set("/dl/Clean C.pdf", "1:777");
  globalThis.__toasts.at(-1).options.action.run();
  await settle();
  assert.equal(globalThis.__disk.get("/dl/Clean C.pdf"), "1:777", "Undo leaves a different file alone");
  assert.equal(globalThis.__disk.has("/dl/c_3.pdf"), false);
});

test("turning AI off while a group name is pending leaves the group unnamed", async () => {
  holdTransport();
  aiOn();
  const { startGroupNaming } = await import("./groupNaming.ts");
  const w = windowWith(3);
  startGroupNaming();
  const ids = S().windows[w].tabIds;
  const g = S().createGroup([ids[1], ids[2]]);
  await new Promise((r) => setTimeout(r, 1700));
  await settle();
  assert.equal(sent.length, 1, "the naming request went out");
  aiOff();
  sent[0].answer('{"name":"Too Late","emoji":"⏰"}');
  await settle();
  assert.equal(sent[0].aborted, true);
  assert.equal(S().groups[g].name, "");
  assert.equal(S().groups[g].icon, null);
});
