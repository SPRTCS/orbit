import { ContextMenuArea, showMenu, Symbol } from "@ardia/shell";
import { Animated, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { createProfile, switchProfile } from "../../lib/actions";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { IconButton, useHover } from "../primitives";
import { openSettings } from "../settings/windows";
import { profileSymbol } from "./icons";
import { runSpaceMenu, spaceMenuItems } from "../spaces/spaceActions";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 24;
const DOT = 6;
const BAND = 28;
const ICON = 14;
const PLUS_ROOM = 44;
const SELECTED = 0.9;
const HOVERED = 0.55;
const IDLE = 0.3;

export function useProfileDotsShown() {
  return !useIsIncognito();
}

export function ProfileDots({ windowId }: { windowId: string }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  const top = (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2;
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT }}>
      <View style={{ marginTop: top, height: BAND, marginHorizontal: PLUS_ROOM, flexDirection: "row", justifyContent: "center", overflow: "hidden" }}>
        {ids.map((id) => (
          <SpaceIcon key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} />
        ))}
      </View>
      <IconButton
        icon="plus"
        size={13}
        box={BAND}
        radius={7}
        weight="medium"
        tooltip="New Space"
        style={{ position: "absolute", top, right: layout.sidebarInset }}
        onPress={() => void createProfile(windowId).then((id) => id && switchProfile(windowId, id, true))}
      />
    </View>
  );
}

function SpaceIcon({ id, windowId, page, pos }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const icon = useBrowser((s) => s.profiles[id]?.icon ?? null);
  const { hovered, hoverProps } = useHover();
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  const ink = theme.dark ? "#FFFFFF" : "#000000";
  const symbol = profileSymbol(icon);
  const editMenu = async () => {
    const choice = await showMenu([{ id: "edit", title: "Edit Space…", symbol: "pencil" }, ...spaceMenuItems(id)]);
    if (choice === "edit") openSettings("profiles", id);
    else if (choice) runSpaceMenu(choice, id, windowId);
  };
  return (
    <View {...hoverProps} tooltip={name}>
      <ContextMenuArea onContextMenu={() => void editMenu()}>
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
          {({ pressed }) => (
            <View
              style={{
                width: CELL,
                height: BAND,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
              }}
            >
              <Animated.View style={{ opacity, alignItems: "center", justifyContent: "center" }}>
                {symbol ? (
                  <Symbol name={symbol} size={ICON - 1} weight="semibold" color={ink} style={{ width: ICON + 2, height: ICON + 2 }} />
                ) : icon ? (
                  <Text style={{ fontSize: ICON - 1, lineHeight: ICON + 2, color: ink }}>{icon}</Text>
                ) : (
                  <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: ink }} />
                )}
              </Animated.View>
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
