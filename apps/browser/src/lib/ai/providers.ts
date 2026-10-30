import { AiError, errorFromType, unknownServerError, type ProviderLabel } from "./errors";

export type AiProvider = "anthropic" | "openai";
export type AiModelKind = "chat" | "quick";
export type AiMessage = { role: "user" | "assistant"; content: string };

export type ProviderConfig = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  kind: AiModelKind;
};

export type HttpRequest = { method: "POST" | "GET"; url: string; headers: Record<string, string>; body: string | null };

export type RequestInput = { system?: string; messages: AiMessage[]; maxTokens?: number };

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2026-10-21";
export const DEFAULT_CHAT_MAX_TOKENS = 16000;
export const DEFAULT_QUICK_MAX_TOKENS = 4096;

export function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = trimSlashes(url);
  if (!trimmed) return trimmed;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const path = withScheme.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  return path ? withScheme : `${withScheme}/v1`;
}

export type HostScope = "loopback" | "network" | "remote";

export function urlHost(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url.trim());
  if (!match) return null;
  const authority = match[1]!.slice(match[1]!.lastIndexOf("@") + 1);
  const host = authority.startsWith("[") ? authority.slice(1, authority.indexOf("]")) : authority.replace(/:\d*$/, "");
  return host ? host.toLowerCase().replace(/\.$/, "") : null;
}

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

export function hostScope(url: string): HostScope {
  const host = urlHost(url);
  if (!host) return "remote";
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const v4 = ipv4(host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 127 || (a === 0 && v4.every((o) => o === 0))) return "loopback";
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return "network";
    return "remote";
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "loopback";
    if (/^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host)) return "network";
    return "remote";
  }
  if (host.endsWith(".local")) return "network";
  return "remote";
}

export function isLocalUrl(url: string): boolean {
  return hostScope(url) !== "remote";
}

export function labelOf(config: Pick<ProviderConfig, "provider" | "baseUrl" | "model">): ProviderLabel {
  const baseUrl = config.provider === "anthropic" ? config.baseUrl || ANTHROPIC_BASE_URL : config.baseUrl;
  return { provider: config.provider, baseUrl, model: config.model, local: config.provider === "openai" && isLocalUrl(baseUrl) };
}

export function cleanMessages(messages: AiMessage[]): AiMessage[] {
  const out: AiMessage[] = [];
  for (const m of messages) {
    const content = m.content.trim() ? m.content : "";
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) out[out.length - 1] = { role: m.role, content: `${last.content}\n\n${content}` };
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

const CLAUDE_EFFORT_MODELS = /^claude-(opus|sonnet|haiku|fable|mythos)-[5-9]/;

export function effortFor(model: string, kind: AiModelKind): "low" | "medium" | null {
  if (!CLAUDE_EFFORT_MODELS.test(model)) return null;
  return kind === "quick" ? "low" : "medium";
}

export function buildRequest(config: ProviderConfig, input: RequestInput, stream = true): HttpRequest {
  const messages = cleanMessages(input.messages);
  if (!messages.length) throw new AiError("badRequest", "There's nothing to send.");
  if (config.provider === "anthropic") {
    const effort = effortFor(config.model, config.kind);
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: input.maxTokens ?? (config.kind === "quick" ? DEFAULT_QUICK_MAX_TOKENS : DEFAULT_CHAT_MAX_TOKENS),
      ...(input.system ? { system: input.system } : {}),
      messages,
      ...(effort ? { output_config: { effort } } : {}),
      ...(stream ? { stream: true } : {}),
    };
    return {
      method: "POST",
      url: `${trimSlashes(config.baseUrl || ANTHROPIC_BASE_URL)}/v1/messages`,
      headers: {
        "content-type": "application/json",
        accept: stream ? "text/event-stream" : "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": config.apiKey ?? "",
      },
      body: JSON.stringify(body),
    };
  }
  const base = normalizeBaseUrl(config.baseUrl);
  const official = /^https:\/\/api\.openai\.com\//i.test(base);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [...(input.system ? [{ role: "system", content: input.system }] : []), ...messages],
    ...(input.maxTokens ? { [official ? "max_completion_tokens" : "max_tokens"]: input.maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
  };
  return {
    method: "POST",
    url: `${base}/chat/completions`,
    headers: {
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

export function buildModelsRequest(config: Pick<ProviderConfig, "provider" | "baseUrl" | "apiKey">): HttpRequest {
  if (config.provider === "anthropic") {
    return {
      method: "GET",
      url: `${trimSlashes(config.baseUrl || ANTHROPIC_BASE_URL)}/v1/models?limit=100`,
      headers: { "anthropic-version": ANTHROPIC_VERSION, "x-api-key": config.apiKey ?? "" },
      body: null,
    };
  }
  return {
    method: "GET",
    url: `${normalizeBaseUrl(config.baseUrl)}/models`,
    headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
    body: null,
  };
}

export function readModelList(body: string): string[] {
  try {
    const json = JSON.parse(body) as { data?: { id?: unknown }[]; models?: { name?: unknown; model?: unknown }[] };
    const ids = (json.data ?? []).map((m) => m?.id).concat((json.models ?? []).map((m) => m?.model ?? m?.name));
    return [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))];
  } catch {
    return [];
  }
}

export type SseEvent = { event: string | null; data: string };

export class SseParser {
  private buffer = "";
  private event: string | null = null;
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      if (match[0] === "\r" && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.line(line, out);
    }
    return out;
  }

  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer) {
      this.line(this.buffer, out);
      this.buffer = "";
    }
    this.line("", out);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (!line) {
      if (this.data.length) out.push({ event: this.event, data: this.data.join("\n") });
      this.event = null;
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }
}

export type StreamStep = { text?: string; done?: boolean; stopReason?: string; error?: AiError };

function parseJson(data: string): Record<string, any> | null {
  try {
    const json = JSON.parse(data);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

export function anthropicStep(event: SseEvent, label: ProviderLabel): StreamStep {
  const json = parseJson(event.data);
  if (!json) return {};
  switch (json.type) {
    case "content_block_delta":
      return json.delta?.type === "text_delta" && typeof json.delta.text === "string" ? { text: json.delta.text } : {};
    case "message_delta":
      return typeof json.delta?.stop_reason === "string" ? { stopReason: json.delta.stop_reason } : {};
    case "message_stop":
      return { done: true };
    case "error": {
      const type = typeof json.error?.type === "string" ? json.error.type : null;
      const message = typeof json.error?.message === "string" ? json.error.message : null;
      return { error: errorFromType(label, type, message) ?? unknownServerError(label) };
    }
  }
  return {};
}

export function openAiStep(event: SseEvent, label: ProviderLabel): StreamStep {
  if (event.data.trim() === "[DONE]") return { done: true };
  const json = parseJson(event.data);
  if (!json) return {};
  if (json.error) {
    const error = typeof json.error === "string" ? { message: json.error } : json.error;
    const type = typeof error?.type === "string" ? error.type : typeof error?.code === "string" ? error.code : null;
    const message = typeof error?.message === "string" ? error.message : null;
    return { error: errorFromType(label, type, message) ?? unknownServerError(label) };
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const text = typeof choice?.delta?.content === "string" ? choice.delta.content : typeof choice?.message?.content === "string" ? choice.message.content : undefined;
  const stopReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
  return { ...(text ? { text } : {}), ...(stopReason ? { stopReason } : {}) };
}

export function stepFor(provider: AiProvider): (event: SseEvent, label: ProviderLabel) => StreamStep {
  return provider === "anthropic" ? anthropicStep : openAiStep;
}

export function refusalError(): AiError {
  return new AiError("refused", "The model declined to answer this.");
}
