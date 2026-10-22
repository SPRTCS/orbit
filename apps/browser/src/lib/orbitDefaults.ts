import { useBrowser } from "../store/browser";
import type { Settings } from "../store/settings";

export const ORBIT_FIRST_RUN_SETTINGS: Partial<Settings> = {
  addressBar: "sidebar",
  newTabOpens: "commandBar",
  newTabPosition: "top",
  cleanUpInactiveTabsAfterHours: 12,
  sidebarWidth: 228,
};

export function applyOrbitFirstRunSettings() {
  useBrowser.getState().updateSettings(ORBIT_FIRST_RUN_SETTINGS);
}
