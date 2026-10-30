import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native-stub.mjs");
const { useBrowser } = await import("../../store/browser.ts");
const { webviews } = await import("../webviews.ts");
const settings = await import("./settings.ts");
const client = await import("./client.ts");
const chat = await import("./chat.ts");
const errors = await import("./errors.ts");
const providers = await import("./providers.ts");
const { runStream } = await import("./run.ts");
const { fetchTransport } = await import("./transport.ts");

settings.startAiSettings();

function mockServer(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, body });
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}/v1` }));
  });
}

const slowAnswer = (res, words = 40, gap = 25) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (res.destroyed) return;
    if (i++ < words) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "word " } }] })}\n\n`);
      return setTimeout(tick, gap);
    }
    res.end("data: [DONE]\n\n");
  };
  tick();
};

const useMock = (base, enabled = true) =>
  settings.updateAiSettings({ enabled, provider: "openai", openai: { preset: "custom", baseUrl: base, chatModel: "mock", quickModel: "" } });

const ask = { messages: [{ role: "user", content: "Hi" }] };

test("listing models sends nothing while AI is off", async () => {
  const { server, seen, base } = await mockServer((req, res) => res.end('{"data":[{"id":"m"}]}'));
  try {
    useMock(base, false);
    await assert.rejects(client.listAiModels(), (e) => e.code === "disabled");
    assert.equal(seen.length, 0);
    useMock(base, true);
    assert.deepEqual(await client.listAiModels(), ["m"]);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
  }
});

test("turning AI off during preparation stops the request before it is sent", async () => {
  const { server, seen, base } = await mockServer((req, res) => slowAnswer(res, 2));
  try {
    useMock(base, true);
    const run = client.complete(ask);
    settings.updateAiSettings({ enabled: false });
    await assert.rejects(run, (e) => e.code === "disabled");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(seen.length, 0);
  } finally {
    server.close();
  }
});

test("turning AI off aborts every request in flight and fires onAiDisabled", async () => {
  const { server, base } = await mockServer((req, res) => slowAnswer(res, 200, 20));
  try {
    useMock(base, true);
    let disabledCalls = 0;
    const off = client.onAiDisabled(() => disabledCalls++);
    const signal = client.aiAbortSignal();
    let deltas = 0;
    const started = Date.now();
    const run = client.streamText(ask, () => {
      if (++deltas === 2) settings.updateAiSettings({ enabled: false });
    });
    await assert.rejects(run, (e) => e.code === "disabled");
    assert.ok(Date.now() - started < 1500);
    assert.equal(signal.aborted, true);
    assert.equal(disabledCalls, 1);
    off();
    useMock(base, true);
    assert.equal(client.aiAbortSignal().aborted, false);
  } finally {
    server.close();
  }
});

test("Stop during page extraction sends nothing", async () => {
  const { server, seen, base } = await mockServer((req, res) => slowAnswer(res, 2));
  try {
    useMock(base, true);
    const tab = { id: "t1", windowId: "w1", profileId: "default", url: "https://a.test/", title: "A", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 };
    const win = { id: "w1", profileId: "default", incognito: false, tabIds: ["t1"], activeTabIds: { default: "t1" }, sidebarOpen: true, frame: null, createdAt: 0 };
    useBrowser.getState().hydrate({ profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, windows: { w1: win }, tabs: { t1: tab }, focusedWindowId: "w1" });
    let extracted = false;
    webviews.set("t1", { evaluate: () => new Promise((r) => setTimeout(() => ((extracted = true), r({ title: "A", url: "https://a.test/", description: "", text: "page text", transcript: null, truncated: false })), 200)) });
    const send = chat.sendChat("w1", "Summarize", { includePage: true });
    await new Promise((r) => setTimeout(r, 40));
    chat.stopChat("w1");
    await send;
    await new Promise((r) => setTimeout(r, 250));
    const c = chat.chatOf("w1");
    assert.equal(seen.length, 0);
    assert.equal(c.busy, false);
    assert.equal(c.turns.at(-1).status, "stopped");
    chat.newChat("w1");
    const ok = chat.sendChat("w1", "Summarize", { includePage: true });
    await ok;
    assert.equal(seen.length, 1);
    assert.equal(chat.chatOf("w1").turns.at(-1).status, "done");
    assert.match(JSON.parse(seen[0].body).messages.at(-1).content, /page text/);
  } finally {
    webviews.delete("t1");
    server.close();
  }
});

test("turning AI off is written to disk at once", () => {
  settings.updateAiSettings({ enabled: true });
  settings.flushAiSettings();
  settings.updateAiSettings({ enabled: false });
  assert.equal(JSON.parse(stub.docs.get("ai-settings.json")).enabled, false);
  settings.updateAiSettings({ panelWidth: 500 });
  settings.flushAiSettings();
  assert.equal(JSON.parse(stub.docs.get("ai-settings.json")).panelWidth, 500);
});

test("error messages never show a credential and unknown server errors stay generic", () => {
  errors.registerAiSecret("sk-live-ABCDEF1234567890");
  const o = providers.labelOf({ provider: "openai", baseUrl: "https://api.example.com/v1", model: "m" });
  const a = providers.labelOf({ provider: "anthropic", baseUrl: "", model: "claude-sonnet-5-5" });
  const echo = '{"error":{"message":"Invalid header Authorization: Bearer sk-live-ABCDEF1234567890 for user"}}';
  for (const status of [400, 403, 418, 500]) {
    const e = errors.errorFromResponse(o, status, echo);
    assert.doesNotMatch(e.message, /sk-live|ABCDEF/, `status ${status}`);
    assert.match(e.message, new RegExp(String(status)));
  }
  const anthropic = errors.errorFromResponse(a, 403, '{"type":"error","error":{"type":"permission_error","message":"key sk-ant-api03-XYZXYZXYZXYZXYZ123 cannot use this model"}}');
  assert.doesNotMatch(anthropic.message, /sk-ant-api03/);
  const unknown = providers.openAiStep({ event: null, data: '{"error":{"message":"boom sk-live-ABCDEF1234567890","type":"weird"}}' }, o);
  assert.doesNotMatch(unknown.error.message, /sk-live/);
  const unknownA = providers.anthropicStep({ event: "error", data: '{"type":"error","error":{"type":"strange_error","message":"leak Bearer abc.def.ghi"}}' }, a);
  assert.doesNotMatch(unknownA.error.message, /abc\.def/);
  assert.doesNotMatch(new errors.AiError("server", "x sk-live-ABCDEF1234567890 y").message, /ABCDEF/);
});

test("only real loopback and private hosts count as local", () => {
  const { hostScope, isLocalUrl } = providers;
  assert.equal(hostScope("http://localhost:11434/v1"), "loopback");
  assert.equal(hostScope("http://127.0.0.1:1234/v1"), "loopback");
  assert.equal(hostScope("http://127.8.9.10/v1"), "loopback");
  assert.equal(hostScope("http://[::1]:8080/v1"), "loopback");
  assert.equal(hostScope("http://ollama.localhost/v1"), "loopback");
  assert.equal(hostScope("http://192.168.1.20:11434/v1"), "network");
  assert.equal(hostScope("http://10.0.0.5/v1"), "network");
  assert.equal(hostScope("http://172.20.1.1/v1"), "network");
  assert.equal(hostScope("http://169.254.3.4/v1"), "network");
  assert.equal(hostScope("http://studio.local:1234/v1"), "network");
  assert.equal(hostScope("http://[fe80::1]/v1"), "network");
  assert.equal(hostScope("https://127.example.com/v1"), "remote");
  assert.equal(hostScope("https://10.example.com/v1"), "remote");
  assert.equal(hostScope("https://192.168.example.com/v1"), "remote");
  assert.equal(hostScope("http://localhost@evil.com/v1"), "remote");
  assert.equal(hostScope("http://localhost.evil.com/v1"), "remote");
  assert.equal(hostScope("http://172.32.0.1/v1"), "remote");
  assert.equal(hostScope("https://api.openai.com/v1"), "remote");
  assert.equal(isLocalUrl("https://127.example.com"), false);
  assert.equal(isLocalUrl("http://192.168.1.20:11434"), true);
});

test("a stream that ends without its end marker is an interrupted answer", async () => {
  let mode = "openai";
  const { server, base } = await mockServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (mode === "openai") return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "half an ans" } }] })}\n\n`);
    if (mode === "anthropic") return res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "half" } })}\n\n`);
    if (mode === "finish") return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
  });
  const openai = { provider: "openai", baseUrl: base, apiKey: null, model: "m", kind: "chat" };
  try {
    const got = [];
    await assert.rejects(runStream(openai, ask, { transport: fetchTransport, onText: (d) => got.push(d) }), (e) => e.code === "interrupted" && e.retryable);
    assert.deepEqual(got, ["half an ans"]);
    mode = "anthropic";
    await assert.rejects(runStream({ ...openai, provider: "anthropic", baseUrl: base.replace(/\/v1$/, ""), apiKey: "k" }, ask, { transport: fetchTransport }), (e) => e.code === "interrupted");
    mode = "finish";
    assert.deepEqual(await runStream(openai, ask, { transport: fetchTransport }), { text: "ok", stopReason: "stop" });
  } finally {
    server.close();
  }
});
