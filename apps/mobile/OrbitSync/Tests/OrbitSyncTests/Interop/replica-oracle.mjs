import { writeFileSync } from "node:fs";

const root = new URL("../../../../../../", import.meta.url);
const { Clock } = await import(new URL("packages/sync/src/hlc.ts", root).href);
const { compact, emptyScope, pull, syncScope } = await import(new URL("packages/sync/src/scope.ts", root).href);

const [, , out, runsArg = "30", seedArg = "11"] = process.argv;
let seed = Number(seedArg);
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (list) => list[Math.floor(random() * list.length)];

class Folder {
  files = new Map();
  counter = 0;
  now = 1_790_000_000_000;
  transport(device) {
    return {
      write: async (_scope, payload) => {
        const id = `f${String(++this.counter).padStart(4, "0")}`;
        this.files.set(id, { payload, hiddenFrom: new Set(), partialFor: new Set() });
        return id;
      },
      read: async (_scope, known) => this.listing(device, known),
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
  listing(device, known) {
    const listing = { files: [], pending: [], damaged: [], present: [] };
    for (const [id, f] of this.files) {
      listing.present.push(id);
      if (known.includes(id)) continue;
      if (f.hiddenFrom.has(device)) listing.pending.push(id);
      else if (f.partialFor.has(device) || (f.stuck && device === "phone")) listing.damaged.push({ id, age: 0 });
      else listing.files.push({ id, payload: f.payload });
    }
    return listing;
  }
}

class Device {
  store = new Map();
  state = emptyScope();
  constructor(id, folder) {
    this.id = id;
    this.folder = folder;
    this.offset = Math.floor(random() * 4000) - 2000;
    this.clock = new Clock(id, null, () => this.folder.now + this.offset);
  }
  adapters() {
    return [
      {
        prefix: "x:",
        extract: () => ({ values: new Map(this.store) }),
        apply: (visible, changed) => {
          for (const k of changed) visible.has(k) ? this.store.set(k, visible.get(k)) : this.store.delete(k);
        },
      },
    ];
  }
  sync() {
    return syncScope({
      scope: "s",
      state: this.state,
      transport: this.folder.transport(this.id),
      adapters: this.adapters(),
      clock: this.clock,
      device: this.id,
      now: () => this.folder.now + this.offset,
      options: { pruneGrace: 0, compactAfterFiles: 6, compactInterval: 0 },
    });
  }
}

const values = () => {
  const r = random();
  if (r < 0.3) return `v${Math.floor(random() * 1000)}`;
  if (r < 0.6) return { n: `name ${Math.floor(random() * 50)}`, tabs: [{ u: "https://a.example/", t: "A \"quoted\" title\n" }], pos: "a" + Math.floor(random() * 9 + 1) };
  if (r < 0.8) return [1, 2.5, true, null, "é😀"];
  return Math.floor(random() * 1e6) / 7;
};

const stateOf = (s, clock) => ({
  records: s.records,
  vv: s.vv,
  extra: s.extra,
  files: s.files,
  damaged: s.damaged,
  pendingSince: s.pendingSince ?? null,
  seen: s.seen,
  pending: s.pending,
  clock: clock.last,
});

const runs = [];
for (let run = 0; run < Number(runsArg); run++) {
  const folder = new Folder();
  const devices = ["devA", "devB", "devC"].map((id) => new Device(id, folder));
  const observer = { state: emptyScope(), clock: new Clock("phone", null, () => folder.now) };
  const deliveries = [];
  for (let step = 0; step < 60; step++) {
    folder.now += Math.floor(random() * 50);
    if (random() < 0.05) folder.now += 2 * 86_400_000;
    const d = pick(devices);
    const key = `x:${Math.floor(random() * 8)}`;
    const r = random();
    if (r < 0.45) d.store.set(key, values());
    else if (r < 0.6) d.store.delete(key);
    else if (r < 0.65) await compact(d.state, folder.transport(d.id), "s", d.id, folder.now + d.offset, { pruneGrace: 0 }, true);
    else await d.sync();
    if (random() < 0.3) await pick(devices).sync();
    for (const e of folder.files.values()) {
      if (random() < 0.01) e.stuck = true;
      if (random() < 0.15) e.hiddenFrom.add(pick([...devices.map((x) => x.id), "phone"]));
      if (random() < 0.1) e.partialFor.add(pick([...devices.map((x) => x.id), "phone"]));
      if (random() < 0.3) e.hiddenFrom.clear();
      if (random() < 0.3) e.partialFor.clear();
    }
    if (random() < 0.35) {
      const listing = folder.listing("phone", Object.keys(observer.state.files));
      await pull(observer.state, { read: async () => listing }, "s", observer.clock, folder.now);
      deliveries.push({ now: folder.now, listing: { ...listing, damaged: listing.damaged.map((d) => d.id) }, expected: JSON.parse(JSON.stringify(stateOf(observer.state, observer.clock))) });
    }
  }
  for (const e of folder.files.values()) {
    e.hiddenFrom.clear();
    e.partialFor.clear();
  }
  for (const d of devices) await d.sync();
  const listing = folder.listing("phone", Object.keys(observer.state.files));
  await pull(observer.state, { read: async () => listing }, "s", observer.clock, folder.now);
  deliveries.push({ now: folder.now, listing: { ...listing, damaged: listing.damaged.map((d) => d.id) }, expected: stateOf(observer.state, observer.clock) });
  runs.push({
    deliveries,
    converged: devices.every((d) => JSON.stringify([...d.store].sort()) === JSON.stringify([...devices[0].store].sort())),
  });
}
writeFileSync(out, JSON.stringify(runs));
