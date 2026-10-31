import { ContextMenuArea, copyText, FadeLabel, MouseArea, showMenu, Symbol } from "@ardia/shell";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type GestureResponderEvent } from "react-native";
import { glassChrome, useGlassSidebar } from "../../lib/glassTheme";
import {
  CLOSED_VIEW,
  deviceDetail,
  deviceOpen,
  devicesBodyRows,
  devicesSectionHeight,
  deviceSymbols,
  showsSyncedDevices,
  sidebarDevices,
  type DevicesView,
  type SidebarDevice,
  type SidebarDeviceTab,
} from "../../lib/syncedDevices";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { devicesViewKey, loadDevicesViews, setDeviceOpen, setDevicesOpen, setSidebarHeight, useSyncedDevicesView } from "../../store/syncedDevices";
import { useSync } from "../../sync/engine";
import { openModeFor, openUrl } from "../bookmarks/actions";
import { Favicon, useHover } from "../primitives";
import { openSettings } from "../settings/windows";
import { dismissHover } from "./hover";

const METRICS = { rowHeight: layout.rowHeight, rowGap: layout.rowGap, padTop: 6, padBottom: 2 };
const INDENT = 14;
const NO_DEVICES: SidebarDevice[] = [];

const shownProfile = (s: BrowserState, windowId: string): string | null => {
  const w = s.windows[windowId];
  return w && !w.incognito && showsSyncedDevices(s.settings) ? w.profileId : null;
};

function useDevicesViewFor(windowId: string, profileId: string | null): DevicesView {
  loadDevicesViews();
  return useSyncedDevicesView((v) => (profileId ? v.views[devicesViewKey(windowId, profileId)] : undefined)) ?? CLOSED_VIEW;
}

export function useSyncedDevicesHeight(windowId: string): number {
  const profileId = useBrowser((s) => shownProfile(s, windowId));
  const view = useDevicesViewFor(windowId, profileId);
  const sidebarHeight = useSyncedDevicesView((v) => v.sidebarHeights[windowId] ?? 0);
  const rows = useSync((s) => {
    if (!profileId || !s.enabled) return -1;
    const devices = sidebarDevices(s.remoteTabs[profileId], s.devices);
    return devices.length ? devicesBodyRows(devices, view) : -1;
  });
  return rows < 0 ? 0 : devicesSectionHeight(rows, sidebarHeight, METRICS).height;
}

export function SyncedDevices({ windowId, bottom }: { windowId: string; bottom: number }) {
  const profileId = useBrowser((s) => shownProfile(s, windowId));
  const view = useDevicesViewFor(windowId, profileId);
  const sidebarHeight = useSyncedDevicesView((v) => v.sidebarHeights[windowId] ?? 0);
  const enabled = useSync((s) => s.enabled);
  const remote = useSync((s) => (profileId && s.enabled ? s.remoteTabs[profileId] : undefined));
  const seen = useSync((s) => s.devices);
  const devices = useMemo(() => (remote ? sidebarDevices(remote, seen) : NO_DEVICES), [remote, seen]);
  const shown = !!profileId && enabled && devices.length > 0;
  const size = devicesSectionHeight(devicesBodyRows(devices, view), sidebarHeight, METRICS);
  return (
    <>
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, top: 0, bottom, width: 0 }}
        onLayout={(e) => setSidebarHeight(windowId, Math.round(e.nativeEvent.layout.height))}
      />
      {shown ? (
        <View style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, bottom, height: size.height, paddingTop: METRICS.padTop }}>
          <DevicesHeader windowId={windowId} profileId={profileId} devices={devices} open={view.open} />
          {view.open ? (
            <ScrollView style={{ height: size.body }} scrollEnabled={size.scrolls} showsVerticalScrollIndicator={size.scrolls}>
              <View style={{ paddingTop: METRICS.rowGap, gap: METRICS.rowGap }}>
                {devices.map((d) => (
                  <DeviceBlock key={d.id} windowId={windowId} profileId={profileId} device={d} open={deviceOpen(view, d.id, devices.length)} />
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function useNow(every = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

function Chevron({ open }: { open: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center", transform: [{ rotate: open ? "0deg" : "-90deg" }] }}>
      <Symbol name="chevron.down" size={9} weight="semibold" color={theme.textTertiary} style={{ width: 10, height: 10 }} />
    </View>
  );
}

function RowFrame({ indent, tooltip, onPress, onContextMenu, onMiddleClick, children }: {
  indent: number;
  tooltip?: string;
  onPress: (e: GestureResponderEvent) => void;
  onContextMenu?: () => void;
  onMiddleClick?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const row = (
    <Pressable
      tooltip={tooltip}
      onPress={(e) => {
        dismissHover();
        onPress(e);
      }}
    >
      {({ pressed }) => (
        <View
          style={{
            height: layout.rowHeight,
            borderRadius: 10,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 9 + indent,
            paddingRight: 8,
            backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
          }}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
  return (
    <View {...hoverProps}>
      <MouseArea onMiddleClick={onMiddleClick}>
        <ContextMenuArea onContextMenu={onContextMenu ? () => (dismissHover(), onContextMenu()) : undefined}>{row}</ContextMenuArea>
      </MouseArea>
    </View>
  );
}

const DevicesHeader = memo(function DevicesHeader({ windowId, profileId, devices, open }: { windowId: string; profileId: string; devices: SidebarDevice[]; open: boolean }) {
  const theme = useTheme();
  const glass = useGlassSidebar();
  const { symbols, more } = deviceSymbols(devices, 3);
  const tabs = devices.reduce((n, d) => n + d.tabs.length, 0);
  return (
    <RowFrame
      indent={0}
      tooltip={`${tabs} ${tabs === 1 ? "tab" : "tabs"} open on your other devices`}
      onPress={() => setDevicesOpen(windowId, profileId, !open)}
      onContextMenu={() => void openDevicesMenu(windowId, profileId, open)}
    >
      <Symbol name="macbook.and.iphone" size={13} weight="medium" color={glass ? glassChrome(theme.dark).ink : theme.icon} style={{ width: 16, height: 16 }} />
      {glass ? (
        <Text numberOfLines={1} style={{ flexShrink: 0, marginLeft: 5, fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>
          Devices
        </Text>
      ) : (
        <FadeLabel text="Devices" fontSize={13} color={theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
      )}
      {glass ? (
        <View style={{ marginLeft: 7, marginRight: "auto" }}>
          <Chevron open={open} />
        </View>
      ) : null}
      {open ? null : (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginLeft: 6, flexShrink: 1, overflow: "hidden" }}>
          {symbols.map((name, i) => (
            <Symbol key={i} name={name} size={11} weight="medium" color={theme.textTertiary} style={{ width: 15, height: 15 }} />
          ))}
          {more ? <Text style={{ fontSize: 10.5, fontWeight: "500", color: theme.textTertiary }}>+{more}</Text> : null}
        </View>
      )}
      {glass ? null : (
        <View style={{ marginLeft: 6 }}>
          <Chevron open={open} />
        </View>
      )}
    </RowFrame>
  );
});

const DeviceBlock = memo(function DeviceBlock({ windowId, profileId, device, open }: { windowId: string; profileId: string; device: SidebarDevice; open: boolean }) {
  const theme = useTheme();
  const now = useNow();
  return (
    <>
      <RowFrame indent={0} tooltip={device.name} onPress={() => setDeviceOpen(windowId, profileId, device.id, !open)}>
        <Symbol name={device.symbol} size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
        <TwoLines title={device.name} detail={deviceDetail(device, now)} />
        <View style={{ marginLeft: 6 }}>
          <Chevron open={open} />
        </View>
      </RowFrame>
      {open ? device.tabs.map((t) => <DeviceTabRow key={t.url} windowId={windowId} profileId={profileId} tab={t} />) : null}
    </>
  );
});

const DeviceTabRow = memo(function DeviceTabRow({ windowId, profileId, tab }: { windowId: string; profileId: string; tab: SidebarDeviceTab }) {
  return (
    <RowFrame
      indent={INDENT}
      tooltip={tab.url}
      onPress={(e) => openSyncedUrl(tab.url, windowId, clickModifiers(e))}
      onMiddleClick={() => openSyncedUrl(tab.url, windowId, { middle: true })}
      onContextMenu={() => void openDeviceTabMenu(windowId, tab)}
    >
      <Favicon url={tab.url} size={16} profileId={profileId} />
      <TwoLines title={tab.title} detail={tab.host} />
    </RowFrame>
  );
});

function TwoLines({ title, detail }: { title: string; detail: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, marginLeft: 5, justifyContent: "center" }}>
      <FadeLabel text={title} fontSize={12.5} color={theme.textTab} style={{ height: 16 }} />
      <Text numberOfLines={1} style={{ marginLeft: 2, fontSize: 10.5, lineHeight: 13, color: theme.textTertiary }}>
        {detail}
      </Text>
    </View>
  );
}

type Modifiers = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean };

const clickModifiers = (e: GestureResponderEvent): Modifiers => {
  const n = e.nativeEvent as unknown as Modifiers;
  return { metaKey: !!n.metaKey, shiftKey: !!n.shiftKey, altKey: !!n.altKey };
};

export function openSyncedUrl(url: string, windowId: string, mods: Modifiers = {}) {
  const mode = openModeFor(mods);
  openUrl(url, windowId, mode === "current" ? "foreground" : mode);
}

const sep = { separator: true } as const;

export async function openDeviceTabMenu(windowId: string, tab: SidebarDeviceTab) {
  const choice = await showMenu([
    { id: "open", title: "Open", symbol: "arrow.up.forward.square" },
    { id: "window", title: "Open in New Window", symbol: "macwindow.badge.plus" },
    sep,
    { id: "copy", title: "Copy Link", symbol: "link" },
  ]);
  if (choice === "open") openSyncedUrl(tab.url, windowId);
  else if (choice === "window") openUrl(tab.url, windowId, "window");
  else if (choice === "copy") copyText(tab.url);
}

export async function openDevicesMenu(windowId: string, profileId: string, open: boolean) {
  const choice = await showMenu([
    { id: "toggle", title: open ? "Collapse" : "Expand" },
    sep,
    { id: "hide", title: "Hide Devices in Sidebar", symbol: "eye.slash" },
    { id: "settings", title: "Sync Settings…", symbol: "gearshape" },
  ]);
  if (choice === "toggle") setDevicesOpen(windowId, profileId, !open);
  else if (choice === "hide") useBrowser.getState().updateSettings({ showSyncedDevices: false });
  else if (choice === "settings") openSettings("sync");
}
