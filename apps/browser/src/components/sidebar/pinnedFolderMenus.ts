import { showMenu, type MenuItem } from "@ardia/shell";
import {
  deletePinnedFolder,
  movePinnedNodes,
  newPinnedFolder,
  setPinnedFolderCollapsed,
  shownProfile,
  subjectRef,
} from "../../lib/pinnedFolders";
import { exportFolder } from "../spaces/spaceFiles";
import { aiFolderMenuItems, folderTabIds, TIDY_FOLDER_TITLES, tidyTitles } from "../../lib/ai/tidyTitles";
import { useBrowser } from "../../store/browser";
import { childrenOf, folderDepth, folderRef, isWithin, parentOf, usePinnedFolders, type PinnedTree } from "../../store/pinnedFolders";

type Subject = { kind: "tab" | "group"; id: string };

const sep = { separator: true } as const;
const PREFIX = "pinnedFolder:";

function foldersInOrder(tree: PinnedTree): string[] {
  const out: string[] = [];
  const walk = (refs: string[]) => {
    for (const ref of refs) {
      if (!ref.startsWith("f:") || out.includes(ref.slice(2)) || !tree.folders[ref.slice(2)]) continue;
      out.push(ref.slice(2));
      walk(tree.folders[ref.slice(2)]!.children);
    }
  };
  walk(tree.root);
  for (const id of Object.keys(tree.folders)) if (!out.includes(id)) out.push(id);
  return out;
}

function destinationItems(tree: PinnedTree | undefined, ref: string | null, movingFolder: string | null): MenuItem[] {
  const current = tree && ref ? (parentOf(tree, ref) ?? null) : null;
  const folders = tree ? foldersInOrder(tree).filter((id) => !movingFolder || !isWithin(tree, movingFolder, id)) : [];
  return [
    ...folders.map((id) => ({
      id: `${PREFIX}into:${id}`,
      title: `${"   ".repeat(folderDepth(tree!, id))}${tree!.folders[id]!.name}`,
      symbol: "folder",
      enabled: id !== current,
    })),
    ...(current !== null ? [...(folders.length ? [sep] : []), { id: `${PREFIX}root`, title: "Move Out of Folders", symbol: "arrow.up.left" }] : []),
    ...(movingFolder ? [] : [...(folders.length || current !== null ? [sep] : []), { id: `${PREFIX}newWith`, title: "New Folder", symbol: "folder.badge.plus" }]),
  ];
}

export function newPinnedFolderMenuItems(windowId: string): MenuItem[] {
  return shownProfile(windowId) ? [{ id: `${PREFIX}new`, title: "New Folder", symbol: "folder.badge.plus" }] : [];
}

export function pinnedFolderMenuItems(windowId: string, subject: Subject): MenuItem[] {
  const profileId = shownProfile(windowId);
  const ref = subjectRef(useBrowser.getState(), subject);
  if (!profileId || !ref) return [];
  const tree = usePinnedFolders.getState().trees[profileId];
  return [{ id: `${PREFIX}move`, title: "Move to Folder", symbol: "folder", children: destinationItems(tree, ref, null) }];
}

export function runPinnedFolderMenu(windowId: string, choice: string, subject?: Subject): boolean {
  if (!choice.startsWith(PREFIX)) return false;
  const action = choice.slice(PREFIX.length);
  const profileId = shownProfile(windowId);
  if (!profileId) return true;
  if (action === "new") {
    newPinnedFolder(windowId);
    return true;
  }
  const ref = subject ? subjectRef(useBrowser.getState(), subject) : null;
  if (!ref) return true;
  const tree = usePinnedFolders.getState().trees[profileId];
  if (action === "newWith") newPinnedFolder(windowId, { target: { parent: tree ? (parentOf(tree, ref) ?? null) : null, before: ref }, contents: [ref] });
  else if (action === "root") movePinnedNodes(profileId, [ref], { parent: null });
  else if (action.startsWith("into:")) movePinnedNodes(profileId, [ref], { parent: action.slice(5) });
  return true;
}

export async function openPinnedFolderMenu(windowId: string, profileId: string, folderId: string) {
  const tree = usePinnedFolders.getState().trees[profileId];
  const folder = tree?.folders[folderId];
  if (!tree || !folder) return;
  const ref = folderRef(folderId);
  const choice = await showMenu([
    { id: "rename", title: "Rename…", symbol: "character.cursor.ibeam" },
    { id: "nested", title: "New Folder Inside", symbol: "folder.badge.plus" },
    { id: "collapse", title: folder.collapsed ? "Expand Folder" : "Collapse Folder", symbol: folder.collapsed ? "chevron.down" : "chevron.up" },
    sep,
    { id: "move", title: "Move to Folder", symbol: "folder", children: destinationItems(tree, ref, folderId) },
    { id: "share", title: "Share Folder…", symbol: "square.and.arrow.up" },
    ...aiFolderMenuItems(),
    sep,
    { id: "delete", title: "Delete Folder", symbol: "trash" },
  ]);
  if (!choice) return;
  if (choice === "rename") usePinnedFolders.setState({ renaming: { windowId, folderId } });
  else if (choice === "nested") {
    setPinnedFolderCollapsed(profileId, folderId, false);
    newPinnedFolder(windowId, { target: { parent: folderId, before: childrenOf(tree, folderId)[0] ?? null } });
  } else if (choice === "collapse") setPinnedFolderCollapsed(profileId, folderId, !folder.collapsed);
  else if (choice === "delete") deletePinnedFolder(profileId, folderId);
  else if (choice === "share") void exportFolder(profileId, folderId, windowId);
  else if (choice === TIDY_FOLDER_TITLES) void tidyTitles(windowId, folderTabIds(useBrowser.getState(), windowId, profileId, folderId));
  else if (choice === `${PREFIX}root`) movePinnedNodes(profileId, [ref], { parent: null });
  else if (choice.startsWith(`${PREFIX}into:`)) movePinnedNodes(profileId, [ref], { parent: choice.slice(PREFIX.length + 5) });
}
