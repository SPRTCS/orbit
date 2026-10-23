import {
  configureExtension,
  installExtension,
  listExtensions,
  reloadExtension,
  setExtensionEnabled,
  uninstallExtension,
  type InstalledExtension,
} from "@ardia/ardiacore";
import { readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBoosts } from "../../store/boosts";
import { useBrowser, type BrowserState } from "../../store/browser";
import { engineProfile, isIncognitoProfile, newId } from "../../store/model";
import type { Tab } from "../../store/types";
import { scriptsTargets } from "../userScripts";
import { webviews } from "../webviews";
import { boostsFolder, compileBoosts, isBoostsExtension } from "./compile";
import { boostAppliesTo, boostCss, readBoosts, siteMatchesUrl, writeBoosts, type Boost } from "./model";
import { boostsFolders, boostsNativeAvailable, publishBoostsFolder, removeBoostsFolder } from "./native";
import { liveStyleScript } from "./pageScripts";

const FILE = "boosts.json";
const SAVE_DELAY_MS = 500;
const APPLY_DELAY_MS = 350;
const LIVE_DELAY_MS = 80;

export type BoostsStatus = { errors: Record<string, string>; applying: boolean };
export const useBoostsStatus = create<BoostsStatus>(() => ({ errors: {}, applying: false }));

export function loadBoosts() {
  if (useBoosts.getState().loaded) return;
  let boosts: Boost[] = [];
  try {
    boosts = readBoosts(readDocument(FILE), () => newId("boost"));
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
  }
  useBoosts.setState({ boosts, loaded: true });
}

const isWeb = (url: string) => /^https?:\/\//i.test(url);
const withoutPrivate = (path: string) => path.replace(/^\/private(?=\/(tmp|var|etc)\/)/, "");
const loadedFrom = (ext: InstalledExtension, path: string) => !!ext.path && withoutPrivate(ext.path).replace(/\/$/, "") === withoutPrivate(path).replace(/\/$/, "");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function tabBoosts(boosts: Boost[], tab: Pick<Tab, "url" | "profileId"> | undefined, active: boolean): Boost[] {
  if (!tab || !isWeb(tab.url)) return [];
  if (!active) return boosts.filter((b) => siteMatchesUrl(b.site, tab.url));
  return boosts.filter((b) => boostAppliesTo(b, tab.url, engineProfile(tab.profileId), isIncognitoProfile(tab.profileId), engineProfile));
}

export function styleWanted(boosts: Boost[], tab: Pick<Tab, "url" | "profileId">): Record<string, string> {
  const want: Record<string, string> = {};
  for (const boost of tabBoosts(boosts, tab, true)) {
    const css = boostCss(boost);
    if (css) want[boost.id] = css;
  }
  return want;
}

const applied = new Map<string, string>();
let running: Promise<void> | null = null;
let again = false;

async function ensureLoaded(engine: string, path: string, changed: boolean, incognito: boolean) {
  const mine = (await listExtensions(engine)).filter(isBoostsExtension);
  const loaded = mine.find((x) => loadedFrom(x, path));
  for (const stale of mine) if (stale !== loaded) await uninstallExtension(stale.id, engine);
  let id = loaded?.id;
  if (loaded && !loaded.enabled) await setExtensionEnabled(loaded.id, engine, true);
  if (loaded && changed) await reloadExtension(loaded.id, engine);
  if (!id) id = await installExtension({ path }, engine);
  if ((loaded?.incognito ?? false) !== incognito) await configureExtension(id, engine, { incognito });
}

async function unloadFrom(engine: string) {
  for (const ext of (await listExtensions(engine)).filter(isBoostsExtension)) await uninstallExtension(ext.id, engine);
}

async function apply() {
  if (!boostsNativeAvailable()) return;
  const boosts = useBoosts.getState().boosts;
  const engines = [...scriptsTargets(useBrowser.getState()).keys()];
  const errors: Record<string, string> = {};
  const kept = new Set<string>();
  for (const engine of engines) {
    const folder = boostsFolder(engine);
    const ext = compileBoosts(boosts.filter((b) => b.profileId === null || engineProfile(b.profileId) === engine));
    const key = ext ? JSON.stringify(ext) : "none";
    if (ext) kept.add(folder);
    if (applied.get(engine) === key) continue;
    try {
      if (ext) {
        const published = await publishBoostsFolder(folder, ext.files);
        await ensureLoaded(engine, published.path, published.changed, ext.incognito);
      } else {
        await unloadFrom(engine);
        await removeBoostsFolder(folder);
      }
      applied.set(engine, key);
    } catch (error) {
      applied.delete(engine);
      errors[engine] = message(error);
    }
    if (again) return;
  }
  for (const folder of await boostsFolders()) if (!kept.has(folder) && !engines.some((e) => boostsFolder(e) === folder)) await removeBoostsFolder(folder).catch(() => {});
  useBoostsStatus.setState({ errors });
}

export function applyBoosts(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  useBoostsStatus.setState({ applying: true });
  running = (async () => {
    do {
      again = false;
      try {
        await apply();
      } catch (error) {
        console.warn("[boosts] couldn't apply boosts", error);
      }
    } while (again);
    running = null;
    useBoostsStatus.setState({ applying: false });
  })();
  return running;
}

const synced = new Map<string, { url: string; json: string }>();

export function syncLiveStyles(previous: Boost[] | null) {
  const s = useBrowser.getState();
  const boosts = useBoosts.getState().boosts;
  for (const [tabId, view] of webviews) {
    const tab = s.tabs[tabId];
    if (!tab || !isWeb(tab.url)) continue;
    const json = JSON.stringify(styleWanted(boosts, tab));
    const known = synced.get(tabId);
    const before = known && known.url === tab.url ? known.json : previous ? JSON.stringify(styleWanted(previous, tab)) : null;
    if (before === json) continue;
    synced.set(tabId, { url: tab.url, json });
    void view.evaluate(liveStyleScript(JSON.parse(json) as Record<string, string>));
  }
  for (const id of synced.keys()) if (!s.tabs[id]) synced.delete(id);
}

let flushBoosts: () => void = () => {};
export const saveBoostsNow = () => flushBoosts();

let started = false;

export function startBoosts() {
  if (started) return;
  started = true;
  loadBoosts();
  let saved = writeBoosts(useBoosts.getState().boosts);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const json = writeBoosts(useBoosts.getState().boosts);
    if (json === saved) return;
    saved = json;
    try {
      writeDocument(FILE, json);
    } catch (error) {
      console.warn(`Couldn't save ${FILE}`, error);
    }
  };
  flushBoosts = save;
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleApply = () => {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => void applyBoosts(), APPLY_DELAY_MS);
  };
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let liveBase: Boost[] | null = null;
  useBoosts.subscribe((b, prev) => {
    if (b.boosts === prev.boosts) return;
    saveTimer ??= setTimeout(save, SAVE_DELAY_MS);
    scheduleApply();
    liveBase ??= prev.boosts;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const base = liveBase;
      liveBase = null;
      syncLiveStyles(base);
    }, LIVE_DELAY_MS);
  });
  let targets = JSON.stringify([...scriptsTargets(useBrowser.getState()).keys()]);
  useBrowser.subscribe((s: BrowserState, prev: BrowserState) => {
    if (s.profiles === prev.profiles && s.profileOrder === prev.profileOrder) return;
    const next = JSON.stringify([...scriptsTargets(s).keys()]);
    if (next === targets) return;
    targets = next;
    scheduleApply();
  });
  void applyBoosts();
}
