import { pinGroupIntoFolder, pinIntoFolder } from "../../lib/pinnedFolders";
import { useBrowser, type BrowserState } from "../../store/browser";
import { isPinnedRow } from "../../store/model";
import { childrenOf, groupRef, parentOf, tabRef, usePinnedFolders, type FolderTarget, type PinnedTree } from "../../store/pinnedFolders";

export type Frame = { x: number; y: number; w: number; h: number };
export type PinnedTreeHandle = { windowId: string; profileId: string; headers: Map<string, Frame>; showInto: (folderId: string | null) => void };

type Source = { tabIds: string[]; groupId?: string };
type DropLike = { type: string; placement?: { pinned?: boolean; row?: boolean; groupId?: string | null; beforeId?: string | null } };

const handles = new Map<object, PinnedTreeHandle>();

export function registerPinnedTree(controller: object, handle: PinnedTreeHandle): () => void {
  handles.set(controller, handle);
  return () => {
    if (handles.get(controller) === handle) handles.delete(controller);
  };
}

export function headerAt(headers: Map<string, Frame>, x: number, y: number): string | null {
  for (const [id, f] of headers) if (x >= f.x && x <= f.x + f.w && y >= f.y + f.h * 0.25 && y <= f.y + f.h * 0.75) return id;
  return null;
}

function refOfTab(s: BrowserState, tabId: string): string | null {
  const t = s.tabs[tabId];
  if (!t) return null;
  if (isPinnedRow(t)) return tabRef(t);
  const g = Object.values(s.groups).find((x) => x.pinned && x.tabIds.includes(tabId));
  return g ? groupRef(g) : null;
}

export function dropTarget(tree: PinnedTree, s: BrowserState, beforeId: string | null | undefined, into: string | null): FolderTarget {
  if (into && tree.folders[into]) return { parent: into };
  const before = beforeId ? refOfTab(s, beforeId) : null;
  if (!before) return { parent: null };
  return { parent: parentOf(tree, before) ?? null, before };
}

export function nextSibling(tree: PinnedTree, parent: string | null, ref: string, skip: Set<string>): string | null {
  const siblings = childrenOf(tree, parent);
  return siblings.slice(siblings.indexOf(ref) + 1).find((r) => !skip.has(r)) ?? null;
}

export function pinnedTreeDrop(controller: object, sources: Source[], drop: DropLike, pointer: { x: number; y: number }): boolean {
  const handle = handles.get(controller);
  const p = drop.placement;
  if (!handle || !sources.length || !p?.pinned) return false;
  const rows = drop.type === "tabs" && !!p.row && !p.groupId;
  const groupId = drop.type === "group" ? sources[0]!.groupId : undefined;
  if (!rows && !groupId) return false;
  const tree = usePinnedFolders.getState().trees[handle.profileId];
  if (!tree) return false;
  const into = headerAt(handle.headers, pointer.x, pointer.y);
  handle.showInto(null);
  const target = dropTarget(tree, useBrowser.getState(), p.beforeId, into);
  if (groupId) pinGroupIntoFolder(handle.windowId, groupId, target);
  else pinIntoFolder(handle.windowId, [...new Set(sources.flatMap((x) => x.tabIds))], target);
  return true;
}
