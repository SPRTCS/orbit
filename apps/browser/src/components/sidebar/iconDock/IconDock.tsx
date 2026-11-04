import { ContextMenuArea, MouseArea, Surface, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { closeTab } from "../../../lib/actions";
import { hex, layout, useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useWindowId, useWindowProfileId } from "../../../store/hooks";
import { activeTabId, isIncognitoProfile } from "../../../store/model";
import { appearanceOf, usePinnedFolders } from "../../../store/pinnedFolders";
import { IconButton } from "../../primitives";
import { clickTab, tabTitle } from "../actions";
import { dismissHoverIn } from "../hover";
import { openSidebarMenu, openTabMenu } from "../menus";
import { ResizeHandle } from "../ResizeHandle";
import { useSidebarUi } from "../state";
import { TabIcon } from "../TabIcon";
import { GROUP_COLORS, withAlpha } from "../tokens";
import { DockMagnification, ICON_DOCK_WIDTH, isIconDock, pageItems, pageKey, type DockItem, type DockPage, type Placement } from "./model";
import { dockSource, folderName } from "./source";

const STRIP = 4;
const FOOTER = 44;
const BACK_ROW = 40;
const FADE_MS = 180;
const TURN_MS = 260;
const GROW_MS = 140;
const SHRINK_MS = 180;
const DOT_X = 4;
const OVERFLOW = 480;

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
        <IconButton icon="plus" size={14} weight="semibold" box={32} radius={16} color={theme.icon} tooltip="New Tab (⌘T)" onPress={() => useBrowser.getState().newTab(windowId)} />
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
  const [scrollY] = useState(() => new Animated.Value(0));
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => void (offset.current = e.nativeEvent.contentOffset.y),
    }),
  );
  const latest = useRef({ dock, items, focus, open });
  latest.current = { dock, items, focus, open };

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
  const focused = focus === null ? null : dock.index(focus);
  const focusedItem = (): DockItem | null => {
    const { dock: d, items: list, focus: f } = latest.current;
    const i = f === null ? null : d.index(f);
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
  const placements = dock.layout(focus, amount);
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
          <View key={item.key} style={{ position: "absolute", left: 0, top: place.center - place.size / 2, height: place.size, flexDirection: "row", alignItems: "center" }}>
            {item.kind === "tab" && item.tabId === active ? (
              <View style={{ position: "absolute", left: DOT_X - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: theme.textPrimary, opacity: 0.7 }} />
            ) : null}
            <View style={{ marginLeft: leading }}>
              <DockTile item={item} size={place.size} />
            </View>
          </View>
        );
      })}
    </>
  );
}

const DockTile = memo(function DockTile({ item, size }: { item: DockItem; size: number }) {
  if (item.kind === "folder") return <FolderTile folderId={item.folderId} size={size} />;
  if (item.kind === "tab") return <SiteTile tabId={item.tabId} size={size} />;
  return null;
});

function TileFrame({ size, fill, children }: { size: number; fill?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Surface
        fill={hex(fill ?? (theme.dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.8)"))}
        cornerRadius={size * 0.225}
        borderColor={hex(theme.pinnedRestingStroke)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={0.16}
        shadowRadius={3}
        shadowOffset={[0, 1.5]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

function SiteTile({ tabId, size }: { tabId: string; size: number }) {
  const tab = useBrowser((s) => s.tabs[tabId]);
  if (!tab) return <TileFrame size={size}>{null}</TileFrame>;
  const icon = Math.round(size * 0.56);
  return (
    <TileFrame size={size}>
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
    <TileFrame size={size} fill={tint ? withAlpha(tint, 0.24) : theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)"}>
      {look.emoji ? (
        <Text style={{ fontSize: Math.round(size * 0.5), lineHeight: size * 0.62 }}>{look.emoji}</Text>
      ) : (
        <Symbol name="folder.fill" size={Math.round(size * 0.42)} weight="medium" color={tint ?? theme.textSecondary} style={{ width: size * 0.6, height: size * 0.6 }} />
      )}
    </TileFrame>
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
