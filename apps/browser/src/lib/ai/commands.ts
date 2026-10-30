import { openSettings } from "../../components/settings/windows";
import { useBrowser } from "../../store/browser";
import { resolveWindowId } from "../../store/model";
import { openChat, summarizePage, toggleChat } from "./chat";
import { aiEnabled } from "./settings";
import { tidyRunner } from "./tidyScope";

const AI_COMMANDS = new Set(["toggleChat", "askOrbit", "summarizePage", "tidyTabs", "tidyTabTitles"]);

export function runAiCommand(command: string, arg: string | null | undefined, requested: string | null | undefined): boolean {
  if (command === "openSettings" && arg === "ai") {
    openSettings("ai");
    return true;
  }
  if (!AI_COMMANDS.has(command)) return false;
  if (!aiEnabled()) return true;
  const windowId = resolveWindowId(useBrowser.getState(), requested);
  if (!windowId) return true;
  if (command === "tidyTabs") tidyRunner()?.tidyTabs(windowId, arg === "all");
  else if (command === "tidyTabTitles") tidyRunner()?.tidyTitles(windowId);
  else if (command === "toggleChat") toggleChat(windowId);
  else if (command === "askOrbit") openChat(windowId);
  else summarizePage(windowId);
  return true;
}
