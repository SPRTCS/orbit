import type { OpenWindowRequest } from "@ardia/ardiacore";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId, engineProfile, inPinnedContainer, navigationTo, newId } from "../store/model";
import { groupWithOpener } from "../store/organize";
import { isSmall } from "../store/small";
import { withNewTab } from "../store/tabs";
import type { Tab } from "../store/types";
import { isWebUrl, siteOf, type PeekLinkConfig } from "./peekSites";

export type PeekPage = { url: string; title: string; favicon: string | null; isLoading: boolean };
export type Peek = {
  id: string;
  windowId: string;
  profileId: string;
  sourceTabId: string;
  shownTabId: string | null;
  url: string;
  adoptId?: string;
  page: PeekPage;
};

export const usePeeks = create<{ peeks: Record<string, Peek> }>()(() => ({ peeks: {} }));

const store = () => useBrowser.getState();
let started = false;
let handOffPage: (tabId: string, profile: string) => void = () => {};
export const setPeekHandOff = (handOff: typeof handOffPage) => {
  handOffPage = handOff;
};

export function peekConfig(s: BrowserState, tabId: string): PeekLinkConfig | null {
  const tab = s.tabs[tabId];
  if (!tab || !isWebUrl(tab.url) || !s.windows[tab.windowId] || isSmall(s, tab.windowId)) return null;
  if (s.settings.openPinnedLinksInPeek === false || !inPinnedContainer(s, tabId)) return { sites: null, shift: true };
  const sites = [siteOf(tab.url), tab.pinnedUrl ? siteOf(tab.pinnedUrl) : ""].filter((site) => !!site);
  return { sites: [...new Set(sites)], shift: true };
}

export function opensInPeek(s: BrowserState, tabId: string, url: string): boolean {
  const sites = peekConfig(s, tabId)?.sites;
  return !!sites && isWebUrl(url) && !sites.includes(siteOf(url));
}

export function peekFromPage(request: OpenWindowRequest, tab: Tab): boolean {
  if (request.disposition !== "foreground" || !opensInPeek(store(), tab.id, request.url)) return false;
  return openPeek(tab.id, request.url, request.adoptId);
}

export function openPeek(sourceTabId: string, url: string, adoptId?: string): boolean {
  const s = store();
  const source = s.tabs[sourceTabId];
  if (!source || !isWebUrl(url) || !s.windows[source.windowId] || isSmall(s, source.windowId)) return false;
  startPeek();
  const peek: Peek = {
    id: newId("tab"),
    windowId: source.windowId,
    profileId: source.profileId,
    sourceTabId,
    shownTabId: activeTabId(s, source.windowId) ?? null,
    url,
    ...(adoptId ? { adoptId } : {}),
    page: { url, title: "", favicon: null, isLoading: true },
  };
  usePeeks.setState((p) => ({ peeks: { ...p.peeks, [peek.windowId]: peek } }));
  return true;
}

export function closePeek(windowId: string) {
  if (!usePeeks.getState().peeks[windowId]) return;
  usePeeks.setState((p) => {
    const peeks = { ...p.peeks };
    delete peeks[windowId];
    return { peeks };
  });
}

export function notePeekPage(windowId: string, id: string, patch: Partial<PeekPage>) {
  const peek = usePeeks.getState().peeks[windowId];
  if (!peek || peek.id !== id) return;
  const page = { ...peek.page, ...patch };
  if ((Object.keys(patch) as (keyof PeekPage)[]).every((k) => peek.page[k] === page[k])) return;
  usePeeks.setState((p) => ({ peeks: { ...p.peeks, [windowId]: { ...peek, page } } }));
}

export function renameTab(s: BrowserState, from: string, to: string, patch: Partial<Tab> = {}): BrowserState {
  const tab = s.tabs[from];
  if (!tab || from === to) return s;
  const swap = (id: string) => (id === from ? to : id);
  const tabs = { ...s.tabs, [to]: { ...tab, ...patch, id: to } };
  delete tabs[from];
  const live = { ...s.live };
  if (live[from]) live[to] = live[from]!;
  delete live[from];
  const w = s.windows[tab.windowId];
  const windows = w
    ? { ...s.windows, [w.id]: { ...w, tabIds: w.tabIds.map(swap), activeTabIds: Object.fromEntries(Object.entries(w.activeTabIds).map(([p, id]) => [p, swap(id)])) } }
    : s.windows;
  return { ...s, tabs, live, windows };
}

export function peekAsTab(s: BrowserState, peek: Peek, background: boolean): BrowserState {
  const source = s.tabs[peek.sourceTabId];
  const url = peek.page.url || peek.url;
  const [made, id] = withNewTab(s, peek.windowId, { url, profileId: peek.profileId, openerId: source?.id, background });
  if (!id) return s;
  const page = { url, title: peek.page.title, favicon: peek.page.favicon, navigation: navigationTo(url), adoptId: undefined, openerId: source?.id ?? null };
  const next = renameTab(made, id, peek.id, page);
  return source ? groupWithOpener(next, peek.id, source.id, background) : next;
}

export function openPeekAsTab(windowId: string, options: { split?: boolean } = {}): string | null {
  const peek = usePeeks.getState().peeks[windowId];
  const s = store();
  if (!peek || !s.windows[windowId]) return null;
  const split = !!options.split && !!s.tabs[peek.sourceTabId];
  handOffPage(peek.id, engineProfile(peek.profileId));
  closePeek(windowId);
  useBrowser.setState(peekAsTab(store(), peek, split));
  if (split) store().openSplitPane(windowId, { tabId: peek.id, anchorTabId: peek.sourceTabId, side: "right" });
  return peek.id;
}

function startPeek() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    for (const peek of Object.values(usePeeks.getState().peeks)) {
      if (!s.windows[peek.windowId] || !s.tabs[peek.sourceTabId] || activeTabId(s, peek.windowId) !== peek.shownTabId) closePeek(peek.windowId);
    }
  });
}

if (__DEV__) (globalThis as { acPeek?: unknown }).acPeek = { usePeeks, openPeek, closePeek, openPeekAsTab, peekConfig: (tabId: string) => peekConfig(store(), tabId) };
