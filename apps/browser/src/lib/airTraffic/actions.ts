import type { MenuItem } from "@ardia/shell";
import { openSettings } from "../../components/settings/windows";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import type { Tab } from "../../store/types";
import { siteDomain, siteRuleFor } from "./rules";
import { airTrafficConfig, toggleSiteRule } from "./store";

export const AIR_TRAFFIC_ARG = "airTraffic";
const MENU_ID = "airTraffic:site";

export function runAirTrafficCommand(command: string, arg: string | null | undefined): boolean {
  if (command !== "openSettings" || arg !== AIR_TRAFFIC_ARG) return false;
  openSettings("airTraffic");
  return true;
}

function siteChoice(tab: Tab) {
  const s = useBrowser.getState();
  const domain = tab.url && !isIncognitoProfile(tab.profileId) ? siteDomain(tab.url) : null;
  const space = s.profiles[tab.profileId];
  if (!domain || !space) return null;
  return { domain, spaceId: tab.profileId, spaceName: space.name, on: !!siteRuleFor(airTrafficConfig().rules, domain, tab.profileId) };
}

export function airTrafficTabMenuItems(tab: Tab): MenuItem[] {
  const choice = siteChoice(tab);
  if (!choice) return [];
  return [{ id: MENU_ID, title: `Always Open ${choice.domain} in ${choice.spaceName}`, symbol: "airplane", checked: choice.on }];
}

export function runAirTrafficTabMenu(choice: string, tab: Tab): boolean {
  if (choice !== MENU_ID) return false;
  const site = siteChoice(tab);
  if (site) toggleSiteRule(site.domain, site.spaceId);
  return true;
}
