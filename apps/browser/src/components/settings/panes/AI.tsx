import { showMenu } from "@ardia/shell";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { complete, listAiModels } from "../../../lib/ai/client";
import { isAiError } from "../../../lib/ai/errors";
import { hostScope, normalizeBaseUrl, urlHost, type AiProvider } from "../../../lib/ai/providers";
import {
  aiSettings,
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_ANTHROPIC_QUICK_MODEL,
  OPENAI_PRESETS,
  refreshAiKeys,
  setAiKey,
  updateAiSettings,
  useAiSettings,
  type OpenAiPreset,
} from "../../../lib/ai/settings";
import { openUrls } from "../../../lib/actions";
import { useTheme } from "../../../lib/theme";
import { Button, Group, PopUp, Row, SectionHeader, TextField, Toggle, useFormColors } from "../controls";

const KEY_PAGE = "https://console.anthropic.com/settings/keys";

export function AiPane() {
  const theme = useTheme();
  const s = useAiSettings();
  useEffect(() => void refreshAiKeys(), []);
  const base = normalizeBaseUrl(s.openai.baseUrl);
  const scope = hostScope(base);
  const host = urlHost(base) ?? "the server you set below";
  const destination =
    s.provider === "anthropic"
      ? "Anthropic (api.anthropic.com)"
      : scope === "loopback"
        ? `the server at ${host} on this Mac`
        : scope === "network"
          ? `the server at ${host} on your local network`
          : host;
  return (
    <>
      <SectionHeader
        title="AI"
        description="Chat with the page you're on, ask about a selection, and summarize. Off until you turn it on: nothing is sent anywhere before that."
      />
      <Group>
        <Row title="Use AI in Orbit" description="Adds Chat (⌘E), Ask on selected text and Summarize This Page. ⌘E goes back to Find › Use Selection when this is off.">
          <Toggle value={s.enabled} onChange={(enabled) => updateAiSettings({ enabled })} />
        </Row>
        <Row title="Provider">
          <PopUp<AiProvider>
            value={s.provider}
            minWidth={210}
            options={[
              { value: "anthropic", title: "Anthropic (Claude)" },
              { value: "openai", title: "OpenAI-compatible (Ollama, LM Studio…)" },
            ]}
            onChange={(provider) => updateAiSettings({ provider })}
          />
        </Row>
      </Group>
      <Text style={{ fontSize: 11.5, lineHeight: 15, color: theme.textSecondary, marginTop: 8, paddingHorizontal: 2 }}>
        {`What's sent, and only when you ask: your messages and, when "Include this page" is on, the page's title, address and text (a YouTube video's transcript too), to ${destination}. API keys stay in your macOS Keychain.`}
      </Text>
      {s.provider === "anthropic" ? <AnthropicSection /> : <OpenAiSection />}
      <SectionHeader title="Chat" />
      <Group>
        <Row title="Include the current page by default" description="Each chat message can still turn it off.">
          <Toggle value={s.includePage} onChange={(includePage) => updateAiSettings({ includePage })} />
        </Row>
      </Group>
      <SectionHeader
        title="Tidy"
        description="Tidy Tabs, Tidy Titles and these send only tab titles and sites, or a download's file name, site and page title: never a page's or file's contents. Undo from the toast."
      />
      <Group>
        <Row title="Name new tab groups with AI" description="A short name and an emoji from the group's tabs. A name you give always wins.">
          <Toggle value={s.nameGroups} onChange={(nameGroups) => updateAiSettings({ nameGroups })} />
        </Row>
        <Row title="Rename downloads with AI" description="Gives each finished download a clean name, keeping its extension.">
          <Toggle value={s.tidyDownloads} onChange={(tidyDownloads) => updateAiSettings({ tidyDownloads })} />
        </Row>
      </Group>
      {s.enabled ? <TestConnection /> : null}
    </>
  );
}

function KeyRow({ provider, optional }: { provider: AiProvider; optional?: boolean }) {
  const theme = useTheme();
  const colors = useFormColors();
  const saved = useAiSettings((s) => s.keys[provider]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!draft.trim()) return;
    const ok = await setAiKey(provider, draft);
    setError(ok ? null : "Couldn't save the key in your Keychain.");
    if (ok) setDraft("");
  };
  return (
    <Row
      title={optional ? "API key (optional)" : "API key"}
      description={
        <Text style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: error ? colors.destructive : theme.textSecondary }}>
          {error ?? (saved ? "Saved in your Keychain." : saved === false ? (optional ? "Not set. Local servers usually don't need one." : "Not set.") : "…")}
        </Text>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextField value={draft} onChangeText={setDraft} secure placeholder={saved ? "Replace key" : provider === "anthropic" ? "sk-ant-…" : "Key"} onSubmit={() => void save()} style={{ width: 170 }} />
        {draft.trim() ? <Button title="Save" kind="primary" onPress={() => void save()} /> : saved ? <Button title="Remove" onPress={() => void setAiKey(provider, null)} /> : null}
      </View>
    </Row>
  );
}

function ModelRow({ title, value, placeholder, onChange, pick }: { title: string; value: string; placeholder: string; onChange: (v: string) => void; pick?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const enabled = useAiSettings((s) => s.enabled);
  const choose = async () => {
    try {
      const models = await listAiModels(aiSettings());
      setError(models.length ? null : "The server listed no models.");
      if (!models.length) return;
      const choice = await showMenu(models.slice(0, 60).map((id) => ({ id, title: id, checked: id === value })));
      if (choice) onChange(choice);
    } catch (e) {
      setError(isAiError(e) ? e.message : String(e));
    }
  };
  return (
    <Row title={title} description={error ?? (pick && !enabled ? "Turn on AI to list the server's models." : undefined)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextField value={value} onChangeText={onChange} placeholder={placeholder} style={{ width: 190 }} />
        {pick ? <Button title="Choose…" disabled={!enabled} onPress={() => void choose()} /> : null}
      </View>
    </Row>
  );
}

function AnthropicSection() {
  const a = useAiSettings((s) => s.anthropic);
  return (
    <>
      <SectionHeader title="Anthropic" description="Uses your own API key with Anthropic's Messages API." action={<Button title="Get a Key" kind="plain" onPress={() => openUrls([KEY_PAGE])} />} />
      <Group>
        <KeyRow provider="anthropic" />
        <ModelRow title="Chat model" value={a.chatModel} placeholder={DEFAULT_ANTHROPIC_CHAT_MODEL} onChange={(chatModel) => updateAiSettings((s) => ({ anthropic: { ...s.anthropic, chatModel } }))} />
        <ModelRow title="Quick tasks model" value={a.quickModel} placeholder={DEFAULT_ANTHROPIC_QUICK_MODEL} onChange={(quickModel) => updateAiSettings((s) => ({ anthropic: { ...s.anthropic, quickModel } }))} />
      </Group>
    </>
  );
}

function OpenAiSection() {
  const o = useAiSettings((s) => s.openai);
  const scope = hostScope(normalizeBaseUrl(o.baseUrl));
  const host = urlHost(normalizeBaseUrl(o.baseUrl));
  return (
    <>
      <SectionHeader
        title="OpenAI-compatible server"
        description={
          scope === "loopback"
            ? "A server on this Mac: nothing leaves it."
            : scope === "network"
              ? `A server on your local network (${host}): requests stay off the internet, but leave this Mac.`
              : `Any server that speaks OpenAI's chat completions API. Requests go over the internet to ${host ?? "it"}.`
        }
      />
      <Group>
        <Row title="Server">
          <PopUp<OpenAiPreset>
            value={o.preset}
            minWidth={190}
            options={(Object.keys(OPENAI_PRESETS) as OpenAiPreset[]).map((value) => ({ value, title: OPENAI_PRESETS[value].title }))}
            onChange={(preset) => updateAiSettings((s) => ({ openai: { ...s.openai, preset, baseUrl: OPENAI_PRESETS[preset].baseUrl || s.openai.baseUrl } }))}
          />
        </Row>
        <Row title="Base URL" description="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1">
          <TextField
            value={o.baseUrl}
            onChangeText={(baseUrl) => updateAiSettings((s) => ({ openai: { ...s.openai, baseUrl, preset: "custom" } }))}
            placeholder="http://localhost:11434/v1"
            style={{ width: 230 }}
          />
        </Row>
        <KeyRow provider="openai" optional />
        <ModelRow title="Chat model" value={o.chatModel} placeholder="llama3.2" pick onChange={(chatModel) => updateAiSettings((s) => ({ openai: { ...s.openai, chatModel } }))} />
        <ModelRow title="Quick tasks model" value={o.quickModel} placeholder="Same as chat" pick onChange={(quickModel) => updateAiSettings((s) => ({ openai: { ...s.openai, quickModel } }))} />
      </Group>
    </>
  );
}

function TestConnection() {
  const theme = useTheme();
  const colors = useFormColors();
  const [state, setState] = useState<{ busy: boolean; result: string | null; ok: boolean }>({ busy: false, result: null, ok: false });
  const run = async () => {
    setState({ busy: true, result: null, ok: false });
    try {
      const reply = await complete({ messages: [{ role: "user", content: "Reply with just: OK" }], model: "quick", maxTokens: 64 });
      setState({ busy: false, ok: true, result: `Connected. The model replied: “${reply.slice(0, 80)}”` });
    } catch (e) {
      setState({ busy: false, ok: false, result: isAiError(e) ? e.message : String(e) });
    }
  };
  return (
    <>
      <SectionHeader title="Check the connection" />
      <Group>
        <Row
          title="Send a test message"
          description={
            <Text style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: state.result && !state.ok ? colors.destructive : theme.textSecondary }}>
              {state.busy ? "Asking…" : (state.result ?? "Sends “Reply with just: OK” to the quick tasks model.")}
            </Text>
          }
        >
          <Button title="Test" disabled={state.busy} onPress={() => void run()} />
        </Row>
      </Group>
    </>
  );
}
