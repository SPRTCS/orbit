import { readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { hashText, parseSpace, spaceSignature, type SpaceDoc } from "../store/spaceSnapshot";
import { applyPins, applySpaceLook, spaceFiles } from "./spaces";

const background = <T,>(timer: T): T => {
  (timer as { unref?: () => void }).unref?.();
  return timer;
};

export type SpaceSubscription = { url: string; hash: string | null; modified: number | null; checkedAt: number; updatedAt: number | null; error: string | null };

const FILE = "space-subscriptions.json";
const VERSION = 1;
const POLL_MS = 60_000;

export const useSpaceSubscriptions = create<{ subs: Record<string, SpaceSubscription> }>(() => ({ subs: {} }));

const publishedHash = (doc: SpaceDoc) => {
  const { today: _today, ...shared } = doc;
  return hashText(spaceSignature(shared));
};

function persist() {
  try {
    writeDocument(FILE, JSON.stringify({ version: VERSION, subs: useSpaceSubscriptions.getState().subs }));
  } catch (error) {
    console.warn(`Couldn't save ${FILE}`, error);
  }
}

function patch(profileId: string, change: Partial<SpaceSubscription>) {
  const subs = useSpaceSubscriptions.getState().subs;
  const sub = subs[profileId];
  if (!sub) return;
  useSpaceSubscriptions.setState({ subs: { ...subs, [profileId]: { ...sub, ...change } } });
  persist();
}

export function subscribeSpace(profileId: string, url: string, doc?: SpaceDoc, modified: number | null = null) {
  const now = Date.now();
  const sub: SpaceSubscription = { url, hash: doc ? publishedHash(doc) : null, modified, checkedAt: now, updatedAt: doc ? now : null, error: null };
  useSpaceSubscriptions.setState((x) => ({ subs: { ...x.subs, [profileId]: sub } }));
  persist();
}

export function unsubscribeSpace(profileId: string) {
  const { [profileId]: _gone, ...rest } = useSpaceSubscriptions.getState().subs;
  useSpaceSubscriptions.setState({ subs: rest });
  persist();
}

export function applyPublished(profileId: string, doc: SpaceDoc) {
  applyPins(profileId, doc, "replace");
  applySpaceLook(profileId, doc);
}

export async function checkSubscription(profileId: string, force = false): Promise<boolean> {
  const sub = useSpaceSubscriptions.getState().subs[profileId];
  const native = spaceFiles();
  if (!sub || !native || !useBrowser.getState().profiles[profileId]) return false;
  const now = Date.now();
  try {
    const modified = await native.modified(sub.url);
    if (modified === null) {
      patch(profileId, { checkedAt: now, error: "The shared file can't be found. It may have been moved, or iCloud hasn't downloaded it yet." });
      return false;
    }
    if (!force && sub.modified === modified && !sub.error) {
      patch(profileId, { checkedAt: now });
      return false;
    }
    const file = await native.readFile(sub.url);
    const doc = parseSpace(file.contents);
    const hash = publishedHash(doc);
    if (hash === sub.hash) {
      patch(profileId, { checkedAt: now, modified: file.modified, error: null });
      return false;
    }
    applyPublished(profileId, doc);
    patch(profileId, { checkedAt: now, modified: file.modified, hash, updatedAt: now, error: null });
    return true;
  } catch (error) {
    patch(profileId, { checkedAt: now, error: String((error as Error)?.message ?? error) });
    return false;
  }
}

export function startSpaceSubscriptions() {
  try {
    const json = readDocument(FILE);
    const doc = json ? (JSON.parse(json) as { version?: number; subs?: Record<string, SpaceSubscription> }) : null;
    useSpaceSubscriptions.setState({ subs: doc?.version === VERSION && doc.subs ? doc.subs : {} });
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
  }
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      for (const id of Object.keys(useSpaceSubscriptions.getState().subs)) await checkSubscription(id);
    } finally {
      running = false;
    }
  };
  const first = background(setTimeout(() => void poll(), 5_000));
  const interval = background(setInterval(() => void poll(), POLL_MS));
  const stopWatching = useBrowser.subscribe((s, prev) => {
    if (s.profiles === prev.profiles || !Object.keys(s.profiles).length) return;
    const gone = Object.keys(useSpaceSubscriptions.getState().subs).filter((id) => !s.profiles[id]);
    gone.forEach(unsubscribeSpace);
  });
  return () => {
    clearTimeout(first);
    clearInterval(interval);
    stopWatching();
  };
}
