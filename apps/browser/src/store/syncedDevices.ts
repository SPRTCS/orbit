import { readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { CLOSED_VIEW, type DevicesView } from "../lib/syncedDevices";
import { useBrowser } from "./browser";

const FILE = "synced-devices.json";
const VERSION = 1;
const SAVE_DELAY_MS = 500;

type DevicesViews = { views: Record<string, DevicesView>; sidebarHeights: Record<string, number> };

export const useSyncedDevicesView = create<DevicesViews>()(() => ({ views: {}, sidebarHeights: {} }));

export const devicesViewKey = (windowId: string, profileId: string) => `${windowId}|${profileId}`;

let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function loadDevicesViews() {
  if (loaded) return;
  loaded = true;
  try {
    const json = readDocument(FILE);
    const doc = json ? (JSON.parse(json) as { version?: number; views?: Record<string, DevicesView> }) : null;
    if (doc?.version === VERSION && doc.views && typeof doc.views === "object") {
      const views: Record<string, DevicesView> = {};
      for (const [key, v] of Object.entries(doc.views)) {
        if (!v || typeof v !== "object") continue;
        const devices = v.devices && typeof v.devices === "object" ? Object.fromEntries(Object.entries(v.devices).filter(([, open]) => typeof open === "boolean")) : {};
        views[key] = { open: v.open === true, devices };
      }
      useSyncedDevicesView.setState({ views: { ...views, ...useSyncedDevicesView.getState().views } });
    }
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
  }
  useSyncedDevicesView.subscribe((s, prev) => {
    if (s.views !== prev.views) timer ??= setTimeout(saveDevicesViews, SAVE_DELAY_MS);
  });
}

export function saveDevicesViews() {
  if (timer) clearTimeout(timer);
  timer = null;
  const windows = useBrowser.getState().windows;
  const known = Object.keys(windows).length > 0;
  const views = Object.fromEntries(
    Object.entries(useSyncedDevicesView.getState().views).filter(([key, v]) => (!known || !!windows[key.split("|")[0]!]) && (v.open || Object.keys(v.devices).length > 0)),
  );
  try {
    writeDocument(FILE, JSON.stringify({ version: VERSION, views }));
  } catch (error) {
    console.warn(`Couldn't save ${FILE}`, error);
  }
}

export function devicesView(windowId: string, profileId: string): DevicesView {
  return useSyncedDevicesView.getState().views[devicesViewKey(windowId, profileId)] ?? CLOSED_VIEW;
}

function updateView(windowId: string, profileId: string, change: (view: DevicesView) => DevicesView) {
  const key = devicesViewKey(windowId, profileId);
  useSyncedDevicesView.setState((s) => ({ views: { ...s.views, [key]: change(s.views[key] ?? CLOSED_VIEW) } }));
}

export function setDevicesOpen(windowId: string, profileId: string, open: boolean) {
  updateView(windowId, profileId, (v) => ({ ...v, open }));
}

export function setDeviceOpen(windowId: string, profileId: string, deviceId: string, open: boolean) {
  updateView(windowId, profileId, (v) => ({ ...v, devices: { ...v.devices, [deviceId]: open } }));
}

export function setSidebarHeight(windowId: string, height: number) {
  if (useSyncedDevicesView.getState().sidebarHeights[windowId] === height) return;
  useSyncedDevicesView.setState((s) => ({ sidebarHeights: { ...s.sidebarHeights, [windowId]: height } }));
}
