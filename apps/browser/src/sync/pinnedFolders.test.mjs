import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const F = await import("../store/pinnedFolders.ts");
const L = await import("../lib/pinnedFolders.ts");
const { pinKeyOf } = await import("../store/pinMirror.ts");
const { Clock, compact, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const { pinnedFoldersAdapter, breakCycles, PIN_FOLDER } = await import("./pinnedFolders.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const P = () => F.usePinnedFolders.getState();
let now = 1_800_000_000_000;
const later = () => (now += 1_000);

stub.docs.clear();
S().hydrate({});
L.startPinnedFolders();

class Folder {
  files = new Map();
  counter = 0;
  transport(device) {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload, hiddenFrom: new Set(), at: now });
        return id;
      },
      read: async (scope, known) => {
        const during = this.duringRead;
        this.duringRead = null;
        during?.();
        const listing = { files: [], pending: [], damaged: [], present: [] };
        for (const [id, f] of this.files) {
          if (f.scope !== scope) continue;
          listing.present.push(id);
          if (known.includes(id)) continue;
          if (f.hiddenFrom.has(device)) listing.pending.push(id);
          else listing.files.push({ id, payload: f.payload });
        }
        return listing;
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
  newest() {
    return [...this.files.keys()].at(-1);
  }
}

class Device {
  constructor(id, folder, { legacy = false } = {}) {
    this.id = id;
    this.folder = folder;
    this.legacy = legacy;
    this.seen = new Map();
    this.choices = new Map();
    this.folders = { trees: {}, plans: {}, renaming: null };
    this.scope = emptyScope();
    this.clock = new Clock(id, null, () => now);
    this.enter();
    S().hydrate({});
    this.window = S().createWindow({ url: `https://${id.toLowerCase()}-home.example/` });
    this.leave();
  }
  enter() {
    const seen = L.seenPinnedRefs();
    seen.clear();
    for (const [k, v] of this.seen) seen.set(k, v);
    const choices = L.pinnedChoices();
    choices.clear();
    for (const [k, v] of this.choices) choices.set(k, new Map(v));
    F.usePinnedFolders.setState(this.folders, true);
    if (this.browser) useBrowser.setState(this.browser, true);
  }
  leave() {
    this.browser = S();
    this.folders = P();
    this.seen = new Map(L.seenPinnedRefs());
    this.choices = new Map([...L.pinnedChoices()].map(([k, v]) => [k, new Map(v)]));
  }
  with(fn) {
    if (this.inside) return fn();
    this.enter();
    this.inside = true;
    try {
      return fn();
    } finally {
      this.inside = false;
      this.leave();
    }
  }
  adapters() {
    return [
      adapters.pinnedRowsAdapter("default"),
      adapters.pinnedAdapter("default"),
      ...(this.legacy ? [] : [pinnedFoldersAdapter("default", () => this.scope.records)]),
    ];
  }
  async sync(options = {}) {
    later();
    this.enter();
    try {
      return await syncScope({ scope: "p", state: this.scope, transport: this.folder.transport(this.id), adapters: this.adapters(), clock: this.clock, device: this.id, now: () => now, options });
    } finally {
      this.leave();
    }
  }
  async compact() {
    this.enter();
    try {
      return await compact(this.scope, this.folder.transport(this.id), "p", this.id, now, { pruneGrace: 0 }, true);
    } finally {
      this.leave();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

async function settled(devices) {
  await syncAll(devices, 3);
  for (const d of devices) assert.equal((await d.sync()).published, 0, `${d.id} has nothing left to publish`);
}

const hostOf = (url) => new URL(url).host.split(".")[0];

function view(device) {
  return device.with(() => {
    const tree = P().trees.default;
    const refs = F.pinnedRefs(S(), "default");
    const label = (ref) => {
      const key = ref.slice(2);
      if (ref.startsWith("g:")) return `[${Object.values(S().groups).find((g) => pinKeyOf(g) === key)?.name}]`;
      const t = Object.values(S().tabs).find((x) => pinKeyOf(x) === key && x.pinned);
      return t ? hostOf(t.pinnedUrl || t.url) : ref;
    };
    if (!tree) return refs.map(label);
    const shape = (nodes) => nodes.map((n) => (n.children ? { [tree.folders[n.ref.slice(2)].name]: shape(n.children) } : label(n.ref)));
    return shape(F.resolveTree(tree, refs));
  });
}

const collapsedOf = (device) => device.with(() => Object.fromEntries(Object.values(P().trees.default?.folders ?? {}).map((f) => [f.name, f.collapsed])));
const records = (device, prefix = PIN_FOLDER) => Object.fromEntries(Object.entries(device.scope.records).filter(([k, r]) => k.startsWith(prefix) && r.v !== null).map(([k, r]) => [k, r.v]));
const folderId = (device, name) => device.with(() => Object.values(P().trees.default?.folders ?? {}).find((f) => f.name === name)?.id);
const row = (host) => {
  const t = Object.values(S().tabs).find((x) => x.pinned && x.pinnedAsRow && hostOf(x.pinnedUrl || x.url) === host);
  return t ? F.tabRef(t) : null;
};

function pinRows(device, hosts) {
  return device.with(() => {
    const ids = hosts.map((h) => S().newTab(device.window, { url: `https://${h}.example/` }));
    S().pinTabs(ids, true, true);
    return ids;
  });
}

test("folders made, nested, renamed, moved and deleted on one Mac show the same on the other; collapsing stays on its Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal", "news"]);
  a.with(() => {
    const id = a.window;
    S().groupTabs([S().newTab(id, { url: "https://one.example/" })], { pinned: true, name: "Team" });
    const work = L.newPinnedFolder(id, { name: "Work", contents: [row("docs")], rename: false });
    L.newPinnedFolder(id, { name: "Inner", target: { parent: work }, contents: [row("cal")], rename: false });
    L.renamePinnedFolder("default", work, "Job");
    L.setPinnedFolderCollapsed("default", work, true);
  });
  const expected = ["mail", { Job: ["docs", { Inner: ["cal"] }] }, "news", "[Team]"];
  assert.deepEqual(view(a), expected);
  await settled([a, b]);
  assert.deepEqual(view(b), expected, "B has A's folders, nesting and order");
  assert.deepEqual(collapsedOf(a), { Job: true, Inner: false });
  assert.deepEqual(collapsedOf(b), { Job: false, Inner: false }, "collapsed is per Mac");

  b.with(() => L.setPinnedFolderCollapsed("default", folderId(b, "Inner"), true));
  assert.equal((await b.sync()).published, 0, "collapsing publishes nothing");

  b.with(() => {
    L.movePinnedNodes("default", [row("news")], { parent: folderId(b, "Inner") });
    L.movePinnedNodes("default", ["g:" + pinKeyOf(Object.values(S().groups).find((g) => g.name === "Team"))], { parent: null, before: row("mail") });
  });
  await settled([b, a]);
  assert.deepEqual(view(a), ["[Team]", "mail", { Job: ["docs", { Inner: ["cal", "news"] }] }]);
  assert.deepEqual(collapsedOf(a), { Job: true, Inner: false }, "A keeps its own collapsed state through B's edits");

  a.with(() => L.deletePinnedFolder("default", folderId(a, "Job")));
  await settled([a, b]);
  assert.deepEqual(view(b), ["[Team]", "mail", "docs", { Inner: ["cal", "news"] }], "deleting a folder moves its contents up, on every Mac");
  assert.deepEqual(collapsedOf(b), { Inner: true });

  b.with(() => L.deletePinnedFolder("default", folderId(b, "Inner")));
  await settled([b, a]);
  assert.equal(a.with(() => P().trees.default), undefined, "the last folder gone drops the overlay on the other Mac too");
  assert.deepEqual(records(a), {}, "and every placement is a tombstone");
});

test("concurrent edits on two Macs converge: renames by time, moves of different items both kept", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal", "news"]);
  a.with(() => {
    L.newPinnedFolder(a.window, { name: "X", rename: false });
    L.newPinnedFolder(a.window, { name: "Y", rename: false });
  });
  await settled([a, b]);
  const x = folderId(a, "X");
  const y = folderId(a, "Y");
  a.with(() => {
    L.renamePinnedFolder("default", x, "From A");
    L.movePinnedNodes("default", [row("mail")], { parent: x });
  });
  later();
  b.with(() => {
    L.renamePinnedFolder("default", x, "From B");
    L.movePinnedNodes("default", [row("cal")], { parent: y });
    L.movePinnedNodes("default", [row("news")], { parent: null, before: row("docs") });
  });
  await a.sync();
  await b.sync();
  await settled([a, b]);
  const expected = ["news", "docs", { "From B": ["mail"] }, { Y: ["cal"] }];
  assert.deepEqual(view(a), expected, "the later rename wins; both moves are kept");
  assert.deepEqual(view(b), expected);
  assert.equal(folderId(a, "From B"), x);
});

test("two Macs moving the same row into different folders settle on one folder", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => {
    L.newPinnedFolder(a.window, { name: "X", rename: false });
    L.newPinnedFolder(a.window, { name: "Y", rename: false });
  });
  await settled([a, b]);
  a.with(() => L.movePinnedNodes("default", [row("docs")], { parent: folderId(a, "X") }));
  later();
  b.with(() => L.movePinnedNodes("default", [row("docs")], { parent: folderId(b, "Y") }));
  await a.sync();
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.deepEqual(view(a), ["mail", { X: [] }, { Y: ["docs"] }], "the later move wins");
});

test("folders moved into each other on two Macs don't make a cycle, and no folder is lost", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal"]);
  a.with(() => {
    L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false });
    L.newPinnedFolder(a.window, { name: "Y", contents: [row("cal")], rename: false });
  });
  await settled([a, b]);
  const x = folderId(a, "X");
  const y = folderId(a, "Y");
  a.with(() => L.movePinnedNodes("default", [F.folderRef(x)], { parent: y }));
  b.with(() => L.movePinnedNodes("default", [F.folderRef(y)], { parent: x }));
  await a.sync();
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b), "both Macs break the cycle the same way");
  const [low, high] = [x, y].sort();
  const names = { [x]: "X", [y]: "Y" };
  const tree = a.with(() => P().trees.default);
  assert.equal(Object.keys(tree.folders).length, 2, "no folder lost");
  assert.ok(tree.root.includes(F.folderRef(low)), "the folder with the lowest id goes to the top level");
  assert.ok(tree.folders[low].children.includes(F.folderRef(high)), `${names[high]} stays inside ${names[low]}`);
  assert.ok(F.refsIn(tree).has(a.with(() => row("docs"))) && F.refsIn(tree).has(a.with(() => row("cal"))), "their contents too");
});

test("cycle breaking is deterministic whatever order the folders come in", () => {
  const cases = [
    [["a", "b"], ["b", "a"]],
    [["a", "b"], ["b", "c"], ["c", "a"], ["d", "c"]],
    [["z", "y"], ["y", "z"], ["x", "x"]],
  ];
  for (const edges of cases) {
    const results = new Set();
    for (const order of [edges, [...edges].reverse()]) {
      const parent = new Map(order);
      breakCycles(parent, order.map(([id]) => id));
      results.add(JSON.stringify([...parent].sort()));
      for (const [id] of order) {
        const seen = new Set();
        for (let at = id; at !== null && at !== undefined; at = parent.get(at) ?? null) {
          assert.ok(!seen.has(at), `no cycle through ${at}`);
          seen.add(at);
        }
      }
    }
    assert.equal(results.size, 1, "same result in any order");
  }
  const parent = new Map([["d", "c"], ["c", "b"], ["b", "c"]]);
  breakCycles(parent, ["d", "c", "b"]);
  assert.equal(parent.get("d"), "c", "a folder only leading into a cycle keeps its parent");
  assert.equal(parent.get("b"), null, "the cycle's lowest id is cut");
});

test("a placement that arrives before its folder waits at the top level, publishes nothing, and moves in when the folder lands", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const c = new Device("devC", folder);
  pinRows(a, ["mail", "docs", "cal"]);
  await settled([a, b, c]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await a.sync();
  folder.files.get(folder.newest()).hiddenFrom.add("devC");
  await b.sync();
  const x = folderId(b, "X");
  b.with(() => L.movePinnedNodes("default", [row("docs")], { parent: x }));
  await b.sync();
  const before = folder.counter;
  await c.sync();
  await c.sync();
  assert.equal(folder.counter, before, "C publishes nothing while the folder is on its way");
  assert.deepEqual(view(c), ["mail", "docs", "cal"], "no folders yet: upstream's list");
  assert.equal(records(c)[`${PIN_FOLDER}${c.with(() => row("docs"))}`].p, x, "the placement still points at the folder");

  c.with(() => L.newPinnedFolder(c.window, { name: "Local", rename: false }));
  await c.sync();
  assert.equal(records(c)[`${PIN_FOLDER}${c.with(() => row("docs"))}`].p, x, "a folder of its own doesn't make C move the waiting row");

  folder.files.forEach((f) => f.hiddenFrom.clear());
  await settled([a, b, c]);
  const expected = view(a);
  assert.deepEqual(view(c), expected);
  assert.deepEqual(view(b), expected);
  assert.ok(JSON.stringify(expected).includes('{"X":["docs"]}'), "the row is in its folder once the folder arrives");
});

test("a folder made inside a folder that hasn't arrived keeps its nesting, even where its place collides at the top level", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const c = new Device("devC", folder);
  pinRows(a, ["mail"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "Keep", rename: false }));
  await settled([a, b, c]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await a.sync();
  folder.files.get(folder.newest()).hiddenFrom.add("devC");
  await b.sync();
  b.with(() => L.newPinnedFolder(b.window, { name: "Y", target: { parent: folderId(b, "X") }, rename: false }));
  await b.sync();
  const y = folderId(b, "Y");
  await c.sync();
  await c.sync();
  assert.equal(records(c)[`${PIN_FOLDER}f:${y}`].p, folderId(b, "X"), "C keeps Y's folder while X is on its way");
  folder.files.forEach((f) => f.hiddenFrom.clear());
  await settled([a, b, c]);
  for (const d of [a, b, c]) assert.ok(JSON.stringify(view(d)).includes('{"X":[{"Y":[]}]}'), `${d.id}: Y is inside X`);
});

test("an edit made while files are being read wins over the remote edit it raced", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await settled([a, b]);
  const x = folderId(a, "X");
  a.with(() => L.renamePinnedFolder("default", x, "Remote"));
  await a.sync();
  later();
  folder.duringRead = () => L.renamePinnedFolder("default", x, "Local later");
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.ok(JSON.stringify(view(a)).includes("Local later"), "the later edit, made during B's read, is kept");
});

test("a row put in a folder during a read, with no place synced yet, wins over the remote placement it raced", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  await settled([a, b]);
  a.with(() => L.newPinnedFolder(a.window, { name: "Remote", contents: [row("docs")], rename: false }));
  await a.sync();
  later();
  folder.duringRead = () => L.newPinnedFolder(b.window, { name: "Local later", contents: [row("docs")], rename: false });
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.ok(JSON.stringify(view(a)).includes('{"Local later":["docs"]}'), JSON.stringify(view(a)));
});

test("a folder waiting for its parent that the user moves at the top level stays where the user put it", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const c = new Device("devC", folder);
  pinRows(a, ["mail"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "Keep", rename: false }));
  await settled([a, b, c]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await a.sync();
  folder.files.get(folder.newest()).hiddenFrom.add("devC");
  await b.sync();
  b.with(() => L.newPinnedFolder(b.window, { name: "Y", target: { parent: folderId(b, "X") }, rename: false }));
  await b.sync();
  await c.sync();
  later();
  c.with(() => L.movePinnedNodes("default", [F.folderRef(folderId(c, "Y"))], { parent: null, before: row("mail") }));
  await c.sync();
  folder.files.forEach((f) => f.hiddenFrom.clear());
  await settled([a, b, c]);
  for (const d of [a, b, c]) assert.deepEqual(view(d)[0], { Y: [] }, `${d.id}: Y stays first, at the top level`);
});

test("a row unpinned and pinned again into another folder while the unpin's batch is being saved keeps its new folder", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => {
    L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false });
    L.newPinnedFolder(a.window, { name: "Y", rename: false });
  });
  await settled([a, b]);
  const docs = a.with(() => Object.values(S().tabs).find((t) => t.pinned && hostOf(t.pinnedUrl) === "docs").id);
  a.with(() => S().pinTabs([docs], false));
  let repinned = false;
  await a.sync({
    persist: async () => {
      if (repinned) return;
      repinned = true;
      L.pinIntoFolder(a.window, [docs], { parent: folderId(a, "Y") });
    },
  });
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.ok(JSON.stringify(view(a)).includes('{"Y":["docs"]}'), JSON.stringify(view(a)));
});

test("a leftover leaf for a pin this Mac doesn't have and never synced is not published", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  pinRows(a, ["mail"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await settled([a]);
  const x = folderId(a, "X");
  a.with(() => {
    const tree = P().trees.default;
    F.usePinnedFolders.setState({ trees: { default: { ...tree, folders: { ...tree.folders, [x]: { ...tree.folders[x], children: ["t:leftover"] } } } } });
  });
  await settled([a]);
  assert.equal(a.scope.records[`${PIN_FOLDER}t:leftover`], undefined);
});

for (const during of [false, true]) {
  test(`moving a folder ${during ? "while files are being read" : "before syncing"} repositions only that folder, so a remote rename of its neighbour survives`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    pinRows(a, ["mail"]);
    a.with(() => ["X", "Y", "Z"].forEach((name) => L.newPinnedFolder(a.window, { name, rename: false })));
    await settled([a, b]);
    a.with(() => L.renamePinnedFolder("default", folderId(a, "Y"), "Remote Y"));
    await a.sync();
    later();
    const move = () => L.movePinnedNodes("default", [F.folderRef(folderId(b, "X"))], { parent: null, before: F.folderRef(folderId(b, "Z")) });
    if (during) folder.duringRead = move;
    else b.with(move);
    await b.sync();
    await settled([a, b]);
    assert.deepEqual(view(a), view(b));
    assert.deepEqual(view(a), ["mail", { "Remote Y": [] }, { X: [] }, { Z: [] }], "both the rename and the move are kept");
  });
}

test("a choice that ends where it started still beats the older remote edit it raced", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await settled([a, b]);
  const x = folderId(a, "X");
  a.with(() => L.renamePinnedFolder("default", x, "Remote"));
  await a.sync();
  later();
  folder.duringRead = () => {
    L.renamePinnedFolder("default", x, "Temporary");
    L.renamePinnedFolder("default", x, "X");
  };
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.deepEqual(view(a), ["mail", { X: [] }], "B's later choice wins");
});

test("a folder deleted on one Mac while the other moves a row into it: the row lands at the top level on both", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal"]);
  a.with(() => {
    L.newPinnedFolder(a.window, { name: "X", contents: [row("mail")], rename: false });
    L.newPinnedFolder(a.window, { name: "Keep", rename: false });
  });
  await settled([a, b]);
  a.with(() => L.deletePinnedFolder("default", folderId(a, "X")));
  b.with(() => L.movePinnedNodes("default", [row("cal")], { parent: folderId(b, "X") }));
  await a.sync();
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  const tree = a.with(() => P().trees.default);
  assert.equal(Object.values(tree.folders).map((f) => f.name).join(), "Keep", "the deletion stands");
  assert.ok(tree.root.includes(a.with(() => row("cal"))) && tree.root.includes(a.with(() => row("mail"))), "the deleted folder's rows, old and new, are at the top level");
});

test("a rename racing a delete: the later one wins, and a folder brought back keeps no lost rows", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false }));
  await settled([a, b]);
  const x = folderId(a, "X");
  a.with(() => L.deletePinnedFolder("default", x));
  later();
  b.with(() => L.renamePinnedFolder("default", x, "Renamed"));
  await a.sync();
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.deepEqual(view(a), [{ Renamed: [] }, "mail", "docs"], "residual: the rename brings the folder back, empty; X was the last folder, so its rows kept no place and heal in after it");
});

test("a row unpinned on one Mac leaves its folder on the other, and its placement becomes a tombstone", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", contents: [row("docs"), row("cal")], rename: false }));
  await settled([a, b]);
  const docs = a.with(() => row("docs"));
  a.with(() => S().pinTabs([Object.values(S().tabs).find((t) => t.pinned && hostOf(t.pinnedUrl) === "docs").id], false));
  await settled([a, b]);
  assert.deepEqual(view(b), ["mail", { X: ["cal"] }]);
  assert.equal(b.scope.records[`${PIN_FOLDER}${docs}`].v, null);
  assert.equal(F.refsIn(b.with(() => P().trees.default)).has(docs), false, "B's overlay forgets it");
});

test("a placement for a pin this Mac doesn't have is kept until the pin arrives, and dropped once the pin is unpinned", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false }));
  await settled([a, b]);
  const ghost = `t:tab-never-${Math.random().toString(36).slice(2)}`;
  const x = folderId(a, "X");
  later();
  const op = { k: `${PIN_FOLDER}${ghost}`, h: new Clock("devZ", null, () => now).tick(), v: { p: x, pos: "V" } };
  await folder.transport("devZ").write("p", JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 1, at: now, ops: [op] }));
  await settled([a, b]);
  assert.deepEqual(view(b), ["mail", { X: ["docs"] }], "nothing shown for a pin that isn't here");
  assert.ok(b.with(() => P().trees.default.folders[x].children.includes(ghost)), "but its place is kept");
  assert.ok(records(a)[`${PIN_FOLDER}${ghost}`], "and nobody deletes it");

  later();
  const unpin = { k: `pin:${ghost}`, h: new Clock("devZ", null, () => now).tick(), v: null };
  await folder.transport("devZ").write("p", JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 2, at: now, ops: [unpin] }));
  await settled([a, b]);
  assert.equal(b.with(() => P().trees.default.folders[x].children.includes(ghost)), false, "an unpinned pin's place is dropped");
  assert.equal(a.scope.records[`${PIN_FOLDER}${ghost}`].v, null);
});

test("a row pinned into a folder on one Mac lands in that folder on the other, not where self-healing would put it", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await settled([a, b]);
  a.with(() => {
    const id = S().newTab(a.window, { url: "https://cal.example/" });
    L.pinIntoFolder(a.window, [id], { parent: folderId(a, "X") });
  });
  await a.sync();
  await b.sync();
  assert.deepEqual(view(b), ["mail", "docs", { X: ["cal"] }]);
  await settled([a, b]);
  assert.deepEqual(view(a), ["mail", "docs", { X: ["cal"] }], "B's self-healing never published over A's placement");
});

test("pins from a Mac without folders appear next to their neighbour and get a place of their own", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false }));
  await settled([a, old]);
  assert.deepEqual(view(old), ["mail", "docs"], "the older Mac shows its flat list");
  pinRows(old, ["cal"]);
  await settled([old, a]);
  assert.deepEqual(view(a), ["mail", { X: ["docs"] }, "cal"]);
  assert.ok(records(a)[`${PIN_FOLDER}${a.with(() => row("cal"))}`], "A records where it showed it");
});

test("an older Mac keeps the folder records through its own snapshot, and a Mac that joins from it gets the folders", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  pinRows(a, ["mail", "docs", "cal"]);
  a.with(() => {
    const x = L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false });
    L.newPinnedFolder(a.window, { name: "Y", target: { parent: x }, contents: [row("cal")], rename: false });
  });
  await settled([a, old]);
  const kept = records(a);
  assert.deepEqual(records(old), kept, "the older Mac holds every record");
  assert.ok(old.scope.unapplied.some((k) => k.startsWith(PIN_FOLDER)), "as records no adapter of its own applies");
  old.with(() => S().moveTab(Object.values(S().tabs).find((t) => t.pinned && hostOf(t.pinnedUrl) === "cal").id, 1));
  await old.sync();
  assert.deepEqual(records(old), kept, "its own pin edits leave them alone");
  await old.compact();
  for (const [id, f] of folder.files) if (JSON.parse(f.payload).kind === "log") folder.files.delete(id);
  const fresh = new Device("devNew", folder);
  await settled([fresh]);
  assert.deepEqual(records(fresh), kept);
  assert.ok(JSON.stringify(view(fresh)).includes('{"X":["docs",{"Y":["cal"]}]}'), "the folders come back from the older Mac's snapshot");
});

test("a Mac joining with folders of its own keeps them next to the synced ones", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "From A", contents: [row("docs")], rename: false }));
  pinRows(b, ["news", "cal"]);
  b.with(() => L.newPinnedFolder(b.window, { name: "From B", contents: [row("cal")], rename: false }));
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  const names = Object.values(a.with(() => P().trees.default.folders)).map((f) => f.name).sort();
  assert.deepEqual(names, ["From A", "From B"]);
  assert.ok(JSON.stringify(view(a)).includes('{"From A":["docs"]}') && JSON.stringify(view(a)).includes('{"From B":["cal"]}'));
});

test("two Macs adding at the same place get equal positions; the next publish separates them, then nothing moves", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail"]);
  await settled([a, b]);
  a.with(() => L.newPinnedFolder(a.window, { name: "From A", rename: false }));
  b.with(() => L.newPinnedFolder(b.window, { name: "From B", rename: false }));
  await a.sync();
  await b.sync();
  const pos = (d) => Object.values(records(d)).filter((v) => "n" in v).map((v) => v.pos);
  assert.equal(new Set(pos(b)).size, 1, "both took the same position");
  await a.sync();
  const separated = (await b.sync()).published + (await a.sync()).published;
  assert.ok(separated > 0, "residual: both Macs may publish the separation");
  await settled([a, b]);
  assert.equal(new Set(pos(a)).size, 2, "separated");
  assert.deepEqual(view(a), view(b));
});

test("the last folder deleted on one Mac while another adds one: the new folder survives, the rest falls back to the flat list", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs", "cal"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "Old", contents: [row("docs")], rename: false }));
  await settled([a, b]);
  a.with(() => L.deletePinnedFolder("default", folderId(a, "Old")));
  later();
  b.with(() => L.newPinnedFolder(b.window, { name: "New", contents: [row("cal")], rename: false }));
  await a.sync();
  await b.sync();
  await settled([a, b]);
  assert.deepEqual(view(a), view(b));
  assert.deepEqual(Object.values(a.with(() => P().trees.default.folders)).map((f) => f.name), ["New"]);
  assert.ok(JSON.stringify(view(a)).includes('{"New":["cal"]}'));
});

test("a record from a broken or future writer is ignored, not applied or deleted", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  pinRows(a, ["mail"]);
  a.with(() => L.newPinnedFolder(a.window, { name: "X", rename: false }));
  await settled([a]);
  later();
  const h = new Clock("devZ", null, () => now).tick();
  const ops = [
    { k: `${PIN_FOLDER}f:bad`, h, v: { p: 7, pos: "V" } },
    { k: `${PIN_FOLDER}q:future`, h, v: { p: null, pos: "V", extra: true } },
  ];
  await folder.transport("devZ").write("p", JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 1, at: now, ops }));
  await settled([a]);
  assert.deepEqual(view(a), ["mail", { X: [] }]);
  assert.ok(a.scope.records[`${PIN_FOLDER}q:future`].v, "left as it is");
});

const looksOf = (device) => device.with(() => Object.fromEntries(Object.values(P().trees.default?.folders ?? {}).map((f) => [f.name, F.appearanceOf(f)])));

test("a folder's icon and colour sync in a record of their own, next to its name and place", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  pinRows(a, ["mail", "docs"]);
  const id = a.with(() => L.newPinnedFolder(a.window, { name: "🟡 MLP", contents: [row("docs")], rename: false }));
  await settled([a, b]);
  a.with(() => {
    L.setPinnedFolderEmoji("default", id, "🚀");
    L.setPinnedFolderColor("default", id, "yellow");
  });
  await settled([a, b]);
  assert.deepEqual(looksOf(b), { "🟡 MLP": { emoji: "🚀", color: "yellow" } }, "B shows A's icon and colour, and the name stays as typed");
  assert.deepEqual(records(b)[`${PIN_FOLDER}a:${id}`], { e: "🚀", c: "yellow" });
  assert.deepEqual(Object.keys(records(b)[`${PIN_FOLDER}f:${id}`]).sort(), ["n", "p", "pos"], "the folder's own record keeps its old shape");

  a.with(() => L.renamePinnedFolder("default", id, "MLP"));
  b.with(() => L.setPinnedFolderColor("default", id, "green"));
  await settled([a, b]);
  for (const d of [a, b]) assert.deepEqual(looksOf(d), { MLP: { emoji: "🚀", color: "green" } }, `${d.id}: a rename and a colour change made at once both stay`);

  b.with(() => {
    L.setPinnedFolderEmoji("default", id, null);
    L.setPinnedFolderColor("default", id, null);
  });
  await settled([b, a]);
  assert.deepEqual(looksOf(a), { MLP: {} }, "removing both brings back the default folder on the other Mac");
  assert.equal(a.scope.records[`${PIN_FOLDER}a:${id}`].v, null);

  a.with(() => L.setPinnedFolderEmoji("default", id, "📚"));
  await settled([a, b]);
  b.with(() => L.deletePinnedFolder("default", id));
  await settled([b, a]);
  assert.deepEqual(view(a), ["mail", "docs"]);
  for (const d of [a, b]) assert.equal(d.scope.records[`${PIN_FOLDER}a:${id}`].v, null, `${d.id}: a deleted folder leaves no icon behind`);
});

test("older folder records without an icon still apply, and an icon record is kept as written until someone changes it", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  pinRows(a, ["mail"]);
  await settled([a]);
  later();
  const h = new Clock("devZ", null, () => now).tick();
  const ops = [
    { k: `${PIN_FOLDER}f:plain`, h, v: { n: "Plain", p: null, pos: "V" } },
    { k: `${PIN_FOLDER}f:looks`, h, v: { n: "Looks", p: null, pos: "W" } },
    { k: `${PIN_FOLDER}a:looks`, h, v: { e: "🟡", c: "blue", later: 1 } },
    { k: `${PIN_FOLDER}a:odd`, h, v: { e: "not an emoji", c: "magenta" } },
    { k: `${PIN_FOLDER}a:waiting`, h, v: { e: "🎯" } },
  ];
  await folder.transport("devZ").write("p", JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 1, at: now, ops }));
  await settled([a]);
  assert.deepEqual(looksOf(a), { Plain: {}, Looks: { emoji: "🟡", color: "blue" } });
  assert.deepEqual(a.scope.records[`${PIN_FOLDER}a:looks`].v, { e: "🟡", c: "blue", later: 1 }, "not rewritten by a Mac that didn't change it");
  assert.ok(a.scope.records[`${PIN_FOLDER}a:waiting`].v, "an icon whose folder hasn't arrived waits for it");
  a.with(() => L.setPinnedFolderEmoji("default", "plain", "🧪"));
  await settled([a]);
  assert.deepEqual(a.scope.records[`${PIN_FOLDER}a:plain`].v, { e: "🧪" });
});

test("a Mac without folder sync carries the icon records, and a Mac that joins from it gets the icons", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  pinRows(a, ["mail", "docs"]);
  a.with(() => {
    const id = L.newPinnedFolder(a.window, { name: "X", contents: [row("docs")], rename: false });
    L.setPinnedFolderEmoji("default", id, "🔥");
  });
  await settled([a, old]);
  assert.deepEqual(records(old), records(a));
  const fresh = new Device("devNew", folder);
  await settled([fresh, a, old]);
  assert.deepEqual(looksOf(fresh), { X: { emoji: "🔥" } });
});

test("randomized: three Macs making, nesting, renaming, moving and deleting folders, pinning and unpinning, with late files, converge", async () => {
  let seed = 20261030;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let run = 0; run < 25; run++) {
    const folder = new Folder();
    const devices = ["devA", "devB", "devC"].map((id) => new Device(id, folder));
    pinRows(devices[0], ["p1", "p2", "p3", "p4", "p5"]);
    devices[0].with(() => S().groupTabs([S().newTab(devices[0].window, { url: "https://g1.example/" })], { pinned: true, name: "G" }));
    await settled(devices);
    for (let step = 0; step < 40; step++) {
      const d = devices[rand(3)];
      const op = rand(10);
      d.with(() => {
        const folders = Object.keys(P().trees.default?.folders ?? {});
        const some = () => folders[rand(folders.length)];
        const refs = F.pinnedRefs(S(), "default");
        if (op <= 1) L.newPinnedFolder(d.window, { name: `F${run}.${step}`, target: { parent: folders.length && rand(2) ? some() : null }, rename: false });
        else if (op === 2 && folders.length) L.renamePinnedFolder("default", some(), `R${run}.${step}`);
        else if (op === 3 && folders.length) L.deletePinnedFolder("default", some());
        else if (op <= 6 && folders.length) {
          const nodes = [...refs, ...folders.map(F.folderRef)];
          const siblings = (parent) => (parent === null ? P().trees.default.root : P().trees.default.folders[parent].children);
          const parent = rand(3) ? some() : null;
          const before = rand(2) ? (siblings(parent)[rand(siblings(parent).length + 1)] ?? null) : null;
          L.movePinnedNodes("default", [nodes[rand(nodes.length)]], { parent, before });
        } else if (op === 7 && folders.length) L.setPinnedFolderCollapsed("default", some(), !!rand(2));
        else if (op === 8 && refs.filter((r) => r.startsWith("t:")).length > 2) {
          const ref = refs.filter((r) => r.startsWith("t:"))[rand(refs.length - 1)] ?? refs[0];
          const t = Object.values(S().tabs).find((x) => x.pinned && F.tabRef(x) === ref);
          if (t) S().pinTabs([t.id], false);
        } else if (op === 9) S().pinTabs([S().newTab(d.window, { url: `https://n${run}x${step}.example/` })], true, true);
      });
      if (rand(3) === 0) {
        const writer = devices[rand(3)];
        const before = folder.counter;
        await writer.sync();
        if (folder.counter > before && rand(3) === 0) folder.files.get(folder.newest()).hiddenFrom.add(devices[rand(3)].id);
      }
    }
    folder.files.forEach((f) => f.hiddenFrom.clear());
    let quiet = false;
    for (let round = 0; round < 8 && !quiet; round++) {
      let published = 0;
      for (const d of devices) published += (await d.sync()).published;
      quiet = published === 0;
    }
    assert.ok(quiet, `run ${run}: settles`);
    const views = devices.map(view);
    assert.deepEqual(views[1], views[0], `run ${run}: B matches A`);
    assert.deepEqual(views[2], views[0], `run ${run}: C matches A`);
    for (const d of devices) {
      d.with(() => {
        const tree = P().trees.default;
        if (!tree) return;
        const shown = JSON.stringify(F.resolveTree(tree, F.pinnedRefs(S(), "default")));
        for (const id of Object.keys(tree.folders)) assert.ok(shown.includes(`"f:${id}"`), `run ${run}: every folder is shown on ${d.id}`);
        for (const ref of F.pinnedRefs(S(), "default")) assert.ok(shown.includes(`"${ref}"`), `run ${run}: every pin is shown on ${d.id}`);
      });
    }
  }
});
