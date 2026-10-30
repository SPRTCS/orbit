import { Symbol } from "@ardia/shell";
import { Pressable, Text, View } from "react-native";
import { sidebarStyleOf, type SidebarStyle } from "../../lib/glassTheme";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { SectionHeader, useFormColors } from "../settings/controls";

export function SidebarStylePicker() {
  const style = useBrowser((s) => sidebarStyleOf(s.settings));
  const choose = (value: SidebarStyle) => useBrowser.getState().updateSettings({ sidebarStyle: value });
  return (
    <>
      <SectionHeader title="Sidebar Style" description="Glass: a warm gradient from the space’s colour, round glass buttons and touch-sized controls. Classic: the original look." />
      <View style={{ flexDirection: "row", gap: 14 }}>
        <StyleChoice value="glass" title="Glass" selected={style === "glass"} onPress={() => choose("glass")} />
        <StyleChoice value="classic" title="Classic" selected={style === "classic"} onPress={() => choose("classic")} />
      </View>
    </>
  );
}

function StyleChoice({ value, title, selected, onPress }: { value: SidebarStyle; title: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const glass = value === "glass";
  const ink = theme.dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)";
  const page = theme.dark ? "rgba(255,255,255,0.08)" : "#FFFFFF";
  const backdrop = glass ? (theme.dark ? "#3A2C25" : "#EFD9C2") : theme.dark ? "#2A2A2C" : "#E9E9EB";
  const circle = { width: 9, height: 9, borderRadius: 4.5, backgroundColor: theme.dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.8)", borderWidth: 0.5, borderColor: ink };
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 7 }}>
      <View
        style={{
          width: "100%",
          height: 84,
          borderRadius: 9,
          padding: 6,
          flexDirection: "row",
          gap: 5,
          borderWidth: selected ? 2.5 : 1,
          borderColor: selected ? colors.accent : colors.groupBorder,
          backgroundColor: backdrop,
        }}
      >
        <View style={{ width: "30%", gap: 3, paddingTop: 2 }}>
          {glass ? (
            <View style={{ flexDirection: "row", gap: 3, marginBottom: 2 }}>
              <View style={circle} />
              <View style={circle} />
            </View>
          ) : null}
          <View style={{ height: 8, borderRadius: glass ? 4 : 2, marginBottom: 2, backgroundColor: ink }} />
          {[0, 1].map((i) => (
            <View key={i} style={{ height: 5, borderRadius: 2.5, backgroundColor: ink }} />
          ))}
          <View style={{ height: 7, borderRadius: glass ? 3.5 : 2, backgroundColor: glass ? "rgba(255,255,255,0.7)" : ink }} />
          {glass ? <View style={{ flex: 1, justifyContent: "flex-end" }}><View style={circle} /></View> : null}
        </View>
        <View style={{ flex: 1, borderRadius: glass ? 7 : 4, backgroundColor: page }} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {selected && <Symbol name="checkmark.circle.fill" size={12} color={colors.accent} style={{ width: 14, height: 14 }} />}
        <Text style={{ fontSize: 12, color: selected ? theme.textPrimary : theme.textSecondary }}>{title}</Text>
      </View>
    </Pressable>
  );
}
