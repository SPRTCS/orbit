import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";

const root = new URL("../../../../../../", import.meta.url);
const src = (path) => new URL(`apps/browser/src/${path}`, root).href;

console.log = (...args) => console.error(...args);
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = true;

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const waiting = new Map();
let rpcCount = 0;
const rpc = (method, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++rpcCount;
    waiting.set(id, { resolve, reject });
    send({ type: "rpc", id, method, args });
  });

const base32 = "abcdefghijklmnopqrstuvwxyz234567";
const newId = () => {
  const bytes = randomBytes(16);
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += base32[(buffer << (5 - bits)) & 31];
  return out;
};

let deviceName = "Test Mac";
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: newId,
    deviceName: () => deviceName,
    createPhrase: (account) => rpc("createPhrase", account),
    enterPhrase: (account, text, folder) => rpc("enterPhrase", account, text, folder),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: (folder) => rpc("chainStatus", folder),
    createChain: (folder) => rpc("createChain", folder),
    write: (folder, scope, payload) => rpc("write", folder, scope, payload),
    read: (folder, scope, known) => rpc("read", folder, scope, known),
    remove: (folder, scope, ids) => rpc("remove", folder, scope, ids),
    deleteChain: (folder) => rpc("deleteChain", folder),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const { useBrowser } = await import(src("store/browser.ts"));
const F = await import(src("store/pinnedFolders.ts"));
const L = await import(src("lib/pinnedFolders.ts"));
const { pinKeyOf } = await import(src("store/pinMirror.ts"));
const engine = await import(src("sync/engine.ts"));
const menu = await import(src("sync/menu.ts"));
const { compact, folderTransport, SyncNative } = await import(new URL("packages/sync/src/index.ts", root).href);

const S = () => useBrowser.getState();
let folder = null;
let home = null;

const titled = (windowId, url, title) => {
  const id = S().newTab(windowId, { url });
  S().updateTab(id, { title });
  return id;
};

const tabByTitle = (title) => Object.values(S().tabs).find((t) => t.title === title);

function view(profileId) {
  const tree = F.usePinnedFolders.getState().trees[profileId];
  const refs = F.pinnedRefs(S(), profileId);
  const label = (ref) => {
    const key = ref.slice(2);
    if (ref.startsWith("g:")) return `[${Object.values(S().groups).find((g) => pinKeyOf(g) === key)?.name}]`;
    return Object.values(S().tabs).find((x) => pinKeyOf(x) === key && x.pinned)?.title ?? ref;
  };
  const shape = (nodes) => nodes.map((n) => (n.children ? { [tree.folders[n.ref.slice(2)].name]: shape(n.children) } : label(n.ref)));
  const window = S().windows[home];
  const pinned = window.tabIds.map((id) => S().tabs[id]).filter((t) => t?.pinned && t.profileId === profileId);
  const groups = Object.fromEntries(
    Object.values(S().groups)
      .filter((g) => g.pinned && g.profileId === profileId)
      .map((g) => [g.name, g.tabIds.map((id) => S().tabs[id]?.title)]),
  );
  return {
    tiles: pinned.filter((t) => !t.pinnedAsRow).map((t) => t.title),
    tree: tree ? shape(F.resolveTree(tree, refs)) : refs.map(label),
    groups,
  };
}

function summary() {
  const doc = globalThis.acSync.doc();
  const own = {};
  for (const [profileId, link] of Object.entries(doc.profiles)) {
    own[link.syncId] = { profileId, tabs: doc.scopes[`p:${link.syncId}`]?.records[`tabs:${doc.deviceId}`]?.v ?? null };
  }
  return { deviceId: doc.deviceId, profiles: doc.profiles, own, status: engine.useSync.getState().status, error: engine.useSync.getState().error };
}

function startWindow(urls) {
  S().hydrate({});
  useBrowser.setState({ bookmarksReady: { default: true } });
  L.startPinnedFolders();
  home = S().createWindow({ url: urls[0].url });
  S().updateTab(S().windows[home].tabIds[0], { title: urls[0].title });
  for (const { url, title } of urls.slice(1)) titled(home, url, title);
}

const commands = {
  async setupA({ path, name }) {
    folder = path;
    deviceName = name;
    startWindow([
      { url: "https://news.example/today", title: "Today’s News" },
      { url: "https://shop.example/cart", title: "Cart" },
    ]);
    const work = S().createProfile({ name: "Work", color: "blue", icon: "briefcase" });
    const workWindow = S().createWindow({ profileId: work, url: "https://jira.example/board" });
    S().updateTab(S().windows[workWindow].tabIds[0], { title: "Sprint Board" });
    const tiles = [titled(home, "https://mail.example/", "Mail"), titled(home, "https://cal.example/", "Calendar")];
    S().pinTabs(tiles, true);
    const rows = ["Docs", "Notes", "Spec", "Wiki Home"].map((t) => titled(home, `https://${t.toLowerCase().replace(" ", "")}.example/`, t));
    S().pinTabs(rows, true, true);
    S().groupTabs([titled(home, "https://team.example/a", "Team A"), titled(home, "https://team.example/b", "Team B")], { pinned: true, name: "Team" });
    const projects = L.newPinnedFolder(home, { name: "Projects", contents: [F.tabRef(tabByTitle("Notes"))], rename: false });
    L.newPinnedFolder(home, { name: "Inner", target: { parent: projects }, contents: [F.tabRef(tabByTitle("Spec"))], rename: false });
    engine.startSync();
    const result = await engine.turnOnSync(folder);
    if (!("ok" in result)) throw new Error(result.error);
    await engine.syncNow();
    await engine.syncNow();
    return { ...summary(), view: view("default") };
  },
  async setupB({ path, name, phrase }) {
    folder = path;
    deviceName = name;
    startWindow([{ url: "https://b-one.example/", title: "B One" }, { url: "https://b-two.example/", title: "B Two" }]);
    engine.startSync();
    const result = await engine.enterRecoveryPhrase(folder, phrase);
    if (!("ok" in result)) throw new Error(JSON.stringify(result));
    await engine.syncNow();
    await engine.syncNow();
    return summary();
  },
  async enterPhrase({ phrase }) {
    return await engine.enterRecoveryPhrase(folder, phrase);
  },
  async sync() {
    await engine.syncNow();
    return summary();
  },
  async mutateA() {
    S().pinTabs([tabByTitle("Docs").id], false);
    const inner = Object.values(F.usePinnedFolders.getState().trees.default.folders).find((f) => f.name === "Inner");
    L.deletePinnedFolder("default", inner.id);
    S().pinTabs([titled(home, "https://later.example/", "Later")], true, true);
    S().closeTab(tabByTitle("Cart").id);
    await engine.syncNow();
    return { ...summary(), view: view("default") };
  },
  async compactAll() {
    const doc = globalThis.acSync.doc();
    const transport = folderTransport(SyncNative, folder);
    for (const [scope, state] of Object.entries(doc.scopes)) await compact(state, transport, scope, doc.deviceId, Date.now(), { pruneGrace: 0 }, true);
    return summary();
  },
  async remote() {
    await engine.syncNow();
    const doc = globalThis.acSync.doc();
    const state = engine.useSync.getState();
    const raw = {};
    for (const [scope, s] of Object.entries(doc.scopes)) {
      for (const [key, record] of Object.entries(s.records)) if (key.startsWith("tabs:") || key.startsWith("dev:")) raw[`${scope} ${key}`] = record.v;
    }
    return { remoteTabs: state.remoteTabs, devices: state.devices, menu: menu.syncedDevicesMenuItem("default"), raw, ...summary() };
  },
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "rpcResult") {
    const call = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
    return;
  }
  if (message.type === "quit") process.exit(0);
  if (message.type === "cmd") {
    try {
      send({ type: "done", id: message.id, result: (await commands[message.name](message.args ?? {})) ?? null });
    } catch (error) {
      send({ type: "done", id: message.id, error: String(error?.stack ?? error) });
    }
  }
});
send({ type: "ready" });
