import { confirm, prompt, showMenu, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  allowBoostScript,
  BOOSTS_WINDOW_ID,
  copyBoost,
  exportBoostFile,
  importBoostFile,
  importBoostFromClipboard,
  importBoostText,
  newBoostForSite,
  toggleZap,
  useBoostsWindow,
  type ImportResult,
} from "../../lib/boosts/actions";
import { FONTS, isIpHost, normalizeHost, normalizePath, safeSelector, siteLabel, siteMatchesUrl, TINTS, type Boost } from "../../lib/boosts/model";
import { boostsNativeAvailable } from "../../lib/boosts/native";
import { useBoostsStatus } from "../../lib/boosts/runtime";
import { useZap } from "../../lib/boosts/zap";
import { useTheme } from "../../lib/theme";
import { removeBoost, removeZap, updateBoost, useBoosts } from "../../store/boosts";
import { useBrowser } from "../../store/browser";
import { activeTabId, isIncognitoProfile, resolveWindowId } from "../../store/model";
import { HoverSlot } from "../HoverSlot";
import { EmptyState } from "../pages/PageLayout";
import { IconButton, useHover } from "../primitives";
import { Button, Group, PopUp, Row, Sheet, TextField, Toggle, useFormColors } from "../settings/controls";

const TOOLBAR = 52;
const LIST = 190;
const MONO = "Menlo";

function useCurrentPage() {
  return useBrowser((s) => {
    const w = resolveWindowId(s);
    const id = w ? activeTabId(s, w) : undefined;
    const tab = id ? s.tabs[id] : undefined;
    return tab && /^https?:\/\//i.test(tab.url) ? tab : undefined;
  });
}

function report(result: ImportResult) {
  if ("error" in result) void confirm({ title: "Couldn't Import the Boost", message: result.error, confirmTitle: "OK", windowId: BOOSTS_WINDOW_ID });
}

export function BoostsWindow() {
  const theme = useTheme();
  const boosts = useBoosts((b) => b.boosts);
  const selectedId = useBoostsWindow((w) => w.selected);
  const page = useCurrentPage();
  const [pasting, setPasting] = useState(false);
  const here = useMemo(() => (page ? boosts.filter((b) => siteMatchesUrl(b.site, page.url)) : []), [boosts, page?.url]);
  const others = useMemo(() => boosts.filter((b) => !here.includes(b)).sort((a, b) => a.site.host.localeCompare(b.site.host) || a.createdAt - b.createdAt), [boosts, here]);
  const selected = boosts.find((b) => b.id === selectedId) ?? here[0] ?? others[0];
  const select = (id: string | null) => useBoostsWindow.setState({ selected: id });

  const importMenu = async () => {
    const choice = await showMenu([
      { id: "file", title: "Import from File…" },
      { id: "clipboard", title: "Import from Clipboard" },
      { id: "text", title: "Paste Boost Text…" },
    ]);
    if (choice === "file") report(await importBoostFile());
    if (choice === "clipboard") report(await importBoostFromClipboard());
    if (choice === "text") setPasting(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingLeft: 84, paddingRight: 14, gap: 8 }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Boosts</Text>
        <View style={{ flex: 1 }} />
        <Button title="Import…" onPress={() => void importMenu()} />
        <Button
          title={page ? "New Boost for This Site" : "New Boost"}
          kind="primary"
          disabled={!page}
          onPress={() => {
            const id = newBoostForSite(page?.url);
            if (id) select(id);
          }}
        />
      </View>
      {!boostsNativeAvailable() ? (
        <Text style={{ marginHorizontal: 16, marginBottom: 8, fontSize: 12, color: theme.textSecondary }}>This build of Orbit can't apply boosts. Update Orbit to use them.</Text>
      ) : null}
      {boosts.length === 0 ? (
        <EmptyState
          icon={<Symbol name="paintbrush.pointed" size={28} color={theme.textTertiary} style={{ width: 34, height: 34 }} />}
          title="No boosts yet"
          subtitle="Boosts change how a site looks and works: hide things with Zap, restyle it, or add your own CSS and JavaScript."
        />
      ) : (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <BoostList here={here} others={others} hostLabel={page ? hostOf(page.url) : null} selectedId={selected?.id ?? null} onSelect={select} />
          <View style={{ flex: 1 }}>{selected ? <BoostEditor key={selected.id} boost={selected} pageUrl={page?.url} pageTabId={page?.id} /> : null}</View>
        </View>
      )}
      {pasting ? <PasteSheet onClose={() => setPasting(false)} /> : null}
    </View>
  );
}

const hostOf = (url: string) => url.replace(/^https?:\/\/(?:[^@/?#]*@)?/i, "").replace(/[:/?#].*$/, "").replace(/^www\./, "");

function BoostList({
  here,
  others,
  hostLabel,
  selectedId,
  onSelect,
}: {
  here: Boost[];
  others: Boost[];
  hostLabel: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const heading = (title: string) => (
    <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
      {title}
    </Text>
  );
  return (
    <ScrollView style={{ width: LIST, flexGrow: 0, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth * 2, borderRightColor: colors.separator }} contentContainerStyle={{ paddingBottom: 12, paddingHorizontal: 6 }}>
      {hostLabel ? heading(`This Site · ${hostLabel}`) : null}
      {hostLabel && !here.length ? <Text style={{ fontSize: 12, color: theme.textTertiary, paddingHorizontal: 12, paddingVertical: 4 }}>No boosts here yet</Text> : null}
      {here.map((b) => (
        <ListRow key={b.id} boost={b} selected={b.id === selectedId} onPress={() => onSelect(b.id)} />
      ))}
      {others.length ? heading(hostLabel ? "Other Sites" : "All Sites") : null}
      {others.map((b) => (
        <ListRow key={b.id} boost={b} selected={b.id === selectedId} onPress={() => onSelect(b.id)} />
      ))}
    </ScrollView>
  );
}

const ListRow = memo(function ListRow({ boost, selected, onPress }: { boost: Boost; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={boost.name} accessibilityState={{ selected }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 8,
            paddingVertical: 6,
            borderRadius: 7,
            backgroundColor: selected ? colors.selected : hovered ? theme.rowHover : undefined,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: boost.enabled ? colors.accent : colors.switchOff }} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textPrimary }}>
              {boost.name}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary }}>
              {siteLabel(boost.site)}
            </Text>
          </View>
          <Toggle value={boost.enabled} onChange={(enabled) => updateBoost(boost.id, { enabled })} />
        </View>
      </Pressable>
    </View>
  );
});

function CommitField({ value, onCommit, placeholder, invalid, wide }: { value: string; onCommit: (text: string) => boolean; placeholder?: string; invalid?: string; wide?: boolean }) {
  const colors = useFormColors();
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return setError(false);
    setError(!onCommit(text));
  };
  return (
    <View style={wide ? { flex: 1 } : { width: 170 }}>
      <TextField value={text} onChangeText={setText} placeholder={placeholder} onSubmit={commit} onBlur={commit} onEscape={() => setText(value)} style={error ? { borderColor: colors.destructive } : undefined} />
      {error && invalid ? <Text style={{ fontSize: 11, color: colors.destructive, marginTop: 3 }}>{invalid}</Text> : null}
    </View>
  );
}

function CodeEditor({ value, onChange, placeholder, label }: { value: string; onChange: (text: string) => void; placeholder: string; label: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  return (
    <View style={{ height: 150, borderRadius: 8, padding: 8, backgroundColor: colors.field, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.fieldBorder }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        selectionColor={theme.selection}
        enableFocusRing={false}
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={label}
        style={{ flex: 1, fontSize: 12, lineHeight: 17, color: theme.textPrimary, fontFamily: MONO }}
      />
    </View>
  );
}

function Section({ title, detail, action, children }: { title: string; detail?: string; action?: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 6, paddingHorizontal: 2, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
          {detail ? <Text style={{ fontSize: 11.5, marginTop: 2, color: theme.textSecondary, lineHeight: 15 }}>{detail}</Text> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

function BoostEditor({ boost, pageUrl, pageTabId }: { boost: Boost; pageUrl?: string; pageTabId?: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  const profiles = useBrowser((s) => s.profiles);
  const profileOrder = useBrowser((s) => s.profileOrder);
  const error = useBoostsStatus((s) => Object.values(s.errors)[0] ?? null);
  const zapping = useZap((z) => !!z.session && z.session.boostId === boost.id);
  const onPage = !!pageUrl && siteMatchesUrl(boost.site, pageUrl);
  const spaces = profileOrder.filter((id) => !isIncognitoProfile(id) && profiles[id]);
  const fontKnown = FONTS.some((f) => f.value === boost.style.font);
  const fontOptions = [
    ...FONTS.map((f) => ({ value: f.value, title: f.title })),
    ...(fontKnown ? [] : [{ value: boost.style.font, title: boost.style.font }]),
    { value: "\u0000custom", title: "Other Font…", separatorBefore: true },
  ];
  const set = (patch: Partial<Boost>) => updateBoost(boost.id, patch);

  const pickFont = async (value: string) => {
    if (value !== "\u0000custom") return set({ style: { ...boost.style, font: value } });
    const name = await prompt({ title: "Font for this boost", message: "Type the name of a font installed on this Mac, like Avenir Next.", confirmTitle: "Use Font", windowId: BOOSTS_WINDOW_ID });
    const clean = name?.replace(/["\\;{}<>]/g, "").trim();
    if (clean) set({ style: { ...boost.style, font: `"${clean}"` } });
  };
  const addSelector = async () => {
    const selector = await prompt({ title: "Hide elements matching a CSS selector", message: "For example: .sidebar-ads or #promo", confirmTitle: "Hide", windowId: BOOSTS_WINDOW_ID });
    const clean = selector?.trim();
    if (clean && safeSelector(clean)) set({ zaps: [...boost.zaps, { selector: clean, label: "Added by hand" }] });
  };
  const remove = async () => {
    const { confirmed } = await confirm({
      title: `Delete the boost “${boost.name}”?`,
      message: "Its styles, zapped elements and code will be removed. Pages change back when they reload.",
      confirmTitle: "Delete",
      destructive: true,
      windowId: BOOSTS_WINDOW_ID,
    });
    if (confirmed) {
      removeBoost(boost.id);
      useBoostsWindow.setState({ selected: null });
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <CommitField value={boost.name} onCommit={(name) => (name.trim() ? (set({ name: name.trim() }), true) : false)} placeholder="Name" invalid="Give the boost a name." wide />
        </View>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>{boost.enabled ? "On" : "Off"}</Text>
        <Toggle value={boost.enabled} onChange={(enabled) => set({ enabled })} />
      </View>
      {error ? <Text style={{ marginTop: 8, fontSize: 11.5, color: colors.destructive }}>{`Boosts couldn't be applied: ${error}`}</Text> : null}

      <Section title="Site">
        <Group>
          <Row title="Website">
            <CommitField
              value={boost.site.host}
              placeholder="example.com"
              invalid="That isn't a website address."
              onCommit={(text) => {
                const host = normalizeHost(text);
                if (!host) return false;
                set({ site: { ...boost.site, host: host.host, subdomains: boost.site.subdomains || host.subdomains } });
                return true;
              }}
            />
          </Row>
          {isIpHost(boost.site.host) || boost.site.host === "localhost" ? null : (
            <Row title="Include subdomains" description={`Also applies on pages like www.${boost.site.host}`}>
              <Toggle value={boost.site.subdomains} onChange={(subdomains) => set({ site: { ...boost.site, subdomains } })} />
            </Row>
          )}
          <Row title="Only pages under" description="Leave empty for the whole site. * matches anything.">
            <CommitField
              value={boost.site.path}
              placeholder="/path"
              invalid="Use a path like /news or /docs/*."
              onCommit={(text) => {
                const path = normalizePath(text);
                if (path === null) return false;
                set({ site: { ...boost.site, path } });
                return true;
              }}
            />
          </Row>
          {spaces.length > 1 ? (
            <Row title="Space">
              <PopUp
                value={boost.profileId ?? ""}
                options={[{ value: "", title: "All Spaces" }, ...spaces.map((id, i) => ({ value: id, title: profiles[id]!.name || "Space", separatorBefore: i === 0 }))]}
                onChange={(id) => set({ profileId: id || null })}
                minWidth={160}
              />
            </Row>
          ) : null}
          <Row title="Run in private windows" description="Off by default, so private browsing stays as the site made it.">
            <Toggle value={boost.incognito} onChange={(incognito) => set({ incognito })} />
          </Row>
        </Group>
      </Section>

      <Section title="Style">
        <Group>
          <Row title="Font">
            <PopUp value={boost.style.font} options={fontOptions} onChange={(v) => void pickFont(v)} minWidth={160} />
          </Row>
          <Row title="Color tint">
            <PopUp
              value={boost.style.tint === null ? "none" : String(boost.style.tint)}
              options={TINTS.map((t) => ({ value: t.value === null ? "none" : String(t.value), title: t.title }))}
              onChange={(v) => set({ style: { ...boost.style, tint: v === "none" ? null : Number(v) } })}
              minWidth={160}
            />
          </Row>
          <Row title="Dark page" description="Inverts the page's colors, keeping photos and videos as they are.">
            <Toggle value={boost.style.dark} onChange={(dark) => set({ style: { ...boost.style, dark } })} />
          </Row>
        </Group>
      </Section>

      <Section
        title="Zapped Elements"
        detail={boost.zaps.length ? undefined : "Nothing hidden yet."}
        action={
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button title="Add Selector…" onPress={() => void addSelector()} />
            {onPage && pageTabId ? <Button title={zapping ? "Stop Zapping" : "Zap…"} onPress={() => toggleZap(pageTabId)} /> : null}
          </View>
        }
      >
        {boost.zaps.length ? (
          <Group>
            {boost.zaps.map((z) => (
              <ZapRow key={z.selector} label={z.label} selector={z.selector} onRemove={() => removeZap(boost.id, z.selector)} />
            ))}
          </Group>
        ) : null}
      </Section>

      <Section title="CSS" detail="Applies before the page first paints, in every frame of the site.">
        <CodeEditor value={boost.css} onChange={(css) => set({ css })} placeholder={"body {\n  max-width: 900px;\n  margin: auto;\n}"} label="CSS" />
      </Section>

      <Section title="JavaScript" detail="Runs when the page's document is ready, apart from the page's own scripts. Changes apply on reload.">
        {boost.js.trim() && !boost.jsAllowed ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: theme.dark ? "rgba(255,159,10,0.16)" : "rgba(255,149,0,0.12)" }}>
            <Symbol name="exclamationmark.triangle.fill" size={12} color="#FF9F0A" style={{ width: 16, height: 16 }} />
            <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: theme.textPrimary }}>This JavaScript came from someone else and won't run until you allow it.</Text>
            <Button title="Allow…" onPress={() => void allowBoostScript(boost.id)} />
          </View>
        ) : null}
        <CodeEditor value={boost.js} onChange={(js) => set({ js })} placeholder={'document.title = "Focus";'} label="JavaScript" />
      </Section>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
        <Button title="Export…" icon="square.and.arrow.up" onPress={() => void exportBoostFile(boost).catch(() => {})} />
        <Button title="Copy as Text" icon="doc.on.doc" onPress={() => copyBoost(boost)} />
        <View style={{ flex: 1 }} />
        <Button title="Delete Boost" kind="destructive" onPress={() => void remove()} />
      </View>
    </ScrollView>
  );
}

function ZapRow({ label, selector, onRemove }: { label: string; selector: string; onRemove: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: theme.textPrimary }}>
          {label || selector}
        </Text>
        <Text numberOfLines={1} selectable style={{ fontSize: 11, color: theme.textSecondary, fontFamily: MONO }}>
          {selector}
        </Text>
      </View>
      <HoverSlot hovered={hovered} width={24} hover={<IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} tooltip="Show Again" onPress={onRemove} />} />
    </View>
  );
}

function PasteSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const result = await importBoostText(text);
    if ("error" in result) return setError(result.error);
    onClose();
  };
  return (
    <Sheet width={460} onClose={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>Paste a Boost</Text>
      <Text style={{ fontSize: 12, marginTop: 4, color: theme.textSecondary }}>Paste the text someone shared with “Copy as Text”. You'll see what it does before it's added.</Text>
      <View style={{ marginTop: 12, height: 160, borderRadius: 7, padding: 8, backgroundColor: colors.field, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: error ? colors.destructive : colors.fieldBorder }}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          multiline
          autoFocus
          placeholder={'{ "orbitBoost": 1, … }'}
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.selection}
          enableFocusRing={false}
          autoCorrect={false}
          spellCheck={false}
          style={{ flex: 1, fontSize: 12, lineHeight: 17, color: theme.textPrimary, fontFamily: MONO }}
        />
      </View>
      <Text style={{ minHeight: 16, marginTop: 6, fontSize: 11.5, color: colors.destructive }}>{error ?? ""}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Button title="Cancel" onPress={onClose} />
        <Button title="Import…" kind="primary" disabled={!text.trim()} onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}
