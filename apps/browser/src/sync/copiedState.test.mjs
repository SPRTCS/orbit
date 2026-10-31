import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = true;

const folder = new Map();
const calls = [];
let ids = 0;
let deviceName = "Mac";
let unlocks = true;
let onWrite = null;
let keySaves = true;
const shell = await import("@ardia/shell");
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `dev${++ids}`,
    deviceName: () => deviceName,
    createPhrase: async () => true,
    enterPhrase: async (account) => (calls.push(["enterPhrase", account]), { ok: true }),
    saveKey: async (account) => (calls.push(["saveKey", account]), keySaves),
    createChain: async () => {},
    unlock: async (account) => (calls.push(["unlock", account]), unlocks),
    forget: async (account) => void calls.push(["forget", account]),
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${String(folder.size + 1).padStart(4, "0")}`;
      folder.set(id, { scope, payload });
      onWrite?.(JSON.parse(payload));
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: [], damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const { useBrowser } = await import("../store/browser.ts");
const F = await import("../store/pinnedFolders.ts");
const L = await import("../lib/pinnedFolders.ts");
const { useCopyWarning } = await import("./copiedState.ts");
const S = () => useBrowser.getState();
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

let instances = 0;
class Mac {
  constructor({ name, dataDirectoryId, from, docs }) {
    this.name = name;
    this.dataDirectoryId = dataDirectoryId;
    this.docs = new Map(docs ?? from?.docs ?? []);
    this.engineUrl = `./engine.ts?mac${++instances}`;
    if (from) {
      this.browser = { ...from.browser };
      this.folders = { ...from.folders };
      this.window = from.window;
    } else {
      S().hydrate({});
      useBrowser.setState({ bookmarksReady: { default: true } });
      L.startPinnedFolders();
      this.window = S().createWindow({ url: `https://${name.toLowerCase()}.example/` });
      this.browser = S();
      this.folders = F.usePinnedFolders.getState();
    }
  }
  enter() {
    useBrowser.setState(this.browser, true);
    F.usePinnedFolders.setState(this.folders, true);
    L.seenPinnedRefs().clear();
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    shell.appInfo.bundleId = "com.example.orbit";
    shell.appInfo.dataDirectoryId = this.dataDirectoryId;
    deviceName = this.name;
  }
  leave() {
    this.browser = S();
    this.folders = F.usePinnedFolders.getState();
    this.docs = new Map(shell.docs);
  }
  async run(fn) {
    this.enter();
    try {
      return await fn(this.engine);
    } finally {
      this.leave();
    }
  }
  async start() {
    this.engine = await import(this.engineUrl);
    await this.run(async (engine) => {
      engine.startSync();
      await settle();
    });
  }
  sync() {
    return this.run((engine) => engine.syncNow());
  }
  titled(url, title) {
    const id = S().newTab(this.window, { url });
    S().updateTab(id, { title });
    return id;
  }
  doc() {
    return this.run(async () => globalThis.acSync.doc());
  }
  folders_() {
    return this.run(async () => Object.values(F.usePinnedFolders.getState().trees.default?.folders ?? {}).map((f) => f.name).sort());
  }
}

const HOME = "volume:1";

async function originalWithTiles() {
  const original = new Mac({ name: "Original", dataDirectoryId: HOME });
  await original.run(async () => {
    S().pinTabs([1, 2, 3].map((i) => original.titled(`https://tile${i}.example/`, `Tile ${i}`)), true);
  });
  original.engine = await import(original.engineUrl);
  await original.run(async (engine) => {
    engine.startSync();
    assert.ok("ok" in (await engine.turnOnSync("/sync")));
    await engine.syncNow();
    await engine.syncNow();
  });
  return original;
}

function withDoc(mac, patch) {
  const docs = new Map(mac.docs);
  const saved = { ...JSON.parse(docs.get("sync.json")), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete saved[k];
  docs.set("sync.json", JSON.stringify(saved));
  return docs;
}

async function buildFolder(mac) {
  await mac.run(async (engine) => {
    const rows = ["Row One", "Row Two"].map((t) => mac.titled(`https://${t.toLowerCase().replace(" ", "-")}.example/`, t));
    S().pinTabs(rows, true, true);
    L.newPinnedFolder(mac.window, { name: "Work", contents: rows.map((id) => F.tabRef(S().tabs[id])), rename: false });
    await engine.syncNow();
  });
}

async function busy(mac, label) {
  await mac.run(async (engine) => {
    mac.titled(`https://${label}.example/`, label);
    await engine.syncNow();
  });
}

const logs = () => [...folder.values()].map((f) => ({ scope: f.scope, ...JSON.parse(f.payload) })).filter((f) => f.kind === "log");

function reset() {
  folder.clear();
  calls.length = 0;
  unlocks = true;
  onWrite = null;
  keySaves = true;
}

test("a copy whose stamp names another data dir joins as a new device before it writes anything", async () => {
  reset();
  const original = await originalWithTiles();
  const originalId = (await original.doc()).deviceId;
  const before = logs().length;
  const copy = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: original });
  await copy.start();
  const doc = await copy.doc();
  assert.notEqual(doc.deviceId, originalId);
  assert.equal(doc.joining, true, "the upstream join path");
  assert.equal(logs().length, before, "nothing written while switching");
  assert.ok(calls.some(([name, account]) => name === "saveKey" && account === doc.deviceId));
  await buildFolder(copy);
  await copy.sync();
  await busy(original, "meanwhile");
  await original.sync();
  assert.deepEqual(await original.folders_(), ["Work"], "the copy's folder reaches the original");
  assert.equal(Math.min(...logs().filter((f) => f.device === doc.deviceId).map((f) => f.seq)), 1, "the new device starts at seq 1");
  const seqs = logs().filter((f) => f.device === originalId).map((f) => `${f.scope} ${f.seq}`);
  assert.equal(seqs.length, new Set(seqs).size, "no seq of the original's id is used twice");
});

test("a data dir the installer marked joins as a new device once", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const copy = new Mac({ name: "Copy", dataDirectoryId: HOME, from: original, docs: withDoc(original, { rejoin: true }) });
  await copy.start();
  await copy.sync();
  const doc = await copy.doc();
  assert.notEqual(doc.deviceId, id);
  assert.equal(doc.rejoin, undefined);
  const relaunched = new Mac({ name: "Copy", dataDirectoryId: HOME, from: copy });
  await relaunched.start();
  await relaunched.sync();
  assert.equal((await relaunched.doc()).deviceId, doc.deviceId, "and stays that device");
});

test("a crash right after the switch leaves a clean new device: its first batch is seq 1 and the old journal is gone", async () => {
  reset();
  const original = await originalWithTiles();
  const originalId = (await original.doc()).deviceId;
  await original.run(async () => {
    original.titled("https://pending.example/", "Pending");
  });
  shell.heldSaves.on = true;
  const copy = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: original });
  await copy.start();
  shell.heldSaves.queue.length = 0;
  shell.heldSaves.on = false;
  const before = logs().length;
  const afterCrash = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: copy });
  await afterCrash.start();
  await afterCrash.sync();
  const newId = (await afterCrash.doc()).deviceId;
  const written = logs().slice(before);
  assert.ok(written.length > 0);
  assert.ok(written.every((f) => f.device === newId), "nothing under the old id");
  for (const scope of new Set(written.map((f) => f.scope))) {
    assert.equal(Math.min(...written.filter((f) => f.scope === scope).map((f) => f.seq)), 1, `${scope} starts at seq 1`);
  }
  assert.notEqual(newId, originalId);
});

test("a locked copy that's given the phrase joins as a new device with its own key", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const copy = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: original });
  unlocks = false;
  await copy.start();
  unlocks = true;
  await copy.run(async (engine) => {
    assert.equal(engine.useSync.getState().status, "locked");
    assert.ok("ok" in (await engine.enterRecoveryPhrase("/sync", "words")));
  });
  const doc = await copy.doc();
  assert.notEqual(doc.deviceId, id);
  assert.ok(calls.some(([name, account]) => name === "enterPhrase" && account === doc.deviceId));
  await buildFolder(copy);
  await original.sync();
  assert.deepEqual(await original.folders_(), ["Work"]);
});

test("a copy never deletes or retires the identity it came from", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const copy = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: original });
  unlocks = false;
  await copy.start();
  unlocks = true;
  const before = logs().length;
  await copy.run((engine) => engine.stopSync());
  assert.equal(logs().length, before, "no tombstones under the shared id");
  assert.ok(!calls.some(([name, account]) => name === "forget" && account === id));

  const joined = new Mac({ name: "Joined", dataDirectoryId: "volume:3", from: original });
  await joined.start();
  const newId = (await joined.doc()).deviceId;
  await joined.run((engine) => engine.stopSync());
  assert.deepEqual(calls.filter(([name]) => name === "forget").map(([, account]) => account), [newId]);
});

test("a data dir that wasn't copied keeps its device id, also across a phrase entered while locked", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const again = new Mac({ name: "Original", dataDirectoryId: HOME, from: original });
  unlocks = false;
  await again.start();
  unlocks = true;
  await again.run(async (engine) => {
    assert.ok("ok" in (await engine.enterRecoveryPhrase("/sync", "words")));
    await engine.syncNow();
  });
  assert.equal((await again.doc()).deviceId, id);
  assert.equal(useCopyWarning.getState().conflict, false);
});

test("two instances writing as one device in lockstep are flagged, with no automatic action", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const copy = new Mac({ name: "Copy", dataDirectoryId: HOME, from: original, docs: withDoc(original, { home: undefined }) });
  await copy.start();
  for (let i = 0; i < 3; i++) {
    await busy(original, `original-${i}`);
    await busy(copy, `copy-${i}`);
  }
  const doc = await copy.doc();
  assert.ok(doc.copyConflict, "a conflicting batch at one of its own seqs");
  assert.equal(doc.deviceId, id, "nothing changes on its own");
  await copy.run(async () => assert.equal(useCopyWarning.getState().conflict, true));
  const relaunched = new Mac({ name: "Copy", dataDirectoryId: HOME, from: copy });
  await relaunched.start();
  await relaunched.run(async () => assert.equal(useCopyWarning.getState().conflict, true, "the warning survives a relaunch"));
});

test("a copy is flagged when the original writes past its own seqs", async () => {
  reset();
  const original = await originalWithTiles();
  const copy = new Mac({ name: "Copy", dataDirectoryId: HOME, from: original, docs: withDoc(original, { home: undefined }) });
  await copy.start();
  await busy(original, "one");
  await busy(original, "two");
  await copy.sync();
  assert.ok((await copy.doc()).copyConflict);
});

test("Rejoin as New Device gives a flagged Mac its own identity, and its folder then reaches the original", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  const copy = new Mac({ name: "Copy", dataDirectoryId: HOME, from: original, docs: withDoc(original, { home: undefined }) });
  await copy.start();
  await busy(original, "one");
  await busy(original, "two");
  await copy.sync();
  await buildFolder(copy);
  await copy.run(async (engine) => {
    assert.equal(await engine.rejoinAsNewDevice(), true);
    assert.equal(useCopyWarning.getState().conflict, false);
    await engine.syncNow();
    await engine.syncNow();
  });
  const doc = await copy.doc();
  assert.notEqual(doc.deviceId, id);
  assert.equal(doc.copyConflict, undefined);
  await original.sync();
  assert.deepEqual(await original.folders_(), ["Work"]);
});

test("a batch re-sent after a crash is the same batch twice, and isn't flagged", async () => {
  reset();
  const original = await originalWithTiles();
  let captured = null;
  onWrite = (file) => {
    if (!captured && file.ops?.some((op) => op.v?.tabs?.some?.((t) => t.t === "Resent"))) captured = { docs: new Map(shell.docs), browser: S() };
  };
  await busy(original, "Resent");
  onWrite = null;
  assert.ok(captured);
  const relaunched = new Mac({ name: "Original", dataDirectoryId: HOME, from: { ...original, browser: captured.browser }, docs: captured.docs });
  await relaunched.start();
  await relaunched.sync();
  await relaunched.sync();
  const resent = logs().filter((f) => f.ops.some((op) => op.v?.tabs?.some?.((t) => t.t === "Resent")));
  assert.ok(resent.length >= 2, "the same batch landed twice");
  assert.equal((await relaunched.doc()).copyConflict, undefined);
});

test("a copy whose new key can't be saved writes nothing until its join completes", async () => {
  reset();
  const original = await originalWithTiles();
  const id = (await original.doc()).deviceId;
  keySaves = false;
  const copy = new Mac({ name: "Copy", dataDirectoryId: "volume:2", from: original });
  await copy.start();
  const before = logs().length;
  await copy.run(async (engine) => {
    await engine.syncNow();
    engine.setTypeSynced("history", false);
    await engine.syncNow();
    assert.equal(engine.useSync.getState().status, "locked");
    assert.equal(useCopyWarning.getState().joinPending, true);
  });
  assert.equal(logs().length, before, "no batch under the old id, nor any other");
  assert.equal((await copy.doc()).deviceId, id);
  keySaves = true;
  await copy.run(async (engine) => {
    assert.equal(await engine.finishCopyJoin(), true);
    await engine.syncNow();
  });
  const doc = await copy.doc();
  assert.notEqual(doc.deviceId, id);
  assert.ok(logs().slice(before).every((f) => f.device === doc.deviceId));
  await copy.run(async () => assert.equal(useCopyWarning.getState().joinPending, false));
});

test("a collision is flagged even when this Mac's compaction in the same cycle prunes the other batch", async () => {
  reset();
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const original = await originalWithTiles();
    for (let i = 0; i < 45; i++) await busy(original, `filler-${i}`);
    offset = 20 * 60 * 1000;
    const copy = new Mac({ name: "Copy", dataDirectoryId: HOME, from: original, docs: withDoc(original, { home: undefined }) });
    await copy.start();
    await busy(original, "original-next");
    offset = 3 * 60 * 60 * 1000;
    await busy(copy, "copy-late");
    const doc = await copy.doc();
    const scope = `p:${doc.profiles.default.syncId}`;
    assert.ok(Object.values(doc.scopes[scope].files).some((f) => f.k === "snapshot"), "the copy compacted in that cycle");
    assert.ok(doc.copyConflict, "the collision was seen before the compaction removed it");
  } finally {
    Date.now = realNow;
  }
});
