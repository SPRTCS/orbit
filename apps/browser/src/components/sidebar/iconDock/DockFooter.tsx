import { showMenu, Symbol, type MenuItem } from "@ardia/shell";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { profileAccent, useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useIsIncognito, useWindowId } from "../../../store/hooks";
import { downloadsIn } from "../../../store/ui";
import { openSyncedTab, syncedDevicesMenuItem } from "../../../sync/menu";
import { avatarMenuGroups, runAvatarMenuItem } from "../../glassSidebar/GlassFooter";
import { useHover } from "../../primitives";
import { ProfileBadge } from "../../profiles/icons";

const HIT = 30;
const BADGE = 20;

export function DockFooter() {
  const windowId = useWindowId();
  const theme = useTheme();
  const incognito = useIsIncognito();
  const hasDownloads = useBrowser((s) => downloadsIn(s, windowId).length > 0);
  const profile = useBrowser(
    useShallow((s) => {
      const p = s.profiles[s.windows[windowId]?.profileId ?? ""];
      return p ? { name: p.name, color: p.color, icon: p.icon, theme: p.theme } : null;
    }),
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <FooterButton tooltip={incognito ? "Private Window" : profile ? `${profile.name} — Your Devices, Spaces and Settings` : undefined} onPress={() => void openDockAvatarMenu(windowId)}>
        {incognito || !profile ? (
          <Symbol name="hand.raised.fill" size={13} weight="medium" color={theme.icon} style={{ width: HIT, height: HIT }} />
        ) : (
          <ProfileBadge profile={profile} size={BADGE} />
        )}
      </FooterButton>
      {hasDownloads ? (
        <FooterButton
          tooltip="Downloads (⇧⌘J)"
          onPress={() => {
            const s = useBrowser.getState();
            s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
          }}
        >
          <Symbol name="square.and.arrow.down" size={13} weight="medium" color={theme.icon} style={{ width: HIT, height: HIT, transform: [{ translateY: -1 }] }} />
        </FooterButton>
      ) : null}
    </View>
  );
}

function FooterButton({ tooltip, onPress, children }: { tooltip?: string; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View tooltip={tooltip} {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              width: HIT,
              height: HIT,
              borderRadius: HIT / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            {children}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function dockAvatarMenu(windowId: string): MenuItem[] {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const devices = w && !w.incognito ? syncedDevicesMenuItem(w.profileId) : null;
  const items: MenuItem[] = devices ? [devices, { separator: true }] : [];
  avatarMenuGroups(windowId).forEach((group, i) => {
    if (i) items.push({ separator: true });
    for (const item of group) {
      const space = item.badge ? s.profiles[item.badge] : undefined;
      items.push({ id: item.id, title: item.title, symbol: item.icon, checked: item.checked, swatch: space ? profileAccent(space) : undefined });
    }
  });
  return items;
}

async function openDockAvatarMenu(windowId: string) {
  const choice = await showMenu(dockAvatarMenu(windowId));
  const profileId = useBrowser.getState().windows[windowId]?.profileId;
  if (!choice || !profileId) return;
  if (openSyncedTab(choice, windowId, profileId)) return;
  runAvatarMenuItem(choice, windowId);
}
