import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock, emptyScope, publish } from "@ardia/sync";
import { forgetting, forgottenKeys, markForgotten, reviveOwn, stillListed } from "./forgottenDevices.ts";
import { deviceAdapter } from "./adapters.ts";

const remote = (state, key, v, h) => {
  state.records[key] = { h, v, o: ["old-pro", 3] };
};

test("forgetting another device tombstones its name with a newer clock, and leaves this device alone", async () => {
  const state = emptyScope();
  const clock = new Clock("air", null);
  remote(state, "dev:old-pro", { n: "MacBook Pro" }, clock.tick());
  remote(state, "dev:pro", { n: "MacBook Pro" }, clock.tick());
  const keys = forgottenKeys(["old-pro", "air"], "air");
  assert.deepEqual([...keys].sort(), ["dev:old-pro", "tabs:old-pro"]);
  markForgotten(state, keys, clock);
  await publish(state, [forgetting(deviceAdapter("air", () => "MacBook Air"), keys)], clock, "air");
  assert.equal(state.records["dev:old-pro"].v, null);
  assert.equal(state.records["dev:old-pro"].o[0], "air");
  assert.deepEqual(state.records["dev:pro"].v, { n: "MacBook Pro" });
  assert.deepEqual(state.records["dev:air"].v, { n: "MacBook Air" });
  assert.equal(state.outbox.filter((op) => op.k === "dev:old-pro" && op.v === null).length, 1);
  assert.equal(stillListed([state], "old-pro"), false);
  assert.equal(stillListed([state], "pro"), true);
});

test("a device that's already gone isn't tombstoned again", async () => {
  const state = emptyScope();
  const clock = new Clock("air", null);
  remote(state, "dev:old-pro", null, clock.tick());
  const keys = forgottenKeys(["old-pro"], "air");
  markForgotten(state, keys, clock);
  await publish(state, [forgetting(deviceAdapter("air", () => "MacBook Air"), keys)], clock, "air");
  assert.equal(state.outbox.some((op) => op.k === "dev:old-pro"), false);
});

test("without forgotten devices the adapter is unchanged", () => {
  const adapter = deviceAdapter("air", () => "MacBook Air");
  assert.equal(forgetting(adapter, new Set()), adapter);
});

test("a device removed by mistake publishes its name again on its next cycle", async () => {
  const state = emptyScope();
  const clock = new Clock("pro", null);
  const adapter = deviceAdapter("pro", () => "MacBook Pro");
  await publish(state, [adapter], clock, "pro");
  state.outbox = [];
  state.records["dev:pro"] = { h: clock.tick(), v: null, o: ["air", 9] };
  await publish(state, [adapter], clock, "pro");
  assert.equal(state.outbox.length, 0);
  reviveOwn(state, "pro");
  await publish(state, [adapter], clock, "pro");
  assert.deepEqual(state.records["dev:pro"].v, { n: "MacBook Pro" });
  assert.equal(state.outbox.length, 1);
});

test("a forgotten device's record from ahead of this clock still gets its tombstone", async () => {
  const state = emptyScope();
  const ahead = new Clock("old-pro", null, () => Date.now() + 86_400_000);
  remote(state, "dev:old-pro", { n: "MacBook Pro" }, ahead.tick());
  const clock = new Clock("air", null);
  const keys = forgottenKeys(["old-pro"], "air");
  markForgotten(state, keys, clock);
  await publish(state, [forgetting(deviceAdapter("air", () => "MacBook Air"), keys)], clock, "air");
  assert.equal(state.records["dev:old-pro"].v, null);
  assert.equal(stillListed([state], "old-pro"), false);
});

test("a removal waits for a profile scope that still lists the device's tabs", () => {
  const app = emptyScope();
  const disabled = emptyScope();
  disabled.records["tabs:old-pro"] = { h: new Clock("old-pro", null).tick(), v: { n: "MacBook Pro", tabs: [] }, o: ["old-pro", 1] };
  assert.equal(stillListed([app, disabled], "old-pro"), true);
});
