import { readDocument, removeDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { changedIds } from "../store/changes";
import { isIncognitoProfile, newId } from "../store/model";
import { usePinnedFolders } from "../store/pinnedFolders";
import { parseSpace, type SpaceDoc } from "../store/spaceSnapshot";
import { addTimelinePoint, docHash, HOUR_MS, type TimelinePoint } from "../store/spaceTimeline";
import { startSpaceSubscriptions } from "./spaceSubscriptions";
import { spaceDocument } from "./spaces";

export type SavedSession = { id: string; name: string; profileId: string; savedAt: number; doc: SpaceDoc };
type Head = { at: number; hash: string; count: number };

const SESSIONS_FILE = "space-sessions.json";
const TIMELINE_INDEX = "space-timeline.json";
const timelineFile = (profileId: string) => `space-timeline-${profileId.replace(/[^a-z0-9_-]/gi, "_")}.json`;
const VERSION = 1;
const MAX_SESSIONS = 200;
const SETTLE_MS = 60_000;
const TICK_MS = 5 * 60_000;

export const useSpaceSessions = create<{ sessions: SavedSession[]; heads: Record<string, Head>; revision: number }>(() => ({ sessions: [], heads: {}, revision: 0 }));

function readJson<T>(name: string): T | null {
  try {
    const json = readDocument(name);
    return json ? (JSON.parse(json) as T) : null;
  } catch (error) {
    console.warn(`Couldn't read ${name}`, error);
    return null;
  }
}

function writeJson(name: string, value: unknown) {
  try {
    writeDocument(name, JSON.stringify(value));
  } catch (error) {
    console.warn(`Couldn't save ${name}`, error);
  }
}

function validDoc(doc: unknown): SpaceDoc | null {
  try {
    return parseSpace(doc, { local: true });
  } catch {
    return null;
  }
}

function readSessions(): SavedSession[] {
  const doc = readJson<{ version?: number; sessions?: SavedSession[] }>(SESSIONS_FILE);
  if (doc?.version !== VERSION || !Array.isArray(doc.sessions)) return [];
  return doc.sessions.flatMap((x) => {
    const parsed = validDoc(x?.doc);
    return parsed && typeof x.id === "string" && typeof x.profileId === "string" ? [{ ...x, name: String(x.name || parsed.name), doc: parsed }] : [];
  });
}

export function readTimeline(profileId: string): TimelinePoint[] {
  const doc = readJson<{ version?: number; points?: TimelinePoint[] }>(timelineFile(profileId));
  if (doc?.version !== VERSION || !Array.isArray(doc.points)) return [];
  return doc.points.flatMap((p) => {
    const parsed = validDoc(p?.doc);
    return parsed && typeof p.at === "number" ? [{ at: p.at, hash: typeof p.hash === "string" ? p.hash : docHash(parsed), doc: parsed }] : [];
  });
}

function writeTimeline(profileId: string, points: TimelinePoint[]) {
  writeJson(timelineFile(profileId), { version: VERSION, points });
  const heads = { ...useSpaceSessions.getState().heads };
  const last = points.at(-1);
  if (last) heads[profileId] = { at: last.at, hash: last.hash, count: points.length };
  else delete heads[profileId];
  useSpaceSessions.setState((x) => ({ heads, revision: x.revision + 1 }));
  writeJson(TIMELINE_INDEX, { version: VERSION, heads });
}

export function recordTimeline(profileId: string, options: { force?: boolean; now?: number } = {}): boolean {
  const s = useBrowser.getState();
  if (!s.profiles[profileId] || isIncognitoProfile(profileId)) return false;
  const now = options.now ?? Date.now();
  const head = useSpaceSessions.getState().heads[profileId];
  if (!options.force && head && now - head.at < HOUR_MS) return false;
  const doc = spaceDocument(profileId, { today: true, local: true });
  if (!doc) return false;
  if (head?.hash === docHash(doc)) return false;
  const points = readTimeline(profileId);
  const next = addTimelinePoint(points, doc, now, options.force);
  if (next === points) return false;
  writeTimeline(profileId, next);
  return true;
}

export function saveSession(profileId: string, name: string, now = Date.now()): SavedSession | null {
  const doc = spaceDocument(profileId, { today: true, local: true, now });
  if (!doc) return null;
  const session: SavedSession = { id: newId("ss"), name: name.trim() || doc.name, profileId, savedAt: now, doc };
  useSpaceSessions.setState((x) => ({ sessions: [...x.sessions, session].slice(-MAX_SESSIONS) }));
  return session;
}

export function renameSession(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  useSpaceSessions.setState((x) => ({ sessions: x.sessions.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) }));
}

export function deleteSession(id: string) {
  useSpaceSessions.setState((x) => ({ sessions: x.sessions.filter((s) => s.id !== id) }));
}

const SPACE_FIELDS = ["pinned", "pinnedAsRow", "pinnedUrl", "url", "customTitle", "customIcon", "profileId", "windowId", "pinKey"] as const;

function touchedProfiles(s: BrowserState, prev: BrowserState): Set<string> | "all" {
  if (s.windows !== prev.windows || s.groups !== prev.groups || s.parkedPins !== prev.parkedPins || s.profiles !== prev.profiles) return "all";
  const out = new Set<string>();
  if (s.tabs === prev.tabs) return out;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (a && b && SPACE_FIELDS.every((f) => a[f] === b[f])) continue;
    if (a) out.add(a.profileId);
    if (b) out.add(b.profileId);
  }
  return out;
}

export const background = <T,>(timer: T): T => {
  (timer as { unref?: () => void }).unref?.();
  return timer;
};

let flushSessions: () => void = () => {};

export function saveSessionsNow() {
  flushSessions();
}

export function startSpaceSessions(now = Date.now()) {
  const index = readJson<{ version?: number; heads?: Record<string, Head> }>(TIMELINE_INDEX);
  useSpaceSessions.setState({ sessions: readSessions(), heads: index?.version === VERSION && index.heads ? index.heads : {}, revision: 0 });
  let saved = JSON.stringify({ version: VERSION, sessions: useSpaceSessions.getState().sessions });
  const save = () => {
    const json = JSON.stringify({ version: VERSION, sessions: useSpaceSessions.getState().sessions });
    if (json === saved) return;
    saved = json;
    try {
      writeDocument(SESSIONS_FILE, json);
    } catch (error) {
      console.warn(`Couldn't save ${SESSIONS_FILE}`, error);
    }
  };
  flushSessions = save;
  const stopSaving = useSpaceSessions.subscribe((x, prev) => {
    if (x.sessions !== prev.sessions) save();
  });

  const dirty = new Set<string>(useBrowser.getState().profileOrder);
  const markAll = () => useBrowser.getState().profileOrder.forEach((id) => dirty.add(id));
  const stopWatching = useBrowser.subscribe((s, prev) => {
    const touched = touchedProfiles(s, prev);
    if (touched === "all") markAll();
    else touched.forEach((id) => dirty.add(id));
    if (s.profiles !== prev.profiles) forgetDeleted(s);
  });
  const stopFolders = usePinnedFolders.subscribe((f, prev) => {
    if (f.trees !== prev.trees) markAll();
  });
  const tick = () => {
    const at = Date.now();
    for (const id of [...dirty]) {
      const head = useSpaceSessions.getState().heads[id];
      if (head && at - head.at < HOUR_MS) continue;
      dirty.delete(id);
      recordTimeline(id, { now: at });
    }
  };
  const settle = background(setTimeout(tick, Math.max(0, SETTLE_MS - (Date.now() - now))));
  const interval = background(setInterval(tick, TICK_MS));
  return () => {
    clearTimeout(settle);
    clearInterval(interval);
    stopWatching();
    stopFolders();
    stopSaving();
    save();
    flushSessions = () => {};
  };
}

function forgetDeleted(s: BrowserState) {
  if (!Object.keys(s.profiles).length) return;
  const { heads } = useSpaceSessions.getState();
  const gone = Object.keys(heads).filter((id) => !s.profiles[id]);
  if (!gone.length) return;
  const kept = { ...heads };
  for (const id of gone) {
    delete kept[id];
    try {
      removeDocument(timelineFile(id));
    } catch {}
  }
  useSpaceSessions.setState((x) => ({ heads: kept, revision: x.revision + 1 }));
  writeJson(TIMELINE_INDEX, { version: VERSION, heads: kept });
}

export function startOrbitSpaces() {
  const stopSessions = startSpaceSessions();
  const stopSubscriptions = startSpaceSubscriptions();
  return () => {
    stopSubscriptions();
    stopSessions();
  };
}
