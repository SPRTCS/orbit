import { copyText, openWindow } from "@ardia/shell";
import { focus, switchProfile } from "../../lib/actions";
import { folderDocument, importAsNewSpace, mainWindowId, spaceDocument, spaceFiles, usePendingSpace, type PendingSpace } from "../../lib/spaces";
import { useBrowser } from "../../store/browser";
import { extractSpaceJson, parseSpace, serializeSpace, shareText, SPACE_EXTENSION, SpaceFileError, type SpaceDoc } from "../../store/spaceSnapshot";
import { showToast } from "../layout/splitActions";
import { readClipboard } from "../omnibox/paste";
import { SPACE_IMPORT_WINDOW_ID } from "../settings/windows";

let pendingSeq = 0;

const fileName = (name: string) => `${name.replace(/[/:\\?%*|"<>]/g, "-").trim() || "Space"}.${SPACE_EXTENSION}`;

function notify(windowId: string | null | undefined, title: string, message?: string) {
  const target = mainWindowId(useBrowser.getState(), windowId);
  if (target) showToast(target, title, message, { icon: "square.and.arrow.up" });
}

export async function exportSpaceDoc(doc: SpaceDoc, windowId?: string | null): Promise<string | null> {
  const native = spaceFiles();
  if (!native) {
    copyText(shareText(doc));
    notify(windowId, "Copied to the clipboard", "This build can't save space files yet.");
    return null;
  }
  try {
    const saved = await native.saveFile(fileName(doc.name), serializeSpace(doc));
    if (saved) notify(windowId, `Exported “${doc.name}”`, decodeURIComponent(saved.replace(/^file:\/\//, "")));
    return saved;
  } catch (error) {
    notify(windowId, "Couldn't export", String((error as Error)?.message ?? error));
    return null;
  }
}

export function exportSpace(profileId: string, options: { today?: boolean; windowId?: string | null } = {}): Promise<string | null> {
  const doc = spaceDocument(profileId, { today: options.today });
  return doc ? exportSpaceDoc(doc, options.windowId) : Promise.resolve(null);
}

export function copySpaceText(profileId: string, windowId?: string | null) {
  const doc = spaceDocument(profileId);
  if (!doc) return;
  copyText(shareText(doc));
  notify(windowId, `Copied “${doc.name}”`, "Paste it in a message. Orbit can add it with Import Space from Clipboard.");
}

export function exportFolder(profileId: string, folderId: string, windowId?: string | null): Promise<string | null> {
  const doc = folderDocument(profileId, folderId);
  return doc ? exportSpaceDoc(doc, windowId) : Promise.resolve(null);
}

export function showSpaceImport(pending: PendingSpace) {
  usePendingSpace.setState({ pending: { ...pending, seq: ++pendingSeq } });
  void openWindow(SPACE_IMPORT_WINDOW_ID, { kind: "spaceImport", title: pending.doc?.kind === "folder" ? "Import Folder" : "Import Space" });
}

const errorText = (error: unknown) => (error instanceof SpaceFileError ? error.message : `Couldn't read the file: ${String((error as Error)?.message ?? error)}`);

export async function openSpaceFile(url: string, options: { subscribe?: boolean } = {}) {
  const native = spaceFiles();
  if (!native) return showSpaceImport({ doc: null, error: "This build of Orbit can't open space files. Update Orbit.", source: url, origin: "file" });
  try {
    const file = await native.readFile(url);
    showSpaceImport({ doc: parseSpace(file.contents), error: null, source: file.url, origin: "file", subscribe: options.subscribe });
  } catch (error) {
    showSpaceImport({ doc: null, error: errorText(error), source: url, origin: "file" });
  }
}

export async function pickSpaceFile(options: { subscribe?: boolean } = {}) {
  const url = await spaceFiles()?.pickFile();
  if (url) await openSpaceFile(url, options);
}

export async function importSpaceFromClipboard() {
  const json = extractSpaceJson(await readClipboard());
  try {
    if (!json) throw new SpaceFileError("The clipboard doesn't hold a shared space. Copy the whole message someone sent you, then try again.");
    showSpaceImport({ doc: parseSpace(json), error: null, source: null, origin: "clipboard" });
  } catch (error) {
    showSpaceImport({ doc: null, error: errorText(error), source: null, origin: "clipboard" });
  }
}

export const isSpaceFileUrl = (url: string) => /^file:\/\/.*\.orbitspace$/i.test(url.split(/[?#]/)[0]!);

export function takeSpaceFiles(urls: string[]): string[] {
  const spaces = urls.filter(isSpaceFileUrl);
  if (!spaces.length) return urls;
  void openSpaceFile(spaces[0]!);
  return urls.filter((u) => !isSpaceFileUrl(u));
}

export function importAndShowSpace(doc: SpaceDoc, options: Parameters<typeof importAsNewSpace>[1] = {}): string {
  const windowId = mainWindowId(useBrowser.getState(), options.windowId);
  const id = importAsNewSpace(doc, { ...options, windowId });
  if (windowId) {
    switchProfile(windowId, id, true);
    focus(windowId);
  }
  return id;
}

