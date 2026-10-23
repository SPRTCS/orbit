import { confirm, copyText, openWindow, type BrowserCommand } from "@ardia/shell";
import { create } from "zustand";
import { BOOSTS_WINDOW_ID } from "../../components/settings/windows";
import { addBoost, boostById, newBoost, siteBoostFor, updateBoost, useBoosts } from "../../store/boosts";
import { useBrowser } from "../../store/browser";
import { activeTabId, newId, resolveWindowId } from "../../store/model";
import { exportBoost, exportFileName, importBoost, siteForUrl, type Boost } from "./model";
import { openBoostFile, pasteboardText, saveBoostFile } from "./native";
import { startZap, stopZap, zapping } from "./zap";


export { BOOSTS_WINDOW_ID };

export const useBoostsWindow = create<{ selected: string | null }>(() => ({ selected: null }));

export function openBoosts(select?: string | null) {
  if (select !== undefined) useBoostsWindow.setState({ selected: select });
  void openWindow(BOOSTS_WINDOW_ID, { kind: "boosts", title: "Boosts" });
}

export function currentPageTab(windowId?: string | null) {
  const s = useBrowser.getState();
  const w = resolveWindowId(s, windowId);
  const tabId = w ? activeTabId(s, w) : undefined;
  const tab = tabId ? s.tabs[tabId] : undefined;
  return tab && /^https?:\/\//i.test(tab.url) ? tab : undefined;
}

export function toggleZap(tabId: string | undefined): boolean {
  if (!tabId) return false;
  if (zapping(tabId)) {
    stopZap();
    return true;
  }
  return startZap(tabId);
}

export function newBoostForSite(url: string | undefined): string | null {
  const site = url ? siteForUrl(url) : null;
  if (!site) return null;
  const same = useBoosts.getState().boosts.filter((b) => b.site.host === site.host).length;
  return addBoost(newBoost(site, same ? { name: `${site.host} (${same + 1})` } : {}));
}

export function runBoostCommand(command: BrowserCommand, windowId: string | null): boolean {
  switch (command) {
    case "zapElements":
      toggleZap(currentPageTab(windowId)?.id);
      return true;
    case "showBoosts":
      openBoosts(siteBoostFor(currentPageTab(windowId)?.url ?? "", false)?.id ?? undefined);
      return true;
    case "newBoost": {
      const id = newBoostForSite(currentPageTab(windowId)?.url);
      openBoosts(id ?? undefined);
      return true;
    }
  }
  return false;
}

export const copyBoost = (boost: Boost) => copyText(exportBoost(boost));

export const exportBoostFile = (boost: Boost) => saveBoostFile(exportFileName(boost), exportBoost(boost));

export async function allowBoostScript(id: string, windowId = BOOSTS_WINDOW_ID): Promise<boolean> {
  const boost = boostById(id);
  if (!boost) return false;
  const { confirmed } = await confirm({
    title: `Allow JavaScript in “${boost.name}”?`,
    message: `It will run on ${boost.site.host}${boost.site.subdomains ? " and its subdomains" : ""} and can read and change everything on those pages, including what you type. Only allow code you've read and trust.`,
    confirmTitle: "Allow JavaScript",
    cancelTitle: "Don't Allow",
    windowId,
  });
  if (confirmed) updateBoost(id, { jsAllowed: true });
  return confirmed;
}

export type ImportResult = { id: string } | { error: string } | { cancelled: true };

export async function importBoostText(text: string, options: { ask: boolean; allowJs?: boolean; windowId?: string } = { ask: true }): Promise<ImportResult> {
  const windowId = options.windowId ?? BOOSTS_WINDOW_ID;
  const parsed = importBoost(text, newId("boost"));
  if ("error" in parsed) return parsed;
  const { boost, summary, hasJs } = parsed;
  let allowJs = !!options.allowJs;
  if (options.ask) {
    const { confirmed } = await confirm({
      title: `Import the boost “${boost.name}”?`,
      message: `${summary.map((line) => `• ${line}`).join("\n")}${hasJs ? "\n\nIts JavaScript won't run unless you allow it next." : ""}`,
      confirmTitle: "Import",
      windowId,
    });
    if (!confirmed) return { cancelled: true };
    if (hasJs) {
      allowJs = (
        await confirm({
          title: "Allow this boost's JavaScript to run?",
          message: `It will run on ${boost.site.host}${boost.site.subdomains ? " and its subdomains" : ""} and can read and change everything on those pages, including what you type. Only allow code you've read and trust. You can allow it later in Boosts.`,
          confirmTitle: "Allow JavaScript",
          cancelTitle: "Don't Allow",
          windowId,
        })
      ).confirmed;
    }
  }
  const id = addBoost({ ...boost, jsAllowed: hasJs ? allowJs : false });
  if (!id) return { error: "You have too many boosts. Delete some first." };
  useBoostsWindow.setState({ selected: id });
  return { id };
}

export async function importBoostFile(): Promise<ImportResult> {
  try {
    const text = await openBoostFile();
    return text === null ? { cancelled: true } : importBoostText(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function importBoostFromClipboard(): Promise<ImportResult> {
  const text = pasteboardText();
  if (!text?.trim()) return { error: "The clipboard has no boost on it. Copy a boost's text first." };
  return importBoostText(text);
}
