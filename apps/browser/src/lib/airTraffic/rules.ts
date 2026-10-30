import { isIpHost, normalizeHost, urlParts } from "../boosts/model";

export type AirTrafficMatchKind = "domain" | "contains" | "glob";

export type AirTrafficDestination = { kind: "space"; spaceId: string } | { kind: "little" } | { kind: "current" };

export type AirTrafficRule = {
  id: string;
  enabled: boolean;
  match: AirTrafficMatchKind;
  pattern: string;
  fromApp: string | null;
  destination: AirTrafficDestination;
};

export type AirTrafficConfig = { rules: AirTrafficRule[]; fallback: AirTrafficDestination | null };

export const AIR_TRAFFIC_VERSION = 1;
export const MAX_RULES = 200;
export const MAX_PATTERN = 2000;
export const EMPTY_AIR_TRAFFIC: AirTrafficConfig = { rules: [], fallback: null };

const MATCH_KINDS: AirTrafficMatchKind[] = ["domain", "contains", "glob"];
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizePattern(match: AirTrafficMatchKind, input: string): string | null {
  const text = input.trim();
  if (!text || text.length > MAX_PATTERN) return null;
  if (match !== "domain") return text;
  const host = normalizeHost(text)?.host;
  if (!host) return null;
  return host.startsWith("www.") && host.length > 4 ? host.slice(4) : host;
}

export function normalizeBundleId(input: string | null | undefined): string | null {
  const text = (input ?? "").trim();
  return text && BUNDLE_ID.test(text) ? text : null;
}

export const hostWithin = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

const globs = new Map<string, RegExp>();

function globRegExp(pattern: string): RegExp {
  let found = globs.get(pattern);
  if (!found) {
    found = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i");
    if (globs.size > 500) globs.clear();
    globs.set(pattern, found);
  }
  return found;
}

export function patternMatches(match: AirTrafficMatchKind, pattern: string, url: string): boolean {
  if (match === "domain") {
    const host = urlParts(url)?.host;
    return !!host && hostWithin(host, pattern);
  }
  if (match === "contains") return url.toLowerCase().includes(pattern.toLowerCase());
  const re = globRegExp(pattern);
  return re.test(url) || re.test(url.replace(SCHEME, ""));
}

export function ruleMatches(rule: AirTrafficRule, url: string, sourceApp?: string | null): boolean {
  if (rule.fromApp && rule.fromApp.toLowerCase() !== (sourceApp ?? "").toLowerCase()) return false;
  return patternMatches(rule.match, rule.pattern, url);
}

export type SpaceCheck = (spaceId: string) => boolean;

export const destinationUsable = (d: AirTrafficDestination | null, spaceExists: SpaceCheck) => !!d && (d.kind !== "space" || spaceExists(d.spaceId));

export function matchingRule(rules: AirTrafficRule[], url: string, sourceApp: string | null | undefined, spaceExists: SpaceCheck): AirTrafficRule | null {
  return rules.find((r) => r.enabled && destinationUsable(r.destination, spaceExists) && ruleMatches(r, url, sourceApp)) ?? null;
}

export type Clearance = { destination: AirTrafficDestination | null; ruleId: string | null };

export function clearance(config: AirTrafficConfig, url: string, sourceApp: string | null | undefined, spaceExists: SpaceCheck): Clearance {
  const rule = matchingRule(config.rules, url, sourceApp, spaceExists);
  if (rule) return { destination: rule.destination, ruleId: rule.id };
  return { destination: destinationUsable(config.fallback, spaceExists) ? config.fallback : null, ruleId: null };
}

export const routesLinks = (config: AirTrafficConfig) => !!config.fallback || config.rules.some((r) => r.enabled);

export function sameDestination(a: AirTrafficDestination | null, b: AirTrafficDestination | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && (a.kind !== "space" || a.spaceId === (b as { spaceId: string }).spaceId);
}

export function siteDomain(url: string): string | null {
  const host = urlParts(url)?.host;
  if (!host) return null;
  const normal = normalizePattern("domain", host);
  return normal && (isIpHost(normal) || normal.includes(".") || normal === "localhost") ? normal : null;
}

export function siteRuleFor(rules: AirTrafficRule[], domain: string, spaceId: string): AirTrafficRule | undefined {
  return rules.find((r) => r.match === "domain" && r.pattern === domain && !r.fromApp && r.destination.kind === "space" && r.destination.spaceId === spaceId);
}

function readDestination(raw: unknown): AirTrafficDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as { kind?: unknown; spaceId?: unknown };
  if (d.kind === "little" || d.kind === "current") return { kind: d.kind };
  if (d.kind === "space" && typeof d.spaceId === "string" && d.spaceId) return { kind: "space", spaceId: d.spaceId };
  return null;
}

function readRule(raw: unknown, seen: Set<string>): AirTrafficRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id && !seen.has(r.id) ? r.id : null;
  const match = MATCH_KINDS.find((k) => k === r.match);
  const pattern = match && typeof r.pattern === "string" ? normalizePattern(match, r.pattern) : null;
  const destination = readDestination(r.destination);
  if (!id || !match || !pattern || !destination) return null;
  seen.add(id);
  return { id, enabled: r.enabled !== false, match, pattern, fromApp: normalizeBundleId(typeof r.fromApp === "string" ? r.fromApp : null), destination };
}

export function readAirTraffic(json: string | null | undefined): AirTrafficConfig {
  if (!json) return EMPTY_AIR_TRAFFIC;
  try {
    const doc = JSON.parse(json) as { version?: unknown; rules?: unknown; fallback?: unknown };
    if (!doc || typeof doc !== "object" || doc.version !== AIR_TRAFFIC_VERSION) return EMPTY_AIR_TRAFFIC;
    const seen = new Set<string>();
    const rules = (Array.isArray(doc.rules) ? doc.rules : []).map((r) => readRule(r, seen)).filter((r): r is AirTrafficRule => !!r).slice(0, MAX_RULES);
    return { rules, fallback: readDestination(doc.fallback) };
  } catch {
    return EMPTY_AIR_TRAFFIC;
  }
}

export const serializeAirTraffic = (config: AirTrafficConfig) => JSON.stringify({ version: AIR_TRAFFIC_VERSION, rules: config.rules, fallback: config.fallback }, null, 1);

export function matchDescription(rule: Pick<AirTrafficRule, "match" | "pattern">): string {
  if (rule.match === "domain") return `${rule.pattern} and its subdomains`;
  if (rule.match === "contains") return `URL contains “${rule.pattern}”`;
  return `URL matches ${rule.pattern}`;
}

export function moveRule(rules: AirTrafficRule[], id: string, to: number): AirTrafficRule[] {
  const from = rules.findIndex((r) => r.id === id);
  if (from < 0) return rules;
  const target = Math.max(0, Math.min(rules.length - 1, to));
  if (target === from) return rules;
  const next = rules.slice();
  const [rule] = next.splice(from, 1);
  next.splice(target, 0, rule!);
  return next;
}
