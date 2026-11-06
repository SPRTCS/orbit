export const ICON_DOCK_WIDTH = 96;
export const ICON_DOCK_SNAP = 128;

export const isIconDock = (width: number) => width < ICON_DOCK_SNAP;

export function snapSidebarWidth(width: number, minimum: number): number {
  if (width < ICON_DOCK_SNAP) return ICON_DOCK_WIDTH;
  return Math.max(minimum, width);
}

export type DockPage = { kind: "folder"; id: string };

export type DockItem =
  | { kind: "folder"; key: string; folderId: string }
  | { kind: "tab"; key: string; tabId: string }
  | { kind: "newTab"; key: string }
  | { kind: "separator"; key: string };

export type DockNode = { tabIds: string[] } | { folderId: string; children: DockNode[] };

export type DockSource = { tiles: string[]; nodes: DockNode[]; open: string[] };

export const pageKey = (page: DockPage | null | undefined) => (page ? `f:${page.id}` : "root");

const isFolderNode = (node: DockNode): node is { folderId: string; children: DockNode[] } => "folderId" in node;

const tabItem = (tabId: string): DockItem => ({ kind: "tab", key: `t:${tabId}`, tabId });

function nodeItems(nodes: DockNode[]): DockItem[] {
  return nodes.flatMap((node) => (isFolderNode(node) ? [{ kind: "folder", key: `f:${node.folderId}`, folderId: node.folderId } as DockItem] : node.tabIds.map(tabItem)));
}

export function findFolder(nodes: DockNode[], id: string): DockNode[] | null {
  for (const node of nodes) {
    if (!isFolderNode(node)) continue;
    if (node.folderId === id) return node.children;
    const inside = findFolder(node.children, id);
    if (inside) return inside;
  }
  return null;
}

function withOpenTabs(pinned: DockItem[], source: DockSource): DockItem[] {
  const open: DockItem[] = [{ kind: "newTab", key: "new-tab" }, ...source.open.map(tabItem)];
  return pinned.length ? [...pinned, { kind: "separator", key: "separator" }, ...open] : open;
}

export const rootItems = (source: DockSource): DockItem[] => withOpenTabs([...source.tiles.map(tabItem), ...nodeItems(source.nodes)], source);

export function pageItems(source: DockSource, page: DockPage | null | undefined): DockItem[] | null {
  if (!page) return rootItems(source);
  const children = findFolder(source.nodes, page.id);
  return children ? withOpenTabs(nodeItems(children), source) : null;
}

export const DOCK_METRICS = {
  maximumTile: 52,
  minimumTile: 38,
  visibleIcons: 12,
  spacing: 8,
  separatorHeight: 9,
  padding: 8,
};

export type Placement = { center: number; size: number };

export function dockTile(viewport: number): number {
  const m = DOCK_METRICS;
  const fitting = Math.floor((viewport - m.padding * 2 - m.spacing * (m.visibleIcons - 1)) / m.visibleIcons);
  return Math.min(m.maximumTile, Math.max(m.minimumTile, fitting));
}

export class DockColumn {
  readonly tile: number;
  readonly rest: Placement[];
  readonly separators: boolean[];

  constructor(separators: boolean[], viewport: number) {
    const m = DOCK_METRICS;
    this.separators = separators;
    this.tile = dockTile(viewport);
    this.rest = placements(separators.map((s) => (s ? m.separatorHeight : this.tile)));
  }

  get restHeight(): number {
    const last = this.rest[this.rest.length - 1];
    return last ? last.center + last.size / 2 + DOCK_METRICS.padding : DOCK_METRICS.padding * 2;
  }

  index(y: number): number | null {
    const rest = this.rest;
    if (!rest.length || y < -DOCK_METRICS.spacing || y > this.restHeight + DOCK_METRICS.spacing) return null;
    let best: number | null = null;
    for (let i = 0; i < rest.length; i++) {
      if (this.separators[i]) continue;
      if (best === null || Math.abs(rest[i]!.center - y) < Math.abs(rest[best]!.center - y)) best = i;
    }
    return best;
  }
}

function placements(sizes: number[]): Placement[] {
  let y = DOCK_METRICS.padding;
  return sizes.map((size) => {
    const place = { center: y + size / 2, size };
    y += size + DOCK_METRICS.spacing;
    return place;
  });
}
