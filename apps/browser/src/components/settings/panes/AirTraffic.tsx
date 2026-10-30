import { showMenu, Symbol } from "@ardia/shell";
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { create } from "zustand";
import { spaceExists } from "../../../lib/airTraffic/flights";
import {
  clearance,
  destinationUsable,
  matchDescription,
  normalizeBundleId,
  normalizePattern,
  type AirTrafficDestination,
  type AirTrafficMatchKind,
  type AirTrafficRule,
} from "../../../lib/airTraffic/rules";
import { addRule, airTrafficConfig, moveRuleTo, removeRule, setFallback, updateRule, useAirTraffic, type RuleDraft } from "../../../lib/airTraffic/store";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { Favicon, IconButton } from "../../primitives";
import { Button, Group, PopUp, Row, SectionHeader, Sheet, TextField, Toggle, type Option } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

const MATCH_OPTIONS: Option<AirTrafficMatchKind>[] = [
  { value: "domain", title: "Domain" },
  { value: "contains", title: "URL contains" },
  { value: "glob", title: "URL matches pattern" },
];

const PLACEHOLDERS: Record<AirTrafficMatchKind, string> = {
  domain: "github.com",
  contains: "/pull/",
  glob: "*.atlassian.net/browse/*",
};

const MATCH_HELP: Record<AirTrafficMatchKind, string> = {
  domain: "Matches the domain and every subdomain: github.com also catches gist.github.com.",
  contains: "Matches any link whose address contains this text, ignoring case.",
  glob: "* stands for anything. Matched against the whole address, with or without https://.",
};

const DEFAULT_VALUE = "default";

const useTestUrl = create<{ url: string; fromApp: string }>(() => ({ url: "", fromApp: "" }));

export const setAirTrafficTest = (url: string, fromApp = "") => useTestUrl.setState({ url, fromApp });

export function showRuleSheet(ruleId?: string) {
  const rule = ruleId ? airTrafficConfig().rules.find((r) => r.id === ruleId) : undefined;
  showSettingsSheet(<RuleSheet rule={rule} />);
}

const destinationValue = (d: AirTrafficDestination | null) => (!d ? DEFAULT_VALUE : d.kind === "space" ? `space:${d.spaceId}` : d.kind);

function destinationOf(value: string): AirTrafficDestination | null {
  if (value === "current" || value === "little") return { kind: value };
  if (value.startsWith("space:")) return { kind: "space", spaceId: value.slice(6) };
  return null;
}

function useSpaces() {
  const profiles = useBrowser((s) => s.profiles);
  const order = useBrowser((s) => s.profileOrder);
  return order.filter((id) => profiles[id]).map((id) => ({ id, name: profiles[id]!.name }));
}

function useDestinationName() {
  const profiles = useBrowser((s) => s.profiles);
  return (d: AirTrafficDestination | null, fallbackTitle = "the default place"): string => {
    if (!d) return fallbackTitle;
    if (d.kind === "current") return "the current Space";
    if (d.kind === "little") return "Little Orbit";
    return profiles[d.spaceId]?.name ?? "a deleted Space";
  };
}

function destinationOptions(spaces: { id: string; name: string }[], current: AirTrafficDestination | null, withDefault: boolean): Option<string>[] {
  const missing = current?.kind === "space" && !spaces.some((s) => s.id === current.spaceId);
  return [
    ...(withDefault ? [{ value: DEFAULT_VALUE, title: "Where links usually open" }] : []),
    { value: "current", title: "Current Space", separatorBefore: withDefault },
    { value: "little", title: "Little Orbit" },
    ...spaces.map((s, i) => ({ value: `space:${s.id}`, title: s.name, separatorBefore: i === 0 })),
    ...(missing ? [{ value: destinationValue(current), title: "Space deleted", separatorBefore: true }] : []),
  ];
}

export function AirTrafficPane() {
  const theme = useTheme();
  const rules = useAirTraffic((s) => (s.loaded ? s.rules : null));
  const fallback = useAirTraffic((s) => s.fallback);
  const spaces = useSpaces();
  const littleByDefault = useBrowser((s) => s.settings.openLinksInLittleArdia);
  useEffect(() => void airTrafficConfig(), []);
  const list = rules ?? [];
  return (
    <View>
      <SectionHeader
        title="Air Traffic Control"
        description="Choose where links from other apps open: Mail, Slack, Finder, the open command. Rules run from the top; the first match wins. Links you click inside Orbit stay where they are."
        action={<Button title="Add Rule…" icon="plus" onPress={() => showSettingsSheet(<RuleSheet />)} />}
      />
      <Group>
        {list.length ? (
          list.map((rule, i) => <RuleRow key={rule.id} rule={rule} index={i} count={list.length} />)
        ) : (
          <Row
            icon={<Symbol name="airplane" size={14} color={theme.textSecondary} style={{ width: 22, height: 22 }} />}
            title="No rules yet"
            description="Add one, or right-click a tab and choose Always Open … in this Space."
          />
        )}
      </Group>

      <SectionHeader title="Links that match no rule" />
      <Group>
        <Row
          title="Open in"
          description={fallback ? undefined : littleByDefault ? "Little Orbit, as set in General." : "A new tab in the window you used last, as set in General."}
        >
          <PopUp value={destinationValue(fallback)} options={destinationOptions(spaces, fallback, true)} onChange={(v) => setFallback(destinationOf(v))} minWidth={210} />
        </Row>
      </Group>

      <TestUrl />
    </View>
  );
}

function RuleRow({ rule, index, count }: { rule: AirTrafficRule; index: number; count: number }) {
  const theme = useTheme();
  const name = useDestinationName();
  const usable = useBrowser((s) => destinationUsable(rule.destination, (id) => !!s.profiles[id] && s.profileOrder.includes(id)));
  const deleted = !usable;
  const title = `${matchDescription(rule)}${rule.fromApp ? `, from ${rule.fromApp}` : ""}`;
  const description = deleted ? "Space deleted: this rule is skipped." : `${rule.enabled ? "Opens" : "Off. Would open"} in ${name(rule.destination)}.`;
  const more = async () => {
    const choice = await showMenu([
      { id: "edit", title: "Edit…", symbol: "pencil" },
      { separator: true },
      { id: "top", title: "Move to Top", enabled: index > 0 },
      { id: "up", title: "Move Up", symbol: "arrow.up", enabled: index > 0 },
      { id: "down", title: "Move Down", symbol: "arrow.down", enabled: index < count - 1 },
      { id: "bottom", title: "Move to Bottom", enabled: index < count - 1 },
      { separator: true },
      { id: "delete", title: "Delete Rule", symbol: "trash" },
    ]);
    if (choice === "edit") showSettingsSheet(<RuleSheet rule={rule} />);
    else if (choice === "top") moveRuleTo(rule.id, 0);
    else if (choice === "up") moveRuleTo(rule.id, index - 1);
    else if (choice === "down") moveRuleTo(rule.id, index + 1);
    else if (choice === "bottom") moveRuleTo(rule.id, count - 1);
    else if (choice === "delete") removeRule(rule.id);
  };
  return (
    <Row
      icon={
        <View style={{ width: 22, alignItems: "center", opacity: rule.enabled && !deleted ? 1 : 0.45 }}>
          {rule.match === "domain" ? (
            <Favicon url={`https://${rule.pattern}`} size={16} />
          ) : (
            <Symbol name={rule.match === "contains" ? "text.magnifyingglass" : "link"} size={13} color={theme.icon} style={{ width: 18, height: 18 }} />
          )}
        </View>
      }
      title={
        <Text numberOfLines={1} style={{ fontSize: 13, color: rule.enabled && !deleted ? theme.textPrimary : theme.textSecondary }}>
          <Text style={{ color: theme.textTertiary }}>{`${index + 1}  `}</Text>
          {title}
        </Text>
      }
      description={
        <Text style={{ fontSize: 11.5, marginTop: 2, lineHeight: 15, color: deleted ? "#E5534B" : theme.textSecondary }}>{description}</Text>
      }
    >
      <Toggle value={rule.enabled} onChange={(enabled) => updateRule(rule.id, { enabled })} />
      <Button title="Edit…" onPress={() => showSettingsSheet(<RuleSheet rule={rule} />)} />
      <IconButton icon="ellipsis" size={13} box={24} radius={6} tooltip="More" onPress={() => void more()} />
    </Row>
  );
}

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4, marginBottom: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary }}>{label}</Text>
      {children}
      {help ? <Text style={{ fontSize: 11.5, lineHeight: 15, color: theme.textSecondary }}>{help}</Text> : null}
    </View>
  );
}

function RuleSheet({ rule }: { rule?: AirTrafficRule }) {
  const theme = useTheme();
  const spaces = useSpaces();
  const lastSourceApp = useAirTraffic((s) => s.lastSourceApp);
  const currentSpace = useBrowser((s) => s.ui.lastProfileId);
  const [match, setMatch] = useState<AirTrafficMatchKind>(rule?.match ?? "domain");
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [fromApp, setFromApp] = useState(rule?.fromApp ?? "");
  const [destination, setDestination] = useState<AirTrafficDestination>(
    rule?.destination ?? (currentSpace && spaceExists(currentSpace) ? { kind: "space", spaceId: currentSpace } : { kind: "current" }),
  );
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!normalizePattern(match, pattern)) return setError(match === "domain" ? "Enter a domain such as github.com." : "Enter what the link should contain.");
    if (fromApp.trim() && !normalizeBundleId(fromApp)) return setError("Enter an app's bundle ID, such as com.tinyspeck.slackmacgap, or leave it empty.");
    const draft: RuleDraft = { match, pattern, fromApp: fromApp.trim() || null, destination };
    const ok = rule ? updateRule(rule.id, draft) : !!addRule(draft);
    if (!ok) return setError("Couldn't save this rule.");
    closeSettingsSheet();
  };

  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Symbol name="airplane" size={15} color={theme.icon} style={{ width: 22, height: 22 }} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{rule ? "Edit Rule" : "New Rule"}</Text>
      </View>
      <Field label="When a link" help={MATCH_HELP[match]}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <PopUp value={match} options={MATCH_OPTIONS} onChange={(v) => (setMatch(v), setError(null))} minWidth={170} />
          <TextField value={pattern} onChangeText={(t) => (setPattern(t), setError(null))} placeholder={PLACEHOLDERS[match]} autoFocus onSubmit={save} style={{ flex: 1 }} />
        </View>
      </Field>
      <Field
        label="Comes from app (optional)"
        help={lastSourceApp && lastSourceApp !== fromApp ? undefined : "The bundle ID of the app the link was clicked in. Empty means any app."}
      >
        <TextField value={fromApp} onChangeText={(t) => (setFromApp(t), setError(null))} placeholder="Any app, or e.g. com.tinyspeck.slackmacgap" onSubmit={save} />
        {lastSourceApp && lastSourceApp !== fromApp ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSecondary }}>{`The last link came from ${lastSourceApp}.`}</Text>
            <Button title="Use" kind="plain" onPress={() => setFromApp(lastSourceApp)} />
          </View>
        ) : null}
      </Field>
      <Field label="Open it in">
        <PopUp value={destinationValue(destination)} options={destinationOptions(spaces, destination, false)} onChange={(v) => setDestination(destinationOf(v) ?? { kind: "current" })} minWidth={210} />
      </Field>
      {error ? <Text style={{ marginBottom: 8, fontSize: 12, color: "#E5534B" }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        {rule ? <Button title="Delete" kind="destructive" onPress={() => (removeRule(rule.id), closeSettingsSheet())} /> : null}
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={rule ? "Save" : "Add Rule"} kind="primary" onPress={save} />
      </View>
    </Sheet>
  );
}

function TestUrl() {
  const theme = useTheme();
  const name = useDestinationName();
  const { url, fromApp } = useTestUrl();
  const setUrl = (text: string) => useTestUrl.setState({ url: text });
  const setFromApp = (text: string) => useTestUrl.setState({ fromApp: text });
  const rules = useAirTraffic((s) => s.rules);
  const fallback = useAirTraffic((s) => s.fallback);
  const littleByDefault = useBrowser((s) => s.settings.openLinksInLittleArdia);
  useBrowser((s) => s.profiles);
  const typed = url.trim();
  const full = typed && !/^[a-z][a-z0-9+.-]*:/i.test(typed) ? `https://${typed}` : typed;
  const result = full ? clearance({ rules, fallback }, full, fromApp.trim() || null, spaceExists) : null;
  const index = result?.ruleId ? rules.findIndex((r) => r.id === result.ruleId) : -1;
  const rule = index >= 0 ? rules[index]! : null;
  const usual = littleByDefault ? "Little Orbit" : "a new tab in the window you used last";
  const answer = !result
    ? "Type a link to see which rule catches it."
    : rule
      ? `Rule ${index + 1} (${matchDescription(rule)}) opens it in ${name(rule.destination)}.`
      : `No rule matches, so it opens in ${name(result.destination, usual)}.`;
  return (
    <>
      <SectionHeader title="Test a URL" />
      <Group>
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextField value={url} onChangeText={setUrl} placeholder="https://github.com/orbit/pulls" style={{ flex: 2 }} />
            <TextField value={fromApp} onChangeText={setFromApp} placeholder="From app (optional)" style={{ flex: 1 }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Symbol
              name={!result ? "questionmark.circle" : rule ? "checkmark.circle.fill" : "arrow.right"}
              size={12}
              color={rule ? "#34C759" : theme.textSecondary}
              style={{ width: 16, height: 16 }}
            />
            <Text style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>{answer}</Text>
          </View>
        </View>
      </Group>
    </>
  );
}
