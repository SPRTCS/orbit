import { fileExists, type BrowserCommand } from "@ardia/shell";
import { create } from "zustand";
import { showToast } from "../../components/layout/splitActions";
import { useBrowser } from "../../store/browser";
import { activeTabId, engineProfile, privateSession, resolveWindowId } from "../../store/model";
import { webviews } from "../webviews";
import {
  captureMode,
  freeFileName,
  fullPageClip,
  insideViewport,
  pageZoom,
  regionClip,
  type CaptureMode,
  type LayoutMetrics,
} from "./model";
import { capturedImageInfo, captureNativeAvailable, copyCapturedImage, downloadsFolder, prepareCaptureFolder, saveCapturedCopy } from "./native";
import { captureScript, type CaptureAnswer } from "./pageScript";

export type CapturePreview = {
  id: number;
  windowId: string;
  url: string;
  path: string;
  name: string;
  date: number;
  width: number;
  height: number;
  bytes: number;
  thumbnail: string | null;
  copied: boolean;
  saved: string | null;
  cropped: boolean;
};

type Selecting = { windowId: string; tabId: string; url: string };

export const useCapture = create<{ selecting: Selecting | null; previews: Record<string, CapturePreview | null> }>(() => ({
  selecting: null,
  previews: {},
}));

export const THUMBNAIL_WIDTH = 220;
export const THUMBNAIL_MAX_ASPECT = 1.25;

const KEY = `orbitcapture${Math.random().toString(36).slice(2)}`;
const SELECTABLE_PAGE = /^(https?|file):/i;
const pageOf = (url: string) => url.replace(/#.*$/, "");
let token = 0;
let previewSeq = 0;
let watching = false;
let busy = false;

const REPEAT_WINDOW_MS = 300;
let lastCommand = { at: 0, mode: "" };

export function runCaptureCommand(command: BrowserCommand, arg: string | null, windowId: string | null): boolean {
  if (command !== "capture") return false;
  const mode = captureMode(arg);
  const now = Date.now();
  const repeated = lastCommand.mode === mode && now - lastCommand.at < REPEAT_WINDOW_MS;
  lastCommand = { at: now, mode };
  if (!repeated) void startCapture(windowId, mode);
  return true;
}

function targetOf(windowId: string | null) {
  const s = useBrowser.getState();
  const w = resolveWindowId(s, windowId);
  const tabId = w ? activeTabId(s, w) : undefined;
  const tab = tabId ? s.tabs[tabId] : undefined;
  return w && tab ? { windowId: w, tab } : null;
}

const cantCapture = (windowId: string, message?: string) => {
  showToast(windowId, "Can't capture this page", message, { icon: "camera.viewfinder" });
  return null;
};

function watch() {
  if (watching) return;
  watching = true;
  useBrowser.subscribe((s, prev) => {
    const selecting = useCapture.getState().selecting;
    if (!selecting || (s.tabs === prev.tabs && s.windows === prev.windows)) return;
    const tab = s.tabs[selecting.tabId];
    if (!tab || pageOf(tab.url) !== pageOf(selecting.url) || activeTabId(s, selecting.windowId) !== selecting.tabId) stopSelecting();
  });
}

export function stopSelecting() {
  const selecting = useCapture.getState().selecting;
  if (!selecting) return;
  token++;
  useCapture.setState({ selecting: null });
  void webviews.get(selecting.tabId)?.evaluate(captureScript(KEY, { stop: true }));
}

async function selectRegion(windowId: string, tabId: string, url: string): Promise<CaptureAnswer | null> {
  const view = webviews.get(tabId);
  if (!view) return null;
  watch();
  const mine = ++token;
  useCapture.setState({ selecting: { windowId, tabId, url } });
  void view.focus();
  const answer = await view.evaluate<CaptureAnswer>(captureScript(KEY, {}));
  if (mine !== token) return { kind: "cancel" };
  useCapture.setState({ selecting: null });
  return answer;
}

export async function startCapture(windowId: string | null, mode: CaptureMode): Promise<CapturePreview | null> {
  const target = targetOf(windowId);
  if (!target) return null;
  const { tab } = target;
  const selecting = useCapture.getState().selecting;
  if (selecting) {
    stopSelecting();
    if (mode === "region" && selecting.tabId === tab.id) return null;
  }
  if (busy) return null;
  if (!tab.url || !webviews.get(tab.id)) return cantCapture(target.windowId);
  if (!captureNativeAvailable()) return cantCapture(target.windowId, "This build of Orbit can't capture yet. Update Orbit.");
  let answer: CaptureAnswer | null = null;
  if (mode === "region" && SELECTABLE_PAGE.test(tab.url)) {
    answer = await selectRegion(target.windowId, tab.id, tab.url);
    if (answer && answer.kind !== "region" && answer.kind !== "element" && answer.kind !== "visible" && answer.kind !== "fullPage") return null;
  }
  const chosen: CaptureMode = answer?.kind === "fullPage" ? "fullPage" : answer?.kind === "region" || answer?.kind === "element" ? "region" : mode === "fullPage" ? "fullPage" : "visible";
  busy = true;
  try {
    return await shoot(target.windowId, tab.id, chosen, answer);
  } finally {
    busy = false;
  }
}

async function captureParams(tabId: string, mode: CaptureMode, answer: CaptureAnswer | null): Promise<{ params: Record<string, unknown>; cropped: boolean } | null> {
  if (mode === "visible") return { params: { format: "png" }, cropped: false };
  const view = webviews.get(tabId);
  const metrics = (await view?.orbitCapture("Page.getLayoutMetrics", {}))?.result as LayoutMetrics | undefined;
  if (!metrics) return null;
  if (mode === "fullPage") {
    const full = fullPageClip(metrics);
    return full ? { params: { format: "png", clip: full.clip, captureBeyondViewport: true }, cropped: full.cropped } : null;
  }
  if (!answer || (answer.kind !== "region" && answer.kind !== "element")) return null;
  const clip = regionClip(answer.rect, answer, pageZoom(metrics));
  if (!clip) return null;
  return { params: { format: "png", clip, captureBeyondViewport: !insideViewport(answer.rect, answer) }, cropped: false };
}

async function shoot(windowId: string, tabId: string, mode: CaptureMode, answer: CaptureAnswer | null): Promise<CapturePreview | null> {
  const view = webviews.get(tabId);
  const url = useBrowser.getState().tabs[tabId]?.url ?? "";
  const request = await captureParams(tabId, mode, answer);
  const folder = await prepareCaptureFolder();
  if (!view || !request || !folder) return cantCapture(windowId);
  const date = Date.now();
  const name = freeFileName(new Date(date), (n) => fileExists(`${folder}/${n}`));
  if (!name) return cantCapture(windowId);
  const shot = await view.orbitCapture("Page.captureScreenshot", request.params, `${folder}/${name}`);
  if (!shot.path) return cantCapture(windowId);
  const info = await capturedImageInfo(shot.path, THUMBNAIL_WIDTH * 2, THUMBNAIL_MAX_ASPECT);
  if (!info || !info.width || !info.height) return cantCapture(windowId);
  const copied = await copyCapturedImage(shot.path);
  const preview: CapturePreview = {
    id: ++previewSeq,
    windowId,
    url,
    path: shot.path,
    name,
    date,
    width: info.width,
    height: info.height,
    bytes: info.bytes,
    thumbnail: info.thumbnail ?? null,
    copied,
    saved: null,
    cropped: request.cropped,
  };
  useCapture.setState((s) => ({ previews: { ...s.previews, [windowId]: preview } }));
  return preview;
}

function patchPreview(windowId: string, id: number, patch: Partial<CapturePreview>) {
  useCapture.setState((s) => {
    const current = s.previews[windowId];
    return current?.id === id ? { previews: { ...s.previews, [windowId]: { ...current, ...patch } } } : s;
  });
}

export function dismissCapture(windowId: string, id?: number) {
  useCapture.setState((s) => {
    const current = s.previews[windowId];
    return current && (id === undefined || current.id === id) ? { previews: { ...s.previews, [windowId]: null } } : s;
  });
}

export async function copyCapture(windowId: string): Promise<boolean> {
  const preview = useCapture.getState().previews[windowId];
  if (!preview) return false;
  const copied = await copyCapturedImage(preview.path);
  patchPreview(windowId, preview.id, { copied });
  return copied;
}

export async function saveCapture(windowId: string): Promise<string | null> {
  const preview = useCapture.getState().previews[windowId];
  if (!preview) return null;
  if (preview.saved) return preview.saved;
  const folder = downloadsFolder();
  const name = folder ? freeFileName(new Date(preview.date), (n) => fileExists(`${folder}/${n}`)) : null;
  const path = folder && name ? `${folder}/${name}` : null;
  if (!path || !name || !(await saveCapturedCopy(preview.path, path))) {
    showToast(windowId, "Couldn't save the capture", "Check that the Downloads folder exists and can be written to.", { icon: "exclamationmark.triangle" });
    return null;
  }
  patchPreview(windowId, preview.id, { saved: path });
  listDownload(windowId, preview, name, path);
  return path;
}

function listDownload(windowId: string, preview: CapturePreview, filename: string, path: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return;
  const session = privateSession(w.profileId);
  s.upsertDownload({
    id: `orbit-capture-${preview.date}-${preview.id}`,
    url: preview.url,
    filename,
    path,
    state: "finished",
    paused: false,
    received: preview.bytes,
    total: preview.bytes,
    speed: 0,
    mimeType: "image/png",
    profile: session ?? engineProfile(w.profileId),
    offTheRecord: session !== null,
  });
}
