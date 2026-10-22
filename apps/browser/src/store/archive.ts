import { create } from "zustand";
import { isIncognitoProfile, newId } from "./model";
import type { ClosedTab } from "./types";

export type ArchiveReason = "cleanUp" | "closed";

export type ArchivedTab = {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  icon: string | null;
  profileId: string;
  windowId: string;
  archivedAt: number;
  reason: ArchiveReason;
  sourceId: string;
};

export const MAX_ARCHIVED = 1000;
export const ARCHIVE_KEPT_MS = 30 * 86_400_000;

export const useArchive = create<{ entries: ArchivedTab[] }>(() => ({ entries: [] }));

const archivableUrl = (url: string) => /^(https?|file):/i.test(url);

export const archivable = (c: ClosedTab): boolean =>
  !!c.tab.url && archivableUrl(c.tab.url) && !c.pinnedTile && !c.tab.pinned && !isIncognitoProfile(c.tab.profileId);

export const toArchived = (c: ClosedTab, reason: ArchiveReason): ArchivedTab => ({
  id: newId("ar"),
  url: c.tab.url,
  title: c.tab.customTitle || c.tab.title || "",
  favicon: c.tab.favicon ?? null,
  icon: c.tab.customIcon ?? null,
  profileId: c.tab.profileId,
  windowId: c.windowId,
  archivedAt: c.closedAt,
  reason,
  sourceId: c.id,
});

export const pruneArchive = (list: ArchivedTab[], now = Date.now()): ArchivedTab[] => {
  const kept = list.filter((e) => now - e.archivedAt < ARCHIVE_KEPT_MS && !isIncognitoProfile(e.profileId));
  const capped = kept.length > MAX_ARCHIVED ? kept.slice(-MAX_ARCHIVED) : kept;
  return capped.length === list.length ? list : capped;
};

const samePlace = (a: ArchivedTab, b: ArchivedTab) => a.url === b.url && a.profileId === b.profileId;

export function addArchived(list: ArchivedTab[], added: ArchivedTab[], now = Date.now()): ArchivedTab[] {
  if (!added.length) return pruneArchive(list, now);
  const fresh = added.filter((e, i) => !added.slice(i + 1).some((later) => samePlace(e, later)));
  const kept = list.filter((e) => !fresh.some((f) => samePlace(e, f)));
  return pruneArchive([...kept, ...fresh].sort((a, b) => a.archivedAt - b.archivedAt), now);
}

export function closedChanges(prev: ClosedTab[], next: ClosedTab[]): { added: ClosedTab[]; removed: string[] } {
  if (prev === next) return { added: [], removed: [] };
  const before = new Set(prev.map((c) => c.id));
  const after = new Set(next.map((c) => c.id));
  const added = next.filter((c) => !before.has(c.id));
  const gone = prev.filter((c) => !after.has(c.id)).map((c) => c.id);
  const trimmed = added.length > 0 && gone.every((id, i) => prev[i]?.id === id);
  return { added, removed: trimmed ? [] : gone };
}

export type ArchiveSources = { closedTabs: ClosedTab[]; cleanedTabs: ClosedTab[] };

export function archiveUpdate(list: ArchivedTab[], prev: ArchiveSources, next: ArchiveSources, since: number, now = Date.now()): ArchivedTab[] {
  const closed = closedChanges(prev.closedTabs, next.closedTabs);
  const cleaned = closedChanges(prev.cleanedTabs, next.cleanedTabs);
  const fresh = (c: ClosedTab) => c.closedAt >= since && archivable(c);
  const added = [
    ...closed.added.filter(fresh).map((c) => toArchived(c, "closed")),
    ...cleaned.added.filter(fresh).map((c) => toArchived(c, "cleanUp")),
  ];
  const removed = new Set([...closed.removed, ...cleaned.removed]);
  const left = removed.size ? list.filter((e) => !removed.has(e.sourceId)) : list;
  if (!added.length && left === list) return list;
  return addArchived(left, added, now);
}

export const archiveForProfiles = (list: ArchivedTab[], profiles: Record<string, unknown>): ArchivedTab[] => {
  const kept = list.filter((e) => !!profiles[e.profileId]);
  return kept.length === list.length ? list : kept;
};

export type ArchiveDay = { start: number; entries: ArchivedTab[] };

export const dayOf = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function archiveDays(list: ArchivedTab[], query = ""): ArchiveDay[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const days: ArchiveDay[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (words.length) {
      const hay = `${e.title} ${e.url}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    const start = dayOf(e.archivedAt);
    const last = days.at(-1);
    if (last?.start === start) last.entries.push(e);
    else days.push({ start, entries: [e] });
  }
  return days;
}

export function removeArchived(ids: string[]) {
  const gone = new Set(ids);
  useArchive.setState((s) => ({ entries: s.entries.filter((e) => !gone.has(e.id)) }));
}

export function clearArchive() {
  useArchive.setState({ entries: [] });
}
