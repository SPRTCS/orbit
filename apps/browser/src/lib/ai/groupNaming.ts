import { create } from "zustand";
import { useSidebarUi } from "../../components/sidebar/state";
import { useBrowser, type BrowserState } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import { pinKeyOf } from "../../store/pinMirror";
import type { TabGroup } from "../../store/types";
import { complete } from "./client";
import { aiEnabled, aiSettings, subscribeAiSettings } from "./settings";
import { tidyJob } from "./tidyJobs";
import { groupNameRequest, hostOf, parseGroupName } from "./tidyPrompts";

const DEBOUNCE_MS = 1500;

export const useGroupNaming = create<{ thinking: Record<string, true> }>(() => ({ thinking: {} }));

const handled = new Map<string, string>();
const aiNames = new Map<string, { name: string; icon: string | null }>();
const timers = new Map<string, { sig: string; timer: ReturnType<typeof setTimeout> }>();
const inflight = new Set<string>();

const setThinking = (groupId: string, on: boolean) =>
  useGroupNaming.setState((s) => {
    const thinking = { ...s.thinking };
    if (on) thinking[groupId] = true;
    else delete thinking[groupId];
    return { thinking };
  });

const namingOn = () => aiEnabled() && aiSettings().nameGroups;

const titled = (s: BrowserState, g: TabGroup) =>
  g.tabIds.map((id) => s.tabs[id]).filter((t) => !!t && !!t.url && !!t.title && t.title !== t.url);

function membership(s: BrowserState, g: TabGroup): string {
  return g.tabIds
    .map((id) => (s.tabs[id] ? pinKeyOf(s.tabs[id]!) : id))
    .sort()
    .join(",");
}

function eligible(s: BrowserState, g: TabGroup): boolean {
  if (isIncognitoProfile(g.profileId)) return false;
  const w = s.windows[g.windowId];
  if (!w || w.incognito) return false;
  const ai = aiNames.get(pinKeyOf(g));
  return g.name === "" || (!!ai && g.name === ai.name);
}

function scan(s: BrowserState) {
  for (const g of Object.values(s.groups)) {
    const key = pinKeyOf(g);
    if (inflight.has(key) || !eligible(s, g)) continue;
    const sig = membership(s, g);
    if (handled.get(key) === sig || !titled(s, g).length) continue;
    const pending = timers.get(key);
    if (pending?.sig === sig) continue;
    if (pending) clearTimeout(pending.timer);
    timers.set(key, { sig, timer: setTimeout(() => void nameGroup(key, g.id, sig), DEBOUNCE_MS) });
  }
}

function baseline(s: BrowserState) {
  for (const g of Object.values(s.groups)) handled.set(pinKeyOf(g), membership(s, g));
}

function findCopy(s: BrowserState, key: string, preferred: string): TabGroup | undefined {
  const own = s.groups[preferred];
  if (own && pinKeyOf(own) === key) return own;
  return Object.values(s.groups).find((g) => pinKeyOf(g) === key && !isIncognitoProfile(g.profileId));
}

async function nameGroup(key: string, groupId: string, sig: string) {
  timers.delete(key);
  if (!namingOn()) return;
  const s = useBrowser.getState();
  const g = findCopy(s, key, groupId);
  if (!g || !eligible(s, g) || membership(s, g) !== sig) return;
  const renaming = useSidebarUi.getState().renaming;
  if (renaming?.kind === "group" && renaming.id === g.id) {
    timers.set(key, { sig, timer: setTimeout(() => void nameGroup(key, g.id, sig), DEBOUNCE_MS) });
    return;
  }
  const tabs = titled(s, g).map((t) => ({ title: t!.title, host: hostOf(t!.url) }));
  if (!tabs.length) return;
  const job = tidyJob();
  if (!job) return;
  handled.set(key, sig);
  inflight.add(key);
  const nameBefore = g.name;
  setThinking(g.id, true);
  try {
    const plan = parseGroupName(await complete({ ...groupNameRequest(tabs), signal: job.signal }));
    if (!plan || !job.live() || !namingOn()) return;
    const now = useBrowser.getState();
    const target = findCopy(now, key, g.id);
    if (!target || target.name !== nameBefore || !eligible(now, target)) return;
    const previous = aiNames.get(key);
    const ownIcon = target.icon === null || (!!previous && target.icon === previous.icon);
    const icon = ownIcon ? plan.emoji : null;
    aiNames.set(key, { name: plan.name, icon });
    now.updateGroup(target.id, ownIcon ? { name: plan.name, icon } : { name: plan.name });
  } catch {
  } finally {
    inflight.delete(key);
    setThinking(g.id, false);
  }
}

let started = false;

export function startGroupNaming() {
  if (started) return;
  started = true;
  let on = namingOn();
  baseline(useBrowser.getState());
  subscribeAiSettings(() => {
    const now = namingOn();
    if (now === on) return;
    on = now;
    if (now) baseline(useBrowser.getState());
    else {
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
    }
  });
  useBrowser.subscribe((s, prev) => {
    if (!on || (s.groups === prev.groups && s.tabs === prev.tabs)) return;
    scan(s);
  });
}

export const groupNamingDebug = () => ({ handled: [...handled.entries()], aiNames: [...aiNames.entries()], pending: [...timers.keys()], inflight: [...inflight] });
