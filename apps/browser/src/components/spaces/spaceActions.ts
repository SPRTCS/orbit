import { openWindow, prompt, type MenuItem } from "@ardia/shell";
import { create } from "zustand";
import { saveSession } from "../../lib/spaceSessions";
import { checkSubscription, unsubscribeSpace, useSpaceSubscriptions } from "../../lib/spaceSubscriptions";
import { currentSpaceId, mainWindowId } from "../../lib/spaces";
import { copySpaceText, exportSpace, importSpaceFromClipboard, pickSpaceFile } from "./spaceFiles";
import { useBrowser } from "../../store/browser";
import { showToast } from "../layout/splitActions";
import { SESSIONS_WINDOW_ID } from "../settings/windows";

export const useSessionsView = create<{ profileId: string | null; tab: "sessions" | "timeline" }>(() => ({ profileId: null, tab: "sessions" }));

export function openSessionsWindow(profileId?: string | null, tab?: "sessions" | "timeline") {
  useSessionsView.setState((v) => ({ profileId: profileId ?? currentSpaceId() ?? v.profileId, tab: tab ?? v.tab }));
  void openWindow(SESSIONS_WINDOW_ID, { kind: "sessions", title: "Sessions" });
}

export const defaultSessionName = (spaceName: string, now = Date.now()) =>
  `${spaceName} — ${new Date(now).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;

export async function promptSaveSession(profileId: string | null, windowId?: string | null): Promise<string | null> {
  const s = useBrowser.getState();
  const space = profileId ? s.profiles[profileId] : undefined;
  if (!profileId || !space) return null;
  const name = await prompt({
    title: "Save Session",
    message: `Saves the pinned tabs, folders and today tabs of “${space.name}” so you can bring them back later.`,
    value: defaultSessionName(space.name),
    confirmTitle: "Save",
    windowId: windowId ?? undefined,
  });
  if (!name) return null;
  const session = saveSession(profileId, name);
  const target = mainWindowId(useBrowser.getState(), windowId);
  if (session && target) showToast(target, `Saved “${session.name}”`, undefined, { icon: "clock.arrow.circlepath", action: { title: "Show", run: () => openSessionsWindow(profileId, "sessions") } });
  return session?.id ?? null;
}

const PREFIX = "space:";
const sep = { separator: true } as const;

export function spaceMenuItems(profileId: string): MenuItem[] {
  const sub = useSpaceSubscriptions.getState().subs[profileId];
  return [
    sep,
    {
      id: `${PREFIX}share`,
      title: "Share Space",
      symbol: "square.and.arrow.up",
      children: [
        { id: `${PREFIX}export`, title: "Export as File…" },
        { id: `${PREFIX}exportToday`, title: "Export with Today Tabs…" },
        { id: `${PREFIX}copy`, title: "Copy as Text" },
      ],
    },
    { id: `${PREFIX}saveSession`, title: "Save Session…", symbol: "tray.and.arrow.down" },
    { id: `${PREFIX}sessions`, title: "Sessions & Timeline…", symbol: "clock.arrow.circlepath" },
    ...(sub
      ? [
          sep,
          { id: `${PREFIX}subscribed`, title: `Subscribed to ${decodeURIComponent(sub.url.split("/").pop() ?? "a shared file")}`, enabled: false },
          { id: `${PREFIX}check`, title: "Check for Updates Now", symbol: "arrow.clockwise" },
          { id: `${PREFIX}unsubscribe`, title: "Unsubscribe", symbol: "xmark.circle" },
        ]
      : []),
  ];
}

export function runSpaceMenu(choice: string, profileId: string, windowId?: string | null): boolean {
  if (!choice.startsWith(PREFIX)) return false;
  const action = choice.slice(PREFIX.length);
  if (action === "export") void exportSpace(profileId, { windowId });
  else if (action === "exportToday") void exportSpace(profileId, { windowId, today: true });
  else if (action === "copy") copySpaceText(profileId, windowId);
  else if (action === "saveSession") void promptSaveSession(profileId, windowId);
  else if (action === "sessions") openSessionsWindow(profileId);
  else if (action === "check") void checkSubscription(profileId, true);
  else if (action === "unsubscribe") unsubscribeSpace(profileId);
  return true;
}

export function runSpaceCommand(command: string, arg: string | null, requested: string | null): boolean {
  const windowId = mainWindowId(useBrowser.getState(), requested) ?? null;
  const profileId = currentSpaceId(windowId);
  switch (command) {
    case "shareSpace":
      if (!profileId) return true;
      if (arg === "text") copySpaceText(profileId, windowId);
      else void exportSpace(profileId, { windowId, today: arg === "today" });
      return true;
    case "importSpace":
      if (arg === "clipboard") void importSpaceFromClipboard();
      else void pickSpaceFile();
      return true;
    case "subscribeSpace":
      void pickSpaceFile({ subscribe: true });
      return true;
    case "saveSession":
      void promptSaveSession(profileId, windowId);
      return true;
    case "showSessions":
      openSessionsWindow(profileId, arg === "timeline" ? "timeline" : undefined);
      return true;
  }
  return false;
}
