import { hashText, spaceSignature, type SpaceDoc } from "./spaceSnapshot";

export type TimelinePoint = { at: number; hash: string; doc: SpaceDoc };

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const HOURLY_KEPT = 48;
export const DAILY_KEPT = 30;
export const MAX_TIMELINE_CHARS = 4_000_000;

export const docHash = (doc: SpaceDoc) => hashText(spaceSignature(doc));

const localDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function timelineDue(points: TimelinePoint[], now: number): boolean {
  const last = points.at(-1);
  return !last || now - last.at >= HOUR_MS;
}

export function addTimelinePoint(points: TimelinePoint[], doc: SpaceDoc, now: number, force = false): TimelinePoint[] {
  const hash = docHash(doc);
  const last = points.at(-1);
  if (last?.hash === hash) return points;
  if (!force && !timelineDue(points, now)) return points;
  return pruneTimeline([...points, { at: now, hash, doc }], now);
}

export function pruneTimeline(points: TimelinePoint[], now: number): TimelinePoint[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const hourlyFrom = now - HOURLY_KEPT * HOUR_MS;
  const hourly = sorted.filter((p) => p.at >= hourlyFrom).slice(-HOURLY_KEPT);
  const lastOfDay = new Map<number, TimelinePoint>();
  for (const p of sorted) if (p.at < hourlyFrom) lastOfDay.set(localDay(p.at), p);
  const daily = [...lastOfDay.values()].slice(-DAILY_KEPT);
  const keep = new Set<TimelinePoint>([...hourly, ...daily]);
  let kept = sorted.filter((p) => keep.has(p));
  kept = kept.filter((p, i) => i === 0 || p.hash !== kept[i - 1]!.hash);
  let size = kept.reduce((n, p) => n + JSON.stringify(p.doc).length, 0);
  while (kept.length > 1 && size > MAX_TIMELINE_CHARS) {
    size -= JSON.stringify(kept[0]!.doc).length;
    kept = kept.slice(1);
  }
  return kept.length === points.length && kept.every((p, i) => p === points[i]) ? points : kept;
}
