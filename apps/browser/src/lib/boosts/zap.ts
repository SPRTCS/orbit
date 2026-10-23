import { create } from "zustand";
import { addZap, removeZap, siteBoostFor, updateBoost } from "../../store/boosts";
import { useBrowser } from "../../store/browser";
import { webviews } from "../webviews";
import { urlParts } from "./model";
import { zapScript, type ZapAnswer } from "./pageScripts";

export type ZapSession = { tabId: string; boostId: string; url: string; zapped: number };

export const useZap = create<{ session: ZapSession | null }>(() => ({ session: null }));

const KEY = `orbitzap${Math.random().toString(36).slice(2)}`;
const pageOf = (url: string) => url.replace(/#.*$/, "");
let token = 0;
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  useBrowser.subscribe((s, prev) => {
    const session = useZap.getState().session;
    if (!session || s.tabs === prev.tabs) return;
    const tab = s.tabs[session.tabId];
    if (!tab || pageOf(tab.url) !== pageOf(session.url)) stopZap();
  });
}

export function zapping(tabId?: string | null): boolean {
  const session = useZap.getState().session;
  return !!session && (!tabId || session.tabId === tabId);
}

export function startZap(tabId: string): boolean {
  const tab = useBrowser.getState().tabs[tabId];
  const view = webviews.get(tabId);
  if (!tab || !view || !/^https?:\/\//i.test(tab.url)) return false;
  if (zapping(tabId)) return true;
  stopZap();
  const boost = siteBoostFor(tab.url, true);
  if (!boost) return false;
  if (!boost.enabled) updateBoost(boost.id, { enabled: true });
  watch();
  useZap.setState({ session: { tabId, boostId: boost.id, url: tab.url, zapped: 0 } });
  void arm(++token);
  return true;
}

async function arm(mine: number) {
  const session = useZap.getState().session;
  const view = session ? webviews.get(session.tabId) : undefined;
  if (!session || !view) return end(mine);
  const answer = await view.evaluate<ZapAnswer>(zapScript(KEY, { host: urlParts(session.url)?.host.replace(/^www\./, "") }));
  if (mine !== token) return;
  const current = useZap.getState().session;
  if (!answer || !current) return end(mine);
  if (answer.kind === "zap") {
    addZap(current.boostId, { selector: answer.selector, label: answer.label });
    useZap.setState({ session: { ...current, zapped: current.zapped + 1 } });
  } else if (answer.kind === "undo") {
    removeZap(current.boostId, answer.selector);
    useZap.setState({ session: { ...current, zapped: Math.max(0, current.zapped - 1) } });
  } else if (answer.kind === "done") {
    return stopZap();
  } else return;
  void arm(mine);
}

function end(mine: number) {
  if (mine === token) useZap.setState({ session: null });
}

export function stopZap() {
  const session = useZap.getState().session;
  if (!session) return;
  token++;
  useZap.setState({ session: null });
  void webviews.get(session.tabId)?.evaluate(zapScript(KEY, { stop: true }));
}
