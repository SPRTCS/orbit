import { Symbol } from "@ardia/shell";
import { memo, useMemo } from "react";
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../lib/theme";
import { plural } from "../../store/model";
import { spaceCounts, spaceLines, type SpaceDoc, type SpaceLine, type SpaceSection } from "../../store/spaceSnapshot";
import { hostLabel } from "../pages/PageLayout";
import { Favicon } from "../primitives";
import { useFormColors } from "../settings/controls";
import { profileSymbol } from "../profiles/icons";

const ROW = 26;

export function countsLabel(doc: SpaceDoc, today = true): string {
  const c = spaceCounts(doc);
  const parts = [
    c.tiles ? plural(c.tiles, "Top App") : null,
    c.pins ? plural(c.pins, "pinned tab") : null,
    c.groups ? plural(c.groups, "group") : null,
    c.folders ? plural(c.folders, "folder") : null,
    today && c.today ? `${plural(c.today, "today tab")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Empty";
}

export function SpaceBadge({ doc, size = 28 }: { doc: Pick<SpaceDoc, "icon" | "kind">; size?: number }) {
  const theme = useTheme();
  const colors = useFormColors();
  const symbol = doc.kind === "folder" ? "folder.fill" : profileSymbol(doc.icon ?? null);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: colors.group, borderWidth: 1, borderColor: colors.groupBorder, alignItems: "center", justifyContent: "center" }}>
      {symbol ? (
        <Symbol name={symbol} size={size * 0.5} weight="semibold" color={theme.textPrimary} style={{ width: size * 0.7, height: size * 0.7 }} />
      ) : doc.icon ? (
        <Text style={{ fontSize: size * 0.55, lineHeight: size * 0.75, color: theme.textPrimary }}>{doc.icon}</Text>
      ) : (
        <Symbol name="square.grid.2x2" size={size * 0.45} color={theme.textSecondary} style={{ width: size * 0.7, height: size * 0.7 }} />
      )}
    </View>
  );
}

const SECTION_TITLES: Record<SpaceSection, string> = { tiles: "Top Apps", pinned: "Pinned", today: "Today" };

export function SpaceOutline({ doc, today = true, style }: { doc: SpaceDoc; today?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const colors = useFormColors();
  const lines = useMemo(() => spaceLines(doc, { today }), [doc, today]);
  const box: StyleProp<ViewStyle> = [{ flex: 1, borderRadius: 10, backgroundColor: colors.group, borderWidth: 1, borderColor: colors.groupBorder }, style];
  if (!lines.length) {
    return (
      <View style={[box, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ fontSize: 13, color: theme.textTertiary }}>Nothing pinned</Text>
      </View>
    );
  }
  return (
    <ScrollView style={box} contentContainerStyle={{ paddingVertical: 6 }}>
      {lines.map((line, i) => (
        <View key={i}>
          {line.section !== lines[i - 1]?.section ? <Heading title={SECTION_TITLES[line.section]} /> : null}
          <OutlineRow line={line} />
        </View>
      ))}
    </ScrollView>
  );
}

function Heading({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTertiary, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 3 }}>{title}</Text>;
}

const OutlineRow = memo(function OutlineRow({ line }: { line: SpaceLine }) {
  const theme = useTheme();
  const container = line.kind === "folder" || line.kind === "group";
  const symbol = line.kind === "folder" ? "folder" : line.kind === "group" ? "square.stack" : null;
  return (
    <View style={{ height: ROW, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12 + line.depth * 16, paddingRight: 12 }}>
      {symbol ? (
        <Symbol name={symbol} size={12} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
      ) : line.icon && !line.icon.startsWith("symbol:") && [...line.icon].length <= 2 ? (
        <Text style={{ width: 16, fontSize: 12, textAlign: "center" }}>{line.icon}</Text>
      ) : (
        <Favicon url={line.url ?? ""} size={16} />
      )}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontWeight: container ? "600" : "400", color: theme.textPrimary }}>
        {line.title}
      </Text>
      {line.url ? (
        <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: 180, fontSize: 12, color: theme.textTertiary }}>
          {hostLabel(line.url)}
        </Text>
      ) : null}
    </View>
  );
});
