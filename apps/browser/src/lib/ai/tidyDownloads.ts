import type { Download } from "@ardia/ardiacore";
import { fileExists, type MenuItem } from "@ardia/shell";
import { requireOptionalNativeModule } from "expo-modules-core";
import { showToast } from "../../components/layout/splitActions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTab } from "../../store/model";
import { downloadSession, downloadVisibleIn } from "../../store/ui";
import { complete } from "./client";
import { aiEnabled, aiSettings } from "./settings";
import { aiErrorText } from "./tidyTabs";
import { tidyJob } from "./tidyJobs";
import { downloadNameRequest, hostOf, parseDownloadName } from "./tidyPrompts";

type FilesModule = {
  fileIdentity(path: string): Promise<string | null>;
  renameFile(path: string, name: string, identity: string | null): Promise<string | null>;
};

const RENAME = "ai:renameDownload";
const sources = new Map<string, { pageHost: string | null; pageTitle: string | null }>();
const renamed = new Map<string, { from: string; to: string; identity: string }>();
const working = new Set<string>();

const files = () => {
  const module = requireOptionalNativeModule<FilesModule>("OrbitFiles");
  return module && typeof module.fileIdentity === "function" ? module : null;
};
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const canRenameDownload = (d: Download) =>
  aiEnabled() && !!files() && d.state === "finished" && !d.paused && !d.offTheRecord && downloadSession(d) === null && !!d.path && !working.has(d.id);

function latest(id: string): Download | undefined {
  return useBrowser.getState().downloads.find((x) => x.id === id);
}

function windowFor(s: BrowserState, d: Download, requested?: string | null): string | null {
  if (requested && s.windows[requested]) return requested;
  const focused = s.ui.focusedWindowId;
  if (focused && downloadVisibleIn(d, s.windows[focused])) return focused;
  return s.windowOrder.find((id) => downloadVisibleIn(d, s.windows[id])) ?? null;
}

function setPath(id: string, path: string) {
  const d = latest(id);
  if (d && d.path !== path) useBrowser.getState().upsertDownload({ ...d, path, filename: baseName(path) });
}

async function renameOnDisk(id: string, from: string, name: string, identity: string): Promise<string | null> {
  const module = files();
  if (!module) return null;
  const d = latest(id);
  if (!d || d.state !== "finished" || d.path !== from || !fileExists(from)) return null;
  return module.renameFile(from, name, identity).catch(() => null);
}

export async function renameDownloadWithAi(download: Download, requestedWindow?: string | null, auto = false): Promise<string | null> {
  if (!canRenameDownload(download)) return null;
  const job = tidyJob();
  const module = files();
  if (!job || !module) return null;
  const windowId = windowFor(useBrowser.getState(), download, requestedWindow);
  const toast = (title: string, message?: string) => {
    if (windowId && !auto) showToast(windowId, title, message, { icon: "exclamationmark.triangle" });
  };
  if (!fileExists(download.path)) {
    toast("Couldn't Rename", "The file isn't there any more.");
    return null;
  }
  const from = download.path;
  const original = baseName(from);
  const source = sources.get(download.id);
  working.add(download.id);
  try {
    const identity = await module.fileIdentity(from).catch(() => null);
    if (!identity) {
      toast("Couldn't Rename", "The file isn't there any more.");
      return null;
    }
    if (!job.live()) return null;
    let text: string;
    try {
      text = await complete({
        ...downloadNameRequest({ filename: original, host: hostOf(download.url) || source?.pageHost, pageTitle: source?.pageTitle }),
        signal: job.signal,
      });
    } catch (error) {
      if (job.live()) toast("Couldn't Rename", aiErrorText(error));
      return null;
    }
    if (!job.live()) return null;
    const name = parseDownloadName(text, original);
    if (!name) {
      if (windowId && !auto) showToast(windowId, "Name Already Tidy", original, { icon: "wand.and.stars" });
      return null;
    }
    const to = await renameOnDisk(download.id, from, name, identity);
    if (!to) {
      toast("Couldn't Rename", "The file was moved, replaced or can't be renamed.");
      return null;
    }
    renamed.set(download.id, { from, to, identity });
    setPath(download.id, to);
    if (windowId) {
      showToast(windowId, `Renamed to “${baseName(to)}”`, undefined, {
        icon: "wand.and.stars",
        action: { title: "Undo", run: () => void undoRename(download.id, windowId) },
      });
    }
    return to;
  } finally {
    working.delete(download.id);
  }
}

async function undoRename(id: string, windowId: string) {
  const r = renamed.get(id);
  if (!r) return;
  const back = await renameOnDisk(id, r.to, baseName(r.from), r.identity);
  if (!back) {
    showToast(windowId, "Couldn't Undo Rename", "The file was moved, replaced or renamed since.", { icon: "exclamationmark.triangle" });
    return;
  }
  renamed.delete(id);
  setPath(id, back);
}

export function aiDownloadMenuItems(d: Download): MenuItem[] {
  return canRenameDownload(d) && fileExists(d.path) ? [{ id: RENAME, title: "Rename with AI" }] : [];
}

export function runAiDownloadMenu(choice: string | null | undefined, d: Download, windowId: string): boolean {
  if (choice !== RENAME) return false;
  void renameDownloadWithAi(d, windowId);
  return true;
}

let started = false;

export function startTidyDownloads() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.downloads === prev.downloads) return;
    const before = new Map(prev.downloads.map((d) => [d.id, d]));
    for (const d of s.downloads) {
      const old = before.get(d.id);
      if (!old && d.state === "downloading" && !sources.has(d.id) && downloadSession(d) === null) {
        const focused = s.ui.focusedWindowId;
        const tab = focused && downloadVisibleIn(d, s.windows[focused]) ? activeTab(s, focused) : undefined;
        sources.set(d.id, { pageHost: tab ? hostOf(tab.url) || null : null, pageTitle: tab?.title || null });
      }
      const r = renamed.get(d.id);
      if (r && d.path === r.from && old?.path === r.to) queueMicrotask(() => setPath(d.id, r.to));
      if (old?.state === "downloading" && d.state === "finished" && aiEnabled() && aiSettings().tidyDownloads) {
        void renameDownloadWithAi(d, null, true);
      }
    }
    if (sources.size > 200) for (const id of [...sources.keys()].slice(0, sources.size - 200)) sources.delete(id);
  });
}
