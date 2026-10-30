import { AiError, abortedError, errorFromResponse, interruptedError, networkError, timeoutError } from "./errors";
import { buildModelsRequest, buildRequest, labelOf, readModelList, refusalError, SseParser, stepFor, type ProviderConfig, type RequestInput } from "./providers";
import { defaultTransport, TransportError, type Transport } from "./transport";

export type RunOptions = { signal?: AbortSignal; onText?: (delta: string) => void; transport?: Transport; idleTimeoutMs?: number };
export type RunResult = { text: string; stopReason: string | null };

function mapTransportError(error: unknown, config: ProviderConfig): AiError {
  if (error instanceof AiError) return error;
  const label = labelOf(config);
  if (error instanceof TransportError) {
    if (error.failure.kind === "aborted") return abortedError();
    if (error.failure.kind === "timeout") return timeoutError(label);
    return networkError(label, error.failure.detail);
  }
  return networkError(label, error instanceof Error ? error.message : null);
}

export async function runStream(config: ProviderConfig, input: RequestInput, options: RunOptions = {}): Promise<RunResult> {
  const label = labelOf(config);
  const request = buildRequest(config, input, true);
  const parser = new SseParser();
  const step = stepFor(config.provider);
  let text = "";
  let stopReason: string | null = null;
  let streamError: AiError | null = null;
  let sawEvent = false;
  let finished = false;
  const handle = (events: ReturnType<SseParser["push"]>) => {
    for (const event of events) {
      sawEvent = true;
      if (streamError) return;
      const s = step(event, label);
      if (s.error) streamError = s.error;
      if (s.done) finished = true;
      if (s.stopReason) {
        stopReason = s.stopReason;
        finished = true;
      }
      if (s.text) {
        text += s.text;
        options.onText?.(s.text);
      }
    }
  };
  let result;
  try {
    result = await (options.transport ?? defaultTransport)(request, {
      signal: options.signal,
      idleTimeoutMs: options.idleTimeoutMs,
      onText: (chunk) => handle(parser.push(chunk)),
    });
  } catch (error) {
    throw mapTransportError(error, config);
  }
  if (result.status < 200 || result.status >= 300) throw errorFromResponse(label, result.status, result.body, result.retryAfter);
  handle(parser.end());
  if (streamError) throw streamError;
  if (!sawEvent) {
    const fallback = result.body.trim() ? readPlainCompletion(result.body) : null;
    if (fallback !== null) {
      text = fallback;
      finished = true;
      if (text) options.onText?.(text);
    }
  }
  if (!finished) throw interruptedError(label);
  if (stopReason === "refusal" && !text.trim()) throw refusalError();
  return { text, stopReason };
}

export function readPlainCompletion(body: string): string | null {
  try {
    const json = JSON.parse(body) as { content?: { type?: string; text?: string }[]; choices?: { message?: { content?: string } }[] };
    if (Array.isArray(json.content)) return json.content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
    const message = json.choices?.[0]?.message?.content;
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

export async function runModelList(config: Pick<ProviderConfig, "provider" | "baseUrl" | "apiKey" | "model">, options: RunOptions = {}): Promise<string[]> {
  const full: ProviderConfig = { ...config, kind: "quick" };
  let result;
  try {
    result = await (options.transport ?? defaultTransport)(buildModelsRequest(config), { signal: options.signal, idleTimeoutMs: options.idleTimeoutMs ?? 15_000 });
  } catch (error) {
    throw mapTransportError(error, full);
  }
  if (result.status < 200 || result.status >= 300) throw errorFromResponse(labelOf(full), result.status, result.body, result.retryAfter);
  return readModelList(result.body);
}
