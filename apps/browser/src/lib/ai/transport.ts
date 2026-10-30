import type { HttpRequest } from "./providers";

export type HttpResult = { status: number; body: string; retryAfter: number | null };

export type HttpFailure = { kind: "network"; detail: string | null } | { kind: "timeout" } | { kind: "aborted" };

export class TransportError extends Error {
  readonly failure: HttpFailure;
  constructor(failure: HttpFailure) {
    super(failure.kind);
    this.failure = failure;
  }
}

export type SendOptions = {
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
  idleTimeoutMs?: number;
};

export type Transport = (request: HttpRequest, options: SendOptions) => Promise<HttpResult>;

const DEFAULT_IDLE_MS = 120_000;

function retryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, (at - Date.now()) / 1000) : null;
}

export const xhrTransport: Transport = (request, { signal, onText, idleTimeoutMs = DEFAULT_IDLE_MS }) =>
  new Promise<HttpResult>((resolve, reject) => {
    if (signal?.aborted) return reject(new TransportError({ kind: "aborted" }));
    const xhr = new XMLHttpRequest();
    let seen = 0;
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        finish(() => reject(new TransportError({ kind: "timeout" })));
        xhr.abort();
      }, idleTimeoutMs);
    };
    const onAbort = () => {
      finish(() => reject(new TransportError({ kind: "aborted" })));
      xhr.abort();
    };
    const ok = () => xhr.status >= 200 && xhr.status < 300;
    const drain = () => {
      const text = xhr.responseText ?? "";
      if (text.length > seen && ok()) {
        const chunk = text.slice(seen);
        seen = text.length;
        onText?.(chunk);
      }
    };
    xhr.open(request.method, request.url, true);
    xhr.responseType = "text";
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.onprogress = () => {
      armIdle();
      drain();
    };
    xhr.onload = () => {
      drain();
      const body = xhr.responseText ?? "";
      finish(() => resolve({ status: xhr.status, body, retryAfter: retryAfterSeconds(xhr.getResponseHeader("retry-after")) }));
    };
    xhr.onerror = () => {
      const detail = typeof xhr.responseText === "string" && xhr.responseText ? xhr.responseText : null;
      finish(() => reject(new TransportError({ kind: "network", detail })));
    };
    xhr.ontimeout = () => finish(() => reject(new TransportError({ kind: "timeout" })));
    xhr.onabort = () => finish(() => reject(new TransportError({ kind: "aborted" })));
    signal?.addEventListener("abort", onAbort);
    armIdle();
    xhr.send(request.body ?? null);
  });

export const fetchTransport: Transport = async (request, { signal, onText, idleTimeoutMs = DEFAULT_IDLE_MS }) => {
  const controller = new AbortController();
  let reason: HttpFailure | null = null;
  const onAbort = () => {
    reason = { kind: "aborted" };
    controller.abort();
  };
  if (signal?.aborted) throw new TransportError({ kind: "aborted" });
  signal?.addEventListener("abort", onAbort);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      reason = { kind: "timeout" };
      controller.abort();
    }, idleTimeoutMs);
  };
  try {
    armIdle();
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body ?? undefined, signal: controller.signal });
    const ok = response.ok;
    let body = "";
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armIdle();
        const chunk = decoder.decode(value, { stream: true });
        body += chunk;
        if (ok && chunk) onText?.(chunk);
      }
      const tail = decoder.decode();
      body += tail;
      if (ok && tail) onText?.(tail);
    } else {
      body = await response.text();
      if (ok && body) onText?.(body);
    }
    return { status: response.status, body, retryAfter: retryAfterSeconds(response.headers.get("retry-after")) };
  } catch (error) {
    if (reason) throw new TransportError(reason);
    throw new TransportError({ kind: "network", detail: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener("abort", onAbort);
  }
};

export const defaultTransport: Transport = (request, options) =>
  (typeof XMLHttpRequest === "function" ? xhrTransport : fetchTransport)(request, options);
