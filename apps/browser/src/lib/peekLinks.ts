import { useEffect } from "react";
import { useBrowser, type BrowserState } from "../store/browser";
import { openPeek, peekConfig } from "./peek";
import { peekLinkScript, type PeekLinkAnswer } from "./peekSites";
import { webviews } from "./webviews";

const SIGNAL = `orbitpeek${Math.random().toString(36).slice(2)}`;
const RETRY_MS = 400;
const RETRIES = 6;

type Armed = { key: string; token: number };

const watched = new Map<string, number>();
const armed = new Map<string, Armed>();
let tokens = 0;
let started = false;

function armKey(s: BrowserState, tabId: string): string | null {
  const config = peekConfig(s, tabId);
  if (!config) return null;
  return JSON.stringify([config, s.tabs[tabId]!.url.replace(/#.*$/, ""), !!s.live[tabId]?.isLoading]);
}

function disarm(tabId: string) {
  if (!armed.delete(tabId)) return;
  void webviews.get(tabId)?.executeJavaScript(`dispatchEvent(new Event(${JSON.stringify(SIGNAL)}))`);
}

function arm(tabId: string, retries = 0) {
  const s = useBrowser.getState();
  const config = peekConfig(s, tabId);
  const key = armKey(s, tabId);
  const view = webviews.get(tabId);
  if (!config || !key || !view) return disarm(tabId);
  if (armed.get(tabId)?.key === key) return;
  const token = ++tokens;
  armed.set(tabId, { key, token });
  void view.evaluate<PeekLinkAnswer>(peekLinkScript(config, SIGNAL)).then(
    (answer) => {
      if (armed.get(tabId)?.token !== token) return;
      if (answer && "url" in answer && typeof answer.url === "string") {
        armed.delete(tabId);
        openPeek(tabId, answer.url);
        return arm(tabId);
      }
      if (answer) return;
      if (!watched.has(tabId) || retries >= RETRIES) return void armed.delete(tabId);
      setTimeout(() => {
        if (armed.get(tabId)?.token !== token) return;
        armed.delete(tabId);
        arm(tabId, retries + 1);
      }, RETRY_MS);
    },
    () => {
      if (armed.get(tabId)?.token === token) armed.delete(tabId);
    },
  );
}

function startPeekLinks() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.live === prev.live && s.settings === prev.settings && s.groups === prev.groups) return;
    for (const id of armed.keys()) if (!s.tabs[id]) armed.delete(id);
    for (const id of watched.keys()) if (armKey(s, id) !== (armed.get(id)?.key ?? null)) arm(id);
  });
}

export function usePeekLinks(tabId: string, visible: boolean) {
  useEffect(() => {
    if (!visible) return;
    startPeekLinks();
    watched.set(tabId, (watched.get(tabId) ?? 0) + 1);
    arm(tabId);
    return () => {
      const left = (watched.get(tabId) ?? 1) - 1;
      if (left > 0) watched.set(tabId, left);
      else watched.delete(tabId);
    };
  }, [tabId, visible]);
}
