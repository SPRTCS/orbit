import { ContextMenuArea, FadeLabel, Symbol } from "@ardia/shell";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, View } from "react-native";
import { create, useStore, type StoreApi } from "zustand";
import { endFolderRename, movePinnedNodes, renamePinnedFolder, setPinnedFolderCollapsed } from "../../lib/pinnedFolders";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId, isIncognitoProfile, isPinnedRow } from "../../store/model";
import {
  folderIdOf,
  folderRef,
  groupRef,
  hasFolders,
  isWithin,
  resolveTree,
  tabRef,
  usePinnedFolders,
  windowRefs,
  type FolderTarget,
  type PinnedTree,
  type ResolvedNode,
} from "../../store/pinnedFolders";
import { useHover } from "../primitives";
import { useDragController, useDragItem } from "./dnd";
import { useFold } from "./Fold";
import { GroupBlock } from "./GroupBlock";
import { dismissHover, suppressHover } from "./hover";
import { headerAt, nextSibling, registerPinnedTree, type Frame, type PinnedTreeHandle } from "./pinnedFolderDrop";
import { openPinnedFolderMenu } from "./pinnedFolderMenus";
import { rowView } from "./state";
import { RenameField, TabRowItem } from "./TabRow";

const INDENT = 14;
const GAP = layout.rowGap;

type DropState = { into: string | null; line: number | null; dragging: string | null };
type Slot = { ref: string; parent: string | null; folder: boolean; collapsed: boolean; frame: Frame };
type Visible = { ref: string; parent: string | null };
type Tree = {
  windowId: string;
  profileId: string;
  tree: PinnedTree;
  idOf: Map<string, string>;
  keep: Map<string, string>;
  visible: Visible[];
  headers: Map<string, View | null>;
  container: { current: View | null };
  drop: StoreApi<DropState>;
};

const TreeContext = createContext<Tree | null>(null);

const measure = (view: View | null | undefined): Promise<Frame | null> =>
  view ? new Promise((resolve) => view.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null))) : Promise.resolve(null);

export function PinnedFolders({ windowId, profileId, rows, groups, children }: { windowId: string; profileId: string; rows: string[]; groups: string[]; children: ReactNode }) {
  const tree = usePinnedFolders((f) => (isIncognitoProfile(profileId) ? undefined : f.trees[profileId]));
  if (!hasFolders(tree)) return <>{children}</>;
  return <FolderTree windowId={windowId} profileId={profileId} rows={rows} groups={groups} tree={tree} />;
}

function activeRef(s: BrowserState, windowId: string, profileId: string): string | null {
  const id = activeTabId(s, windowId, profileId);
  const t = id ? s.tabs[id] : undefined;
  if (!t) return null;
  if (isPinnedRow(t)) return tabRef(t);
  const g = Object.values(s.groups).find((x) => x.pinned && x.windowId === windowId && x.tabIds.includes(t.id));
  return g ? groupRef(g) : null;
}

function keptChildren(nodes: ResolvedNode[], active: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!active) return out;
  const walk = (list: ResolvedNode[]): string | null => {
    for (const n of list) {
      if (n.ref === active) return n.ref;
      if (!n.children) continue;
      const inside = walk(n.children);
      if (inside) {
        out.set(folderIdOf(n.ref), inside);
        return n.ref;
      }
    }
    return null;
  };
  walk(nodes);
  return out;
}

function visibleOrder(nodes: ResolvedNode[], tree: PinnedTree, keep: Map<string, string>, parent: string | null = null, out: Visible[] = []): Visible[] {
  for (const n of nodes) {
    out.push({ ref: n.ref, parent });
    if (!n.children) continue;
    const id = folderIdOf(n.ref);
    const shown = tree.folders[id]?.collapsed ? n.children.filter((c) => c.ref === keep.get(id)) : n.children;
    visibleOrder(shown, tree, keep, id, out);
  }
  return out;
}

function FolderTree({ windowId, profileId, rows, groups, tree }: { windowId: string; profileId: string; rows: string[]; groups: string[]; tree: PinnedTree }) {
  const keys = useBrowser((s) => {
    const tabs = rows.map((id) => (s.tabs[id] ? tabRef(s.tabs[id]!) : "")).join("\n");
    return `${tabs}\u0001${groups.map((id) => (s.groups[id] ? groupRef(s.groups[id]!) : "")).join("\n")}`;
  });
  const { refs, idOf } = useMemo(() => windowRefs(useBrowser.getState(), rows, groups), [keys, rows, groups]);
  const nodes = useMemo(() => resolveTree(tree, refs), [tree, refs]);
  const active = useBrowser((s) => activeRef(s, windowId, profileId));
  const keep = useMemo(() => keptChildren(nodes, active), [nodes, active]);
  const [drop] = useState(() => create<DropState>(() => ({ into: null, line: null, dragging: null })));
  const headers = useRef(new Map<string, View | null>()).current;
  const container = useRef<View | null>(null);
  const controller = useDragController();
  const handle = useMemo<PinnedTreeHandle>(
    () => ({ windowId, profileId, headers: new Map(), showInto: (into) => drop.setState({ into }) }),
    [windowId, profileId, drop],
  );
  useEffect(() => (controller ? registerPinnedTree(controller, handle) : undefined), [controller, handle]);
  useDropTracking(controller, handle, headers, drop);
  const ctx = useMemo<Tree>(
    () => ({ windowId, profileId, tree, idOf, keep, visible: visibleOrder(nodes, tree, keep), headers, container, drop }),
    [windowId, profileId, tree, idOf, keep, nodes, headers, drop],
  );
  return (
    <TreeContext.Provider value={ctx}>
      <View ref={(v) => void (container.current = v)} style={{ gap: GAP }}>
        {nodes.map((n) => (
          <Node key={n.ref} node={n} parent={null} />
        ))}
        <TreeTail id="tail:pinnedRows" section="pinnedRows" />
        <TreeTail id="tail:pinnedGroups" section="pinnedGroups" />
        <DropLine />
      </View>
    </TreeContext.Provider>
  );
}

function useDropTracking(controller: ReturnType<typeof useDragController>, handle: PinnedTreeHandle, headers: Map<string, View | null>, drop: StoreApi<DropState>) {
  useEffect(() => {
    if (!controller) return;
    let frame = 0;
    let tick = 0;
    let alive = true;
    const pointer = () => (controller as unknown as { pointer?: { x: number; y: number } }).pointer;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (tick++ % 3) return;
      const views = [...headers];
      void Promise.all(views.map(([, v]) => measure(v))).then((frames) => {
        if (!alive || !frame) return;
        handle.headers.clear();
        frames.forEach((f, i) => f && handle.headers.set(views[i]![0], f));
        const p = pointer();
        const sources = [...controller.marks.getState().sources];
        const tabsOrGroups = sources.length > 0 && sources.every((k) => k.startsWith("t:") || k.startsWith("g:"));
        const into = p && tabsOrGroups ? headerAt(handle.headers, p.x, p.y) : null;
        if (drop.getState().into !== into) drop.setState({ into });
      });
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      handle.headers.clear();
      if (drop.getState().into) drop.setState({ into: null });
    };
    const unsubscribe = controller.marks.subscribe((m, prev) => {
      const on = m.sources.size > 0;
      if (on && prev.sources.size === 0) {
        tick = 0;
        frame = requestAnimationFrame(loop);
      } else if (!on && prev.sources.size > 0) stop();
    });
    return () => {
      alive = false;
      unsubscribe();
      stop();
    };
  }, [controller, handle, headers, drop]);
}

const TreeTail = memo(function TreeTail({ id, section }: { id: string; section: "pinnedRows" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

function DropLine() {
  const theme = useTheme();
  const ctx = useContext(TreeContext)!;
  const line = useStore(ctx.drop, (d) => d.line);
  if (line === null) return null;
  return <View pointerEvents="none" style={{ position: "absolute", left: 6, right: 6, top: line - 1, height: 2, borderRadius: 1, backgroundColor: theme.accent }} />;
}

const Node = memo(function Node({ node, parent }: { node: ResolvedNode; parent: string | null }) {
  const ctx = useContext(TreeContext)!;
  if (node.children) return <FolderBlock node={node} parent={parent} />;
  const id = ctx.idOf.get(node.ref);
  if (!id) return null;
  return node.ref.startsWith("g:") ? <GroupBlock groupId={id} section="pinnedGroups" /> : <TabRowItem tabId={id} section="pinnedRows" />;
});

const FolderBlock = memo(function FolderBlock({ node, parent }: { node: ResolvedNode; parent: string | null }) {
  const ctx = useContext(TreeContext)!;
  const id = folderIdOf(node.ref);
  const folder = ctx.tree.folders[id];
  const collapsed = !!folder?.collapsed;
  const fold = useFold(collapsed);
  const [height, setHeight] = useState(0);
  if (!folder) return null;
  const kept = ctx.keep.get(id);
  const all = node.children ?? [];
  const shown = !collapsed || fold.moving ? all : all.filter((c) => c.ref === kept);
  const clamp = fold.moving && height > 0 ? { height: fold.open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), overflow: "hidden" as const } : null;
  return (
    <View style={{ gap: GAP }}>
      <FolderHeader folderId={id} name={folder.name} collapsed={collapsed} open={fold.open} />
      {shown.length ? (
        <Animated.View style={clamp}>
          <View
            onLayout={(e) => {
              if (!collapsed && !fold.moving) setHeight(e.nativeEvent.layout.height);
            }}
            style={{ paddingLeft: INDENT, gap: GAP }}
          >
            {shown.map((c) => (
              <Node key={c.ref} node={c} parent={id} />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
});

function FolderHeader({ folderId, name, collapsed, open }: { folderId: string; name: string; collapsed: boolean; open: Animated.Value }) {
  const theme = useTheme();
  const ctx = useContext(TreeContext)!;
  const renaming = usePinnedFolders((f) => f.renaming?.folderId === folderId && f.renaming.windowId === ctx.windowId);
  const into = useStore(ctx.drop, (d) => d.into === folderId);
  const dragging = useStore(ctx.drop, (d) => d.dragging === folderId);
  const { hovered, hoverProps } = useHover();
  const pan = useFolderDrag(folderId, renaming);
  return (
    <View
      ref={(v) => void ctx.headers.set(folderId, v)}
      {...pan.panHandlers}
      {...hoverProps}
      onDoubleClick={() => usePinnedFolders.setState({ renaming: { windowId: ctx.windowId, folderId } })}
      style={{ opacity: dragging ? 0.45 : 1 }}
    >
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openPinnedFolderMenu(ctx.windowId, ctx.profileId, folderId);
        }}
      >
        <Pressable
          onPress={() => {
            dismissHover();
            if (!renaming) setPinnedFolderCollapsed(ctx.profileId, folderId, !collapsed);
          }}
        >
          {({ pressed }) => (
            <View
              style={{
                height: layout.rowHeight,
                borderRadius: 10,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 9,
                paddingRight: 6,
                backgroundColor: into || pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
              }}
            >
              <Symbol name={collapsed ? "folder" : "folder.fill"} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
              {renaming ? (
                <RenameField
                  initial={name}
                  placeholder="Folder name"
                  color={theme.textPrimary}
                  onDone={(text) => (text === null ? endFolderRename(folderId) : renamePinnedFolder(ctx.profileId, folderId, text))}
                />
              ) : (
                <FadeLabel text={name} fontSize={13} color={theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
              )}
              <Animated.View
                style={{
                  width: 10,
                  height: 10,
                  marginLeft: 4,
                  alignItems: "center",
                  justifyContent: "center",
                  transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                }}
              >
                <Symbol name="chevron.down" size={9} weight="semibold" color={theme.textTertiary} style={{ width: 10, height: 10 }} />
              </Animated.View>
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function slotTarget(tree: PinnedTree, slots: Slot[], y: number, skip: Set<string>, top: number): { target: FolderTarget; into: string | null; line: number | null } {
  const before = (s: Slot) => ({ target: { parent: s.parent, before: s.ref }, into: null, line: s.frame.y - top - GAP / 2 });
  const after = (s: Slot) => ({ target: { parent: s.parent, before: nextSibling(tree, s.parent, s.ref, skip) }, into: null, line: s.frame.y + s.frame.h - top + GAP / 2 });
  for (const s of slots) {
    const f = s.frame;
    if (y < f.y) return before(s);
    if (y > f.y + f.h) continue;
    const at = (y - f.y) / f.h;
    if (!s.folder) return at < 0.5 ? before(s) : after(s);
    const id = folderIdOf(s.ref);
    if (at < 0.25) return before(s);
    if (at <= 0.75) return { target: { parent: id }, into: id, line: null };
    if (s.collapsed) return after(s);
    const first = tree.folders[id]?.children.find((r) => !skip.has(r)) ?? null;
    return { target: { parent: id, before: first }, into: null, line: f.y + f.h - top + GAP / 2 };
  }
  const last = slots.at(-1);
  return { target: { parent: null }, into: null, line: last ? last.frame.y + last.frame.h - top + GAP / 2 : null };
}

function useFolderDrag(folderId: string, renaming: boolean) {
  const ctx = useContext(TreeContext)!;
  const latest = useRef({ ctx, renaming });
  latest.current = { ctx, renaming };
  return useMemo(() => {
    let slots: Slot[] | null = null;
    let top = 0;
    let pointerY = 0;
    let result: ReturnType<typeof slotTarget> | null = null;
    const update = () => {
      const { ctx: c } = latest.current;
      if (!slots) return;
      const skip = new Set([folderRef(folderId)]);
      result = slotTarget(c.tree, slots, pointerY, skip, top);
      c.drop.setState({ into: result.into, line: result.line });
    };
    const reset = () => {
      slots = null;
      result = null;
      suppressHover(false);
      latest.current.ctx.drop.setState({ into: null, line: null, dragging: null });
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !latest.current.renaming && Math.hypot(g.dx, g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        const { ctx: c } = latest.current;
        pointerY = g.y0;
        suppressHover(true);
        c.drop.setState({ dragging: folderId });
        const tree = c.tree;
        const candidates = c.visible.filter((v) => v.ref !== folderRef(folderId) && !(v.parent && isWithin(tree, folderId, v.parent)));
        const viewOf = (v: Visible) => (v.ref.startsWith("f:") ? c.headers.get(folderIdOf(v.ref)) : rowView(c.windowId, c.idOf.get(v.ref) ?? ""));
        void Promise.all([measure(c.container.current), ...candidates.map((v) => measure(viewOf(v)))]).then(([box, ...frames]) => {
          if (latest.current.ctx.drop.getState().dragging !== folderId) return;
          top = box?.y ?? 0;
          slots = candidates
            .map((v, i) => ({ ...v, folder: v.ref.startsWith("f:"), collapsed: !!tree.folders[folderIdOf(v.ref)]?.collapsed, frame: frames[i]! }))
            .filter((s) => !!s.frame && s.frame.h >= 1)
            .sort((a, z) => a.frame.y - z.frame.y);
          update();
        });
      },
      onPanResponderMove: (_, g) => {
        pointerY = g.moveY;
        update();
      },
      onPanResponderRelease: () => {
        const { ctx: c } = latest.current;
        const target = result?.target;
        reset();
        if (target) movePinnedNodes(c.profileId, [folderRef(folderId)], target);
      },
      onPanResponderTerminate: reset,
    });
  }, [folderId]);
}
