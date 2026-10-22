import { Symbol } from "@ardia/shell";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { tabLayoutOf } from "../../../store/model";
import type { Settings } from "../../../store/settings";
import { ARCHIVE_AFTER, archiveAfterHours, archiveAfterValue } from "../../archive/archiveAfter";
import { Button, Group, PopUp, Row, SectionHeader, Toggle, useFormColors } from "../controls";
import { openArchive } from "../windows";

export function TabsPane() {
  const settings = useBrowser((s) => s.settings);
  const update = useBrowser((s) => s.updateSettings);
  const toggle = (key: keyof Settings, title: string, description?: string) => (
    <Row key={key} title={title} description={description}>
      <Toggle value={!!settings[key]} onChange={(v) => update({ [key]: v })} />
    </Row>
  );
  const top = useBrowser((s) => tabLayoutOf(s) === "top");

  return (
    <View>
      <SectionHeader title="Tab layout" />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <LayoutChoice layout="sidebar" title="Tab layout in the sidebar" selected={!top} />
        <LayoutChoice layout="top" title="Tab layout across the top of the window" selected={top} />
      </View>
      <Group style={{ marginTop: 14 }}>
        {toggle(
          "hideToolbarWhileScrolling",
          "Hide toolbar while scrolling",
          "Scrolling down tucks the toolbar into a thin strip with the site's name. Scroll up, or click the strip, to bring it back.",
        )}
        {!top && toggle("showSidebarButton", "Show sidebar button", "⌘S and View › Auto-Hide Tabs still hide and show the sidebar.")}
      </Group>

      <SectionHeader title="General" />
      <Group>
        <Row
          title="New tab opens"
          description="With Command Bar, ⌘T and New Tab open the command bar over the page, as in Arc. The tab appears when you pick a result; Esc leaves everything as it was."
        >
          <PopUp
            value={settings.newTabOpens}
            options={[
              { value: "page", title: "New Tab Page" },
              { value: "commandBar", title: "Command Bar" },
            ]}
            onChange={(v) => update({ newTabOpens: v })}
            minWidth={160}
          />
        </Row>
        <Row title={top ? "Add new tabs to the left" : "Add new tabs to the top"}>
          <Toggle value={settings.newTabPosition === "top"} onChange={(v) => update({ newTabPosition: v ? "top" : "bottom" })} />
        </Row>
        {toggle("warnBeforeClosingLastTab", "Warn before closing last tab in a Profile")}
        {toggle("tabReorderHaptics", "Haptic feedback when reordering tabs")}
        {toggle("extendWebsiteColor", "Extend website color into tab bar")}
        {toggle(
          "sidebarMediaControls",
          "Show media controls in the sidebar",
          "When a tab you're not looking at plays sound, a player appears at the bottom of the sidebar. Pinned tabs that are playing show one when you hover them.",
        )}
        {toggle("autoPictureInPicture", "Automatic Picture in Picture", "A video or call you're watching pops out when you switch tabs or leave the window, and returns when you come back.")}
        {toggle(
          "videoUpscaling",
          "Video upscaling",
          "Sharpens low-resolution videos shown larger than they are, on Apple silicon. Only in the tab you're watching, never in the background, in Low Power Mode or when the Mac runs hot.",
        )}
      </Group>

      <SectionHeader title="Tab groups" />
      <Group>
        {toggle("cmdClickCreatesTabGroup", "⌘-clicking links creates tab groups")}
        {toggle("optShiftClickOpensInGroup", "⌥⇧-click opens tab in group", "⌥⇧-click a tab to open it in a group with the current tab. (⌥⇧-clicking a link opens it in a split.)")}
        {toggle("autoGroupMeetingTabs", "Automatically group tabs for meetings")}
      </Group>

      <SectionHeader
        title="Archive"
        description="Unpinned tabs you haven't used (and duplicates) are archived automatically. Pinned, playing and selected tabs stay. Find archived tabs in History › Show Archive (⌥⌘A)."
      />
      <Group>
        <Row title="Archive tabs after">
          <PopUp
            value={archiveAfterValue(settings.cleanUpInactiveTabsAfterHours)}
            options={ARCHIVE_AFTER}
            onChange={(v) => update({ cleanUpInactiveTabsAfterHours: archiveAfterHours(v) })}
          />
        </Row>
        <Row title="Archived tabs">
          <Button title="Show Archive…" onPress={openArchive} />
        </Row>
      </Group>
    </View>
  );
}

function LayoutChoice({ layout, title, selected }: { layout: "sidebar" | "top"; title: string; selected: boolean }) {
  const theme = useTheme();
  const colors = useFormColors();
  const choose = () => {
    const s = useBrowser.getState();
    s.updateSettings({ tabLayout: layout });
    for (const w of Object.values(s.windows)) {
      if ((w.tabLayout ?? s.settings.tabLayout) !== layout) useBrowser.getState().toggleTabLayout(w.id);
    }
    useBrowser.getState().updateSettings({ tabLayout: layout });
  };
  const bar = theme.dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)";
  const page = theme.dark ? "rgba(255,255,255,0.08)" : "#FFFFFF";
  return (
    <Pressable onPress={choose} style={{ flex: 1, alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: "100%",
          height: 104,
          borderRadius: 10,
          padding: 8,
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
          backgroundColor: theme.dark ? "#2A2A2C" : "#E9E9EB",
          flexDirection: layout === "sidebar" ? "row" : "column",
          gap: 5,
        }}
      >
        {layout === "sidebar" ? (
          <View style={{ width: "26%", gap: 4, paddingTop: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ height: 7, borderRadius: 3, backgroundColor: i === 1 ? colors.accent : bar }} />
            ))}
          </View>
        ) : (
          <View style={{ height: 10, flexDirection: "row", gap: 4, paddingLeft: 26 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flex: 1, borderRadius: 3, backgroundColor: i === 1 ? colors.accent : bar }} />
            ))}
          </View>
        )}
        <View style={{ flex: 1, borderRadius: 5, backgroundColor: page }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}
