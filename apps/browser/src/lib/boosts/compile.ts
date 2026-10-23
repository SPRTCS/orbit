import { boostCss, isLiveBoost, matchPatterns, type Boost } from "./model";

export const BOOSTS_EXTENSION_NAME = "Orbit Boosts";
export const BOOST_STYLE_ATTRIBUTE = "data-orbit-boost";
const MAX_ENTRIES = 256;

export type BoostExtension = { files: Record<string, string>; incognito: boolean };

type ContentScript = { matches: string[]; js: string[]; run_at: "document_start" | "document_end"; all_frames: boolean; world: "ISOLATED" };

const fileId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[-_]+/, "") || "boost";

const incognitoGuard = (allowed: boolean) => (allowed ? "" : "  if (globalThis.chrome && chrome.extension && chrome.extension.inIncognitoContext) return;\n");

export function styleLoader(id: string, css: string, incognito: boolean): string {
  return `(() => {
${incognitoGuard(incognito)}  const style = document.createElement("style");
  style.setAttribute(${JSON.stringify(BOOST_STYLE_ATTRIBUTE)}, ${JSON.stringify(id)});
  style.textContent = ${JSON.stringify(css)};
  const watch = new MutationObserver(() => {
    if (!style.isConnected) place();
  });
  const place = () => {
    const parent = document.head || document.documentElement;
    if (!parent) return;
    parent.appendChild(style);
    watch.disconnect();
    watch.observe(document, { childList: true });
    watch.observe(parent, { childList: true });
  };
  place();
})();
`;
}

export function scriptWrapper(name: string, js: string, incognito: boolean): string {
  return `(() => {
${incognitoGuard(incognito)}  (function (chrome, browser) {
${js}
  }).call(window, undefined, undefined);
})();
//# sourceURL=orbit-boost/${encodeURIComponent(name || "boost")}.js
`;
}

export function compileBoosts(boosts: Boost[]): BoostExtension | null {
  const files: Record<string, string> = {};
  const entries: ContentScript[] = [];
  let incognito = false;
  for (const boost of boosts) {
    if (!isLiveBoost(boost) || entries.length + 2 > MAX_ENTRIES) continue;
    const matches = matchPatterns(boost.site);
    const base = `boosts/${fileId(boost.id)}`;
    let used = false;
    const css = boostCss(boost);
    if (css) {
      files[`${base}.style.js`] = styleLoader(boost.id, css, boost.incognito);
      entries.push({ matches, js: [`${base}.style.js`], run_at: "document_start", all_frames: true, world: "ISOLATED" });
      used = true;
    }
    if (boost.js.trim() && boost.jsAllowed) {
      files[`${base}.script.js`] = scriptWrapper(boost.name, boost.js, boost.incognito);
      entries.push({ matches, js: [`${base}.script.js`], run_at: "document_end", all_frames: true, world: "ISOLATED" });
      used = true;
    }
    if (used && boost.incognito) incognito = true;
  }
  if (!entries.length) return null;
  files["manifest.json"] = `${JSON.stringify(
    {
      manifest_version: 3,
      name: BOOSTS_EXTENSION_NAME,
      version: "1.0",
      description: "Your Orbit Boosts. Orbit writes this folder; edit boosts in Orbit.",
      content_scripts: entries,
    },
    null,
    2,
  )}\n`;
  return { files, incognito };
}

export function boostsFolder(engine: string): string {
  return engine ? `p_${engine.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 70)}` : "default";
}

export const isBoostsExtension = (x: { name: string; path: string | null }) =>
  x.name === BOOSTS_EXTENSION_NAME && !!x.path && /\/Boosts\/[A-Za-z0-9_-]+\/extension\/?$/.test(x.path);
