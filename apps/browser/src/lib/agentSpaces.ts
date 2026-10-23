import { readDocument, writeDocument } from "@ardia/shell";
import type { WebViewHandle } from "@ardia/ardiacore";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { engineProfile, inPinnedContainer, isIncognitoProfile } from "../store/model";
import { useCli } from "./cliControl";
import { webviews } from "./webviews";

export const AGENT_SPACES_DOC = "agent-spaces.json";
const PUBLISH_DELAY_MS = 250;
const REFRESH_MS = 2000;

export type AgentTarget = { targetId: string; browserContextId: string };

export type LearnedTarget = AgentTarget & { profileId: string };

export type PublishedSpace = { id: string; name: string; allowed: boolean; sharesDataWith: string[]; contexts: string[] };

export type PublishedTab = { space: string; pinned: boolean };

export type AgentSpacesDoc = {
  version: 1;
  allowed: string[];
  closeAnyTab: boolean;
  spaces: PublishedSpace[];
  tabs: Record<string, PublishedTab>;
};

type Choices = { allowed: string[]; closeAnyTab: boolean };

type Spaces = Pick<BrowserState, "profiles" | "profileOrder">;

function readChoices(): Choices {
  try {
    const json = readDocument(AGENT_SPACES_DOC);
    const saved = json ? (JSON.parse(json) as Partial<AgentSpacesDoc>) : {};
    const allowed = Array.isArray(saved.allowed) ? saved.allowed.filter((id): id is string => typeof id === "string" && !isIncognitoProfile(id)) : [];
    return { allowed, closeAnyTab: saved.closeAnyTab === true };
  } catch {
    return { allowed: [], closeAnyTab: false };
  }
}

export const useAgentSpaces = create<Choices>(() => readChoices());

export function allowAgentsIn(profileId: string, allowed: boolean) {
  if (isIncognitoProfile(profileId)) return;
  const current = useAgentSpaces.getState().allowed.filter((id) => id !== profileId);
  useAgentSpaces.setState({ allowed: allowed ? [...current, profileId] : current });
}

export const setAgentsCloseAnyTab = (closeAnyTab: boolean) => useAgentSpaces.setState({ closeAnyTab });

export function spaceIds(s: Spaces): string[] {
  const ordered = s.profileOrder.filter((id) => s.profiles[id]);
  return [...ordered, ...Object.keys(s.profiles).filter((id) => !ordered.includes(id))].filter((id) => !isIncognitoProfile(id));
}

export function dataPartners(s: Spaces, profileId: string, engineOf: (id: string) => string = engineProfile): string[] {
  const engine = engineOf(profileId);
  return spaceIds(s).filter((id) => id !== profileId && engineOf(id) === engine);
}

export function effectiveSpaces(s: Spaces, allowed: readonly string[], engineOf: (id: string) => string = engineProfile): Set<string> {
  const chosen = new Set(allowed);
  return new Set(spaceIds(s).filter((id) => chosen.has(id) && dataPartners(s, id, engineOf).every((other) => chosen.has(other))));
}

export function buildAgentSpacesDoc(
  s: Pick<BrowserState, "profiles" | "profileOrder" | "tabs" | "groups">,
  choices: Choices,
  targets: ReadonlyMap<string, LearnedTarget>,
  live: boolean,
  engineOf: (id: string) => string = engineProfile,
  seen: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): AgentSpacesDoc {
  const effective = live ? effectiveSpaces(s, choices.allowed, engineOf) : new Set<string>();
  const contexts = new Map<string, Set<string>>([...seen].filter(([id]) => effective.has(id)).map(([id, set]) => [id, new Set(set)]));
  const tabs: Record<string, PublishedTab> = {};
  for (const tab of Object.values(s.tabs)) {
    const target = targets.get(tab.id);
    if (!target || target.profileId !== tab.profileId || !effective.has(tab.profileId)) continue;
    const set = contexts.get(tab.profileId) ?? new Set<string>();
    set.add(target.browserContextId);
    contexts.set(tab.profileId, set);
    tabs[target.targetId] = { space: tab.profileId, pinned: inPinnedContainer(s, tab.id) };
  }
  const spaces = spaceIds(s).map((id) => ({
    id,
    name: s.profiles[id]?.name ?? id,
    allowed: effective.has(id),
    sharesDataWith: dataPartners(s, id, engineOf),
    contexts: [...(contexts.get(id) ?? [])].sort(),
  }));
  return { version: 1, allowed: [...new Set(choices.allowed)], closeAnyTab: choices.closeAnyTab, spaces, tabs };
}

const known = new Map<string, { handle: WebViewHandle; target: LearnedTarget }>();
const seenContexts = new Map<string, Set<string>>();
const asking = new Set<string>();

async function learnTarget(tabId: string, handle: WebViewHandle, profileId: string) {
  asking.add(tabId);
  try {
    const target = await handle.devToolsTarget().catch(() => null);
    if (target && webviews.get(tabId) === handle && useBrowser.getState().tabs[tabId]?.profileId === profileId) {
      known.set(tabId, { handle, target: { ...target, profileId } });
      seenContexts.set(profileId, (seenContexts.get(profileId) ?? new Set()).add(target.browserContextId));
      schedule();
    }
  } finally {
    asking.delete(tabId);
  }
}

const controlLive = () => {
  const state = useCli.getState().server?.state;
  return (state === "on" || state === "starting") && (useBrowser.getState().settings.cliControl ?? false);
};

let published: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function publish() {
  timer = null;
  const s = useBrowser.getState();
  const choices = useAgentSpaces.getState();
  const live = controlLive();
  for (const [id, entry] of known) if (!s.tabs[id] || s.tabs[id]!.profileId !== entry.target.profileId) known.delete(id);
  for (const id of seenContexts.keys()) if (!s.profiles[id]) seenContexts.delete(id);
  if (live) {
    const effective = effectiveSpaces(s, choices.allowed);
    for (const tab of Object.values(s.tabs)) {
      const handle = webviews.get(tab.id);
      if (handle && effective.has(tab.profileId) && known.get(tab.id)?.handle !== handle && !asking.has(tab.id)) void learnTarget(tab.id, handle, tab.profileId);
    }
  }
  const targets = new Map([...known].map(([id, entry]) => [id, entry.target]));
  const json = JSON.stringify(buildAgentSpacesDoc(s, choices, targets, live, engineProfile, seenContexts));
  if (json === published) return;
  try {
    writeDocument(AGENT_SPACES_DOC, json);
    published = json;
  } catch (error) {
    console.warn("[agents] couldn't publish the allowed spaces", error);
  }
}

function schedule() {
  if (!timer) timer = setTimeout(publish, PUBLISH_DELAY_MS);
}

let started = false;

export function startAgentSpaces() {
  if (started) return;
  started = true;
  publish();
  useBrowser.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.profiles !== prev.profiles || s.profileOrder !== prev.profileOrder || s.groups !== prev.groups || s.settings !== prev.settings) schedule();
  });
  useCli.subscribe((s, prev) => {
    if (s.server?.state !== prev.server?.state) schedule();
  });
  useAgentSpaces.subscribe(schedule);
  const refresh: unknown = setInterval(() => controlLive() && schedule(), REFRESH_MS);
  (refresh as { unref?: () => void }).unref?.();
}

export const flushAgentSpaces = () => {
  if (timer) clearTimeout(timer);
  publish();
};

if (__DEV__) (globalThis as { acAgents?: unknown }).acAgents = { store: useAgentSpaces, allow: allowAgentsIn, flush: flushAgentSpaces, seen: seenContexts };
