import { cleanUrl } from "@ardia/core";
import { confirm, ContextMenuArea, copyText, MouseArea, showMenu, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { focus } from "../../lib/actions";
import { restoreArchived } from "../../lib/archive";
import { profileAccent, useTheme } from "../../lib/theme";
import { archiveDays, clearArchive, removeArchived, useArchive, type ArchivedTab } from "../../store/archive";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import type { Profile } from "../../store/types";
import { HoverSlot } from "../HoverSlot";
import { dayLabel, EmptyState, hostLabel, timeLabel } from "../pages/PageLayout";
import { Favicon, IconButton, useHover } from "../primitives";
import { Button, SearchField, useFormColors } from "../settings/controls";
import { ARCHIVE_WINDOW_ID, openSettings } from "../settings/windows";
import { archiveAfterLabel } from "./archiveAfter";

const TOOLBAR = 52;
const ROW = 38;

export function openArchivedTab(entryId: string, background: boolean) {
  const tabId = restoreArchived(entryId, { background });
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (!tab || background) return;
  useBrowser.getState().activate(tab.id);
  focus(tab.windowId);
}

export function ArchiveWindow() {
  const theme = useTheme();
  const entries = useArchive((a) => a.entries);
  const hours = useBrowser((s) => s.settings.cleanUpInactiveTabsAfterHours);
  const spaces = useBrowser((s) => s.profiles);
  const [query, setQuery] = useState("");
  const days = useMemo(() => archiveDays(entries, query.trim()), [entries, query]);
  const showSpace = Object.keys(spaces).filter((id) => !isIncognitoProfile(id)).length > 1;

  const clear = async () => {
    const { confirmed } = await confirm({
      title: "Clear Archive?",
      message: "Archived tabs will be removed from this list. Your browsing history isn't affected.",
      confirmTitle: "Clear Archive",
      destructive: true,
      windowId: ARCHIVE_WINDOW_ID,
    });
    if (confirmed) clearArchive();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingLeft: 84, paddingRight: 14, gap: 10 }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Archive</Text>
        <View style={{ flex: 1 }} />
        <Button title="Clear Archive" kind="destructive" disabled={!entries.length} onPress={() => void clear()} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search Archive" autoFocus />
      </View>
      {days.length === 0 ? (
        <EmptyState
          icon={<Symbol name="archivebox" size={28} color={theme.textTertiary} style={{ width: 34, height: 34 }} />}
          title={entries.length ? `No archived tabs match “${query.trim()}”` : "Nothing archived yet"}
          subtitle={entries.length ? undefined : "Tabs you close or that get cleaned up show up here, so you can always bring them back."}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {days.map((day) => (
            <View key={day.start}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, paddingHorizontal: 28, paddingTop: 12, paddingBottom: 6 }}>{dayLabel(day.start)}</Text>
              {day.entries.map((entry, i) => (
                <ArchiveRow
                  key={entry.id}
                  entry={entry}
                  first={i === 0}
                  last={i === day.entries.length - 1}
                  space={showSpace ? spaces[entry.profileId] : undefined}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      <Footer label={archiveAfterLabel(hours)} />
    </View>
  );
}

function Footer({ label }: { label: string }) {
  const theme = useTheme();
  const colors = useFormColors();
  return (
    <View style={{ height: 36, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 6, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.separator }}>
      <Text style={{ flex: 1, fontSize: 12, color: theme.textTertiary }}>{label}</Text>
      <Button title="Change…" kind="plain" onPress={() => openSettings("tabs")} />
    </View>
  );
}

const clickedInBackground = (e: GestureResponderEvent) => !!(e.nativeEvent as unknown as { metaKey?: boolean }).metaKey;

const ArchiveRow = memo(function ArchiveRow({
  entry,
  first,
  last,
  space,
}: {
  entry: ArchivedTab;
  first: boolean;
  last: boolean;
  space?: Profile;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  const menu = async () => {
    const choice = await showMenu([
      { id: "open", title: "Open" },
      { id: "background", title: "Open in Background" },
      { separator: true },
      { id: "copy", title: "Copy Link" },
      { separator: true },
      { id: "remove", title: "Remove from Archive" },
    ]);
    if (choice === "open") openArchivedTab(entry.id, false);
    if (choice === "background") openArchivedTab(entry.id, true);
    if (choice === "copy") copyText(cleanUrl(entry.url));
    if (choice === "remove") removeArchived([entry.id]);
  };
  const r = 10;
  return (
    <View {...hoverProps} style={{ height: ROW, paddingHorizontal: 16 }}>
      <ContextMenuArea onContextMenu={() => void menu()} style={{ flex: 1 }}>
        <MouseArea style={{ flex: 1 }} onMiddleClick={() => openArchivedTab(entry.id, true)}>
          <Pressable
            onPress={(e) => openArchivedTab(entry.id, clickedInBackground(e))}
            accessibilityLabel={entry.title || entry.url}
            accessibilityActions={[{ name: "menu", label: "More Actions" }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === "menu" && void menu()}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 12,
              paddingRight: 6,
              gap: 10,
              backgroundColor: hovered ? theme.rowHover : colors.group,
              borderTopLeftRadius: first ? r : 0,
              borderTopRightRadius: first ? r : 0,
              borderBottomLeftRadius: last ? r : 0,
              borderBottomRightRadius: last ? r : 0,
            }}
          >
            <Favicon url={entry.url} favicon={entry.favicon} profileId={entry.profileId} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
              {entry.title || hostLabel(entry.url)}
            </Text>
            <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: 160, fontSize: 12, color: theme.textTertiary }}>
              {hostLabel(entry.url)}
            </Text>
            <View style={{ flex: 1 }} />
            {space ? <SpaceBadge name={space.name} color={profileAccent(space)} /> : null}
            <Text style={{ width: 62, textAlign: "right", fontSize: 12, color: theme.textSecondary }}>{timeLabel(entry.archivedAt)}</Text>
            <HoverSlot
              hovered={hovered}
              width={24}
              hover={<IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} tooltip="Remove from Archive" onPress={() => removeArchived([entry.id])} />}
            />
          </Pressable>
        </MouseArea>
      </ContextMenuArea>
      {!last && <View style={{ position: "absolute", left: 28, right: 28, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />}
    </View>
  );
});

function SpaceBadge({ name, color }: { name: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 120 }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />
      <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
        {name}
      </Text>
    </View>
  );
}
