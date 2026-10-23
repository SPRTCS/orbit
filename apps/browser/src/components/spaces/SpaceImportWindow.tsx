import { closeWindow, confirm, Symbol, WindowDragRegion } from "@ardia/shell";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { focus } from "../../lib/actions";
import { recordTimeline } from "../../lib/spaceSessions";
import { subscribeSpace } from "../../lib/spaceSubscriptions";
import { currentSpaceId, importIntoSpace, mainWindowId, spaceFiles, usePendingSpace, type PendingSpace } from "../../lib/spaces";
import { importAndShowSpace } from "./spaceFiles";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { dataGroups } from "../../store/profiles";
import { spaceCounts } from "../../store/spaceSnapshot";
import { EmptyState } from "../pages/PageLayout";
import { profileNames } from "../profiles/CreateProfile";
import { Button, Checkbox, PopUp, useFormColors, type Option } from "../settings/controls";
import { SPACE_IMPORT_WINDOW_ID } from "../settings/windows";
import { countsLabel, SpaceBadge, SpaceOutline } from "./SpaceOutline";

const TOOLBAR = 52;
type Target = "new" | "merge" | "replace";
const OWN_DATA = "own";

export function SpaceImportWindow() {
  const pending = usePendingSpace((p) => p.pending);
  return <SpaceImportBody key={pending?.seq ?? 0} pending={pending} />;
}

function SpaceImportBody({ pending }: { pending: PendingSpace | null }) {
  const theme = useTheme();
  const colors = useFormColors();
  const profiles = useBrowser((s) => s.profiles);
  const profileOrder = useBrowser((s) => s.profileOrder);
  const current = useBrowser(() => currentSpaceId());
  const doc = pending?.doc ?? null;
  const counts = useMemo(() => (doc ? spaceCounts(doc) : null), [doc]);
  const [target, setTarget] = useState<Target>(doc?.kind === "folder" ? "merge" : "new");
  const [shareWith, setShareWith] = useState<string>(OWN_DATA);
  const [today, setToday] = useState(true);
  const [subscribe, setSubscribe] = useState(!!pending?.subscribe);
  const groups = useMemo(() => dataGroups({ profiles, profileOrder }), [profiles, profileOrder]);
  const close = () => {
    usePendingSpace.setState({ pending: null });
    void closeWindow(SPACE_IMPORT_WINDOW_ID);
  };

  if (!pending || !doc) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
        <View style={{ height: TOOLBAR }}>
          <WindowDragRegion style={StyleSheet.absoluteFill} />
        </View>
        <EmptyState
          icon={<Symbol name="exclamationmark.triangle" size={28} color={theme.textTertiary} style={{ width: 34, height: 34 }} />}
          title={pending?.error ? "Couldn't open this space" : "No space to import"}
          subtitle={pending?.error ?? "Open a .orbitspace file, or choose Spaces › Import Space…"}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 16 }}>
          <Button title="Close" onPress={close} />
        </View>
      </View>
    );
  }

  const currentName = current ? profiles[current]?.name : null;
  const targetOptions: Option<Target>[] = [
    { value: "new", title: "As a new space" },
    ...(current ? [{ value: "merge" as const, title: `Add to “${currentName}”` }, { value: "replace" as const, title: `Replace the pins of “${currentName}”` }] : []),
  ];
  const shareOptions: Option<string>[] = [
    { value: OWN_DATA, title: "Its own logins and data" },
    ...groups.map((g, i) => ({ value: g.profileIds[0]!, title: `Share data with ${profileNames(g.profileIds.map((id) => profiles[id]!.name))}`, separatorBefore: i === 0 })),
  ];
  const canSubscribe = pending.origin === "file" && !!pending.source && doc.kind === "space" && target === "new" && !!spaceFiles();
  const hasToday = !!counts?.today;

  const run = async () => {
    const windowId = mainWindowId();
    if (target === "replace" && current) {
      const { confirmed } = await confirm({
        title: `Replace the pins of “${currentName}”?`,
        message: "Its Top Apps, pinned tabs and folders are replaced by the ones in this file. Pinned tabs you have open stay open as today tabs. The sidebar's timeline keeps the previous pins.",
        confirmTitle: "Replace Pins",
        destructive: true,
        windowId: SPACE_IMPORT_WINDOW_ID,
      });
      if (!confirmed) return;
    }
    if (target === "new") {
      const id = importAndShowSpace(doc, { shareWith: shareWith === OWN_DATA ? null : shareWith, today: hasToday && today, windowId });
      if (canSubscribe && subscribe) {
        const file = await spaceFiles()!.readFile(pending.source!).catch(() => null);
        subscribeSpace(id, pending.source!, doc, file?.modified ?? null);
      }
    } else if (current) {
      recordTimeline(current, { force: true });
      importIntoSpace(current, doc, target, { today: hasToday && today, windowId });
    }
    close();
    if (windowId) focus(windowId);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingLeft: 84, paddingRight: 14 }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{doc.kind === "folder" ? "Import Folder" : "Import Space"}</Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <SpaceBadge doc={doc} size={40} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: "600", color: theme.textPrimary }}>
              {doc.name}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 12, marginTop: 2, color: theme.textSecondary }}>
              {countsLabel(doc)}
              {doc.savedAt ? ` · shared ${new Date(doc.savedAt).toLocaleDateString()}` : ""}
            </Text>
          </View>
        </View>
        <SpaceOutline doc={doc} today={hasToday && today} />
        <View style={{ borderRadius: 10, backgroundColor: colors.group, borderWidth: 1, borderColor: colors.groupBorder, padding: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ width: 110, fontSize: 13, color: theme.textPrimary }}>Import</Text>
            <PopUp value={target} options={targetOptions} onChange={setTarget} minWidth={300} />
          </View>
          {target === "new" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ width: 110, fontSize: 13, color: theme.textPrimary }}>Data</Text>
              <PopUp value={shareWith} options={shareOptions} onChange={setShareWith} minWidth={300} />
            </View>
          ) : null}
          {hasToday ? <Checkbox value={today} onChange={setToday} label={`Open the ${counts!.today === 1 ? "today tab" : `${counts!.today} today tabs`} too`} /> : null}
          {canSubscribe ? <Checkbox value={subscribe} onChange={setSubscribe} label="Keep in sync with this file (read-only)" /> : null}
          {canSubscribe && subscribe ? (
            <Text style={{ fontSize: 11.5, lineHeight: 15, color: theme.textSecondary }}>
              Orbit checks the file every minute and updates this space's pins when the owner exports a new version to it, for example in a shared iCloud Drive folder.
            </Text>
          ) : null}
          <Text style={{ fontSize: 11.5, lineHeight: 15, color: theme.textSecondary }}>
            Spaces carry links, names and icons only: no cookies, history, passwords or form data.
          </Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button title="Cancel" onPress={close} />
          <Button title={target === "replace" ? "Replace Pins…" : "Import"} kind="primary" onPress={() => void run()} />
        </View>
      </View>
    </View>
  );
}
