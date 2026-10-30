import type { CommandAction } from "@ardia/core";
import { useBrowser } from "../../store/browser";
import { activeTab } from "../../store/model";
import { aiEnabled } from "./settings";
import { canTidyWindow, pinnedTabIds } from "./tidyScope";

export function aiBarActions(windowId: string): CommandAction[] {
  if (!aiEnabled()) return [];
  const s = useBrowser.getState();
  const tab = activeTab(s, windowId);
  const page = !!tab && /^(https?|file):/i.test(tab.url);
  return [
    { id: "askOrbit", title: "Ask Orbit…", icon: "sparkles", hint: "⌘E", keywords: ["chat", "ai", "assistant", "ask", "claude"] },
    ...(page ? [{ id: "summarizePage", title: "Summarize This Page", icon: "text.alignleft", keywords: ["summary", "tldr", "ai", "chat"] }] : []),
    ...(canTidyWindow(s, windowId)
      ? [
          { id: "tidyTabs", title: "Tidy Tabs", icon: "wand.and.stars", keywords: ["group tabs", "organize tabs", "ai", "sort tabs"] },
          { id: "tidyTabs:all", title: "Tidy Tabs: Regroup All", icon: "wand.and.stars", keywords: ["regroup tabs", "organize tabs", "ai"] },
          ...(pinnedTabIds(s, windowId).length ? [{ id: "tidyTabTitles", title: "Tidy Pinned Tab Titles", icon: "wand.and.stars", keywords: ["rename pinned tabs", "shorten titles", "ai"] }] : []),
        ]
      : []),
  ];
}
