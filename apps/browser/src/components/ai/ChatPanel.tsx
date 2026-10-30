import { copyText, Symbol } from "@ardia/shell";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import {
  closeChat,
  includesPage,
  newChat,
  retryChat,
  sendChat,
  sendQuickPrompt,
  setChatDraft,
  setChatQuote,
  setIncludePage,
  stopChat,
  useChats,
  type WindowChat,
} from "../../lib/ai/chat";
import { QUICK_PROMPTS, type ChatTurn, type QuickPrompt } from "../../lib/ai/prompt";
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, updateAiSettings, useAiEnabled, useAiSettings } from "../../lib/ai/settings";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { activeTab } from "../../store/model";
import { openFromPage } from "../layout/openFromPage";
import { openSettings } from "../settings/windows";
import { IconButton, useHover } from "../primitives";
import { Markdown } from "./Markdown";

declare module "react-native" {
  interface TextInputProps {
    submitKeyEvents?: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; functionKey?: boolean }[];
  }
}

const HEADER = 40;
const EMPTY_CHAT: WindowChat = { open: false, turns: [], draft: "", quote: null, includePage: null, focusRequest: 0, busy: false };

function rubberBand(width: number): number {
  const band = (over: number) => 36 * (1 - Math.exp(-over / 90));
  if (width > PANEL_MAX_WIDTH) return PANEL_MAX_WIDTH + band(width - PANEL_MAX_WIDTH);
  if (width < PANEL_MIN_WIDTH) return PANEL_MIN_WIDTH - band(PANEL_MIN_WIDTH - width);
  return width;
}
const clamp = (w: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w));

export function ChatPanel() {
  const windowId = useWindowId();
  const enabled = useAiEnabled();
  const open = useChats((c) => !!c[windowId]?.open) && enabled;
  const savedWidth = useAiSettings((s) => s.panelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(appear, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
  }, [open]);

  const width = dragWidth ?? savedWidth;
  const start = useRef(width);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = useAiSettings.getState().panelWidth;
          setDragWidth(start.current);
        },
        onPanResponderMove: (_, g) => setDragWidth(rubberBand(start.current - g.dx)),
        onPanResponderRelease: (_, g) => {
          const raw = rubberBand(start.current - g.dx);
          const target = clamp(raw);
          const finish = () => {
            updateAiSettings({ panelWidth: target });
            setDragWidth(null);
          };
          if (raw === target) return finish();
          const value = new Animated.Value(raw);
          value.addListener(({ value: v }) => setDragWidth(v));
          Animated.timing(value, { toValue: target, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: false }).start(() => {
            value.removeAllListeners();
            finish();
          });
        },
        onPanResponderTerminate: () => setDragWidth(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  if (!shown || !enabled) return null;
  const room = width + layout.cardInset - 1;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width, opacity: appear }}>
        <ChatCard windowId={windowId} />
        <View
          {...responder.panHandlers}
          onDoubleClick={() => updateAiSettings({ panelWidth: PANEL_DEFAULT_WIDTH })}
          style={{ position: "absolute", top: 0, bottom: 0, left: -3, width: 7, cursor: "col-resize" }}
        />
      </Animated.View>
    </Animated.View>
  );
}

function ChatCard({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const chat = useChats((c) => c[windowId] ?? EMPTY_CHAT);
  const scroll = useRef<ScrollView>(null);
  const pinned = useRef(true);
  const viewport = useRef(0);
  const lastAssistant = [...chat.turns].reverse().find((t) => t.role === "assistant")?.id;
  const onLink = (href: string) => {
    const s = useBrowser.getState();
    const w = s.windows[windowId];
    if (!w) return;
    openFromPage({ url: href, disposition: "foreground" }, { windowId, profileId: w.profileId, tabId: activeTab(s, windowId)?.id });
  };

  return (
    <View accessibilityLabel="Chat" style={{ flex: 1, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <View style={{ height: HEADER, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 5, gap: 7 }}>
        <Symbol name="sparkles" size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          Chat
        </Text>
        <IconButton icon="plus" size={13} tooltip="New Chat" disabled={!chat.turns.length && !chat.quote} onPress={() => newChat(windowId)} />
        <IconButton icon="xmark" size={12} weight="medium" tooltip="Close Chat" onPress={() => closeChat(windowId)} />
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }} />
      {chat.turns.length ? (
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, gap: 16 }}
          scrollEventThrottle={50}
          onLayout={(e) => (viewport.current = e.nativeEvent.layout.height)}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            pinned.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
          }}
          onContentSizeChange={() => pinned.current && scroll.current?.scrollToEnd({ animated: false })}
        >
          {chat.turns.map((turn) =>
            turn.role === "user" ? (
              <UserTurn key={turn.id} turn={turn} />
            ) : (
              <AssistantTurn key={turn.id} turn={turn} last={turn.id === lastAssistant} windowId={windowId} busy={chat.busy} onLink={onLink} />
            ),
          )}
        </ScrollView>
      ) : (
        <EmptyState windowId={windowId} />
      )}
      <Composer windowId={windowId} chat={chat} />
    </View>
  );
}

function EmptyState({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const page = useBrowser((s) => {
    const tab = activeTab(s, windowId);
    return !!tab && /^(https?|file):/i.test(tab.url);
  });
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", padding: 14, gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Ask Orbit</Text>
      <Text style={{ fontSize: 12.5, lineHeight: 17, color: theme.textSecondary }}>
        {page ? "Ask about this page, or anything else." : "Ask anything. Open a page to ask about it."}
      </Text>
      {page ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(QUICK_PROMPTS) as QuickPrompt[]).map((kind) => (
            <Chip key={kind} icon={QUICK_PROMPTS[kind].icon} title={QUICK_PROMPTS[kind].title} onPress={() => void sendQuickPrompt(windowId, kind)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Chip({ icon, title, onPress, active, disabled }: { icon: string; title: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const fill = active ? (theme.dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.08)") : hovered ? theme.toolbarHover : undefined;
  return (
    <View {...hoverProps} style={{ opacity: disabled ? 0.45 : 1, flexShrink: 1 }}>
      <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        <View
          style={{
            height: 24,
            borderRadius: 12,
            paddingHorizontal: 9,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.chipBorder,
            backgroundColor: fill,
          }}
        >
          <Symbol name={icon} size={11} color={active ? theme.textPrimary : theme.icon} style={{ width: 14, height: 14 }} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: active ? theme.textPrimary : theme.chipText }}>
            {title}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const UserTurn = memo(function UserTurn({ turn }: { turn: ChatTurn }) {
  const theme = useTheme();
  const bubble = theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.055)";
  return (
    <View style={{ alignItems: "flex-end", gap: 4 }}>
      <View style={{ maxWidth: "88%", borderRadius: 12, backgroundColor: bubble, paddingHorizontal: 11, paddingVertical: 8, gap: 6 }}>
        {turn.quote ? (
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 2, borderRadius: 1, backgroundColor: theme.chipBorder, marginRight: 8 }} />
            <Text numberOfLines={4} style={{ flexShrink: 1, fontSize: 12, lineHeight: 16, color: theme.textSecondary }}>
              {turn.quote}
            </Text>
          </View>
        ) : null}
        {turn.text ? (
          <Text selectable style={{ fontSize: 13.5, lineHeight: 19, color: theme.textPrimary }}>
            {turn.text}
          </Text>
        ) : null}
      </View>
      {turn.page ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "88%" }}>
          <Symbol name={turn.page.transcript ? "video" : "doc.text"} size={10} color={theme.textTertiary} style={{ width: 12, height: 12 }} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, color: theme.textTertiary }}>
            {turn.page.transcript ? "Video and transcript: " : ""}
            {turn.page.title || turn.page.url}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

function Thinking() {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.Text style={{ opacity: pulse, fontSize: 13, color: theme.textSecondary }}>Thinking…</Animated.Text>;
}

const AssistantTurn = memo(function AssistantTurn({
  turn,
  last,
  windowId,
  busy,
  onLink,
}: {
  turn: ChatTurn;
  last: boolean;
  windowId: string;
  busy: boolean;
  onLink: (href: string) => void;
}) {
  const theme = useTheme();
  const streaming = turn.status === "streaming";
  const destructive = theme.dark ? "#FF6961" : "#D70015";
  return (
    <View style={{ gap: 8 }}>
      {turn.text ? <Markdown text={turn.text} onLink={onLink} /> : streaming ? <Thinking /> : null}
      {turn.status === "error" ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
          <Symbol name="exclamationmark.triangle.fill" size={11} color={destructive} style={{ width: 14, height: 16 }} />
          <Text selectable style={{ flex: 1, fontSize: 12.5, lineHeight: 17, color: destructive }}>
            {turn.error}
          </Text>
        </View>
      ) : null}
      {!streaming ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -6 }}>
          {turn.text ? <IconButton icon="doc.on.doc" size={11} box={24} radius={6} tooltip="Copy" onPress={() => copyText(turn.text)} /> : null}
          {last && !busy ? <IconButton icon="arrow.clockwise" size={11} box={24} radius={6} tooltip="Retry" onPress={() => void retryChat(windowId)} /> : null}
          {turn.status === "stopped" ? <Text style={{ fontSize: 11, color: theme.textTertiary, marginLeft: 4 }}>Stopped</Text> : null}
          {turn.status === "error" && (turn.errorCode === "noKey" || turn.errorCode === "badKey" || turn.errorCode === "badModel" || turn.errorCode === "disabled") ? (
            <Chip icon="gearshape" title="Open AI Settings" onPress={() => openSettings("ai")} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function Composer({ windowId, chat }: { windowId: string; chat: WindowChat }) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const [height, setHeight] = useState(20);
  const page = useBrowser(
    useShallow((s) => {
      const tab = activeTab(s, windowId);
      return tab && /^(https?|file):/i.test(tab.url) ? { title: tab.customTitle || tab.title || tab.url, url: tab.url } : null;
    }),
  );
  const include = includesPage(chat);
  useEffect(() => {
    if (!chat.focusRequest) return;
    const timer = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [chat.focusRequest]);
  const canSend = !chat.busy && (!!chat.draft.trim() || !!chat.quote);
  const send = () => canSend && void sendChat(windowId);
  return (
    <View style={{ padding: 10, paddingTop: 6, gap: 6 }}>
      {chat.quote ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", borderRadius: 8, backgroundColor: theme.urlPill, paddingLeft: 8, paddingVertical: 6 }}>
          <View style={{ width: 2, alignSelf: "stretch", borderRadius: 1, backgroundColor: theme.chipBorder, marginRight: 7 }} />
          <Text numberOfLines={3} style={{ flex: 1, fontSize: 12, lineHeight: 16, color: theme.textSecondary }}>
            {chat.quote}
          </Text>
          <IconButton icon="xmark" size={9} box={20} radius={5} tooltip="Remove Quote" onPress={() => setChatQuote(windowId, null)} />
        </View>
      ) : null}
      <View
        style={{
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: theme.chipBorder,
          backgroundColor: theme.dark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.75)",
          paddingHorizontal: 10,
          paddingTop: 8,
          paddingBottom: 6,
          gap: 6,
        }}
      >
        <TextInput
          ref={input}
          value={chat.draft}
          onChangeText={(t) => setChatDraft(windowId, t)}
          placeholder={chat.quote ? "Ask about the selection…" : include && page ? "Ask about this page…" : "Ask anything…"}
          placeholderTextColor={theme.placeholder}
          selectionColor={theme.selection}
          multiline
          enableFocusRing={false}
          submitKeyEvents={[{ key: "Enter" }]}
          onSubmitEditing={send}
          keyDownEvents={[{ key: "Escape" }]}
          onKeyDown={(e) => {
            if (e.nativeEvent.key !== "Escape") return;
            if (chat.busy) stopChat(windowId);
            else if (chat.quote) setChatQuote(windowId, null);
            else closeChat(windowId);
          }}
          onContentSizeChange={(e) => setHeight(Math.min(140, Math.max(20, e.nativeEvent.contentSize.height)))}
          accessibilityLabel="Message"
          style={{ height, fontSize: 13.5, lineHeight: 19, color: theme.textPrimary, paddingVertical: 0 }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, flexDirection: "row" }}>
            <Chip
              icon="doc.text"
              title={page ? (include ? `Include ${page.title}` : "Include this page") : "No page to include"}
              active={include && !!page}
              disabled={!page}
              onPress={() => setIncludePage(windowId, !include)}
            />
          </View>
          {chat.busy ? (
            <SendButton stop tooltip="Stop" onPress={() => stopChat(windowId)} enabled />
          ) : (
            <SendButton tooltip="Send" onPress={send} enabled={canSend} />
          )}
        </View>
      </View>
    </View>
  );
}

function SendButton({ stop, tooltip, onPress, enabled }: { stop?: boolean; tooltip: string; onPress: () => void; enabled: boolean }) {
  const theme = useTheme();
  return (
    <View tooltip={tooltip}>
      <Pressable disabled={!enabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={tooltip}>
        {({ pressed }) => (
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: enabled ? theme.goButton : theme.goButtonIdle,
              opacity: pressed ? 0.8 : 1,
            }}
          >
            {stop ? (
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: theme.goButtonText }} />
            ) : (
              <Symbol name="arrow.up" size={11} weight="bold" color={enabled ? theme.goButtonText : theme.iconDisabled} style={{ width: 14, height: 14 }} />
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}
