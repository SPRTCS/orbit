import { useBrowser } from "../../store/browser";
import { engineProfile, isIncognitoProfile } from "../../store/model";
import { lastActiveProfile } from "../../store/small";
import type { RoutedLinks } from "../linkRoutes";
import { clearance, routesLinks, type AirTrafficConfig, type AirTrafficDestination } from "./rules";
import { airTrafficConfig, noteSourceApp } from "./store";

export type Flight = { urls: string[]; routed: RoutedLinks; little?: boolean };

type Leg = { url: string; profileId: string | null; little: boolean | undefined; adoptId: string | undefined };

export const spaceExists = (spaceId: string) => {
  const s = useBrowser.getState();
  return !isIncognitoProfile(spaceId) && !!s.profiles[spaceId] && s.profileOrder.includes(spaceId);
};

function leg(url: string, destination: AirTrafficDestination | null, routed: RoutedLinks, adoptId: string | undefined, currentSpace: string | null): Leg {
  const here = routed.profileId ?? currentSpace;
  if (!destination) return { url, profileId: here, little: undefined, adoptId };
  if (destination.kind === "current") return { url, profileId: here, little: false, adoptId };
  if (destination.kind === "little") return { url, profileId: here, little: true, adoptId };
  const sameEngine = routed.profileId !== null && engineProfile(routed.profileId) === engineProfile(destination.spaceId);
  return { url, profileId: destination.spaceId, little: false, adoptId: sameEngine ? adoptId : undefined };
}

export function planFlights(config: AirTrafficConfig, urls: string[], routed: RoutedLinks, sourceApp?: string | null, currentSpace: string | null = null): Flight[] {
  if (!routesLinks(config)) return [{ urls, routed }];
  const legs = urls.map((url, i) => leg(url, clearance(config, url, sourceApp, spaceExists).destination, routed, routed.adoptIds[i], currentSpace));
  const flights: Flight[] = [];
  let open: { flight: Flight; key: string } | null = null;
  for (const l of legs) {
    const key = `${l.profileId ?? ""}|${l.little ?? "default"}`;
    if (open && open.key === key && !l.little) {
      open.flight.urls.push(l.url);
      open.flight.routed.adoptIds.push(l.adoptId);
      continue;
    }
    const flight: Flight = { urls: [l.url], routed: { profileId: l.profileId, adoptIds: [l.adoptId] }, ...(l.little === undefined ? {} : { little: l.little }) };
    flights.push(flight);
    open = { flight, key };
  }
  return flights;
}

export function airTrafficFlights(urls: string[], routed: RoutedLinks, sourceApp?: string | null): Flight[] {
  noteSourceApp(sourceApp);
  return planFlights(airTrafficConfig(), urls, routed, sourceApp, lastActiveProfile(useBrowser.getState()));
}
