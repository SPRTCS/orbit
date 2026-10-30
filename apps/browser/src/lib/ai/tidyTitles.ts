import type { MenuItem } from "@ardia/shell";
import { showToast } from "../../components/layout/splitActions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { plural, viewTabIds } from "../../store/model";
import { childrenOf, usePinnedFolders } from "../../store/pinnedFolders";
import { pinKeyOf } from "../../store/pinMirror";
import type { Tab } from "../../store/types";
import { complete } from "./client";
import { aiEnabled } from "./settings";
import { tidyJob } from "./tidyJobs";
import { aiErrorText } from "./tidyTabs";
import { titleTidyable as tidyable } from "./tidyScope";
import { hostOf, MAX_TIDY_TABS, parseTidyTitles, tidyTitlesRequest } from "./tidyPrompts";

const TOAST_KEY = "aiTidyTitles";
const TIDY_TITLE = "ai:tidyTitle";
export const TIDY_FOLDER_TITLES = "ai:tidyFolderTitles";

export function folderTabIds(s: BrowserState, windowId: string, profileId: string, folderId: string): string[] {
  const tree = usePinnedFolders.getState().trees[profileId];
  if (!tree) return [];
  const inWindow = viewTabIds(s, windowId);
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (parent: string) => {
    if (seen.has(parent)) return;
    seen.add(parent);
    for (const ref of childrenOf(tree, parent)) {
      const key = ref.slice(2);
      if (ref.startsWith("f:")) walk(key);
      else if (ref.startsWith("t:")) {
        const id = inWindow.find((x) => s.tabs[x] && pinKeyOf(s.tabs[x]!) === key);
        if (id) out.push(id);
      } else if (ref.startsWith("g:")) {
        const g = Object.values(s.groups).find((x) => x.windowId === windowId && pinKeyOf(x) === key);
        if (g) out.push(...g.tabIds);
      }
    }
  };
  walk(folderId);
  return out.filter((id) => tidyable(s, s.tabs[id]));
}

type TitleUndo = { windowId: string; before: { id: string; key: string; customTitle: string | null }[] };

function undoTitles(u: TitleUndo) {
  const s = useBrowser.getState();
  for (const b of u.before) {
    const id = s.tabs[b.id] ? b.id : viewTabIds(s, u.windowId).find((x) => s.tabs[x] && pinKeyOf(s.tabs[x]!) === b.key);
    if (id) useBrowser.getState().updateTab(id, { customTitle: b.customTitle });
  }
}

function stopped(windowId: string): number {
  showToast(windowId, "Tidy Stopped", "AI was turned off.", { icon: "exclamationmark.triangle" });
  return 0;
}

export async function tidyTitles(windowId: string, tabIds: string[]): Promise<number> {
  const job = tidyJob();
  if (!job) return 0;
  const start = useBrowser.getState();
  const ids = [...new Set(tabIds)].filter((id) => tidyable(start, start.tabs[id])).slice(0, MAX_TIDY_TABS);
  if (!ids.length) {
    showToast(windowId, "Nothing to Tidy", "Tidy Titles works on pinned tabs.", { icon: "wand.and.stars" });
    return 0;
  }
  const tabs = ids.map((id) => {
    const t = start.tabs[id]!;
    return { title: t.title || t.url, host: hostOf(t.url) };
  });
  showToast(windowId, ids.length === 1 ? "Tidying Title…" : "Tidying Titles…", undefined, { icon: "wand.and.stars", key: TOAST_KEY, sticky: true });
  let text: string;
  try {
    text = await complete({ ...tidyTitlesRequest(tabs), signal: job.signal });
  } catch (error) {
    if (!job.live()) return stopped(windowId);
    showToast(windowId, ids.length === 1 ? "Couldn't Tidy Title" : "Couldn't Tidy Titles", aiErrorText(error), { icon: "exclamationmark.triangle" });
    return 0;
  }
  if (!job.live()) return stopped(windowId);
  const titles = parseTidyTitles(text, tabs.length);
  if (!titles) {
    showToast(windowId, ids.length === 1 ? "Couldn't Tidy Title" : "Couldn't Tidy Titles", "The model's answer wasn't usable. Try again.", { icon: "exclamationmark.triangle" });
    return 0;
  }
  const s = useBrowser.getState();
  const undo: TitleUndo = { windowId, before: [] };
  for (const [i, title] of titles) {
    const t = s.tabs[ids[i]!];
    if (!t || !tidyable(s, t) || title === (t.customTitle || t.title)) continue;
    undo.before.push({ id: t.id, key: pinKeyOf(t), customTitle: t.customTitle });
    useBrowser.getState().updateTab(t.id, { customTitle: title });
  }
  if (!undo.before.length) {
    showToast(windowId, ids.length === 1 ? "Title Already Tidy" : "Titles Already Tidy", undefined, { icon: "wand.and.stars" });
    return 0;
  }
  showToast(windowId, `Tidied ${plural(undo.before.length, "Title")}`, undefined, {
    icon: "wand.and.stars",
    action: { title: "Undo", run: () => undoTitles(undo) },
  });
  return undo.before.length;
}

export function aiTabMenuItems(tab: Tab): MenuItem[] {
  const s = useBrowser.getState();
  if (!aiEnabled() || !tidyable(s, tab)) return [];
  return [{ id: TIDY_TITLE, title: "Tidy Title", symbol: "wand.and.stars" }];
}

export function runAiTabMenu(choice: string, windowId: string, tab: Tab): boolean {
  if (choice !== TIDY_TITLE) return false;
  void tidyTitles(windowId, [tab.id]);
  return true;
}

export function aiFolderMenuItems(): MenuItem[] {
  return aiEnabled() ? [{ id: TIDY_FOLDER_TITLES, title: "Tidy Titles", symbol: "wand.and.stars" }] : [];
}
