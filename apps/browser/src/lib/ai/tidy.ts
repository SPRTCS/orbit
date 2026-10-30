import { groupNamingDebug, startGroupNaming, useGroupNaming } from "./groupNaming";
import { aiDownloadMenuItems, renameDownloadWithAi, startTidyDownloads } from "./tidyDownloads";
import { aiBarActions } from "./barActions";
import { tidyCandidates, tidyTabs, undoTidy, useTidyTabs } from "./tidyTabs";
import { setTidyRunner, pinnedTabIds } from "./tidyScope";
import { aiFolderMenuItems, aiTabMenuItems, folderTabIds, tidyTitles } from "./tidyTitles";
import { useBrowser } from "../../store/browser";

export { aiBarActions, aiDownloadMenuItems, aiFolderMenuItems, aiTabMenuItems, folderTabIds, groupNamingDebug, pinnedTabIds, renameDownloadWithAi, tidyCandidates, tidyTabs, tidyTitles, undoTidy, useGroupNaming, useTidyTabs };

export function startAiTidy() {
  setTidyRunner({
    tidyTabs: (windowId, regroupAll) => void tidyTabs(windowId, { regroupAll }),
    tidyTitles: (windowId) => void tidyTitles(windowId, pinnedTabIds(useBrowser.getState(), windowId)),
  });
  startGroupNaming();
  startTidyDownloads();
}
