import assert from "node:assert/strict";
import { test } from "node:test";
const T = await import("./spaceTimeline.ts");

const H = T.HOUR_MS;
const doc = (n) => ({ format: "orbit-space", version: 1, kind: "space", name: "S", tiles: [], pinned: [{ kind: "tab", url: `https://p${n}.com/` }] });
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime();

test("a timeline point is skipped when nothing changed since the previous one", () => {
  let points = T.addTimelinePoint([], doc(1), NOW);
  assert.equal(points.length, 1);
  const same = T.addTimelinePoint(points, { ...doc(1), savedAt: 5 }, NOW + 2 * H);
  assert.equal(same, points, "identical structure, only the time differs");
  points = T.addTimelinePoint(points, doc(2), NOW + 2 * H);
  assert.equal(points.length, 2);
});

test("at most one point an hour unless forced", () => {
  const points = T.addTimelinePoint([], doc(1), NOW);
  assert.equal(T.addTimelinePoint(points, doc(2), NOW + H / 2), points, "a change half an hour later waits");
  assert.equal(T.timelineDue(points, NOW + H / 2), false);
  assert.equal(T.timelineDue(points, NOW + H), true);
  assert.equal(T.addTimelinePoint(points, doc(2), NOW + H / 2, true).length, 2, "Snapshot Now forces one");
});

test("retention keeps 48 hourly and 30 daily points", () => {
  let points = [];
  const start = NOW - 90 * 24 * H;
  for (let at = start, n = 0; at <= NOW; at += H, n++) points.push({ at, hash: `h${n}`, doc: doc(n) });
  const kept = T.pruneTimeline(points, NOW);
  const hourly = kept.filter((p) => p.at > NOW - 48 * H);
  const daily = kept.filter((p) => p.at <= NOW - 48 * H);
  assert.equal(hourly.length, 48);
  assert.equal(daily.length, 30);
  const days = new Set(daily.map((p) => new Date(p.at).toDateString()));
  assert.equal(days.size, 30, "one per day");
  const older = points.filter((p) => p.at < NOW - 48 * H);
  assert.ok(daily.every((p) => !older.some((o) => o.at > p.at && new Date(o.at).toDateString() === new Date(p.at).toDateString())), "the day's last point is the one kept");
  assert.ok(kept.every((p, i) => i === 0 || p.at > kept[i - 1].at), "in order");
});

test("pruning drops repeats that become neighbours and bounds the size", () => {
  const points = [
    { at: NOW - 100 * 24 * H, hash: "a", doc: doc(1) },
    { at: NOW - 3 * H, hash: "a", doc: doc(1) },
    { at: NOW - 2 * H, hash: "b", doc: doc(2) },
  ];
  assert.deepEqual(T.pruneTimeline(points, NOW).map((p) => p.hash), ["a", "b"]);
  const big = { ...doc(0), pinned: Array.from({ length: 4000 }, (_, i) => ({ kind: "tab", url: `https://example.com/${"x".repeat(200)}/${i}` })) };
  const many = Array.from({ length: 10 }, (_, i) => ({ at: NOW - (10 - i) * H, hash: `b${i}`, doc: big }));
  const kept = T.pruneTimeline(many, NOW);
  assert.ok(kept.length < many.length && kept.length >= 1, "oldest points go first when the file would grow too big");
  assert.equal(kept.at(-1).hash, "b9");
});
