import { readDocument, writeDocument } from "@ardia/shell";
import { useBrowser, type BrowserState } from "../store/browser";
import { changedIds } from "../store/changes";
import { isIncognitoProfile, isPinnedRow, newId } from "../store/model";
import {
  applyImportPlan,
  createFolder,
  deleteFolder,
  groupRef,
  hasFolders,
  moveNodes,
  parentOf,
  pinnedRefs,
  reconcileTree,
  renameFolder,
  setFolderCollapsed,
  tabRef,
  usePinnedFolders,
  type FolderTarget,
  type ImportPlan,
  type PinnedTree,
} from "../store/pinnedFolders";

const FILE = "pinned-folders.json";
const VERSION = 1;
const SAVE_DELAY_MS = 800;
const PLAN_MS = 30_000;
export const NEW_FOLDER_NAME = "New Folder";

const lastSeen = new Map<string, string[]>();

function readTrees(): Record<string, PinnedTree> {
  try {
    const json = readDocument(FILE);
    const doc = json ? (JSON.parse(json) as { version?: number; trees?: Record<string, PinnedTree> }) : null;
    return doc?.version === VERSION && doc.trees && typeof doc.trees === "object" ? doc.trees : {};
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
    return {};
  }
}

const serialize = (trees: Record<string, PinnedTree>) => JSON.stringify({ version: VERSION, trees });

const PIN_FIELDS = ["pinned", "pinnedAsRow", "pinKey", "profileId", "windowId"] as const;

function pinsMayHaveChanged(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups || s.parkedPins !== prev.parkedPins) return true;
  if (s.tabs === prev.tabs) return false;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) {
      if (a?.pinned || b?.pinned) return true;
      continue;
    }
    if (PIN_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

function urlOfRef(s: BrowserState, ref: string): string | null {
  if (!ref.startsWith("t:")) return null;
  const key = ref.slice(2);
  const t = s.tabs[key] ?? Object.values(s.tabs).find((x) => x.pinKey === key);
  return t ? t.pinnedUrl || t.url : null;
}

export function reconcileFolders(s: BrowserState, now = Date.now()) {
  const { trees, plans } = usePinnedFolders.getState();
  let nextTrees = trees;
  let nextPlans = plans;
  for (const profileId of new Set([...Object.keys(trees), ...Object.keys(plans)])) {
    const refs = pinnedRefs(s, profileId);
    const prev = lastSeen.get(profileId) ?? null;
    if (prev && prev.length === refs.length && prev.every((r, i) => r === refs[i])) continue;
    if (refs.length) lastSeen.set(profileId, refs);
    const tree = nextTrees[profileId];
    if (!tree) continue;
    let next = reconcileTree(tree, prev, refs);
    const plan = nextPlans[profileId];
    if (plan) {
      const before = new Set(prev ?? []);
      const fresh = refs.filter((r) => !before.has(r)).map((ref) => ({ ref, url: urlOfRef(s, ref) ?? "" }));
      const applied = applyImportPlan(next, plan, fresh);
      next = applied.tree;
      if (applied.matched || plan.expires < now) {
        const { [profileId]: _done, ...rest } = nextPlans;
        nextPlans = rest;
      }
    }
    if (next !== tree) nextTrees = { ...nextTrees, [profileId]: next };
  }
  if (nextTrees !== trees || nextPlans !== plans) usePinnedFolders.setState({ trees: nextTrees, plans: nextPlans });
}

let flushFolders: () => void = () => {};

export function savePinnedFoldersNow() {
  flushFolders();
}

export function startPinnedFolders() {
  lastSeen.clear();
  usePinnedFolders.setState({ trees: readTrees(), plans: {}, renaming: null });
  let saved = serialize(usePinnedFolders.getState().trees);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    const json = serialize(usePinnedFolders.getState().trees);
    if (json === saved) return;
    saved = json;
    try {
      writeDocument(FILE, json);
    } catch (error) {
      console.warn(`Couldn't save ${FILE}`, error);
    }
  };
  flushFolders = save;
  const stopSaving = usePinnedFolders.subscribe((f, prev) => {
    if (f.trees !== prev.trees) timer ??= setTimeout(save, SAVE_DELAY_MS);
  });
  reconcileFolders(useBrowser.getState());
  const stopWatching = useBrowser.subscribe((s, prev) => {
    if (s.profiles !== prev.profiles && Object.keys(s.profiles).length) forgetDeletedProfiles(s);
    if (pinsMayHaveChanged(s, prev)) reconcileFolders(s);
  });
  return () => {
    stopWatching();
    stopSaving();
    save();
    flushFolders = () => {};
  };
}

function forgetDeletedProfiles(s: BrowserState) {
  const { trees } = usePinnedFolders.getState();
  const gone = Object.keys(trees).filter((id) => !s.profiles[id]);
  if (!gone.length) return;
  const kept = { ...trees };
  for (const id of gone) {
    delete kept[id];
    lastSeen.delete(id);
  }
  usePinnedFolders.setState({ trees: kept });
}

export function shownProfile(windowId: string | null | undefined): string | null {
  const s = useBrowser.getState();
  const w = windowId ? s.windows[windowId] : undefined;
  const id = w?.profileId ?? s.windows[s.ui.focusOrder[0] ?? ""]?.profileId ?? null;
  return id && !isIncognitoProfile(id) && !w?.incognito && w?.kind !== "small" ? id : null;
}

function updateTree(profileId: string, change: (tree: PinnedTree) => PinnedTree) {
  const s = useBrowser.getState();
  const { trees } = usePinnedFolders.getState();
  const refs = pinnedRefs(s, profileId);
  const base = trees[profileId] ?? reconcileTree({ root: [], folders: {} }, null, refs);
  if (!trees[profileId] && refs.length) lastSeen.set(profileId, refs);
  const next = change(base);
  if (next === trees[profileId]) return;
  if (!hasFolders(next)) {
    const { [profileId]: _gone, ...rest } = trees;
    usePinnedFolders.setState({ trees: rest });
    lastSeen.delete(profileId);
    return;
  }
  usePinnedFolders.setState({ trees: { ...trees, [profileId]: next } });
}

export function newPinnedFolder(requested: string | null, options: { target?: FolderTarget; contents?: string[]; name?: string; rename?: boolean } = {}): string | null {
  const windowId = requested ?? useBrowser.getState().ui.focusOrder[0] ?? null;
  const profileId = shownProfile(windowId);
  if (!profileId) return null;
  const id = newId("pf");
  const contents = options.contents ?? [];
  const at = (tree: PinnedTree): FolderTarget => options.target ?? (contents.length ? { parent: parentOf(tree, contents[0]!) ?? null, before: contents[0] } : { parent: null });
  updateTree(profileId, (tree) => createFolder(tree, id, options.name ?? NEW_FOLDER_NAME, at(tree), contents));
  if (options.rename !== false && windowId) usePinnedFolders.setState({ renaming: { windowId, folderId: id } });
  return id;
}

export function renamePinnedFolder(profileId: string, folderId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed) updateTree(profileId, (tree) => renameFolder(tree, folderId, trimmed));
  endFolderRename(folderId);
}

export function endFolderRename(folderId: string) {
  if (usePinnedFolders.getState().renaming?.folderId === folderId) usePinnedFolders.setState({ renaming: null });
}

export function setPinnedFolderCollapsed(profileId: string, folderId: string, collapsed: boolean) {
  updateTree(profileId, (tree) => setFolderCollapsed(tree, folderId, collapsed));
}

export function deletePinnedFolder(profileId: string, folderId: string) {
  updateTree(profileId, (tree) => deleteFolder(tree, folderId));
}

export function movePinnedNodes(profileId: string, refs: string[], target: FolderTarget) {
  if (!usePinnedFolders.getState().trees[profileId]) return;
  updateTree(profileId, (tree) => moveNodes(tree, refs, target));
}

export function subjectRef(s: BrowserState, subject: { kind: "tab" | "group"; id: string }): string | null {
  if (subject.kind === "tab") {
    const t = s.tabs[subject.id];
    return t && isPinnedRow(t) ? tabRef(t) : null;
  }
  const g = s.groups[subject.id];
  return g?.pinned ? groupRef(g) : null;
}

export function pinIntoFolder(windowId: string, tabIds: string[], target: FolderTarget) {
  const profileId = shownProfile(windowId);
  if (!profileId || !tabIds.length) return;
  const s = useBrowser.getState();
  const loose = tabIds.filter((id) => s.tabs[id] && !isPinnedRow(s.tabs[id]!));
  if (loose.length) s.placeTabs(loose, { pinned: true, row: true, beforeId: null });
  const after = useBrowser.getState();
  const refs = tabIds.map((id) => after.tabs[id]).filter((t) => !!t && isPinnedRow(t)).map((t) => tabRef(t!));
  movePinnedNodes(profileId, refs, target);
}

export function pinGroupIntoFolder(windowId: string, groupId: string, target: FolderTarget) {
  const profileId = shownProfile(windowId);
  const s = useBrowser.getState();
  if (!profileId || !s.groups[groupId]) return;
  if (!s.groups[groupId]!.pinned) s.moveGroup(groupId, { pinned: true });
  const g = useBrowser.getState().groups[groupId];
  if (g?.pinned) movePinnedNodes(profileId, [groupRef(g)], target);
}

export function planArcImport(profileId: string, plan: Omit<ImportPlan, "expires">, folders: { id: string; name: string; parent: string | null }[]) {
  if (isIncognitoProfile(profileId) || !folders.length) return;
  updateTree(profileId, (tree) => folders.reduce((t, f) => createFolder(t, f.id, f.name, { parent: f.parent }), tree));
  const { plans } = usePinnedFolders.getState();
  usePinnedFolders.setState({ plans: { ...plans, [profileId]: { ...plan, expires: Date.now() + PLAN_MS } } });
}
