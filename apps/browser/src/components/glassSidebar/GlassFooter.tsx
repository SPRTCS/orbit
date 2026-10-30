import { ContextMenuArea, OutsidePressArea, showMenu, Surface, Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createProfile, openWindow, switchProfile } from "../../lib/actions";
import { glassChrome, GLASS } from "../../lib/glassTheme";
import { openReleaseNotesPage } from "../../lib/releaseNotesPage";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { originalProfile } from "../../store/small";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { openInternalPage } from "../pages/urls";
import { useHover } from "../primitives";
import { profileSymbol, ProfileBadge } from "../profiles/icons";
import { openSettings } from "../settings/windows";
import { runSpaceMenu, spaceMenuItems } from "../spaces/spaceActions";
import { GlassIconButton, GlassSurface } from "./GlassSurface";

const HIT = GLASS.buttonHit;
const TOP = GLASS.footerCenter - HIT / 2;
const BADGE = GLASS.button - 6;
const OPEN_SPRING = { stiffness: 400, damping: 40, mass: 1 };
const FROM_SCALE = 0.2;

export const useAvatarMenu = create<Record<string, boolean>>()(() => ({}));


export function GlassFooter({ windowId, width, downloads }: { windowId: string; width: number; downloads: boolean }) {
  const open = useAvatarMenu((m) => !!m[windowId]);
  const setOpen = (value: boolean) => useAvatarMenu.setState({ [windowId]: value });
  const closedAt = useRef(0);
  const incognito = useIsIncognito();
  const close = () => {
    closedAt.current = Date.now();
    setOpen(false);
  };
  return (
    <>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: GLASS.footer }}>
        <AvatarButton
          windowId={windowId}
          incognito={incognito}
          open={open}
          onPress={() => {
            if (!open && Date.now() - closedAt.current < 250) return;
            setOpen(!open);
          }}
        />
        {incognito ? null : <SpaceDots windowId={windowId} />}
        {downloads ? <DownloadsCircle windowId={windowId} /> : null}
      </View>
      <AvatarMenu windowId={windowId} width={width} open={open} onClose={close} />
    </>
  );
}

function AvatarButton({ windowId, incognito, open, onPress }: { windowId: string; incognito: boolean; open: boolean; onPress: () => void }) {
  const profile = useBrowser(useShallow((s) => {
    const p = s.profiles[s.windows[windowId]?.profileId ?? ""];
    return p ? { name: p.name, color: p.color, icon: p.icon, theme: p.theme } : null;
  }));
  const chrome = glassChrome(useTheme().dark);
  return (
    <GlassIconButton
      hit={{ width: HIT, height: HIT }}
      style={{ position: "absolute", top: TOP, left: GLASS.footerInsetLeft + GLASS.button / 2 - HIT / 2 }}
      tooltip={incognito ? "Private Window" : profile ? `${profile.name} — Windows, Spaces and Settings` : undefined}
      onPress={onPress}
    >
      {incognito || !profile ? (
        <Symbol name="hand.raised.fill" size={14} weight="medium" color={chrome.ink} style={{ width: GLASS.button, height: GLASS.button }} />
      ) : (
        <View style={{ opacity: open ? 0.85 : 1 }}>
          <ProfileBadge profile={profile} size={BADGE} />
        </View>
      )}
    </GlassIconButton>
  );
}

function DownloadsCircle({ windowId }: { windowId: string }) {
  return (
    <GlassIconButton
      icon="square.and.arrow.down"
      glyph={15}
      hit={{ width: HIT, height: HIT }}
      style={{ position: "absolute", top: TOP, right: GLASS.footerInsetRight + GLASS.button / 2 - HIT / 2 }}
      tooltip="Downloads (⇧⌘J)"
      onPress={() => {
        const s = useBrowser.getState();
        s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
      }}
    />
  );
}

const DOT_HIT = 18;

function SpaceDots({ windowId }: { windowId: string }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  const icons = useBrowser((s) => ids.some((id) => !!s.profiles[id]?.icon));
  const cell = icons ? DOT_HIT : GLASS.dotPitch;
  const width = Math.max(GLASS.dotsWidth, ids.length * cell + GLASS.dotsHeight - GLASS.dot);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center" }}>
      <View style={{ width, height: GLASS.footer, alignItems: "center", justifyContent: "center" }}>
        <GlassSurface width={width} height={GLASS.dotsHeight} style={{ position: "absolute", left: 0, top: GLASS.footerCenter - GLASS.dotsHeight / 2 }} />
        <View style={{ flexDirection: "row" }}>
          {ids.map((id) => (
            <SpaceDot key={id} id={id} windowId={windowId} cell={cell} page={pages.find((p) => p.id === id)} pos={pager.pos} />
          ))}
        </View>
      </View>
    </View>
  );
}

function SpaceDot({ id, windowId, cell, page, pos }: { id: string; windowId: string; cell: number; page: PagerPage | undefined; pos: Animated.Value }) {
  const chrome = glassChrome(useTheme().dark);
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const icon = useBrowser((s) => s.profiles[id]?.icon ?? null);
  const { hovered, hoverProps } = useHover();
  const on = page ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [0, 1, 0], extrapolate: "clamp" }) : 0;
  const symbol = profileSymbol(icon);
  const editMenu = async () => {
    const choice = await showMenu([{ id: "edit", title: "Edit Space…", symbol: "pencil" }, ...spaceMenuItems(id)]);
    if (choice === "edit") openSettings("profiles", id);
    else if (choice) runSpaceMenu(choice, id, windowId);
  };
  const mark = (color: string) =>
    symbol ? (
      <Symbol name={symbol} size={10} weight="semibold" color={color} style={{ width: 13, height: 13 }} />
    ) : icon ? (
      <Text style={{ fontSize: 10, lineHeight: 13, color }}>{icon}</Text>
    ) : (
      <View style={{ width: GLASS.dot, height: GLASS.dot, borderRadius: GLASS.dot / 2, backgroundColor: color }} />
    );
  return (
    <View {...hoverProps} tooltip={name}>
      <ContextMenuArea onContextMenu={() => void editMenu()}>
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)} style={{ width: cell, height: GLASS.footer, alignItems: "center", justifyContent: "center" }}>
          <View style={{ alignItems: "center", justifyContent: "center", transform: [{ scale: hovered ? 1.25 : 1 }] }}>
            {mark(chrome.dotOff)}
            <Animated.View style={{ position: "absolute", opacity: on }}>{mark(chrome.dotOn)}</Animated.View>
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

type Item = { id: string; title: string; icon?: string; badge?: string; checked?: boolean };

function menuItems(windowId: string): Item[][] {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.profileId;
  return [
    [
      { id: "newWindow", title: "New Window", icon: "macwindow.on.rectangle" },
      { id: "newPrivate", title: "New Private Window", icon: "hand.raised" },
    ],
    [
      ...s.profileOrder.filter((id) => s.profiles[id]).map((id) => ({ id: `space:${id}`, title: s.profiles[id]!.name, badge: id, checked: id === current })),
      { id: "addSpace", title: "Add Space", icon: "plus" },
    ],
    [
      { id: "history", title: "History", icon: "clock.arrow.circlepath" },
      { id: "whatsNew", title: "What’s New", icon: "newspaper" },
      { id: "settings", title: "Settings", icon: "gearshape" },
    ],
  ];
}

function runMenuItem(id: string, windowId: string) {
  const s = useBrowser.getState();
  if (id.startsWith("space:")) return switchProfile(windowId, id.slice("space:".length), true);
  switch (id) {
    case "newWindow":
      return void openWindow({ profileId: s.windows[windowId]?.profileId });
    case "newPrivate":
      return void openWindow({ incognito: true, profileId: originalProfile(s, s.windows[windowId]) });
    case "addSpace":
      return void createProfile(windowId).then((created) => created && switchProfile(windowId, created, true));
    case "history":
      return void openInternalPage("history", windowId);
    case "whatsNew":
      return openReleaseNotesPage(windowId);
    case "settings":
      return void openSettings();
  }
}

if (__DEV__) (globalThis as { orbitAvatarMenu?: unknown }).orbitAvatarMenu = Object.assign(useAvatarMenu, { run: runMenuItem });

export function menuWidth(sidebarWidth: number) {
  return Math.max(190, Math.min(260, sidebarWidth - 2 * GLASS.footerInsetLeft - 4));
}

function AvatarMenu({ windowId, width, open, onClose }: { windowId: string; width: number; open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const chrome = glassChrome(theme.dark);
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(open);
  const [height, setHeight] = useState(280);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open) {
      progress.setValue(0);
      fade.setValue(0);
      Animated.parallel([
        Animated.spring(progress, { toValue: 1, ...OPEN_SPRING, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(progress, { toValue: 0.6, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start(({ finished }) => finished && setShown(false));
    }
  }, [open]);
  if (!shown) return null;
  const w = menuWidth(width);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [FROM_SCALE, 1] });
  const shiftX = progress.interpolate({ inputRange: [0, 1], outputRange: [(-(1 - FROM_SCALE) * w) / 2, 0] });
  const shiftY = progress.interpolate({ inputRange: [0, 1], outputRange: [((1 - FROM_SCALE) * height) / 2, 0] });
  const groups = menuItems(windowId);
  const pick = (id: string) => {
    onClose();
    runMenuItem(id, windowId);
  };
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        left: GLASS.footerInsetLeft,
        bottom: GLASS.footerCenter + GLASS.button / 2 + GLASS.menuGapAbove,
        width: w,
        opacity: fade,
        transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }],
      }}
    >
      <OutsidePressArea onOutsidePress={onClose}>
        <Surface
          fill={hex(chrome.menu)}
          cornerRadius={GLASS.menuRadius}
          borderWidth={0.5}
          borderColor={hex(chrome.menuEdge)}
          shadowColor={hex(chrome.menuShadow)}
          shadowOpacity={1}
          shadowRadius={18}
          shadowOffset={[0, 6]}
          style={{ paddingVertical: 6, paddingHorizontal: 6 }}
        >
          {groups.map((group, i) => (
            <View key={i}>
              {i ? <View style={{ height: 0.5, marginVertical: 5, marginHorizontal: 6, backgroundColor: chrome.menuSeparator }} /> : null}
              {group.map((item) => (
                <MenuRow key={item.id} item={item} onPress={() => pick(item.id)} />
              ))}
            </View>
          ))}
        </Surface>
      </OutsidePressArea>
    </Animated.View>
  );
}

function MenuRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const theme = useTheme();
  const chrome = glassChrome(theme.dark);
  const { hovered, hoverProps } = useHover();
  const profile = useBrowser(useShallow((s) => {
    const p = item.badge ? s.profiles[item.badge] : undefined;
    return p ? { name: p.name, color: p.color, icon: p.icon, theme: p.theme } : null;
  }));
  return (
    <View {...hoverProps}>
      <Pressable accessibilityRole="menuitem" accessibilityLabel={item.title} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: GLASS.menuRow,
              borderRadius: GLASS.menuRadius - 6,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 5,
              backgroundColor: pressed || hovered ? chrome.menuHover : undefined,
            }}
          >
            <View style={{ width: GLASS.menuIcon, height: GLASS.menuIcon, alignItems: "center", justifyContent: "center" }}>
              {profile ? (
                <ProfileBadge profile={profile} size={GLASS.menuIcon} />
              ) : item.icon ? (
                <Symbol name={item.icon} size={14} weight="regular" color={chrome.menuText} style={{ width: GLASS.menuIcon, height: GLASS.menuIcon }} />
              ) : null}
            </View>
            <Text numberOfLines={1} style={{ flex: 1, marginLeft: 10, fontSize: 13, color: chrome.menuText }}>
              {item.title}
            </Text>
            {item.checked ? <Symbol name="checkmark" size={12} weight="semibold" color={chrome.menuText} style={{ width: 16, height: 16 }} /> : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

