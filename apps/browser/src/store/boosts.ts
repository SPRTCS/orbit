import { create } from "zustand";
import { MAX_BOOSTS, MAX_ZAPS, NO_STYLE, readBoost, siteForUrl, type Boost, type BoostSite, type BoostZap } from "../lib/boosts/model";
import { newId } from "./model";

export const useBoosts = create<{ boosts: Boost[]; loaded: boolean }>(() => ({ boosts: [], loaded: false }));

const now = () => Date.now();

export function newBoost(site: BoostSite, patch: Partial<Boost> = {}): Boost {
  const at = now();
  return {
    id: newId("boost"),
    name: site.host,
    enabled: true,
    site,
    profileId: null,
    css: "",
    js: "",
    jsAllowed: true,
    zaps: [],
    style: NO_STYLE,
    incognito: false,
    createdAt: at,
    updatedAt: at,
    ...patch,
  };
}

export function addBoost(boost: Boost): string | null {
  const { boosts } = useBoosts.getState();
  if (boosts.length >= MAX_BOOSTS) return null;
  useBoosts.setState({ boosts: [...boosts, boost] });
  return boost.id;
}

export function updateBoost(id: string, patch: Partial<Boost> | ((b: Boost) => Partial<Boost>)) {
  useBoosts.setState((state) => ({
    boosts: state.boosts.map((b) => {
      if (b.id !== id) return b;
      const changes = typeof patch === "function" ? patch(b) : patch;
      const next = readBoost({ ...b, ...changes }, b.id, b.updatedAt);
      return next ? { ...next, updatedAt: now() } : b;
    }),
  }));
}

export const removeBoost = (id: string) => useBoosts.setState((state) => ({ boosts: state.boosts.filter((b) => b.id !== id) }));

export const boostById = (id: string | null | undefined) => (id ? useBoosts.getState().boosts.find((b) => b.id === id) : undefined);

export function addZap(id: string, zap: BoostZap) {
  updateBoost(id, (b) => (b.zaps.some((z) => z.selector === zap.selector) || b.zaps.length >= MAX_ZAPS ? {} : { zaps: [...b.zaps, zap], enabled: true }));
}

export function removeZap(id: string, selector: string) {
  updateBoost(id, (b) => {
    const at = b.zaps.map((z) => z.selector).lastIndexOf(selector);
    return at < 0 ? {} : { zaps: b.zaps.filter((_, i) => i !== at) };
  });
}

export function siteBoostFor(url: string, create: boolean): Boost | null {
  const site = siteForUrl(url);
  if (!site) return null;
  const { boosts } = useBoosts.getState();
  const found = boosts.find((b) => b.profileId === null && b.site.host === site.host && b.site.path === "" && !b.js.trim()) ?? boosts.find((b) => b.site.host === site.host && b.site.path === "");
  if (found || !create) return found ?? null;
  const boost = newBoost(site);
  return addBoost(boost) ? boost : null;
}
