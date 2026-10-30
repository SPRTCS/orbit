import { create } from "zustand";
import { showToast } from "../../components/layout/splitActions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { orderSections, placeBlock, syncGroupOrder } from "../../store/groups";
import { inPinnedContainer, plural, viewTabIds } from "../../store/model";
import { groupOf, withGroup } from "../../store/organize";
import { splitOf } from "../../store/splits";
import type { TabGroup } from "../../store/types";
import { complete } from "./client";
import { isAiError } from "./errors";
import { tidyJob } from "./tidyJobs";
import { canTidyWindow } from "./tidyScope";
import { hostOf, MAX_TIDY_TABS, MIN_GROUP_SIZE, parseTidyGroups, tidyTabsRequest } from "./tidyPrompts";

export const MIN_TIDY_TABS = 3;
const TOAST_KEY = "aiTidyTabs";

export const useTidyTabs = create<{ busy: Record<string, true> }>(() => ({ busy: {} }));

const setBusy = (windowId: string, on: boolean) =>
  useTidyTabs.setState((s) => {
    const busy = { ...s.busy };
    if (on) busy[windowId] = true;
    else delete busy[windowId];
    return { busy };
  });

export const aiErrorText = (error: unknown) => (isAiError(error) ? error.message : "Something went wrong. Try again.");

function tidyable(s: BrowserState, id: string, regroupAll: boolean): boolean {
  const t = s.tabs[id];
  if (!t || t.pinned || !t.url || inPinnedContainer(s, id) || splitOf(s, id)) return false;
  const g = groupOf(s, id);
  return !g || (regroupAll && !g.pinned);
}

export function tidyCandidates(s: BrowserState, windowId: string, regroupAll: boolean): string[] {
  if (!canTidyWindow(s, windowId)) return [];
  return viewTabIds(s, windowId)
    .filter((id) => tidyable(s, id, regroupAll))
    .slice(0, MAX_TIDY_TABS);
}

type TidyUndo = { windowId: string; tabIds: string[]; groups: TabGroup[]; created: string[] };

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export function undoTidy(u: TidyUndo) {
  const s = useBrowser.getState();
  const w = s.windows[u.windowId];
  if (!w) return;
  const groups = { ...s.groups };
  for (const id of u.created) delete groups[id];
  const present = new Set(w.tabIds);
  const tracked = u.tabIds.filter((id) => present.has(id));
  const trackedSet = new Set(tracked);
  let tabIds = [...w.tabIds];
  let k = 0;
  tabIds = tabIds.map((id) => (trackedSet.has(id) ? tracked[k++]! : id));
  for (const g of u.groups) {
    const now = groups[g.id];
    if (now && sameIds(now.tabIds, g.tabIds)) continue;
    delete groups[g.id];
    const grouped = new Set(Object.values(groups).flatMap((x) => x.tabIds));
    const members = g.tabIds.filter((id) => present.has(id) && !grouped.has(id) && !s.tabs[id]?.pinned);
    if (!members.length) continue;
    tabIds = placeBlock(tabIds, tabIds.filter((id) => members.includes(id)));
    groups[g.id] = { ...g, tabIds: tabIds.filter((id) => members.includes(id)) };
  }
  const window = { ...w, tabIds: orderSections(tabIds, s.tabs, groups) };
  useBrowser.setState({ groups: syncGroupOrder(groups, window), windows: { ...s.windows, [u.windowId]: window } });
}

export async function tidyTabs(windowId: string, options: { regroupAll?: boolean } = {}): Promise<number> {
  if (useTidyTabs.getState().busy[windowId]) return 0;
  const job = tidyJob();
  if (!job) return 0;
  const regroupAll = !!options.regroupAll;
  const start = useBrowser.getState();
  if (!canTidyWindow(start, windowId)) return 0;
  const ids = tidyCandidates(start, windowId, regroupAll);
  if (ids.length < MIN_TIDY_TABS) {
    showToast(windowId, "Nothing to Tidy", regroupAll ? "Tidy needs at least 3 unpinned tabs." : "Tidy needs at least 3 tabs that aren't pinned or in a group.", { icon: "wand.and.stars" });
    return 0;
  }
  const tabs = ids.map((id) => {
    const t = start.tabs[id]!;
    return { title: t.customTitle || t.title || t.url, host: hostOf(t.url) };
  });
  setBusy(windowId, true);
  showToast(windowId, "Tidying Tabs…", undefined, { icon: "wand.and.stars", key: TOAST_KEY, sticky: true });
  let text: string;
  try {
    text = await complete({ ...tidyTabsRequest(tabs), signal: job.signal });
  } catch (error) {
    showToast(windowId, job.live() ? "Couldn't Tidy Tabs" : "Tidy Stopped", job.live() ? aiErrorText(error) : "AI was turned off.", { icon: "exclamationmark.triangle" });
    return 0;
  } finally {
    setBusy(windowId, false);
  }
  if (!job.live()) {
    showToast(windowId, "Tidy Stopped", "AI was turned off.", { icon: "exclamationmark.triangle" });
    return 0;
  }
  const plan = parseTidyGroups(text, tabs.length);
  if (!plan) {
    showToast(windowId, "Couldn't Tidy Tabs", "The model's answer wasn't usable. Try again.", { icon: "exclamationmark.triangle" });
    return 0;
  }
  let s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w || !canTidyWindow(s, windowId)) return 0;
  const view = new Set(viewTabIds(s, windowId));
  const groupsToMake = plan
    .map((g) => ({ ...g, ids: g.tabs.map((i) => ids[i]!).filter((id) => view.has(id) && tidyable(s, id, regroupAll)) }))
    .filter((g) => g.ids.length >= MIN_GROUP_SIZE);
  if (!groupsToMake.length) {
    showToast(windowId, "Tabs Already Tidy", "Nothing grouped well enough to tidy.", { icon: "wand.and.stars" });
    return 0;
  }
  const undo: TidyUndo = { windowId, tabIds: [...w.tabIds], groups: Object.values(s.groups).filter((g) => g.windowId === windowId), created: [] };
  let moved = 0;
  for (const g of groupsToMake) {
    const [next, id] = withGroup(s, g.ids, { name: g.name, pinned: false });
    if (!id) continue;
    s = g.emoji ? { ...next, groups: { ...next.groups, [id]: { ...next.groups[id]!, icon: g.emoji } } } : next;
    undo.created.push(id);
    moved += g.ids.length;
  }
  useBrowser.setState({ groups: s.groups, windows: s.windows });
  showToast(windowId, `Tidied ${plural(moved, "Tab")} into ${plural(undo.created.length, "Group")}`, undefined, {
    icon: "wand.and.stars",
    action: { title: "Undo", run: () => undoTidy(undo) },
  });
  return undo.created.length;
}
