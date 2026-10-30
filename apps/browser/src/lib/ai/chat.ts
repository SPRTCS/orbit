import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { activeTabId, newId } from "../../store/model";
import { webviews } from "../webviews";
import { streamText } from "./client";
import { AiError, isAiError } from "./errors";
import { readPageContext, READ_PAGE_SCRIPT, type PageContext } from "./pageScript";
import { chatMessages, chatSystemPrompt, QUICK_PROMPTS, type ChatTurn, type QuickPrompt } from "./prompt";
import { aiEnabled, aiSettings, subscribeAiSettings } from "./settings";

export type WindowChat = {
  open: boolean;
  turns: ChatTurn[];
  draft: string;
  quote: string | null;
  includePage: boolean | null;
  focusRequest: number;
  busy: boolean;
};

const EMPTY: WindowChat = { open: false, turns: [], draft: "", quote: null, includePage: null, focusRequest: 0, busy: false };
const PAGE_TIMEOUT_MS = 9000;
const FLUSH_MS = 40;
const QUOTE_LIMIT = 4000;

export const useChats = create<Record<string, WindowChat>>(() => ({}));

const controllers = new Map<string, AbortController>();

export const chatOf = (windowId: string): WindowChat => useChats.getState()[windowId] ?? EMPTY;

function patch(windowId: string, change: Partial<WindowChat> | ((c: WindowChat) => Partial<WindowChat>)) {
  useChats.setState((all) => {
    const current = all[windowId] ?? EMPTY;
    const next = typeof change === "function" ? change(current) : change;
    return { [windowId]: { ...current, ...next } };
  });
}

function patchTurn(windowId: string, turnId: string, change: Partial<ChatTurn>) {
  patch(windowId, (c) => ({ turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...change } : t)) }));
}

const isBrowserWindow = (windowId: string | null | undefined): windowId is string => {
  const w = windowId ? useBrowser.getState().windows[windowId] : undefined;
  return !!w && w.kind !== "small";
};

export const includesPage = (chat: WindowChat) => chat.includePage ?? aiSettings().includePage;

export function openChat(windowId: string, focus = true) {
  if (!aiEnabled() || !isBrowserWindow(windowId)) return;
  patch(windowId, (c) => ({ open: true, focusRequest: focus ? Date.now() : c.focusRequest }));
}

export function closeChat(windowId: string) {
  patch(windowId, { open: false });
}

export function toggleChat(windowId: string) {
  if (chatOf(windowId).open) closeChat(windowId);
  else openChat(windowId);
}

export const setChatDraft = (windowId: string, draft: string) => patch(windowId, { draft });
export const setChatQuote = (windowId: string, quote: string | null) => patch(windowId, { quote });
export const setIncludePage = (windowId: string, includePage: boolean) => patch(windowId, { includePage });

export function stopChat(windowId: string) {
  controllers.get(windowId)?.abort();
}

export function newChat(windowId: string) {
  stopChat(windowId);
  patch(windowId, (c) => ({ turns: [], quote: null, draft: "", busy: false, focusRequest: c.open ? Date.now() : c.focusRequest }));
}

const timeout = <T,>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

export async function readActivePage(windowId: string): Promise<PageContext | null> {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  if (!tab || !/^(https?|file):/i.test(tab.url)) return null;
  const web = webviews.get(tab.id);
  if (!web) return null;
  const raw = await Promise.race([web.evaluate<unknown>(READ_PAGE_SCRIPT).catch(() => null), timeout(PAGE_TIMEOUT_MS, null)]);
  return readPageContext(raw, { title: tab.customTitle || tab.title, url: tab.url });
}

export function activePageLabel(windowId: string): { title: string; url: string } | null {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  if (!tab || !/^(https?|file):/i.test(tab.url)) return null;
  return { title: tab.customTitle || tab.title || tab.url, url: tab.url };
}

function takeController(windowId: string): AbortController {
  const controller = new AbortController();
  controllers.get(windowId)?.abort();
  controllers.set(windowId, controller);
  return controller;
}

function release(windowId: string, controller: AbortController) {
  if (controllers.get(windowId) !== controller) return;
  controllers.delete(windowId);
  patch(windowId, { busy: false });
}

const whenAborted = (signal: AbortSignal) =>
  new Promise<null>((resolve) => (signal.aborted ? resolve(null) : signal.addEventListener("abort", () => resolve(null), { once: true })));

async function answer(windowId: string, assistantId: string, controller = takeController(windowId)) {
  const chat = chatOf(windowId);
  const at = chat.turns.findIndex((t) => t.id === assistantId);
  const history = chat.turns.slice(0, at < 0 ? chat.turns.length : at);
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (controllers.get(windowId) === controller) patchTurn(windowId, assistantId, { text });
  };
  patch(windowId, { busy: true });
  try {
    await streamText({ system: chatSystemPrompt(), messages: chatMessages(history), model: "chat", signal: controller.signal }, (delta) => {
      text += delta;
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    clearTimeout(timer);
    patchTurn(windowId, assistantId, { text, status: "done", error: null, errorCode: null });
  } catch (error) {
    clearTimeout(timer);
    const e = isAiError(error) ? error : new AiError("server", error instanceof Error ? error.message : String(error));
    if (controllers.get(windowId) !== controller && e.code !== "aborted") return;
    patchTurn(windowId, assistantId, e.code === "aborted" ? { text, status: "stopped" } : { text, status: "error", error: e.message, errorCode: e.code });
  } finally {
    release(windowId, controller);
  }
}

export async function sendChat(windowId: string, text?: string, options: { includePage?: boolean } = {}) {
  if (!aiEnabled() || !isBrowserWindow(windowId)) return;
  const chat = chatOf(windowId);
  if (chat.busy) return;
  const prompt = (text ?? chat.draft).trim();
  const quote = chat.quote?.trim() ? chat.quote.trim().slice(0, QUOTE_LIMIT) : null;
  if (!prompt && !quote) return;
  const userId = newId("chat");
  const assistantId = newId("chat");
  const wantsPage = options.includePage ?? includesPage(chat);
  const label = wantsPage ? activePageLabel(windowId) : null;
  const pending: PageContext | null = label ? { ...label, description: "", text: "", transcript: null, truncated: false } : null;
  patch(windowId, (c) => ({
    open: true,
    draft: text === undefined ? "" : c.draft,
    quote: null,
    busy: true,
    turns: [...c.turns, { id: userId, role: "user", text: prompt, quote, page: pending }, { id: assistantId, role: "assistant", text: "", status: "streaming" }],
  }));
  const controller = takeController(windowId);
  if (pending) {
    const page = await Promise.race([readActivePage(windowId), whenAborted(controller.signal)]);
    if (!controller.signal.aborted) patchTurn(windowId, userId, { page: page ?? pending });
  }
  if (controller.signal.aborted || !aiEnabled()) {
    if (chatOf(windowId).turns.some((t) => t.id === assistantId)) patchTurn(windowId, assistantId, { status: "stopped" });
    release(windowId, controller);
    return;
  }
  if (!chatOf(windowId).turns.some((t) => t.id === assistantId)) return release(windowId, controller);
  await answer(windowId, assistantId, controller);
}

export async function retryChat(windowId: string) {
  const chat = chatOf(windowId);
  if (chat.busy) return;
  const lastUser = chat.turns.map((t) => t.role).lastIndexOf("user");
  if (lastUser < 0) return;
  const assistantId = newId("chat");
  patch(windowId, (c) => ({ busy: true, turns: [...c.turns.slice(0, lastUser + 1), { id: assistantId, role: "assistant", text: "", status: "streaming" }] }));
  await answer(windowId, assistantId);
}

export function sendQuickPrompt(windowId: string, kind: QuickPrompt) {
  return sendChat(windowId, QUICK_PROMPTS[kind].prompt, { includePage: true });
}

export function summarizePage(windowId: string) {
  if (!aiEnabled() || !isBrowserWindow(windowId)) return;
  openChat(windowId, false);
  void sendQuickPrompt(windowId, "summarize");
}

export function askAboutSelection(tabId: string, text: string) {
  const tab = useBrowser.getState().tabs[tabId];
  const quote = text.trim();
  if (!tab || !quote || !aiEnabled() || !isBrowserWindow(tab.windowId)) return;
  patch(tab.windowId, { quote: quote.slice(0, QUOTE_LIMIT) });
  openChat(tab.windowId);
}

let started = false;

export function startAiChats() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows) return;
    const gone = Object.keys(useChats.getState()).filter((id) => !s.windows[id]);
    if (!gone.length) return;
    for (const id of gone) stopChat(id);
    useChats.setState((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !gone.includes(id))), true);
  });
  subscribeAiSettings((settings, previous) => {
    if (settings.enabled || !previous.enabled) return;
    for (const id of controllers.keys()) stopChat(id);
    useChats.setState((all) => Object.fromEntries(Object.entries(all).map(([id, c]) => [id, { ...c, open: false }])), true);
  });
}
