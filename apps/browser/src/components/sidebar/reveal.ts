import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { groupOf } from "../../store/organize";

const revealers = new Map<string, () => void>();

export function onRevealTab(windowId: string, reveal: () => void) {
  revealers.set(windowId, reveal);
  return () => {
    if (revealers.get(windowId) === reveal) revealers.delete(windowId);
  };
}

export function revealActiveTab(windowId: string) {
  const s = useBrowser.getState();
  const group = groupOf(s, activeTabId(s, windowId));
  if (group?.collapsed) s.updateGroup(group.id, { collapsed: false });
  revealers.get(windowId)?.();
}
