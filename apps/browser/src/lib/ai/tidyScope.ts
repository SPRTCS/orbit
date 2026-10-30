import type { BrowserState } from "../../store/browser";
import { inPinnedContainer, isIncognitoProfile, viewTabIds } from "../../store/model";
import type { Tab } from "../../store/types";

type TidyRunner = { tidyTabs(windowId: string, regroupAll: boolean): void; tidyTitles(windowId: string): void };

let runner: TidyRunner | null = null;

export const setTidyRunner = (next: TidyRunner) => void (runner = next);
export const tidyRunner = () => runner;

export function canTidyWindow(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return !!w && !w.incognito && w.kind !== "small" && !isIncognitoProfile(w.profileId);
}

export const titleTidyable = (s: BrowserState, t: Tab | undefined): t is Tab =>
  !!t && !!t.url && !isIncognitoProfile(t.profileId) && !s.windows[t.windowId]?.incognito && (t.pinned || inPinnedContainer(s, t.id));

export function pinnedTabIds(s: BrowserState, windowId: string): string[] {
  return viewTabIds(s, windowId).filter((id) => titleTidyable(s, s.tabs[id]));
}
