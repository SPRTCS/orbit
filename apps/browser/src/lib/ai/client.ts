import { AiError, disabledError, noKeyError } from "./errors";
import { ANTHROPIC_BASE_URL, type AiMessage, type AiModelKind, type ProviderConfig } from "./providers";
import { runModelList, runStream, type RunResult } from "./run";
import { aiAbortSignal, aiEnabled, aiKey, aiSettings, onAiDisabled, useAiSettings, type AiSettings } from "./settings";
import { defaultTransport, type Transport } from "./transport";

export { aiAbortSignal, onAiDisabled };

export type AiRequest = {
  system?: string;
  messages: AiMessage[];
  model?: AiModelKind;
  maxTokens?: number;
  signal?: AbortSignal;
};

let transportOverride: Transport | undefined;

export function setAiTransport(transport: Transport | undefined) {
  transportOverride = transport;
}

const guardedTransport: Transport = (request, options) => {
  if (!aiEnabled()) return Promise.reject(disabledError());
  const off = aiAbortSignal();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort);
  off.addEventListener("abort", abort);
  return (transportOverride ?? defaultTransport)(request, { ...options, signal: controller.signal })
    .catch((error) => {
      throw off.aborted ? disabledError() : error;
    })
    .finally(() => {
      options.signal?.removeEventListener("abort", abort);
      off.removeEventListener("abort", abort);
    });
};

export function modelFor(settings: AiSettings, kind: AiModelKind): string {
  if (settings.provider === "anthropic") return kind === "quick" ? settings.anthropic.quickModel : settings.anthropic.chatModel;
  return (kind === "quick" ? settings.openai.quickModel || settings.openai.chatModel : settings.openai.chatModel).trim();
}

export async function resolveAiConfig(kind: AiModelKind = "chat", settings: AiSettings = aiSettings()): Promise<ProviderConfig> {
  if (!useAiSettings.getState().loaded || !settings.enabled) throw disabledError();
  const model = modelFor(settings, kind);
  if (settings.provider === "anthropic") {
    const apiKey = await aiKey("anthropic");
    if (!apiKey) throw noKeyError("anthropic");
    return { provider: "anthropic", baseUrl: ANTHROPIC_BASE_URL, apiKey, model, kind };
  }
  if (!settings.openai.baseUrl.trim()) throw new AiError("badRequest", "Set the server's address in Settings › AI.");
  if (!model) throw new AiError("badModel", "Choose a model in Settings › AI.");
  return { provider: "openai", baseUrl: settings.openai.baseUrl, apiKey: await aiKey("openai"), model, kind };
}

export async function streamText(request: AiRequest, onDelta: (delta: string) => void): Promise<RunResult> {
  const config = await resolveAiConfig(request.model ?? "chat");
  if (request.signal?.aborted) throw new AiError("aborted", "Stopped.");
  return runStream(config, request, { signal: request.signal, onText: onDelta, transport: guardedTransport });
}

export async function complete(request: AiRequest): Promise<string> {
  const { text } = await streamText(request, () => {});
  return text.trim();
}

export async function* stream(request: AiRequest): AsyncGenerator<string, RunResult, void> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  let result: RunResult = { text: "", stopReason: null };
  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  void streamText(request, (delta) => {
    queue.push(delta);
    signal();
  }).then(
    (r) => {
      result = r;
      finished = true;
      signal();
    },
    (error) => {
      failure = error;
      finished = true;
      signal();
    },
  );
  for (;;) {
    while (queue.length) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => (wake = resolve));
  }
  while (queue.length) yield queue.shift()!;
  if (failure) throw failure;
  return result;
}

export async function listAiModels(settings: AiSettings = aiSettings(), signal?: AbortSignal): Promise<string[]> {
  if (!aiEnabled()) throw disabledError();
  const provider = settings.provider;
  const apiKey = await aiKey(provider);
  if (provider === "anthropic" && !apiKey) throw noKeyError("anthropic");
  const baseUrl = provider === "anthropic" ? ANTHROPIC_BASE_URL : settings.openai.baseUrl;
  return runModelList({ provider, baseUrl, apiKey, model: modelFor(settings, "chat") }, { signal, transport: guardedTransport });
}
