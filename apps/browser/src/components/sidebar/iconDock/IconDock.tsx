import { ContextMenuArea, MouseArea, Surface, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { closeTab } from "../../../lib/actions";
import { withLivePage } from "../../../lib/livePage";
import { hex, layout, useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useWindowId, useWindowProfileId } from "../../../store/hooks";
import { activeTabId, isIncognitoProfile } from "../../../store/model";
import { appearanceOf, usePinnedFolders } from "../../../store/pinnedFolders";
import { IconButton, useHover } from "../../primitives";
import { clickTab, tabTitle } from "../actions";
import { dismissHoverIn } from "../hover";
import { openSidebarMenu, openTabMenu } from "../menus";
import { ResizeHandle } from "../ResizeHandle";
import { useSidebarUi } from "../state";
import { TabIcon } from "../TabIcon";
import { GROUP_COLORS } from "../tokens";
import { DockMagnification, ICON_DOCK_WIDTH, isIconDock, pageItems, pageKey, type DockItem, type DockPage, type Placement } from "./model";
import { DockFooter } from "./DockFooter";
import { dockSource, folderName } from "./source";

const STRIP = 4;
const FOOTER = 44;
const BACK_ROW = 40;
const FADE_MS = 180;
const TURN_MS = 260;
const GROW_MS = 140;
const SHRINK_MS = 180;
const OVERFLOW = 480;
const BADGE = 18;
const ICON_SHARE = 0.64;
const FOLDER_SYMBOL_SHARE = 0.5;
const FOLDER_EMOJI_SHARE = 0.58;
const BADGE_INSET = 4;
const BADGE_DROP = 7;

export const devIconDocks: Record<string, { hover: (y: number | null) => void; open: (index: number) => void; back: () => void; items: () => DockItem[] }> = {};
if (__DEV__) (globalThis as { acIconDock?: unknown }).acIconDock = devIconDocks;

export function IconDockSwitch({ width, children }: { width: number; children: ReactNode }) {
  const windowId = useWindowId();
  const dock = isIconDock(width);
  const dragging = useSidebarUi((u) => u.dragWidth[windowId] !== undefined);
  const [fade] = useState(() => new Animated.Value(dock ? 1 : 0));
  const [lingering, setLingering] = useState(false);
  const was = useRef(dock);
  useLayoutEffect(() => {
    if (was.current === dock) return;
    was.current = dock;
    dismissHoverIn(windowId);
    setLingering(true);
    Animated.timing(fade, { toValue: dock ? 1 : 0, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setLingering(false);
    });
  }, [dock]);
  const sidebarShown = !dock || dragging || lingering;
  const dockShown = dock || dragging || lingering;
  return (
    <View style={{ width, height: "100%" }}>
      {sidebarShown ? (
        <Animated.View pointerEvents={dock ? "none" : "box-none"} style={[StyleSheet.absoluteFill, { opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          {children}
        </Animated.View>
      ) : null}
      {dockShown ? (
        <Animated.View pointerEvents={dock ? "box-none" : "none"} style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <IconDock width={width} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function IconDock({ width }: { width: number }) {
  const windowId = useWindowId();
  const profileId = useWindowProfileId();
  const theme = useTheme();
  const tree = usePinnedFolders((f) => (isIncognitoProfile(profileId) ? undefined : f.trees[profileId]));
  const [path, setPath] = useState<DockPage[]>([]);
  const page = path[path.length - 1] ?? null;
  const key = useBrowser((s) => {
    const items = pageItems(dockSource(s, windowId, profileId, tree), page);
    return items ? items.map((i) => i.key).join("\n") : null;
  });
  const items = useMemo(() => pageItems(dockSource(useBrowser.getState(), windowId, profileId, tree), page) ?? [], [key, tree, page, windowId, profileId]);
  const [turn] = useState(() => new Animated.Value(0));
  const [turning, setTurning] = useState(false);

  useEffect(() => setPath([]), [profileId]);
  useEffect(() => {
    if (page && key === null) setPath([]);
  }, [page, key]);

  const go = (change: (p: DockPage[]) => DockPage[], forward: boolean) => {
    setPath(change);
    turn.stopAnimation();
    turn.setValue(forward ? 1 : -1);
    setTurning(true);
    Animated.timing(turn, { toValue: 0, duration: TURN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setTurning(false));
  };
  const open = (item: DockItem) => {
    if (item.kind === "folder") go((p) => [...p, { kind: "folder", id: item.folderId }], true);
    else if (item.kind === "tab") clickTab(windowId, item.tabId);
    else if (item.kind === "newTab") useBrowser.getState().newTab(windowId);
  };
  const back = () => {
    if (path.length) go((p) => p.slice(0, -1), false);
  };
  const title = page ? folderName(tree, page.id) : null;

  return (
    <View style={{ width, height: "100%" }}>
      <View style={{ height: layout.sidebarHeader }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
      </View>
      <View style={{ flex: 1, overflow: turning ? "hidden" : "visible" }}>
        <Animated.View
          style={{
            flex: 1,
            opacity: turn.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateX: turn.interpolate({ inputRange: [-1, 1], outputRange: [-width * 0.6, width * 0.6] }) }],
          }}
        >
          {page ? (
            <View style={{ height: BACK_ROW, alignItems: "center", justifyContent: "center" }}>
              <IconButton icon="chevron.backward" size={14} weight="semibold" box={32} radius={16} color={theme.icon} tooltip={title ? `Back from ${title}` : "Back"} onPress={back} />
            </View>
          ) : null}
          <DockPageView key={pageKey(page)} windowId={windowId} width={width} items={items} open={open} back={back} />
        </Animated.View>
      </View>
      <View style={{ height: FOOTER, alignItems: "center", justifyContent: "center" }}>
        <DockFooter />
      </View>
      <ResizeHandle windowId={windowId} />
    </View>
  );
}

function DockPageView({ windowId, width, items, open, back }: { windowId: string; width: number; items: DockItem[]; open: (item: DockItem) => void; back: () => void }) {
  const [viewport, setViewport] = useState(0);
  const dock = useMemo(() => new DockMagnification(items.map((i) => i.kind === "separator"), viewport), [items, viewport]);
  const [focus, setFocus] = useState<number | null>(null);
  const [amount, setAmount] = useState(0);
  const target = useRef(0);
  const frame = useRef<number | null>(null);
  const offset = useRef(0);
  const [, setScrolled] = useState(0);
  const [scrollY] = useState(() => new Animated.Value(0));
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        offset.current = e.nativeEvent.contentOffset.y;
        if (latest.current.focus !== null) setScrolled(offset.current);
      },
    }),
  );
  const placements = dock.layout(focus, amount);
  const latest = useRef({ dock, items, focus, open, placements });
  latest.current = { dock, items, focus, open, placements };

  const shown = useRef(0);
  const animateTo = (value: number) => {
    target.current = value;
    if (frame.current !== null) return;
    let last = Date.now();
    const step = () => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      const goal = target.current;
      const a = shown.current;
      const next = goal > a ? Math.min(goal, a + dt / GROW_MS) : Math.max(goal, a - dt / SHRINK_MS);
      shown.current = next;
      setAmount(next);
      const done = next === goal;
      frame.current = done ? null : requestAnimationFrame(step);
      if (done && goal === 0) setFocus(null);
    };
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  const hover = (y: number | null) => {
    if (y === null) return animateTo(0);
    setFocus(y);
    animateTo(1);
  };
  const focused = focus === null ? null : dock.hit(placements, focus);
  const focusedItem = (): DockItem | null => {
    const { dock: d, items: list, focus: f, placements: p } = latest.current;
    const i = f === null ? null : d.hit(p, f);
    return i === null ? null : (list[i] ?? null);
  };
  if (__DEV__) {
    devIconDocks[windowId] = {
      hover,
      open: (i) => latest.current.items[i] && latest.current.open(latest.current.items[i]!),
      back,
      items: () => latest.current.items,
    };
  }
  useEffect(() => () => void delete devIconDocks[windowId], [windowId]);

  const height = Math.max(dock.restHeight, viewport);
  const strips = useMemo(
    () =>
      Array.from({ length: Math.ceil(height / STRIP) }, (_, i) => (
        <View key={i} style={{ height: STRIP }} onMouseEnter={() => latestHover.current(i * STRIP + STRIP / 2)} />
      )),
    [height],
  );
  const latestHover = useRef(hover);
  latestHover.current = hover;
  const leading = (Math.max(ICON_DOCK_WIDTH, width) - dock.tile) / 2;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setViewport(e.nativeEvent.layout.height)} onMouseLeave={() => hover(null)}>
      <Animated.ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={onScroll}>
        <MouseArea
          onMiddleClick={() => {
            const item = focusedItem();
            if (item?.kind === "tab") void closeTab(item.tabId);
          }}
        >
          <ContextMenuArea
            onContextMenu={() => {
              const item = focusedItem();
              const tab = item?.kind === "tab" ? useBrowser.getState().tabs[item.tabId] : undefined;
              void (tab ? openTabMenu(windowId, tab) : openSidebarMenu(windowId));
            }}
          >
            <Pressable
              onPress={() => {
                const item = focusedItem();
                if (item && item.kind !== "separator") latest.current.open(item);
              }}
            >
              <View style={{ height }}>{strips}</View>
            </Pressable>
          </ContextMenuArea>
        </MouseArea>
      </Animated.ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.max(ICON_DOCK_WIDTH, width) + OVERFLOW, overflow: "hidden" }}>
        <Animated.View style={{ height, transform: [{ translateY: Animated.multiply(scrollY, -1) }] }}>
          <DockTiles windowId={windowId} items={items} placements={placements} leading={leading} tile={dock.tile} />
        </Animated.View>
      </View>
      {focused !== null && amount > 0.5 && items[focused] ? (
        <TitleBubble item={items[focused]!} place={placements[focused]!} leading={leading} offset={offset.current} viewport={viewport} opacity={(amount - 0.5) * 2} />
      ) : null}
      {focused !== null && amount > 0.5 && items[focused]?.kind === "tab" ? (
        <TileActions tabId={(items[focused] as { tabId: string }).tabId} place={placements[focused]!} leading={leading} edge={Math.max(ICON_DOCK_WIDTH, width)} offset={offset.current} opacity={(amount - 0.5) * 2} />
      ) : null}
    </View>
  );
}

function DockTiles({ windowId, items, placements, leading, tile }: { windowId: string; items: DockItem[]; placements: Placement[]; leading: number; tile: number }) {
  const theme = useTheme();
  const active = useBrowser((s) => activeTabId(s, windowId));
  return (
    <>
      {items.map((item, i) => {
        const place = placements[i]!;
        if (item.kind === "separator") {
          return (
            <View
              key={item.key}
              style={{ position: "absolute", left: leading + tile * 0.15, top: place.center - 0.5, width: tile * 0.7, height: 1, borderRadius: 0.5, backgroundColor: theme.textSecondary, opacity: 0.45 }}
            />
          );
        }
        return (
          <View key={item.key} style={{ position: "absolute", left: leading, top: place.center - place.size / 2, width: place.size, height: place.size }}>
            <DockTile item={item} size={place.size} framed={item.kind === "tab" && item.tabId === active} />
          </View>
        );
      })}
    </>
  );
}

const DockTile = memo(function DockTile({ item, size, framed }: { item: DockItem; size: number; framed: boolean }) {
  if (item.kind === "folder") return <FolderTile folderId={item.folderId} size={size} />;
  if (item.kind === "tab") return <SiteTile tabId={item.tabId} size={size} framed={framed} />;
  if (item.kind === "newTab") return <NewTabTile size={size} />;
  return null;
});

function TileFrame({ size, framed, children }: { size: number; framed: boolean; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {framed ? (
        <Surface
          fill={hex(theme.dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.8)")}
          cornerRadius={size * 0.225}
          borderColor={hex(theme.pinnedRestingStroke)}
          borderWidth={0.5}
          shadowColor="#000000"
          shadowOpacity={0.16}
          shadowRadius={3}
          shadowOffset={[0, 1.5]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
}

function SiteTile({ tabId, size, framed }: { tabId: string; size: number; framed: boolean }) {
  const tab = useBrowser((s) => s.tabs[tabId]);
  if (!tab) return <TileFrame size={size} framed={framed}>{null}</TileFrame>;
  const icon = Math.round(size * ICON_SHARE);
  return (
    <TileFrame size={size} framed={framed}>
      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={icon} />
    </TileFrame>
  );
}

function FolderTile({ folderId, size }: { folderId: string; size: number }) {
  const theme = useTheme();
  const profileId = useWindowProfileId();
  const folder = usePinnedFolders((f) => f.trees[profileId]?.folders[folderId]);
  const look = appearanceOf(folder);
  const tint = look.color ? GROUP_COLORS[look.color].hex : null;
  return (
    <TileFrame size={size} framed={false}>
      {look.emoji ? (
        <Text style={{ width: size, height: size, textAlign: "center", fontSize: Math.round(size * FOLDER_EMOJI_SHARE), lineHeight: size }}>{look.emoji}</Text>
      ) : (
        <Symbol name="folder.fill" size={Math.round(size * FOLDER_SYMBOL_SHARE)} weight="medium" color={tint ?? theme.textSecondary} style={{ width: size, height: size }} />
      )}
    </TileFrame>
  );
}

function NewTabTile({ size }: { size: number }) {
  const theme = useTheme();
  return (
    <TileFrame size={size} framed={false}>
      <Symbol name="plus" size={Math.round(size * 0.36)} weight="medium" color={theme.icon} style={{ width: size, height: size }} />
    </TileFrame>
  );
}

function TileActions({ tabId, place, leading, edge, offset, opacity }: { tabId: string; place: Placement; leading: number; edge: number; offset: number; opacity: number }) {
  const top = Math.max(0, place.center - place.size / 2 - offset + BADGE_DROP - BADGE / 2);
  return (
    <>
      <TileBadge icon="arrow.clockwise" tooltip="Reload" left={leading + BADGE_INSET - BADGE / 2} top={top} opacity={opacity} onPress={() => void withLivePage(tabId, (page) => page.reload())} />
      <TileBadge icon="xmark" tooltip="Close Tab" left={Math.min(leading + place.size - BADGE_INSET - BADGE / 2, edge - BADGE - 2)} top={top} opacity={opacity} onPress={() => void closeTab(tabId)} />
    </>
  );
}

function TileBadge({ icon, tooltip, left, top, opacity, onPress }: { icon: string; tooltip: string; left: number; top: number; opacity: number; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View tooltip={tooltip} style={{ position: "absolute", left, top, width: BADGE, height: BADGE, opacity }} {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <Surface
            fill={hex(pressed ? theme.toolbarPressed : hovered ? theme.textPrimary : theme.windowTint[0])}
            cornerRadius={BADGE / 2}
            borderColor={hex(theme.panelBorder)}
            borderWidth={0.5}
            shadowColor="#000000"
            shadowOpacity={0.22}
            shadowRadius={2}
            shadowOffset={[0, 1]}
            style={{ width: BADGE, height: BADGE, alignItems: "center", justifyContent: "center" }}
          >
            <Symbol name={icon} size={icon === "xmark" ? 8 : 9} weight="bold" color={hovered && !pressed ? theme.windowTint[0] : theme.textPrimary} style={{ width: BADGE, height: BADGE }} />
          </Surface>
        )}
      </Pressable>
    </View>
  );
}

function TitleBubble({ item, place, leading, offset, viewport, opacity }: { item: DockItem; place: Placement; leading: number; offset: number; viewport: number; opacity: number }) {
  const theme = useTheme();
  const profileId = useWindowProfileId();
  const tree = usePinnedFolders((f) => f.trees[profileId]);
  const label = useBrowser((s) => {
    if (item.kind === "tab") {
      const tab = s.tabs[item.tabId];
      return tab ? tabTitle(tab) : "";
    }
    if (item.kind === "newTab") return "New Tab";
    return item.kind === "folder" ? folderName(tree, item.folderId) : "";
  });
  if (!label) return null;
  const height = 30;
  const top = Math.min(Math.max(0, place.center - offset - height / 2), Math.max(0, viewport - height));
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: leading + place.size + 10, top, height, opacity, width: 320, alignItems: "flex-start" }}>
      <Surface
        fill={hex(theme.windowTint[0])}
        cornerRadius={9}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={12}
        shadowOffset={[0, 4]}
        style={{ height, maxWidth: 320, paddingHorizontal: 11, justifyContent: "center" }}
      >
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          {label}
        </Text>
      </Surface>
    </View>
  );
}
