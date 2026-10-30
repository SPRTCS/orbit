export type AiErrorCode =
  | "disabled"
  | "noKey"
  | "badKey"
  | "rateLimit"
  | "overloaded"
  | "offline"
  | "localServerDown"
  | "badModel"
  | "badRequest"
  | "refused"
  | "server"
  | "timeout"
  | "interrupted"
  | "aborted";

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["rateLimit", "overloaded", "offline", "localServerDown", "server", "timeout", "interrupted"]);

const secrets = new Set<string>();

export function registerAiSecret(secret: string | null | undefined) {
  const s = secret?.trim();
  if (s && s.length >= 6) secrets.add(s);
}

export function forgetAiSecret(secret: string | null | undefined) {
  const s = secret?.trim();
  if (s) secrets.delete(s);
}

const CREDENTIAL_PATTERNS = [
  /\b(Bearer|Basic)\s+[^\s"',;]+/gi,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(x-api-key|api[_-]?key|authorization|access[_-]?token|token)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("••••");
  out = out.replace(CREDENTIAL_PATTERNS[0]!, "$1 ••••");
  out = out.replace(CREDENTIAL_PATTERNS[1]!, "••••");
  out = out.replace(CREDENTIAL_PATTERNS[2]!, "$1$2••••");
  return out.replace(CREDENTIAL_PATTERNS[3]!, "••••");
}

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | null;

  constructor(code: AiErrorCode, message: string, status: number | null = null) {
    super(redactSecrets(message));
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  get needsSettings(): boolean {
    return this.code === "disabled" || this.code === "noKey" || this.code === "badKey" || this.code === "badModel";
  }
}

export const isAiError = (error: unknown): error is AiError => error instanceof AiError;

export type ProviderLabel = { provider: "anthropic" | "openai"; baseUrl: string; local: boolean; model: string };

export function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  return match ? match[1]!.replace(/^[^@]*@/, "") : url;
}

function serverName(p: ProviderLabel): string {
  return p.provider === "anthropic" ? "Anthropic" : p.local ? `The local server at ${hostOf(p.baseUrl)}` : hostOf(p.baseUrl);
}

export function noKeyError(provider: "anthropic" | "openai"): AiError {
  return new AiError(
    "noKey",
    provider === "anthropic" ? "Add your Anthropic API key in Settings › AI to start chatting." : "This server needs an API key. Add it in Settings › AI.",
  );
}

export const disabledError = () => new AiError("disabled", "AI is off. Turn it on in Settings › AI.");

export const abortedError = () => new AiError("aborted", "Stopped.");

export function networkError(p: ProviderLabel, detail: string | null): AiError {
  if (p.local) {
    const host = hostOf(p.baseUrl);
    const app = /:11434\b/.test(host) ? "Ollama" : /:1234\b/.test(host) ? "LM Studio's local server" : "the local server";
    return new AiError("localServerDown", `Nothing answered at ${host}. Start ${app} and try again.`);
  }
  const host = p.provider === "anthropic" ? "api.anthropic.com" : hostOf(p.baseUrl);
  const offline = !!detail && /offline|not connected|network connection was lost/i.test(detail);
  return new AiError("offline", offline ? "You're offline. Check your internet connection and try again." : `Couldn't reach ${host}. Check your connection and try again.`);
}

export function timeoutError(p: ProviderLabel): AiError {
  return new AiError("timeout", `${serverName(p)} stopped responding. Try again.`);
}

type ApiErrorBody = { type: string | null; message: string | null };

export function readErrorBody(body: string | null | undefined): ApiErrorBody {
  if (!body) return { type: null, message: null };
  try {
    const json = JSON.parse(body) as { error?: { type?: unknown; message?: unknown; code?: unknown } | string; message?: unknown };
    const error = json?.error;
    if (typeof error === "string") return { type: null, message: error };
    const type = typeof error?.type === "string" ? error.type : typeof error?.code === "string" ? error.code : null;
    const message = typeof error?.message === "string" ? error.message : typeof json?.message === "string" ? json.message : null;
    return { type, message };
  } catch {
    const text = body.trim();
    return { type: null, message: text && text.length < 300 && !text.startsWith("<") ? text : null };
  }
}

export function errorFromType(p: ProviderLabel, type: string | null, message: string | null, status: number | null = null): AiError | null {
  switch (type) {
    case "authentication_error":
    case "invalid_api_key":
      return badKey(p, status);
    case "permission_error":
      return permissionDenied(p, status);
    case "rate_limit_error":
    case "rate_limit_exceeded":
      return rateLimited(p, null, status);
    case "overloaded_error":
      return new AiError("overloaded", `${serverName(p)} is overloaded right now. Try again in a moment.`, status);
    case "not_found_error":
    case "model_not_found":
      return badModel(p, status);
    case "api_error":
      return new AiError("server", `${serverName(p)} had a problem. Try again.`, status);
  }
  return null;
}

function permissionDenied(p: ProviderLabel, status: number | null): AiError {
  return new AiError("badKey", `${serverName(p)} didn't allow this API key to do that${status ? ` (${status})` : ""}. Check it in Settings › AI.`, status);
}

export function unknownServerError(p: ProviderLabel, status: number | null = null): AiError {
  return new AiError("server", `${serverName(p)} had a problem${status ? ` (${status})` : ""}. Try again.`, status);
}

export function interruptedError(p: ProviderLabel): AiError {
  return new AiError("interrupted", `${serverName(p)} stopped before finishing the answer. Try again.`);
}

function badKey(p: ProviderLabel, status: number | null): AiError {
  return new AiError(
    "badKey",
    p.provider === "anthropic" ? "Anthropic didn't accept your API key. Check it in Settings › AI." : `${serverName(p)} didn't accept the API key. Check it in Settings › AI.`,
    status,
  );
}

function badModel(p: ProviderLabel, status: number | null): AiError {
  return new AiError("badModel", `The model “${p.model}” isn't available on ${p.provider === "anthropic" ? "Anthropic" : hostOf(p.baseUrl)}. Check the model name in Settings › AI.`, status);
}

function rateLimited(p: ProviderLabel, retryAfter: number | null, status: number | null): AiError {
  const wait = retryAfter && retryAfter > 0 ? ` Try again in ${retryAfter < 90 ? `${Math.ceil(retryAfter)} s` : `${Math.ceil(retryAfter / 60)} min`}.` : " Try again in a moment.";
  return new AiError("rateLimit", `${serverName(p)} is rate limiting requests.${wait}`, status);
}

export function errorFromResponse(p: ProviderLabel, status: number, body: string | null, retryAfter: number | null = null): AiError {
  const { type, message } = readErrorBody(body);
  if (status === 401) return badKey(p, status);
  if (status === 429) return rateLimited(p, retryAfter, status);
  if (status === 529 || (status === 503 && p.provider === "anthropic")) return new AiError("overloaded", `${serverName(p)} is overloaded right now. Try again in a moment.`, status);
  const typed = errorFromType(p, type, message, status);
  if (typed) return typed;
  if (status === 404 || (message && /model[^.]*(not found|does not exist|not available|unknown)|no such model|not a valid model/i.test(message))) return badModel(p, status);
  if (status === 403) return permissionDenied(p, status);
  if (status >= 500) return new AiError("server", `${serverName(p)} had a problem (${status}). Try again.`, status);
  const detail = p.provider === "anthropic" && type === "invalid_request_error" && message ? `: ${message.slice(0, 240)}` : ` (${status})`;
  return new AiError("badRequest", `${serverName(p)} refused the request${detail}.`.replace(/\.\.$/, "."), status);
}
