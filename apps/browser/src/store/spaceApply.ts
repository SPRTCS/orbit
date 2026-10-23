import type { BrowserState } from "./browser";
import { orderSections, placeBlock, syncGroupOrder } from "./groups";
import { IDLE_LIVE, isIncognitoProfile, isPinnedRow, makeTab, newId, pinnedFirst, without } from "./model";
import { groupChoiceKey, nextPinChoice, placeChoiceKey, samePage } from "./organize";
import { adoptParkedPins, parkWindowPins } from "./parkedPins";
import { mirrored, pinKeyOf } from "./pinMirror";
import { folderRef, pinnedRefs, type PinnedFolder, type PinnedTree } from "./pinnedFolders";
import { removeTabs } from "./tabs";
import type { BrowserWindow, Tab, TabGroup } from "./types";
import type { SpaceLink, SpaceNode, SpaceDoc, SpaceTodayItem } from "./spaceSnapshot";

export type PinMode = "replace" | "merge";

const parkWindowId = (profileId: string) => `park:${profileId}`;
const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;

export function pinWindow(s: BrowserState, profileId: string): BrowserWindow | undefined {
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].map((id) => s.windows[id]).filter(mirrored);
  const shows = (w: BrowserWindow) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows);
}

type Section = { tiles: Tab[]; rows: Tab[]; groups: TabGroup[] };

function sectionOf(s: BrowserState, w: BrowserWindow, profileId: string): Section {
  const at = new Map(w.tabIds.map((id, i) => [id, i]));
  const tabs = w.tabIds.map((id) => s.tabs[id]).filter((t): t is Tab => !!t && t.profileId === profileId && t.pinned);
  const groups = Object.values(s.groups)
    .filter((g) => g.pinned && g.windowId === w.id && g.profileId === profileId && g.tabIds.length)
    .sort((a, z) => (at.get(a.tabIds[0]!) ?? 0) - (at.get(z.tabIds[0]!) ?? 0));
  return { tiles: tabs.filter((t) => !isPinnedRow(t)), rows: tabs.filter(isPinnedRow), groups };
}

const homeOf = (t: Pick<Tab, "url" | "pinnedUrl">) => t.pinnedUrl || t.url;

export function applySpacePins(
  s: BrowserState,
  profileId: string,
  doc: Pick<SpaceDoc, "tiles" | "pinned">,
  mode: PinMode,
  current: PinnedTree | undefined,
  now = Date.now(),
): { state: BrowserState; tree: PinnedTree } {
  const refsBefore = pinnedRefs(s, profileId);
  let st = s;
  const shown = pinWindow(st, profileId);
  const homeId = shown?.id ?? parkWindowId(profileId);
  if (!shown) {
    const stand: BrowserWindow = { id: homeId, profileId, incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 };
    st = { ...st, windows: { ...st.windows, [homeId]: stand } };
  }
  if (st.parkedPins[profileId]) st = adoptParkedPins(st, homeId, profileId);
  const home = st.windows[homeId]!;
  const old = sectionOf(st, home, profileId);
  const merging = mode === "merge";

  const tabs = { ...st.tabs };
  const live = { ...st.live };
  let groups = { ...st.groups };
  const added: string[] = [];
  const chosen: Record<string, number> = { ...st.pinChoices[profileId] };
  const choose = (key: string) => (chosen[key] = nextPinChoice());

  const existingPins = merging ? [...old.tiles, ...old.rows] : [];
  const matchPin = (url: string) => existingPins.find((t) => samePage(homeOf(t), url));
  const addTab = (link: SpaceLink, kind: "tile" | "row" | "member"): string => {
    const pinned = kind !== "member";
    const tab: Tab = {
      ...makeTab(homeId, profileId, link.url, {
        title: link.title ?? "",
        pinned,
        customTitle: link.customTitle ?? null,
        customIcon: link.customIcon ?? null,
        ...(kind === "row" ? { pinnedAsRow: true as const } : {}),
      }),
      pinnedUrl: pinned ? link.url : null,
      navigation: null,
      unloaded: true,
    };
    tabs[tab.id] = tab;
    live[tab.id] = IDLE_LIVE;
    added.push(tab.id);
    if (pinned) choose(tab.id);
    choose(placeChoiceKey(tab.id));
    if (pinned) existingPins.push(tab);
    return tab.id;
  };

  for (const link of doc.tiles) if (!matchPin(link.url)) addTab(link, "tile");

  const folders: Record<string, PinnedFolder> = {};
  const oldGroupByName = new Map(merging ? old.groups.map((g) => [g.name.trim().toLowerCase(), g] as const).filter(([name]) => !!name) : []);
  const build = (nodes: SpaceNode[]): string[] => {
    const refs: string[] = [];
    for (const n of nodes) {
      if (n.kind === "tab") {
        const same = matchPin(n.url);
        refs.push(`t:${same ? pinKeyOf(same) : addTab(n, "row")}`);
      } else if (n.kind === "group") {
        const into = n.name ? oldGroupByName.get(n.name.trim().toLowerCase()) : undefined;
        if (into) {
          const have = (groups[into.id]?.tabIds ?? []).map((id) => tabs[id]).filter((t): t is Tab => !!t);
          const fresh = n.tabs.filter((l) => !have.some((t) => samePage(t.url, l.url))).map((l) => addTab(l, "member"));
          groups[into.id] = { ...groups[into.id]!, tabIds: [...groups[into.id]!.tabIds, ...fresh] };
          refs.push(`g:${pinKeyOf(into)}`);
          continue;
        }
        const id = newId("g");
        groups[id] = {
          id,
          windowId: homeId,
          profileId,
          name: n.name,
          icon: n.icon ?? null,
          color: n.color ?? null,
          collapsed: !!n.collapsed,
          pinned: true,
          tabIds: n.tabs.map((l) => addTab(l, "member")),
          createdAt: now,
        };
        choose(groupChoiceKey(id));
        refs.push(`g:${id}`);
      } else {
        const id = newId("pf");
        folders[id] = { id, name: n.name, collapsed: !!n.collapsed, children: [] };
        folders[id] = { ...folders[id]!, children: build(n.children) };
        refs.push(folderRef(id));
      }
    }
    return refs;
  };
  const top = build(doc.pinned);

  let gone: string[] = [];
  if (!merging) {
    const leaving = [...old.tiles, ...old.rows, ...old.groups.flatMap((g) => g.tabIds.map((id) => tabs[id]).filter((t): t is Tab => !!t))];
    const active = new Set(Object.values(home.activeTabIds));
    const demoted = leaving.filter((t) => hasPage(t) || active.has(t.id));
    gone = leaving.filter((t) => !demoted.includes(t)).map((t) => t.id);
    for (const t of demoted) tabs[t.id] = { ...tabs[t.id]!, pinned: false, pinnedUrl: null, pinnedAsRow: undefined, pinKey: undefined };
    for (const g of old.groups) delete groups[g.id];
  }

  let ordered = [...home.tabIds, ...added];
  for (const g of Object.values(groups)) if (g.pinned && g.windowId === homeId && g.profileId === profileId) ordered = placeBlock(ordered, g.tabIds.filter((id) => tabs[id]));
  const window: BrowserWindow = { ...home, tabIds: orderSections(pinnedFirst(ordered, tabs), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  const pinChoices = isIncognitoProfile(profileId) ? st.pinChoices : { ...st.pinChoices, [profileId]: chosen };
  let next: BrowserState = { ...st, tabs, live, groups, pinChoices, windows: { ...st.windows, [homeId]: window } };
  if (gone.length) next = removeTabs(next, gone, false);

  if (!shown) {
    const stand = next.windows[homeId];
    let parkedPins = without(next.parkedPins, [profileId]);
    if (stand) parkedPins = parkWindowPins(parkedPins, stand, { tabs: next.tabs, groups: next.groups, history: next.history });
    const ids = stand?.tabIds ?? [];
    next = {
      ...next,
      parkedPins,
      tabs: without(next.tabs, ids),
      live: without(next.live, ids),
      groups: Object.fromEntries(Object.entries(next.groups).filter(([, g]) => g.windowId !== homeId)),
      windows: without(next.windows, [homeId]),
      windowOrder: next.windowOrder.filter((id) => id !== homeId),
    };
  }

  const tree: PinnedTree = merging
    ? mergeTree(current ?? { root: refsBefore, folders: {} }, top, folders)
    : { root: top, folders };
  return { state: next, tree };
}

function mergeTree(base: PinnedTree, top: string[], folders: Record<string, PinnedFolder>): PinnedTree {
  const known = new Set(base.root);
  for (const f of Object.values(base.folders)) for (const ref of f.children) known.add(ref);
  return { root: [...base.root, ...top.filter((r) => !known.has(r))], folders: { ...base.folders, ...folders } };
}

export function todayTabIds(s: BrowserState, windowId: string, profileId: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const pinnedMembers = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  return w.tabIds.filter((id) => s.tabs[id]?.profileId === profileId && !s.tabs[id]!.pinned && !pinnedMembers.has(id));
}

export function openTodayTabs(s: BrowserState, windowId: string, profileId: string, items: SpaceTodayItem[], options: { replace?: boolean; now?: number } = {}): BrowserState {
  const w = s.windows[windowId];
  if (!w || !items.length) return s;
  const now = options.now ?? Date.now();
  const before = options.replace ? todayTabIds(s, windowId, profileId) : [];
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  let groups = { ...s.groups };
  const added: string[] = [];
  const blocks: string[][] = [];
  const addTab = (link: SpaceLink) => {
    const tab: Tab = {
      ...makeTab(windowId, profileId, link.url, { title: link.title ?? "", customTitle: link.customTitle ?? null, customIcon: link.customIcon ?? null }),
      navigation: null,
      unloaded: true,
    };
    tabs[tab.id] = tab;
    live[tab.id] = IDLE_LIVE;
    added.push(tab.id);
    return tab.id;
  };
  for (const item of items) {
    if (item.kind === "tab") {
      addTab(item);
      continue;
    }
    const ids = item.tabs.map(addTab);
    const id = newId("g");
    groups[id] = { id, windowId, profileId, name: item.name, icon: item.icon ?? null, color: item.color ?? null, collapsed: !!item.collapsed, pinned: false, tabIds: ids, createdAt: now };
    blocks.push(ids);
  }
  let tabIds = [...w.tabIds, ...added];
  for (const block of blocks) tabIds = placeBlock(tabIds, block);
  const activeTabIds = w.activeTabIds[profileId] || !added[0] ? w.activeTabIds : { ...w.activeTabIds, [profileId]: added[0] };
  const window: BrowserWindow = { ...w, activeTabIds, tabIds: orderSections(pinnedFirst(tabIds, tabs), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  let next: BrowserState = { ...s, tabs, live, groups, windows: { ...s.windows, [windowId]: window } };
  if (before.length) {
    const active = next.windows[windowId]!.activeTabIds[profileId];
    if (active && before.includes(active) && added[0]) {
      const win = next.windows[windowId]!;
      next = { ...next, windows: { ...next.windows, [windowId]: { ...win, activeTabIds: { ...win.activeTabIds, [profileId]: added[0] } } } };
    }
    next = removeTabs(next, before, true);
  }
  return next;
}
