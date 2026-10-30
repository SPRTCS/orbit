import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

globalThis.__DEV__ = false;
const providers = await import("./providers.ts");
const errors = await import("./errors.ts");
const { runStream, runModelList } = await import("./run.ts");
const { fetchTransport } = await import("./transport.ts");
const { parseMarkdown, parseInline } = await import("./markdown.ts");
const { chatMessages, pageBlock } = await import("./prompt.ts");
const { readAiSettings, DEFAULT_AI_SETTINGS } = await import("./settings.ts");
const { aiShortcuts, AI_MENU_COMMANDS } = await import("./menu.ts");
const { SseParser, buildRequest, normalizeBaseUrl, isLocalUrl, cleanMessages, anthropicStep, openAiStep, labelOf } = providers;

const anthropic = { provider: "anthropic", baseUrl: "", apiKey: "sk-ant-test", model: "claude-sonnet-5-5", kind: "chat" };
const ollama = { provider: "openai", baseUrl: "http://localhost:11434/v1", apiKey: null, model: "llama3.2", kind: "chat" };

test("builds an Anthropic Messages request", () => {
  const req = buildRequest(anthropic, { system: "sys", messages: [{ role: "user", content: "Hi" }] });
  assert.equal(req.method, "POST");
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.headers["x-api-key"], "sk-ant-test");
  assert.equal(req.headers["anthropic-version"], "2026-10-21");
  assert.equal(req.headers["content-type"], "application/json");
  const body = JSON.parse(req.body);
  assert.deepEqual(body, {
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    system: "sys",
    messages: [{ role: "user", content: "Hi" }],
    output_config: { effort: "medium" },
    stream: true,
  });
  assert.equal("temperature" in body, false);
});

test("quick Anthropic requests use the quick budget and low effort; older models get no effort", () => {
  const quick = JSON.parse(buildRequest({ ...anthropic, model: "claude-haiku-5-5", kind: "quick" }, { messages: [{ role: "user", content: "x" }] }).body);
  assert.equal(quick.max_tokens, 4096);
  assert.deepEqual(quick.output_config, { effort: "low" });
  const old = JSON.parse(buildRequest({ ...anthropic, model: "claude-haiku-4-5" }, { messages: [{ role: "user", content: "x" }], maxTokens: 50 }).body);
  assert.equal(old.max_tokens, 50);
  assert.equal("output_config" in old, false);
});

test("builds an OpenAI-compatible chat completions request", () => {
  const req = buildRequest({ ...ollama, apiKey: "k" }, { system: "sys", messages: [{ role: "user", content: "Hi" }], maxTokens: 100 });
  assert.equal(req.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer k");
  assert.deepEqual(JSON.parse(req.body), {
    model: "llama3.2",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Hi" }],
    max_tokens: 100,
    stream: true,
  });
  const keyless = buildRequest(ollama, { messages: [{ role: "user", content: "Hi" }] });
  assert.equal("authorization" in keyless.headers, false);
  assert.equal("max_tokens" in JSON.parse(keyless.body), false);
  const official = buildRequest({ ...ollama, baseUrl: "https://api.openai.com/v1" }, { messages: [{ role: "user", content: "Hi" }], maxTokens: 9 });
  assert.equal(JSON.parse(official.body).max_completion_tokens, 9);
});

test("normalizes base URLs and spots local servers", () => {
  assert.equal(normalizeBaseUrl("http://localhost:11434"), "http://localhost:11434/v1");
  assert.equal(normalizeBaseUrl("localhost:1234/"), "http://localhost:1234/v1");
  assert.equal(normalizeBaseUrl("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1");
  assert.equal(isLocalUrl("http://localhost:11434/v1"), true);
  assert.equal(isLocalUrl("http://127.0.0.1:1234/v1"), true);
  assert.equal(isLocalUrl("http://[::1]:8080"), true);
  assert.equal(isLocalUrl("https://api.openai.com/v1"), false);
});

test("cleans messages: drops empties, merges same roles, starts with the user", () => {
  assert.deepEqual(
    cleanMessages([
      { role: "assistant", content: "hello" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "  " },
      { role: "assistant", content: "c" },
    ]),
    [
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ],
  );
  assert.throws(() => buildRequest(anthropic, { messages: [] }), (e) => e.code === "badRequest");
});

test("parses SSE across arbitrary chunk boundaries", () => {
  const stream = 'event: message_start\ndata: {"type":"message_start"}\n\n: ping\r\nevent: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\r\n\r\ndata: line1\ndata: line2\n\ndata: [DONE]';
  for (let size = 1; size <= stream.length; size += 7) {
    const p = new SseParser();
    const events = [];
    for (let i = 0; i < stream.length; i += size) events.push(...p.push(stream.slice(i, i + size)));
    events.push(...p.end());
    assert.deepEqual(
      events.map((e) => [e.event, e.data]),
      [
        ["message_start", '{"type":"message_start"}'],
        ["content_block_delta", '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}'],
        [null, "line1\nline2"],
        [null, "[DONE]"],
      ],
      `chunk size ${size}`,
    );
  }
});

test("reads Anthropic and OpenAI stream events", () => {
  const label = labelOf(anthropic);
  assert.deepEqual(anthropicStep({ event: null, data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}' }, label), { text: "x" });
  assert.deepEqual(anthropicStep({ event: null, data: '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":""}}' }, label), {});
  assert.deepEqual(anthropicStep({ event: null, data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}' }, label), { stopReason: "end_turn" });
  assert.deepEqual(anthropicStep({ event: null, data: '{"type":"message_stop"}' }, label), { done: true });
  assert.equal(anthropicStep({ event: "error", data: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }, label).error.code, "overloaded");
  const o = labelOf(ollama);
  assert.deepEqual(openAiStep({ event: null, data: '{"choices":[{"delta":{"content":"hi"}}]}' }, o), { text: "hi" });
  assert.deepEqual(openAiStep({ event: null, data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' }, o), { stopReason: "stop" });
  assert.deepEqual(openAiStep({ event: null, data: "[DONE]" }, o), { done: true });
  assert.equal(openAiStep({ event: null, data: '{"error":{"message":"model \\"x\\" not found","type":"model_not_found"}}' }, o).error.code, "badModel");
});

test("maps HTTP failures to presentable errors", () => {
  const a = labelOf(anthropic);
  const e401 = errors.errorFromResponse(a, 401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
  assert.equal(e401.code, "badKey");
  assert.match(e401.message, /didn't accept your API key/);
  const e429 = errors.errorFromResponse(a, 429, '{"type":"error","error":{"type":"rate_limit_error","message":"x"}}', 20);
  assert.equal(e429.code, "rateLimit");
  assert.match(e429.message, /20 s/);
  assert.equal(e429.retryable, true);
  assert.equal(errors.errorFromResponse(a, 529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}').code, "overloaded");
  assert.equal(errors.errorFromResponse(a, 404, '{"type":"error","error":{"type":"not_found_error","message":"model: x"}}').code, "badModel");
  const low = errors.errorFromResponse(a, 400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}');
  assert.equal(low.code, "badRequest");
  assert.match(low.message, /credit balance/);
  const o = labelOf(ollama);
  assert.equal(errors.errorFromResponse(o, 404, '{"error":"model \\"llama9\\" not found, try pulling it first"}').code, "badModel");
  const down = errors.networkError(o, "Could not connect to the server.");
  assert.equal(down.code, "localServerDown");
  assert.match(down.message, /Start Ollama/);
  assert.equal(errors.networkError(a, "The Internet connection appears to be offline.").code, "offline");
});

function mockServer(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const sse = (res, events, gap = 5) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const next = () => {
    if (i >= events.length) return res.end();
    res.write(events[i++]);
    setTimeout(next, gap);
  };
  next();
};

test("streams an OpenAI-compatible answer from a mock server", async () => {
  const { server, seen, base } = await mockServer((req, res) => {
    sse(res, [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ]);
  });
  try {
    const deltas = [];
    const result = await runStream({ ...ollama, baseUrl: base }, { system: "s", messages: [{ role: "user", content: "Hi" }] }, { transport: fetchTransport, onText: (d) => deltas.push(d) });
    assert.deepEqual(deltas, ["Hello", ", world"]);
    assert.deepEqual(result, { text: "Hello, world", stopReason: "stop" });
    assert.equal(seen[0].url, "/v1/chat/completions");
    assert.equal(JSON.parse(seen[0].body).stream, true);
  } finally {
    server.close();
  }
});

test("streams an Anthropic answer and sends the Messages API shape", async () => {
  const { server, seen, base } = await mockServer((req, res) => {
    sse(res, [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","content":[]}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"# Title\\n"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Body"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
  });
  try {
    const result = await runStream({ ...anthropic, baseUrl: base }, { system: "s", messages: [{ role: "user", content: "Hi" }] }, { transport: fetchTransport });
    assert.deepEqual(result, { text: "# Title\nBody", stopReason: "end_turn" });
    assert.equal(seen[0].url, "/v1/messages");
    assert.equal(seen[0].headers["x-api-key"], "sk-ant-test");
    assert.equal(seen[0].headers["anthropic-version"], "2026-10-21");
    assert.equal(JSON.parse(seen[0].body).model, "claude-sonnet-5-5");
  } finally {
    server.close();
  }
});

test("reports HTTP errors, mid-stream errors, refusals, aborts and a dead local server", async () => {
  let mode = "401";
  const { server, base } = await mockServer((req, res) => {
    if (mode === "401") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
    }
    if (mode === "midstream") return sse(res, ['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}\n\n', 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']);
    if (mode === "refusal") return sse(res, ['event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n', 'event: message_stop\ndata: {"type":"message_stop"}\n\n']);
    if (mode === "slow") return sse(res, ['event: ping\ndata: {"type":"ping"}\n\n', ...Array(50).fill('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"z"}}\n\n')], 20);
  });
  const config = { ...anthropic, baseUrl: base };
  const input = { messages: [{ role: "user", content: "Hi" }] };
  try {
    await assert.rejects(runStream(config, input, { transport: fetchTransport }), (e) => e.code === "badKey");
    mode = "midstream";
    await assert.rejects(runStream(config, input, { transport: fetchTransport }), (e) => e.code === "overloaded");
    mode = "refusal";
    await assert.rejects(runStream(config, input, { transport: fetchTransport }), (e) => e.code === "refused");
    mode = "slow";
    const controller = new AbortController();
    const got = [];
    const run = runStream(config, input, { transport: fetchTransport, signal: controller.signal, onText: (d) => (got.push(d), got.length === 3 && controller.abort()) });
    await assert.rejects(run, (e) => e.code === "aborted");
    assert.equal(got.length, 3);
  } finally {
    server.close();
  }
  await assert.rejects(runStream({ ...ollama, baseUrl: base }, input, { transport: fetchTransport }), (e) => e.code === "localServerDown" && /Start Ollama|Nothing answered/.test(e.message));
});

test("lists an OpenAI-compatible server's models", async () => {
  const { server, base } = await mockServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"object":"list","data":[{"id":"llama3.2"},{"id":"qwen3"}]}');
  });
  try {
    assert.deepEqual(await runModelList({ provider: "openai", baseUrl: base, apiKey: null, model: "" }, { transport: fetchTransport }), ["llama3.2", "qwen3"]);
  } finally {
    server.close();
  }
});

test("builds chat messages with the page sent once and the selection quoted", () => {
  const page = { title: "Doc", url: "https://x.test/", description: "", text: "Body text", transcript: null, truncated: false };
  const messages = chatMessages([
    { id: "1", role: "user", text: "Summarize", page },
    { id: "2", role: "assistant", text: "It says X." },
    { id: "3", role: "user", text: "More?", page, quote: "the quote" },
    { id: "4", role: "assistant", text: "", status: "error" },
  ]);
  assert.equal(messages.length, 3);
  assert.match(messages[0].content, /^<page title="Doc" url="https:\/\/x.test\/">\nBody text\n<\/page>\n\nSummarize$/);
  assert.match(messages[2].content, /Still looking at the same page: Doc/);
  assert.match(messages[2].content, /<selection>\nthe quote\n<\/selection>\n\nMore\?$/);
  assert.match(pageBlock({ ...page, transcript: "[0:00] hi", text: "" }), /<transcript>\n\[0:00\] hi\n<\/transcript>/);
});

test("parses the Markdown a chat answer uses", () => {
  const md = [
    "# Title",
    "",
    "Some **bold**, *italic*, `code` and a [link](https://example.com).",
    "",
    "- one",
    "- two",
    "  - nested",
    "1. first",
    "2. second",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "> quoted",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "---",
    "```",
    "unterminated",
  ].join("\n");
  const blocks = parseMarkdown(md);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "list", "list", "code", "quote", "table", "rule", "code"]);
  assert.equal(blocks[0].level, 1);
  const para = blocks[1].inline;
  assert.deepEqual(para.find((n) => n.type === "text" && n.bold), { type: "text", text: "bold", bold: true });
  assert.deepEqual(para.find((n) => n.type === "text" && n.italic), { type: "text", text: "italic", italic: true });
  assert.deepEqual(para.find((n) => n.type === "code"), { type: "code", text: "code" });
  assert.equal(para.find((n) => n.type === "link").href, "https://example.com");
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[2].items[1].children[1].type, "list");
  assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4], { type: "code", lang: "ts", text: "const x = 1;", open: false });
  assert.equal(blocks[6].rows.length, 1);
  assert.equal(blocks[8].open, true);
});

test("drops unsafe link targets and autolinks bare URLs", () => {
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ type: "text", text: "x" }]);
  const auto = parseInline("see https://a.test/path. ok");
  assert.equal(auto[1].type, "link");
  assert.equal(auto[1].href, "https://a.test/path");
  assert.deepEqual(parseInline("snake_case_name"), [{ type: "text", text: "snake_case_name" }]);
});

test("reads saved AI settings defensively, off by default", () => {
  assert.deepEqual(readAiSettings(null), DEFAULT_AI_SETTINGS);
  assert.equal(DEFAULT_AI_SETTINGS.enabled, false);
  assert.equal(DEFAULT_AI_SETTINGS.anthropic.chatModel, "claude-sonnet-5-5");
  assert.equal(DEFAULT_AI_SETTINGS.anthropic.quickModel, "claude-haiku-5-5");
  const s = readAiSettings('{"enabled":true,"provider":"openai","openai":{"preset":"lmstudio","chatModel":"qwen"},"panelWidth":9999,"apiKey":"leak"}');
  assert.equal(s.enabled, true);
  assert.equal(s.provider, "openai");
  assert.equal(s.openai.baseUrl, "http://localhost:1234/v1");
  assert.equal(s.panelWidth, 640);
  assert.equal("apiKey" in s, false);
  assert.deepEqual(readAiSettings("not json"), DEFAULT_AI_SETTINGS);
});

test("⌘E goes to Chat only while AI is on, and the user's own shortcuts win", () => {
  assert.deepEqual(aiShortcuts({ a: ["x"] }, false), { a: ["x"] });
  assert.deepEqual(aiShortcuts({}, true), { toggleChat: ["e", "command"], useSelectionForFind: [] });
  assert.deepEqual(aiShortcuts({ toggleChat: ["k", "command", "shift"] }, true), { toggleChat: ["k", "command", "shift"] });
  assert.deepEqual(aiShortcuts({ useSelectionForFind: ["e", "command", "option"] }, true), { useSelectionForFind: ["e", "command", "option"], toggleChat: ["e", "command"] });
  assert.ok(AI_MENU_COMMANDS.includes("toggleChat"));
});
