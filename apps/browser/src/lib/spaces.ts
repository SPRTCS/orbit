import { requireOptionalNativeModule } from "expo-modules-core";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../store/browser";
import { isIncognitoProfile } from "../store/model";
import { mirrored } from "../store/pinMirror";
import { usePinnedFolders } from "../store/pinnedFolders";
import { applySpacePins, openTodayTabs, type PinMode } from "../store/spaceApply";
import { snapshotFolder, snapshotSpace, type SpaceDoc, type SpaceTodayItem } from "../store/spaceSnapshot";
import { adoptProfileTheme } from "../sync/engine";
import { replacePinnedTree } from "./pinnedFolders";

type SpaceFilesNative = {
  saveFile(name: string, contents: string): Promise<string | null>;
  pickFile(): Promise<string | null>;
  readFile(url: string): Promise<{ contents: string; modified: number; path: string; url: string }>;
  modified(url: string): Promise<number | null>;
};

export const spaceFiles = () => requireOptionalNativeModule<SpaceFilesNative>("OrbitSpaceFiles");

export type PendingSpace = { doc: SpaceDoc | null; error: string | null; source: string | null; origin: "file" | "clipboard" | "session"; subscribe?: boolean; seq?: number };

export const usePendingSpace = create<{ pending: PendingSpace | null }>(() => ({ pending: null }));

export function mainWindowId(s: BrowserState = useBrowser.getState(), requested?: string | null): string | undefined {
  const usable = (id: string | null | undefined) => !!id && mirrored(s.windows[id]);
  if (usable(requested)) return requested!;
  return s.ui.focusOrder.find(usable) ?? s.windowOrder.find(usable);
}

export function currentSpaceId(windowId?: string | null): string | null {
  const s = useBrowser.getState();
  const id = mainWindowId(s, windowId);
  const profileId = id ? s.windows[id]!.profileId : null;
  return profileId && !isIncognitoProfile(profileId) && s.profiles[profileId] ? profileId : null;
}

export function spaceDocument(profileId: string, options: { today?: boolean; local?: boolean; now?: number } = {}): SpaceDoc | null {
  const s = useBrowser.getState();
  if (!s.profiles[profileId]) return null;
  return snapshotSpace(s, usePinnedFolders.getState().trees[profileId], profileId, options);
}

export function folderDocument(profileId: string, folderId: string): SpaceDoc | null {
  const tree = usePinnedFolders.getState().trees[profileId];
  return tree ? snapshotFolder(useBrowser.getState(), tree, profileId, folderId) : null;
}

export function applyPins(profileId: string, doc: Pick<SpaceDoc, "tiles" | "pinned">, mode: PinMode) {
  const s = useBrowser.getState();
  if (!s.profiles[profileId]) return;
  const { state, tree } = applySpacePins(s, profileId, doc, mode, usePinnedFolders.getState().trees[profileId]);
  useBrowser.setState(state);
  replacePinnedTree(profileId, tree);
}

export function openToday(profileId: string, items: SpaceTodayItem[], options: { windowId?: string | null; replace?: boolean } = {}) {
  const s = useBrowser.getState();
  const windowId = mainWindowId(s, options.windowId);
  if (!windowId || !s.profiles[profileId] || !items.length) return;
  useBrowser.setState(openTodayTabs(s, windowId, profileId, items, { replace: options.replace }));
}

export function applySpaceLook(profileId: string, doc: Pick<SpaceDoc, "icon" | "theme">) {
  const s = useBrowser.getState();
  if (!s.profiles[profileId]) return;
  if (doc.theme) adoptProfileTheme(profileId);
  s.updateProfile(profileId, { ...(doc.icon ? { icon: doc.icon } : {}), ...(doc.theme ? { theme: doc.theme } : {}) });
}

export function importAsNewSpace(doc: SpaceDoc, options: { shareWith?: string | null; today?: boolean; windowId?: string | null; name?: string } = {}): string {
  const s = useBrowser.getState();
  const id = s.createProfile({ name: options.name ?? doc.name, color: doc.color, icon: doc.icon ?? null, shareWith: options.shareWith ?? null });
  applySpaceLook(id, doc);
  applyPins(id, doc, "replace");
  if (options.today && doc.today?.length) openToday(id, doc.today, { windowId: options.windowId });
  return id;
}

export function importIntoSpace(profileId: string, doc: SpaceDoc, mode: PinMode, options: { today?: boolean; windowId?: string | null } = {}) {
  applyPins(profileId, doc, mode);
  if (options.today && doc.today?.length) openToday(profileId, doc.today, { windowId: options.windowId });
}
