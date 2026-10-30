export const AI_MENU_COMMANDS = ["toggleChat"];

const CHAT_SHORTCUT = ["e", "command"];

const sameShortcut = (a: string[] | undefined, b: string[]) =>
  !!a && a[0] === b[0] && a.length === b.length && b.slice(1).every((m) => a.includes(m));

export function aiShortcuts(user: Record<string, string[]>, on: boolean): Record<string, string[]> {
  if (!on) return user;
  const out = { ...user };
  if (!("toggleChat" in user)) out.toggleChat = CHAT_SHORTCUT;
  if (!("useSelectionForFind" in user) && sameShortcut(out.toggleChat, CHAT_SHORTCUT)) out.useSelectionForFind = [];
  return out;
}

export const aiShownMenuItems = (on: boolean): string[] => (on ? AI_MENU_COMMANDS : []);
