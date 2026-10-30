import { keychainDelete, keychainGet, keychainSet, onAppEvent, readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { forgetAiSecret, registerAiSecret } from "./errors";
import type { AiProvider } from "./providers";

export type OpenAiPreset = "ollama" | "lmstudio" | "custom";

export type AiSettings = {
  enabled: boolean;
  provider: AiProvider;
  anthropic: { chatModel: string; quickModel: string };
  openai: { preset: OpenAiPreset; baseUrl: string; chatModel: string; quickModel: string };
  includePage: boolean;
  panelWidth: number;
  nameGroups: boolean;
  tidyDownloads: boolean;
};

export const DEFAULT_ANTHROPIC_CHAT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_ANTHROPIC_QUICK_MODEL = "claude-haiku-5-5";

export const OPENAI_PRESETS: Record<OpenAiPreset, { title: string; baseUrl: string }> = {
  ollama: { title: "Ollama (on this Mac)", baseUrl: "http://localhost:11434/v1" },
  lmstudio: { title: "LM Studio (on this Mac)", baseUrl: "http://localhost:1234/v1" },
  custom: { title: "Custom endpoint", baseUrl: "" },
};

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 640;
export const PANEL_DEFAULT_WIDTH = 380;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "anthropic",
  anthropic: { chatModel: DEFAULT_ANTHROPIC_CHAT_MODEL, quickModel: DEFAULT_ANTHROPIC_QUICK_MODEL },
  openai: { preset: "ollama", baseUrl: OPENAI_PRESETS.ollama.baseUrl, chatModel: "", quickModel: "" },
  includePage: true,
  panelWidth: PANEL_DEFAULT_WIDTH,
  nameGroups: true,
  tidyDownloads: false,
};

const FILE = "ai-settings.json";
const SAVE_DELAY_MS = 400;
const MAX_FIELD = 300;

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v.trim().slice(0, MAX_FIELD) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function readAiSettings(raw: string | null | undefined): AiSettings {
  let json: Record<string, any> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed;
  } catch {}
  const d = DEFAULT_AI_SETTINGS;
  const a = json.anthropic && typeof json.anthropic === "object" ? json.anthropic : {};
  const o = json.openai && typeof json.openai === "object" ? json.openai : {};
  const preset: OpenAiPreset = o.preset === "ollama" || o.preset === "lmstudio" || o.preset === "custom" ? o.preset : d.openai.preset;
  const width = typeof json.panelWidth === "number" && Number.isFinite(json.panelWidth) ? json.panelWidth : d.panelWidth;
  return {
    enabled: bool(json.enabled, d.enabled),
    provider: json.provider === "openai" ? "openai" : "anthropic",
    anthropic: {
      chatModel: str(a.chatModel, d.anthropic.chatModel) || d.anthropic.chatModel,
      quickModel: str(a.quickModel, d.anthropic.quickModel) || d.anthropic.quickModel,
    },
    openai: {
      preset,
      baseUrl: str(o.baseUrl, OPENAI_PRESETS[preset].baseUrl),
      chatModel: str(o.chatModel, ""),
      quickModel: str(o.quickModel, ""),
    },
    includePage: bool(json.includePage, d.includePage),
    panelWidth: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width))),
    nameGroups: bool(json.nameGroups, d.nameGroups),
    tidyDownloads: bool(json.tidyDownloads, d.tidyDownloads),
  };
}

export const writeAiSettings = (settings: AiSettings) => JSON.stringify(settings, null, 2);

type KeyState = { anthropic: boolean | null; openai: boolean | null };

export type AiState = AiSettings & { loaded: boolean; keys: KeyState };

export const useAiSettings = create<AiState>(() => ({ ...DEFAULT_AI_SETTINGS, loaded: false, keys: { anthropic: null, openai: null } }));

const settingsOf = ({ loaded: _loaded, keys: _keys, ...settings }: AiState): AiSettings => settings;

export const aiSettings = (): AiSettings => settingsOf(useAiSettings.getState());

export const aiEnabled = (): boolean => {
  const s = useAiSettings.getState();
  return s.loaded && s.enabled;
};

export const useAiEnabled = (): boolean => useAiSettings((s) => s.loaded && s.enabled);

export function subscribeAiSettings(listener: (settings: AiSettings, previous: AiSettings) => void): () => void {
  return useAiSettings.subscribe((s, prev) => {
    if (s === prev) return;
    listener(settingsOf(s), settingsOf(prev));
  });
}

export function updateAiSettings(patch: Partial<AiSettings> | ((s: AiSettings) => Partial<AiSettings>)) {
  useAiSettings.setState((s) => {
    const changes = typeof patch === "function" ? patch(settingsOf(s)) : patch;
    const next = readAiSettings(JSON.stringify({ ...settingsOf(s), ...changes }));
    return { ...next };
  });
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saved = "";
let started = false;

function save() {
  saveTimer = undefined;
  const json = writeAiSettings(aiSettings());
  if (json === saved) return;
  saved = json;
  try {
    writeDocument(FILE, json);
  } catch (error) {
    console.warn(`Couldn't save ${FILE}`, error);
  }
}

export function loadAiSettings() {
  if (useAiSettings.getState().loaded) return;
  let raw: string | null = null;
  try {
    raw = readDocument(FILE);
  } catch (error) {
    console.warn(`Couldn't read ${FILE}`, error);
  }
  const settings = readAiSettings(raw);
  saved = raw ? writeAiSettings(settings) : "";
  useAiSettings.setState({ ...settings, loaded: true });
}

export function startAiSettings() {
  if (started) return;
  started = true;
  loadAiSettings();
  useAiSettings.subscribe((s, prev) => {
    if (s === prev || !s.loaded) return;
    if (s.enabled !== prev.enabled) return flushAiSettings(true);
    saveTimer ??= setTimeout(save, SAVE_DELAY_MS);
  });
  onAppEvent((e) => {
    if (e.type === "willQuit") flushAiSettings();
  });
}

export function flushAiSettings(force = false) {
  if (!saveTimer && !force) return;
  clearTimeout(saveTimer);
  save();
}

let offController = new AbortController();
const disabledListeners = new Set<() => void>();

export const aiAbortSignal = (): AbortSignal => offController.signal;

export function onAiDisabled(listener: () => void): () => void {
  disabledListeners.add(listener);
  return () => disabledListeners.delete(listener);
}

useAiSettings.subscribe((s, prev) => {
  if (!(prev.loaded && prev.enabled) || (s.loaded && s.enabled)) return;
  const was = offController;
  offController = new AbortController();
  was.abort();
  for (const listener of [...disabledListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("AI off listener failed", error);
    }
  }
});

const account = (provider: AiProvider) => `ai.${provider}`;
const keyCache = new Map<AiProvider, string | null>();

export async function aiKey(provider: AiProvider): Promise<string | null> {
  if (keyCache.has(provider)) return keyCache.get(provider) ?? null;
  const key = (await keychainGet(account(provider)).catch(() => null)) || null;
  registerAiSecret(key);
  keyCache.set(provider, key);
  useAiSettings.setState((s) => ({ keys: { ...s.keys, [provider]: !!key } }));
  return key;
}

export async function setAiKey(provider: AiProvider, key: string | null): Promise<boolean> {
  const value = key?.trim() ?? "";
  const ok = value ? await keychainSet(account(provider), value).catch(() => false) : await keychainDelete(account(provider)).catch(() => false);
  if (ok) {
    if (value) registerAiSecret(value);
    else forgetAiSecret(keyCache.get(provider));
    keyCache.set(provider, value || null);
    useAiSettings.setState((s) => ({ keys: { ...s.keys, [provider]: !!value } }));
  }
  return ok;
}

export const refreshAiKeys = () => Promise.all([aiKey("anthropic"), aiKey("openai")]).then(() => undefined);

export function maskKey(key: string): string {
  const k = key.trim();
  return k.length <= 10 ? "••••" : `${k.slice(0, 7)}…${k.slice(-4)}`;
}
