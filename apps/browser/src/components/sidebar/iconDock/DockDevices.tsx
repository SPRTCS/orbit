import { ContextMenuArea, MouseArea, Surface, Symbol } from "@ardia/shell";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, View, type GestureResponderEvent } from "react-native";
import { deviceDetail, deviceOpen, type SidebarDevice } from "../../../lib/syncedDevices";
import { markHoverProps } from "../../../lib/hoverShift";
import { hex, useTheme } from "../../../lib/theme";
import { useWindowId } from "../../../store/hooks";
import { setDeviceOpen, setDevicesOpen } from "../../../store/syncedDevices";
import { Favicon } from "../../primitives";
import { clickModifiers, openDevicesMenu, openDeviceTabMenu, openSyncedUrl, useWindowDevices } from "../SyncedDevices";
import { DEVICES_DOCK, devicesDockHeight, devicesDockLayout, type DevicesDockRow } from "./devicesDock";

const UNFOLD_MS = 240;
const FOLD_MS = 180;
const HIT = 36;
const BUBBLE = 30;
const GROUP_WIDTH = 56;

type Hovered = { key: string; label: string; top: number } | null;

export function DockDevices({ width, available }: { width: number; available: number }) {
  const windowId = useWindowId();
  const theme = useTheme();
  const { profileId, view, devices, shown } = useWindowDevices(windowId);
  const layout = useMemo(() => devicesDockLayout(devices, (id) => deviceOpen(view, id, devices.length)), [devices, view]);
  const visible = devicesDockHeight(layout.height, available);
  const target = view.open ? visible : 0;
  const [height] = useState(() => new Animated.Value(target));
  const scroll = useRef<ScrollView>(null);
  const [offset, setOffset] = useState(0);
  const [hovered, setHovered] = useState<Hovered>(null);
  const shownTarget = useRef(target);

  useEffect(() => {
    const growing = target > shownTarget.current;
    shownTarget.current = target;
    Animated.timing(height, { toValue: target, duration: growing ? UNFOLD_MS : FOLD_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [target]);

  if (!shown || !profileId) return null;
  const column = Math.max(width, HIT + 8);
  const byId = new Map(devices.map((d) => [d.id, d]));
  const hover = (key: string, label: string, top: number) => setHovered({ key, label, top });
  const leave = (key: string) => setHovered((h) => (h?.key === key ? null : h));

  const rowLabel = (row: DevicesDockRow, device: SidebarDevice) =>
    row.kind === "device" ? `${device.name} · ${deviceDetail(device, Date.now())}` : device.tabs[row.index]!.title || device.tabs[row.index]!.host;

  return (
    <View style={{ width: column }}>
      <Animated.View style={{ height, overflow: "hidden" }}>
        <ScrollView
          ref={scroll}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: visible }}
          scrollEnabled={layout.height > visible}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => setOffset(e.nativeEvent.contentOffset.y)}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <View style={{ height: layout.height }}>
            {layout.groups.map((g) => (
              <View
                key={g.deviceId}
                style={{ position: "absolute", left: (column - GROUP_WIDTH) / 2, width: GROUP_WIDTH, top: g.top, height: g.height, borderRadius: 14, backgroundColor: theme.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }}
              />
            ))}
            {layout.rows.map((row) => {
              const device = byId.get(row.deviceId);
              if (!device) return null;
              const label = rowLabel(row, device);
              const top = row.y + (DEVICES_DOCK.row - HIT) / 2;
              const enter = () => hover(row.key, label, row.y - offset + (DEVICES_DOCK.row - BUBBLE) / 2);
              if (row.kind === "device") {
                const open = deviceOpen(view, device.id, devices.length);
                return (
                  <DevicesTile key={row.key} left={(column - HIT) / 2} top={top} onEnter={enter} onLeave={() => leave(row.key)} onPress={() => setDeviceOpen(windowId, profileId, device.id, !open)}>
                    <Symbol name={device.symbol} size={17} weight="medium" color={theme.icon} style={{ width: HIT, height: HIT }} />
                  </DevicesTile>
                );
              }
              const tab = device.tabs[row.index]!;
              return (
                <DevicesTile
                  key={row.key}
                  left={(column - HIT) / 2}
                  top={top}
                  onEnter={enter}
                  onLeave={() => leave(row.key)}
                  onPress={(e) => openSyncedUrl(tab.url, windowId, clickModifiers(e))}
                  onMiddleClick={() => openSyncedUrl(tab.url, windowId, { middle: true })}
                  onContextMenu={() => void openDeviceTabMenu(windowId, tab)}
                >
                  <Favicon url={tab.url} size={22} profileId={profileId} />
                </DevicesTile>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
      <View style={{ height: DEVICES_DOCK.root, alignItems: "center", justifyContent: "center" }}>
        <DevicesTile
          left={(column - HIT) / 2}
          top={(DEVICES_DOCK.root - HIT) / 2}
          framed={view.open}
          onEnter={() => hover("root", devicesLabel(devices), target + (DEVICES_DOCK.root - BUBBLE) / 2)}
          onLeave={() => leave("root")}
          onPress={() => setDevicesOpen(windowId, profileId, !view.open)}
          onContextMenu={() => void openDevicesMenu(windowId, profileId, view.open)}
        >
          <Symbol name="macbook.and.iphone" size={17} weight="medium" color={theme.icon} style={{ width: HIT, height: HIT }} />
        </DevicesTile>
      </View>
      {hovered ? <DevicesBubble left={(column + HIT) / 2 + 10} top={hovered.top} label={hovered.label} /> : null}
    </View>
  );
}

function devicesLabel(devices: SidebarDevice[]): string {
  const tabs = devices.reduce((n, d) => n + d.tabs.length, 0);
  return `Devices · ${tabs} ${tabs === 1 ? "tab" : "tabs"}`;
}

function DevicesTile({ left, top, framed, onEnter, onLeave, onPress, onMiddleClick, onContextMenu, children }: {
  left: number;
  top: number;
  framed?: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPress: (e: GestureResponderEvent) => void;
  onMiddleClick?: () => void;
  onContextMenu?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: () => {
        setHover(true);
        latest.current.onEnter();
      },
      onMouseLeave: () => {
        setHover(false);
        latest.current.onLeave();
      },
    }),
  );
  const latest = useRef({ onEnter, onLeave });
  latest.current = { onEnter, onLeave };
  return (
    <View style={{ position: "absolute", left, top, width: HIT, height: HIT }} {...hoverProps}>
      <MouseArea onMiddleClick={onMiddleClick}>
        <ContextMenuArea onContextMenu={onContextMenu}>
          <Pressable onPress={onPress}>
            {({ pressed }) => (
              <View style={{ width: HIT, height: HIT, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.tabPressed : hover ? theme.tabHover : undefined }}>
                {framed ? (
                  <Surface
                    fill={hex(theme.dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.8)")}
                    cornerRadius={10}
                    borderColor={hex(theme.pinnedRestingStroke)}
                    borderWidth={0.5}
                    shadowColor="#000000"
                    shadowOpacity={0.16}
                    shadowRadius={3}
                    shadowOffset={[0, 1.5]}
                    style={{ position: "absolute", left: 0, top: 0, width: HIT, height: HIT }}
                  />
                ) : null}
                {children}
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </MouseArea>
    </View>
  );
}

function DevicesBubble({ left, top, label }: { left: number; top: number; label: string }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left, top, height: BUBBLE, width: 320, alignItems: "flex-start" }}>
      <Surface
        fill={hex(theme.windowTint[0])}
        cornerRadius={9}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={12}
        shadowOffset={[0, 4]}
        style={{ height: BUBBLE, maxWidth: 320, paddingHorizontal: 11, justifyContent: "center" }}
      >
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>
          {label}
        </Text>
      </Surface>
    </View>
  );
}
