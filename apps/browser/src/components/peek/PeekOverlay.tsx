import { WebView } from "@ardia/ardiacore";
import { breadcrumb } from "@ardia/core";
import { FadeLabel, Surface } from "@ardia/shell";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { closePeek, notePeekPage, openPeekAsTab, setPeekHandOff, usePeeks, type Peek } from "../../lib/peek";
import { handOff } from "../../lib/tabPages";
import { hex, layout, useTheme } from "../../lib/theme";
import { webviewRef, webviews } from "../../lib/webviews";
import { engineProfile } from "../../store/model";
import { openFromPage } from "../layout/openFromPage";
import { Favicon, IconButton } from "../primitives";

const SHARE = 0.85;
const MARGIN = 16;
const BAR = 36;
const RADIUS = 12;
const BUTTON = 26;
const FADE_MS = 160;

setPeekHandOff(handOff);

export function PeekOverlay({ windowId, width, height }: { windowId: string; width: number; height: number }) {
  const peek = usePeeks((p) => p.peeks[windowId]);
  if (!peek || width <= 0 || height <= 0) return null;
  return <PeekCard key={peek.id} peek={peek} width={width} height={height} />;
}

function PeekCard({ peek, width, height }: { peek: Peek; width: number; height: number }) {
  const theme = useTheme();
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const cardWidth = Math.round(Math.max(Math.min(width * SHARE, width - 2 * MARGIN), 0));
  const cardHeight = Math.round(Math.max(Math.min(height * SHARE + BAR, height - 2 * MARGIN), 0));
  const left = Math.round((width - cardWidth) / 2);
  const top = Math.round((height - cardHeight) / 2);
  const close = () => closePeek(peek.windowId);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
        <Pressable
          accessibilityLabel="Close Peek"
          onPress={close}
          style={[StyleSheet.absoluteFill, { borderRadius: layout.cardRadius, backgroundColor: theme.dark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.22)" }]}
        />
      </Animated.View>
      <Animated.View style={{ position: "absolute", left, top, width: cardWidth, height: cardHeight, opacity: shown }}>
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={RADIUS}
          borderColor={hex(theme.panelBorder)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={24}
          shadowOffset={[0, 10]}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flex: 1, borderRadius: RADIUS, overflow: "hidden" }}>
          <PeekBar peek={peek} onClose={close} />
          <View style={{ flex: 1, backgroundColor: theme.dark ? "#000000" : "#FFFFFF" }}>
            <PeekPage peek={peek} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function PeekBar({ peek, onClose }: { peek: Peek; onClose: () => void }) {
  const theme = useTheme();
  const { url, title, favicon } = peek.page;
  const host = url ? breadcrumb(url).host : "";
  return (
    <View style={{ height: BAR, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 6, gap: 8 }}>
      <Favicon url={url} favicon={favicon} profileId={peek.profileId} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: "60%", fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          {host}
        </Text>
        {title && title !== host ? <FadeLabel text={`  ${title}`} fontSize={13} color={theme.textSecondary} fadeWidth={14} style={{ flex: 1, height: 18 }} /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        <IconButton icon="rectangle.split.2x1" size={13} box={BUTTON} radius={7} tooltip="Open in Split View" onPress={() => openPeekAsTab(peek.windowId, { split: true })} />
        <IconButton icon="arrow.up.left.and.arrow.down.right" size={12} box={BUTTON} radius={7} tooltip="Open as Tab" onPress={() => openPeekAsTab(peek.windowId)} />
        <IconButton icon="xmark" size={12} box={BUTTON} radius={7} tooltip="Close (Esc)" onPress={onClose} />
      </View>
    </View>
  );
}

function PeekPage({ peek }: { peek: Peek }) {
  const ref = useMemo(() => webviewRef(peek.id), [peek.id]);
  const { windowId, id, profileId } = peek;
  return (
    <WebView
      ref={ref}
      style={StyleSheet.absoluteFill}
      url={peek.url}
      adoptId={peek.adoptId}
      profile={engineProfile(profileId)}
      transferKey={id}
      visible
      onReady={() => void webviews.get(id)?.focus()}
      onNavigationChange={({ url, title, isLoading }) => notePeekPage(windowId, id, { url: url || peek.page.url, title, isLoading })}
      onFavicon={(favicon) => favicon && notePeekPage(windowId, id, { favicon })}
      onOpenWindow={(request) => openFromPage(request, { windowId, profileId })}
      onWindowClose={() => closePeek(windowId)}
      onCommand={({ command }) => command === "escape" && closePeek(windowId)}
    />
  );
}
