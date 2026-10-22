import { readDocument, writeDocument } from "@ardia/shell";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId } from "../store/model";
import { archiveForProfiles, archiveUpdate, pruneArchive, removeArchived, useArchive, type ArchivedTab } from "../store/archive";

const FILE = "archive.json";
const VERSION = 1;
const SAVE_DELAY_MS = 800;

function readArchive(): ArchivedTab[] {
  try {
    const json = readDocument(FILE);
    const doc = json ? (JSON.parse(json) as { version?: number; entries?: ArchivedTab[] }) : null;
    return doc?.version === VERSION && Array.isArray(doc.entries) ? doc.entries : [];
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
    return [];
  }
}

let flushArchive: () => void = () => {};

export function saveArchiveNow() {
  flushArchive();
}

export function startArchive(since = Date.now()) {
  useArchive.setState({ entries: pruneArchive(readArchive()) });
  let saved = JSON.stringify({ version: VERSION, entries: useArchive.getState().entries });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    const json = JSON.stringify({ version: VERSION, entries: useArchive.getState().entries });
    if (json === saved) return;
    saved = json;
    try {
      writeDocument(FILE, json);
    } catch (error) {
      console.warn(`Couldn't save ${FILE}`, error);
    }
  };
  flushArchive = save;
  const stopSaving = useArchive.subscribe((a, prev) => {
    if (a.entries !== prev.entries) timer ??= setTimeout(save, SAVE_DELAY_MS);
  });
  const stopWatching = useBrowser.subscribe((s, prev) => {
    if (s.closedTabs === prev.closedTabs && s.cleanedTabs === prev.cleanedTabs && s.profiles === prev.profiles) return;
    const entries = useArchive.getState().entries;
    let next = archiveUpdate(entries, prev, s, since);
    if (s.profiles !== prev.profiles && Object.keys(s.profiles).length) next = archiveForProfiles(next, s.profiles);
    if (next !== entries) useArchive.setState({ entries: next });
  });
  return () => {
    stopWatching();
    stopSaving();
    save();
    flushArchive = () => {};
  };
}

function restoreWindow(s: BrowserState, requested?: string | null): string | undefined {
  const usable = (id: string | null | undefined) => !!id && !!s.windows[id] && !s.windows[id]!.incognito && s.windows[id]!.kind !== "small";
  if (usable(requested)) return requested!;
  return s.ui.focusOrder.find(usable) ?? s.windowOrder.find(usable);
}

const newTabIds = (before: BrowserState, after: BrowserState) => Object.keys(after.tabs).filter((id) => !before.tabs[id]);

export function restoreArchived(entryId: string, options: { windowId?: string | null; background?: boolean } = {}): string | undefined {
  const entry = useArchive.getState().entries.find((e) => e.id === entryId);
  if (!entry) return undefined;
  const s = useBrowser.getState();
  const profileId = s.profiles[entry.profileId] ? entry.profileId : s.settings.defaultProfileId;
  const windowId = restoreWindow(s, options.windowId);
  if (!windowId) {
    const created = s.createWindow({ profileId, url: entry.url, background: options.background });
    removeArchived([entry.id]);
    return activeTabId(useBrowser.getState(), created);
  }
  const before = useBrowser.getState();
  if (!options.background && before.closedTabs.some((c) => c.id === entry.sourceId)) before.restoreClosed(entry.sourceId, windowId);
  else if (!options.background && before.cleanedTabs.some((c) => c.id === entry.sourceId)) before.restoreCleaned(entry.sourceId, windowId);
  const restored = newTabIds(before, useBrowser.getState()).find((id) => useBrowser.getState().tabs[id]?.url);
  removeArchived([entry.id]);
  if (restored) return restored;
  useBrowser.setState((b) => ({
    closedTabs: b.closedTabs.some((c) => c.id === entry.sourceId) ? b.closedTabs.filter((c) => c.id !== entry.sourceId) : b.closedTabs,
    cleanedTabs: b.cleanedTabs.some((c) => c.id === entry.sourceId) ? b.cleanedTabs.filter((c) => c.id !== entry.sourceId) : b.cleanedTabs,
  }));
  return useBrowser.getState().newTab(windowId, {
    url: entry.url,
    profileId,
    background: options.background,
    snapshot: { title: entry.title, favicon: entry.favicon, customIcon: entry.icon, profileId },
  }) || undefined;
}
