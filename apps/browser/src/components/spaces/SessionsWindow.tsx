import { confirm, ContextMenuArea, prompt, showMenu, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { focus } from "../../lib/actions";
import { deleteSession, readTimeline, recordTimeline, renameSession, useSpaceSessions, type SavedSession } from "../../lib/spaceSessions";
import { applyPins, currentSpaceId, mainWindowId, openToday } from "../../lib/spaces";
import { exportSpaceDoc, showSpaceImport } from "./spaceFiles";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import type { SpaceDoc } from "../../store/spaceSnapshot";
import type { TimelinePoint } from "../../store/spaceTimeline";
import { dayLabel, dayStart, EmptyState, timeLabel } from "../pages/PageLayout";
import { useHover } from "../primitives";
import { Button, PopUp, useFormColors, type Option } from "../settings/controls";
import { SESSIONS_WINDOW_ID } from "../settings/windows";
import { promptSaveSession, useSessionsView } from "./spaceActions";
import { countsLabel, SpaceOutline } from "./SpaceOutline";

const TOOLBAR = 52;
const LIST_WIDTH = 230;
const ROW = 44;
const DELETED = "deleted";

export function SessionsWindow() {
  const theme = useTheme();
  const view = useSessionsView();
  const profiles = useBrowser((s) => s.profiles);
  const profileOrder = useBrowser((s) => s.profileOrder);
  const sessions = useSpaceSessions((x) => x.sessions);
  const spaces = profileOrder.filter((id) => profiles[id] && !isIncognitoProfile(id));
  const orphans = sessions.filter((x) => !profiles[x.profileId]);
  const selected = view.profileId === DELETED || (view.profileId && profiles[view.profileId]) ? view.profileId! : (currentSpaceId() ?? spaces[0] ?? null);
  const options: Option<string>[] = [
    ...spaces.map((id) => ({ value: id, title: profiles[id]!.name })),
    ...(orphans.length ? [{ value: DELETED, title: "Deleted Spaces", separatorBefore: true }] : []),
  ];
  const tab = selected === DELETED ? "sessions" : view.tab;

  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingLeft: 84, paddingRight: 14, gap: 10 }}>
        <WindowDragRegion style={StyleSheet.absoluteFill} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Sessions</Text>
        {selected ? <PopUp value={selected} options={options} onChange={(id) => useSessionsView.setState({ profileId: id })} minWidth={150} /> : null}
        <View style={{ flex: 1 }} />
        {selected !== DELETED ? <Segments value={tab} onChange={(t) => useSessionsView.setState({ tab: t })} /> : null}
      </View>
      {!selected ? (
        <EmptyState title="No spaces" />
      ) : tab === "sessions" ? (
        <SessionsPane profileId={selected} sessions={selected === DELETED ? orphans : sessions.filter((x) => x.profileId === selected)} />
      ) : (
        <TimelinePane profileId={selected} />
      )}
    </View>
  );
}

function Segments({ value, onChange }: { value: "sessions" | "timeline"; onChange: (v: "sessions" | "timeline") => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const item = (v: "sessions" | "timeline", title: string) => (
    <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="button" accessibilityState={{ selected: value === v }}>
      <View style={{ height: 20, paddingHorizontal: 12, borderRadius: 4.5, justifyContent: "center", backgroundColor: value === v ? colors.control : undefined }}>
        <Text style={{ fontSize: 12.5, color: theme.textPrimary }}>{title}</Text>
      </View>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", padding: 1, borderRadius: 6, backgroundColor: colors.group, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.groupBorder }}>
      {item("sessions", "Saved")}
      {item("timeline", "Timeline")}
    </View>
  );
}

function Split({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
  const colors = useFormColors();
  return (
    <View style={{ flex: 1, flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.separator }}>
      <View style={{ width: LIST_WIDTH, borderRightWidth: StyleSheet.hairlineWidth * 2, borderRightColor: colors.separator }}>{list}</View>
      <View style={{ flex: 1, padding: 16, gap: 10 }}>{detail}</View>
    </View>
  );
}

const ListRow = memo(function ListRow({
  title,
  subtitle,
  selected,
  onPress,
  onMenu,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  onMenu?: () => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ paddingHorizontal: 8 }}>
      <ContextMenuArea onContextMenu={() => onMenu?.()}>
        <Pressable onPress={onPress} accessibilityLabel={title} accessibilityState={{ selected }}>
          <View style={{ height: ROW, borderRadius: 7, paddingHorizontal: 10, justifyContent: "center", backgroundColor: selected ? colors.accent : hovered ? theme.rowHover : undefined }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: selected ? "#FFFFFF" : theme.textPrimary }}>
              {title}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11.5, marginTop: 1, color: selected ? "rgba(255,255,255,0.8)" : theme.textSecondary }}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
});

const when = (ms: number) => `${dayLabel(dayStart(ms)).split(" – ")[0]!.replace(/, \d{4}$/, "")}, ${timeLabel(ms)}`;

function Detail({ doc, title, subtitle, children }: { doc: SpaceDoc; title: string; subtitle: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <View>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>
          {title}
        </Text>
        <Text numberOfLines={2} style={{ fontSize: 12, marginTop: 2, color: theme.textSecondary }}>
          {subtitle} · {countsLabel(doc)}
        </Text>
      </View>
      <SpaceOutline doc={doc} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>{children}</View>
    </>
  );
}

function targetSpace(profileId: string): string | null {
  return useBrowser.getState().profiles[profileId] ? profileId : currentSpaceId();
}

function showMain() {
  const windowId = mainWindowId();
  if (windowId) focus(windowId);
}

async function restoreSessionMenu(session: SavedSession) {
  const s = useBrowser.getState();
  const current = currentSpaceId();
  const own = s.profiles[session.profileId] ? session.profileId : null;
  const hasToday = !!session.doc.today?.length;
  const choice = await showMenu([
    { id: "new", title: "As a New Space…", symbol: "plus.square.on.square" },
    { separator: true },
    { id: "replaceToday", title: own ? `Replace Today Tabs in “${s.profiles[own]!.name}”` : "Replace Today Tabs", enabled: hasToday && !!(own ?? current) },
    { id: "openToday", title: current ? `Open Tabs in “${s.profiles[current]!.name}”` : "Open Tabs in Current Space", enabled: hasToday && !!current },
    { id: "pins", title: own ? `Restore Pins and Folders of “${s.profiles[own]!.name}”` : "Restore Pins and Folders", enabled: !!(own ?? current) },
  ]);
  if (choice === "new") showSpaceImport({ doc: { ...session.doc, name: session.name }, error: null, source: null, origin: "session" });
  else if (choice === "replaceToday") (openToday((own ?? current)!, session.doc.today ?? [], { replace: true }), showMain());
  else if (choice === "openToday") (openToday(current!, session.doc.today ?? []), showMain());
  else if (choice === "pins") await restorePins((own ?? current)!, session.doc, `“${session.name}”`);
}

async function restorePins(profileId: string, doc: SpaceDoc, from: string) {
  const name = useBrowser.getState().profiles[profileId]?.name ?? "this space";
  const { confirmed } = await confirm({
    title: `Restore the pins of “${name}”?`,
    message: `Its Top Apps, pinned tabs and folders are replaced by the ones from ${from}. Open pinned tabs stay open as today tabs, and the timeline keeps the current pins.`,
    confirmTitle: "Restore Pins",
    windowId: SESSIONS_WINDOW_ID,
  });
  if (!confirmed) return;
  recordTimeline(profileId, { force: true });
  applyPins(profileId, doc, "replace");
  recordTimeline(profileId, { force: true });
  showMain();
}

function SessionsPane({ profileId, sessions }: { profileId: string; sessions: SavedSession[] }) {
  const theme = useTheme();
  const ordered = useMemo(() => [...sessions].sort((a, b) => b.savedAt - a.savedAt), [sessions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ordered.find((x) => x.id === selectedId) ?? ordered[0];
  const canSave = profileId !== "deleted";

  const rename = async (session: SavedSession) => {
    const name = await prompt({ title: "Rename Session", value: session.name, confirmTitle: "Rename", windowId: SESSIONS_WINDOW_ID });
    if (name) renameSession(session.id, name);
  };
  const remove = async (session: SavedSession) => {
    const { confirmed } = await confirm({ title: `Delete “${session.name}”?`, confirmTitle: "Delete", destructive: true, windowId: SESSIONS_WINDOW_ID });
    if (confirmed) deleteSession(session.id);
  };
  const menu = async (session: SavedSession) => {
    const choice = await showMenu([
      { id: "restore", title: "Restore…" },
      { id: "export", title: "Export…" },
      { separator: true },
      { id: "rename", title: "Rename…" },
      { id: "delete", title: "Delete" },
    ]);
    if (choice === "restore") await restoreSessionMenu(session);
    else if (choice === "export") void exportSpaceDoc({ ...session.doc, name: session.name });
    else if (choice === "rename") await rename(session);
    else if (choice === "delete") await remove(session);
  };

  const list = (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        {ordered.map((x) => (
          <ListRow key={x.id} title={x.name} subtitle={when(x.savedAt)} selected={x === selected} onPress={() => setSelectedId(x.id)} onMenu={() => void menu(x)} />
        ))}
      </ScrollView>
      {canSave ? (
        <View style={{ padding: 10 }}>
          <Button title="Save Session…" icon="plus" onPress={() => void promptSaveSession(profileId, SESSIONS_WINDOW_ID)} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Split
      list={list}
      detail={
        selected ? (
          <Detail doc={selected.doc} title={selected.name} subtitle={when(selected.savedAt)}>
            <Button title="Rename…" onPress={() => void rename(selected)} />
            <Button title="Delete" kind="destructive" onPress={() => void remove(selected)} />
            <Button title="Export…" onPress={() => void exportSpaceDoc({ ...selected.doc, name: selected.name })} />
            <Button title="Restore…" kind="primary" onPress={() => void restoreSessionMenu(selected)} />
          </Detail>
        ) : (
          <EmptyState
            icon={<Symbol name="tray" size={28} color={theme.textTertiary} style={{ width: 34, height: 34 }} />}
            title="No saved sessions"
            subtitle={canSave ? "Save a session to keep this space's pinned tabs, folders and today tabs under a name." : undefined}
          />
        )
      }
    />
  );
}

function TimelinePane({ profileId }: { profileId: string }) {
  const theme = useTheme();
  const revision = useSpaceSessions((x) => x.revision);
  const points = useMemo(() => [...readTimeline(profileId)].reverse(), [profileId, revision]);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => setAt(null), [profileId]);
  const selected = points.find((p) => p.at === at) ?? points[0];
  const name = useBrowser((s) => s.profiles[profileId]?.name ?? "");

  const list = (
    <View style={{ flex: 1 }}>
      <Scrubber points={points} selected={selected} onSelect={(p) => setAt(p.at)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
        {points.map((p, i) => (
          <View key={p.at}>
            {dayStart(p.at) !== dayStart(points[i - 1]?.at ?? 0) ? (
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTertiary, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4 }}>{dayLabel(dayStart(p.at)).split(" – ")[0]}</Text>
            ) : null}
            <ListRow title={timeLabel(p.at)} subtitle={countsLabel(p.doc)} selected={p === selected} onPress={() => setAt(p.at)} />
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 10 }}>
        <Button title="Snapshot Now" icon="camera" onPress={() => recordTimeline(profileId, { force: true })} />
      </View>
    </View>
  );

  return (
    <Split
      list={list}
      detail={
        selected ? (
          <Detail doc={selected.doc} title={`${name} as of ${timeLabel(selected.at)}`} subtitle={dayLabel(dayStart(selected.at))}>
            <Button
              title="Reopen Today Tabs from Then"
              disabled={!selected.doc.today?.length}
              onPress={() => (openToday(profileId, selected.doc.today ?? []), showMain())}
            />
            <Button title="Restore Pins and Folders as of Then…" kind="primary" onPress={() => void restorePins(profileId, selected.doc, `${when(selected.at)}`)} />
          </Detail>
        ) : (
          <EmptyState
            icon={<Symbol name="clock.arrow.circlepath" size={28} color={theme.textTertiary} style={{ width: 34, height: 34 }} />}
            title="No snapshots yet"
            subtitle="Orbit snapshots each space's sidebar at most once an hour when it changes, and keeps 48 hourly and 30 daily snapshots."
          />
        )
      }
    />
  );
}

function Scrubber({ points, selected, onSelect }: { points: TimelinePoint[]; selected: TimelinePoint | undefined; onSelect: (p: TimelinePoint) => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const ordered = useMemo(() => [...points].reverse(), [points]);
  if (ordered.length < 2) return null;
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
      <View style={{ height: 18, flexDirection: "row", alignItems: "center" }} accessibilityRole="adjustable" accessibilityLabel="Timeline">
        <View style={{ position: "absolute", left: 0, right: 0, top: 8, height: 2, borderRadius: 1, backgroundColor: colors.separator }} />
        {ordered.map((p) => (
          <Pressable key={p.at} onPress={() => onSelect(p)} style={{ flex: 1, height: 18, alignItems: "center", justifyContent: "center" }} tooltip={`${when(p.at)}`}>
            <View style={{ width: p === selected ? 10 : 6, height: p === selected ? 10 : 6, borderRadius: 5, backgroundColor: p === selected ? colors.accent : theme.textTertiary }} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Text style={{ fontSize: 10.5, color: theme.textTertiary }}>{when(ordered[0]!.at)}</Text>
        <Text style={{ fontSize: 10.5, color: theme.textTertiary }}>{when(ordered.at(-1)!.at)}</Text>
      </View>
    </View>
  );
}
