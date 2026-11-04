import type { BrowserState } from "../../../store/browser";
import { activeTabId } from "../../../store/model";
import { folderIdOf, hasFolders, isFolderRef, resolveTree, windowRefs, type PinnedTree, type ResolvedNode } from "../../../store/pinnedFolders";
import { groupEntries, sidebarEntries } from "../entries";
import type { DockNode, DockSource } from "./model";

function entryTabs(s: BrowserState, windowId: string, entry: string): string[] {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return groupEntries(s, id).flatMap((e) => entryTabs(s, windowId, e));
  if (!entry.startsWith("s:")) return s.tabs[id] ? [id] : [];
  const panes = (s.splits[id]?.tabIds ?? []).filter((tabId) => s.tabs[tabId]);
  const active = activeTabId(s, windowId);
  if (active && panes.includes(active)) return [active];
  const last = panes.reduce<string | undefined>((a, b) => (!a || s.tabs[b]!.lastActiveAt > s.tabs[a]!.lastActiveAt ? b : a), undefined);
  return last ? [last] : [];
}

const groupTabs = (s: BrowserState, windowId: string, groupId: string) => entryTabs(s, windowId, `g:${groupId}`);

function toNodes(s: BrowserState, windowId: string, nodes: ResolvedNode[], idOf: Map<string, string>): DockNode[] {
  return nodes.flatMap((n): DockNode[] => {
    if (isFolderRef(n.ref)) return [{ folderId: folderIdOf(n.ref), children: toNodes(s, windowId, n.children ?? [], idOf) }];
    const id = idOf.get(n.ref);
    if (!id) return [];
    return [{ tabIds: n.ref.startsWith("g:") ? groupTabs(s, windowId, id) : [id] }];
  });
}

export function dockSource(s: BrowserState, windowId: string, profileId: string, tree: PinnedTree | undefined): DockSource {
  const { tiles, pinnedRows, pinnedGroups, list } = sidebarEntries(s, windowId, profileId);
  const open = list.flatMap((e) => entryTabs(s, windowId, e));
  if (!hasFolders(tree)) {
    const nodes: DockNode[] = [...pinnedRows.map((id) => ({ tabIds: [id] })), ...pinnedGroups.map((id) => ({ tabIds: groupTabs(s, windowId, id) }))];
    return { tiles, nodes, open };
  }
  const { refs, idOf } = windowRefs(s, pinnedRows, pinnedGroups);
  return { tiles, nodes: toNodes(s, windowId, resolveTree(tree, refs), idOf), open };
}

export const folderName = (tree: PinnedTree | undefined, id: string) => tree?.folders[id]?.name || "Folder";
