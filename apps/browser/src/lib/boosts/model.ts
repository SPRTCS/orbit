import { punycodeEncode } from "@ardia/core";

export type BoostSite = { host: string; subdomains: boolean; path: string };
export type BoostZap = { selector: string; label: string };
export type BoostStyle = { font: string; tint: number | null; dark: boolean };

export type Boost = {
  id: string;
  name: string;
  enabled: boolean;
  site: BoostSite;
  profileId: string | null;
  css: string;
  js: string;
  jsAllowed: boolean;
  zaps: BoostZap[];
  style: BoostStyle;
  incognito: boolean;
  createdAt: number;
  updatedAt: number;
};

export const BOOST_FILE_EXTENSION = "orbitboost";
export const BOOST_FORMAT = 1;
export const MAX_BOOSTS = 200;
export const MAX_CODE = 200_000;
export const MAX_ZAPS = 500;
export const MAX_SELECTOR = 1000;

export const NO_STYLE: BoostStyle = { font: "", tint: null, dark: false };

export const FONTS: { value: string; title: string }[] = [
  { value: "", title: "Site Default" },
  { value: "-apple-system, system-ui, sans-serif", title: "System" },
  { value: '"New York", ui-serif, Georgia, serif', title: "Serif" },
  { value: "ui-rounded, system-ui, sans-serif", title: "Rounded" },
  { value: "ui-monospace, Menlo, monospace", title: "Monospace" },
];

export const TINTS: { value: number | null; title: string }[] = [
  { value: null, title: "None" },
  { value: 330, title: "Rose" },
  { value: 30, title: "Amber" },
  { value: 90, title: "Lime" },
  { value: 150, title: "Teal" },
  { value: 210, title: "Ocean" },
  { value: 270, title: "Violet" },
];

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]{0,200}$/;

export const isIpHost = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

export function normalizeHost(input: string): { host: string; subdomains: boolean } | null {
  let text = input.trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^@/?#]*@/, "");
  text = text.replace(/[/?#].*$/, "").replace(/:\d*$/, "").replace(/\.+$/, "");
  const subdomains = text.startsWith("*.");
  if (subdomains) text = text.slice(2);
  if (!text || text.length > 253) return null;
  const labels = text.split(".").map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : `xn--${punycodeEncode(label)}`));
  if (!labels.every((label) => HOST_LABEL.test(label))) return null;
  return { host: labels.join("."), subdomains };
}

export function normalizePath(input: string): string | null {
  const text = input.trim();
  if (!text || text === "/" || text === "/*") return "";
  const path = text.startsWith("/") ? text : `/${text}`;
  return PATH.test(path) ? path.replace(/\*+$/, "") : null;
}

export function validSite(site: BoostSite): boolean {
  const host = normalizeHost(site.host);
  return !!host && host.host === site.host && normalizePath(site.path) === site.path;
}

export function urlParts(url: string): { host: string; path: string } | null {
  const m = url.match(/^https?:\/\/(?:[^@/?#]*@)?([^:/?#]*)(?::\d*)?([^#]*)/i);
  if (!m || !m[1]) return null;
  const path = m[2] || "/";
  return { host: m[1].toLowerCase().replace(/\.+$/, ""), path: path.startsWith("/") ? path : `/${path}` };
}

export function siteForUrl(url: string): BoostSite | null {
  const parts = urlParts(url);
  if (!parts) return null;
  const normal = normalizeHost(parts.host);
  if (!normal) return null;
  const host = normal.host.replace(/^www\./, "");
  return { host, subdomains: !isIpHost(host) && host !== "localhost", path: "" };
}

export function siteLabel(site: BoostSite): string {
  return `${site.subdomains ? "*." : ""}${site.host}${site.path}`;
}

const globToRegExp = (glob: string) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`);

export function siteMatchesUrl(site: BoostSite, url: string): boolean {
  const parts = urlParts(url);
  if (!parts || !validSite(site)) return false;
  const hostOk = parts.host === site.host || (site.subdomains && !isIpHost(site.host) && parts.host.endsWith(`.${site.host}`));
  return hostOk && globToRegExp(site.path || "/").test(parts.path);
}

export function matchPatterns(site: BoostSite): string[] {
  const path = `${site.path || "/"}*`;
  return [site.subdomains && !isIpHost(site.host) ? `*://*.${site.host}${path}` : `*://${site.host}${path}`];
}

export function cleanFont(font: string): string {
  return font.replace(/[;{}<>\\\n\r]/g, "").trim().slice(0, 200);
}

const cleanTint = (tint: unknown): number | null =>
  typeof tint === "number" && Number.isFinite(tint) ? ((Math.round(tint) % 360) + 360) % 360 : null;

export function hasStyle(style: BoostStyle): boolean {
  return !!style.font || style.tint !== null || style.dark;
}

export function boostDoesSomething(boost: Boost): boolean {
  return !!boost.css.trim() || boost.zaps.length > 0 || hasStyle(boost.style) || (!!boost.js.trim() && boost.jsAllowed);
}

export function isLiveBoost(boost: Boost): boolean {
  return boost.enabled && validSite(boost.site) && boostDoesSomething(boost);
}

export function zapRule(selector: string): string {
  return `${selector} { display: none !important; }`;
}

export function styleCss(style: BoostStyle): string {
  const rules: string[] = [];
  const font = cleanFont(style.font);
  if (font) {
    rules.push(
      `html body, html body *:not(i):not(code):not(pre):not(kbd):not(samp):not(tt):not(svg):not(svg *):not([class*="icon" i]):not([aria-hidden="true"]) { font-family: ${font} !important; }`,
    );
  }
  const tint = cleanTint(style.tint);
  const page = [style.dark ? "invert(1) hue-rotate(180deg)" : "", tint !== null ? `hue-rotate(${tint}deg)` : ""].filter(Boolean);
  if (page.length) {
    const media = [tint !== null ? `hue-rotate(${-tint}deg)` : "", style.dark ? "hue-rotate(180deg) invert(1)" : ""].filter(Boolean);
    rules.push(`html { filter: ${page.join(" ")} !important; }`);
    rules.push(`img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"] { filter: ${media.join(" ")} !important; }`);
  }
  return rules.join("\n");
}

export function boostCss(boost: Boost): string {
  return [styleCss(boost.style), ...boost.zaps.map((z) => zapRule(z.selector)), boost.css.trim()].filter(Boolean).join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export const safeSelector = (selector: string) => !/[{};@]|\/\*|\*\//.test(selector);

function readZaps(v: unknown): BoostZap[] {
  if (!Array.isArray(v)) return [];
  const out: BoostZap[] = [];
  for (const item of v.slice(0, MAX_ZAPS)) {
    const zap = item as Partial<BoostZap> | null;
    const selector = str(zap?.selector, MAX_SELECTOR).trim();
    if (selector && safeSelector(selector) && !out.some((z) => z.selector === selector)) out.push({ selector, label: str(zap?.label, 120) });
  }
  return out;
}

function readStyle(v: unknown): BoostStyle {
  const style = (v ?? {}) as Partial<BoostStyle>;
  return { font: cleanFont(str(style.font, 200)), tint: cleanTint(style.tint), dark: style.dark === true };
}

function readSite(v: unknown): BoostSite | null {
  const site = (v ?? {}) as Partial<BoostSite>;
  const host = normalizeHost(str(site.host, 300));
  const path = normalizePath(str(site.path, 300));
  if (!host || path === null) return null;
  return { host: host.host, subdomains: site.subdomains === true || host.subdomains, path };
}

export function readBoost(v: unknown, fallbackId: string, now = Date.now()): Boost | null {
  const raw = (v ?? {}) as Partial<Boost>;
  const site = readSite(raw.site);
  if (!site) return null;
  return {
    id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw.id) ? raw.id : fallbackId,
    name: str(raw.name, 120).trim() || site.host,
    enabled: raw.enabled !== false,
    site,
    profileId: typeof raw.profileId === "string" ? raw.profileId : null,
    css: str(raw.css, MAX_CODE),
    js: str(raw.js, MAX_CODE),
    jsAllowed: raw.jsAllowed === true,
    zaps: readZaps(raw.zaps),
    style: readStyle(raw.style),
    incognito: raw.incognito === true,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

export function readBoosts(json: string | null, newId: () => string): Boost[] {
  if (!json) return [];
  try {
    const doc = JSON.parse(json) as { version?: number; boosts?: unknown[] };
    if (doc.version !== BOOST_FORMAT || !Array.isArray(doc.boosts)) return [];
    const out: Boost[] = [];
    for (const item of doc.boosts.slice(0, MAX_BOOSTS)) {
      const boost = readBoost(item, newId());
      if (boost && !out.some((b) => b.id === boost.id)) out.push(boost);
    }
    return out;
  } catch {
    return [];
  }
}

export const writeBoosts = (boosts: Boost[]) => JSON.stringify({ version: BOOST_FORMAT, boosts });

export type SharedBoost = {
  orbitBoost: number;
  name: string;
  site: BoostSite;
  css: string;
  js: string;
  zaps: BoostZap[];
  style: BoostStyle;
};

export function exportBoost(boost: Boost): string {
  const shared: SharedBoost = {
    orbitBoost: BOOST_FORMAT,
    name: boost.name,
    site: boost.site,
    css: boost.css,
    js: boost.js,
    zaps: boost.zaps,
    style: boost.style,
  };
  return `${JSON.stringify(shared, null, 2)}\n`;
}

export const exportFileName = (boost: Boost) =>
  `${(boost.name || boost.site.host).replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 80) || "Boost"}.${BOOST_FILE_EXTENSION}`;

export type ImportedBoost = { boost: Boost; summary: string[]; hasJs: boolean };

export function importBoost(text: string, id: string, now = Date.now()): ImportedBoost | { error: string } {
  let raw: Partial<SharedBoost>;
  try {
    raw = JSON.parse(text.trim()) as Partial<SharedBoost>;
  } catch {
    return { error: "That isn't a boost. Boosts are shared as .orbitboost files or their text." };
  }
  if (!raw || typeof raw !== "object" || raw.orbitBoost !== BOOST_FORMAT) return { error: "That isn't a boost Orbit can read." };
  if ((typeof raw.css === "string" && raw.css.length > MAX_CODE) || (typeof raw.js === "string" && raw.js.length > MAX_CODE)) {
    return { error: "That boost is too large." };
  }
  const boost = readBoost({ ...raw, id, enabled: true, jsAllowed: false, incognito: false, profileId: null, createdAt: now, updatedAt: now }, id, now);
  if (!boost) return { error: "That boost's site isn't valid." };
  const hasJs = !!boost.js.trim();
  return { boost, summary: boostSummary(boost), hasJs };
}

export function boostSummary(boost: Boost): string[] {
  const lines = [`Applies to ${boost.site.subdomains ? `${boost.site.host} and its subdomains` : boost.site.host}${boost.site.path ? `, pages under ${boost.site.path}` : ""}`];
  const cssLines = boost.css.trim() ? boost.css.trim().split("\n").length : 0;
  if (cssLines) lines.push(`Custom CSS (${cssLines} line${cssLines === 1 ? "" : "s"})`);
  if (boost.zaps.length) lines.push(`Hides ${boost.zaps.length} element${boost.zaps.length === 1 ? "" : "s"}`);
  const style = [boost.style.font ? "font" : "", boost.style.tint !== null ? "color tint" : "", boost.style.dark ? "dark page" : ""].filter(Boolean);
  if (style.length) lines.push(`Changes the ${style.join(", ")}`);
  const jsLines = boost.js.trim() ? boost.js.trim().split("\n").length : 0;
  if (jsLines) lines.push(`JavaScript (${jsLines} line${jsLines === 1 ? "" : "s"}) that runs on the site`);
  return lines;
}

export function boostAppliesTo(boost: Boost, url: string, engine: string, incognito: boolean, engineOf: (profileId: string) => string): boolean {
  if (!isLiveBoost(boost) || (incognito && !boost.incognito)) return false;
  if (boost.profileId !== null && engineOf(boost.profileId) !== engine) return false;
  return siteMatchesUrl(boost.site, url);
}
