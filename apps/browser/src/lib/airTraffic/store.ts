import { readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { newId } from "../../store/model";
import {
  EMPTY_AIR_TRAFFIC,
  MAX_RULES,
  moveRule,
  normalizeBundleId,
  normalizePattern,
  readAirTraffic,
  routesLinks,
  serializeAirTraffic,
  siteRuleFor,
  type AirTrafficConfig,
  type AirTrafficDestination,
  type AirTrafficRule,
} from "./rules";

export const AIR_TRAFFIC_FILE = "air-traffic.json";

export const useAirTraffic = create<AirTrafficConfig & { loaded: boolean; lastSourceApp: string | null }>(() => ({ ...EMPTY_AIR_TRAFFIC, loaded: false, lastSourceApp: null }));

export function noteSourceApp(sourceApp: string | null | undefined) {
  const app = normalizeBundleId(sourceApp);
  if (app && useAirTraffic.getState().lastSourceApp !== app) useAirTraffic.setState({ lastSourceApp: app });
}

function load() {
  if (useAirTraffic.getState().loaded) return;
  let json: string | null = null;
  try {
    json = readDocument(AIR_TRAFFIC_FILE);
  } catch (error) {
    console.warn(`Couldn't read ${AIR_TRAFFIC_FILE}`, error);
  }
  useAirTraffic.setState({ ...readAirTraffic(json), loaded: true });
}

export function airTrafficConfig(): AirTrafficConfig {
  load();
  const { rules, fallback } = useAirTraffic.getState();
  return { rules, fallback };
}

export const airTrafficRoutesLinks = () => routesLinks(airTrafficConfig());

function commit(next: AirTrafficConfig) {
  useAirTraffic.setState({ ...next, loaded: true });
  try {
    writeDocument(AIR_TRAFFIC_FILE, serializeAirTraffic(next));
  } catch (error) {
    console.warn(`Couldn't save ${AIR_TRAFFIC_FILE}`, error);
  }
}

export type RuleDraft = Pick<AirTrafficRule, "match" | "pattern" | "fromApp" | "destination"> & { enabled?: boolean };

function cleanDraft(draft: RuleDraft): Omit<AirTrafficRule, "id"> | null {
  const pattern = normalizePattern(draft.match, draft.pattern);
  if (!pattern) return null;
  return { enabled: draft.enabled ?? true, match: draft.match, pattern, fromApp: normalizeBundleId(draft.fromApp), destination: draft.destination };
}

export function addRule(draft: RuleDraft, at?: number): string | null {
  const config = airTrafficConfig();
  const clean = cleanDraft(draft);
  if (!clean || config.rules.length >= MAX_RULES) return null;
  const rule: AirTrafficRule = { id: newId("atc"), ...clean };
  const rules = config.rules.slice();
  rules.splice(at ?? rules.length, 0, rule);
  commit({ ...config, rules });
  return rule.id;
}

export function updateRule(id: string, patch: Partial<RuleDraft>): boolean {
  const config = airTrafficConfig();
  const current = config.rules.find((r) => r.id === id);
  const clean = current ? cleanDraft({ ...current, ...patch }) : null;
  if (!current || !clean) return false;
  commit({ ...config, rules: config.rules.map((r) => (r.id === id ? { id, ...clean } : r)) });
  return true;
}

export function removeRule(id: string) {
  const config = airTrafficConfig();
  commit({ ...config, rules: config.rules.filter((r) => r.id !== id) });
}

export function moveRuleTo(id: string, to: number) {
  const config = airTrafficConfig();
  const rules = moveRule(config.rules, id, to);
  if (rules !== config.rules) commit({ ...config, rules });
}

export function setFallback(fallback: AirTrafficDestination | null) {
  commit({ ...airTrafficConfig(), fallback });
}

export function toggleSiteRule(domain: string, spaceId: string): "added" | "removed" | null {
  const config = airTrafficConfig();
  const existing = siteRuleFor(config.rules, domain, spaceId);
  if (existing) {
    removeRule(existing.id);
    return "removed";
  }
  const pattern = normalizePattern("domain", domain);
  if (!pattern) return null;
  const elsewhere = (r: AirTrafficRule) => r.match === "domain" && r.pattern === pattern && !r.fromApp;
  commit({ ...config, rules: config.rules.filter((r) => !elsewhere(r)) });
  return addRule({ match: "domain", pattern, fromApp: null, destination: { kind: "space", spaceId } }, 0) ? "added" : null;
}

export function resetAirTrafficForTests(config: AirTrafficConfig = EMPTY_AIR_TRAFFIC) {
  useAirTraffic.setState({ ...config, loaded: true });
}
