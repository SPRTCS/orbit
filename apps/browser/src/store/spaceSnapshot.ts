import { sanitizeTheme } from "../lib/profileTheme";
import type { BrowserState } from "./browser";
import { isPinnedRow } from "./model";
import { samePage } from "./organize";
import { mirrored, pinKeyOf } from "./pinMirror";
import { EMPTY_TREE, folderIdOf, isFolderRef, pinnedRefs, resolveTree, type PinnedTree, type ResolvedNode } from "./pinnedFolders";
import type { BrowserWindow, GroupColor, ProfileColor, ProfileTheme, Tab, TabGroup } from "./types";

export const SPACE_FORMAT = "orbit-space" as const;
export const SPACE_VERSION = 1;
export const SPACE_EXTENSION = "orbitspace";

export type SpaceLink = { url: string; title?: string; customTitle?: string; customIcon?: string };
export type SpaceTab = { kind: "tab" } & SpaceLink;
export type SpaceGroup = { kind: "group"; name: string; icon?: string; color?: GroupColor; collapsed?: boolean; tabs: SpaceLink[] };
export type SpaceFolder = { kind: "folder"; name: string; collapsed?: boolean; children: SpaceNode[] };
export type SpaceNode = SpaceTab | SpaceGroup | SpaceFolder;
export type SpaceTodayItem = SpaceTab | SpaceGroup;

export type SpaceDoc = {
  format: typeof SPACE_FORMAT;
  version: number;
  kind: "space" | "folder";
  name: string;
  icon?: string;
  color?: ProfileColor;
  savedAt?: number;
  theme?: ProfileTheme;
  tiles: SpaceLink[];
  pinned: SpaceNode[];
  today?: SpaceTodayItem[];
};

export type SnapshotOptions = { today?: boolean; local?: boolean; now?: number };

export class SpaceFileError extends Error {}

const PROFILE_COLORS: ProfileColor[] = ["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral"];
const GROUP_COLORS: GroupColor[] = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const MAX_TEXT = 300;
const MAX_ICON = 64;
const MAX_DEPTH = 32;
const MAX_NODES = 5000;

export const shareableUrl = (url: string, local = false) => /^https?:\/\/[^\s]+$/i.test(url) || (local && /^file:\/\/\/[^\s]+$/i.test(url));

type Source = Pick<BrowserState, "windows" | "windowOrder" | "tabs" | "groups" | "parkedPins" | "profiles" | "history"> & {
  ui: Pick<BrowserState["ui"], "focusOrder">;
};

type FoundGroup = { group: Pick<TabGroup, "name" | "icon" | "color" | "collapsed">; members: Tab[] };
type Found = { tiles: Tab[]; rows: Map<string, Tab>; groups: Map<string, FoundGroup> };

function spaceWindows(s: Source, profileId: string): BrowserWindow[] {
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].map((id) => s.windows[id]).filter(mirrored);
  const shows = (w: BrowserWindow) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.filter(shows);
}

function findPins(s: Source, profileId: string): Found {
  const found: Found = { tiles: [], rows: new Map(), groups: new Map() };
  const seen = new Set<string>();
  const memberOf = new Map<string, TabGroup>();
  for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) for (const id of g.tabIds) memberOf.set(id, g);
  for (const w of spaceWindows(s, profileId)) {
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      if (!t || t.profileId !== profileId) continue;
      const g = t.pinned ? undefined : memberOf.get(id);
      if (!t.pinned && !g) continue;
      if (seen.has(pinKeyOf(t))) continue;
      seen.add(pinKeyOf(t));
      if (g) {
        const key = pinKeyOf(g);
        const entry = found.groups.get(key) ?? { group: g, members: [] };
        entry.members.push(t);
        found.groups.set(key, entry);
      } else if (isPinnedRow(t)) found.rows.set(pinKeyOf(t), t);
      else found.tiles.push(t);
    }
  }
  if (seen.size) return found;
  const park = s.parkedPins[profileId];
  if (!park) return found;
  const parkedTab = (p: (typeof park.tabs)[number]) => ({ ...p, id: p.id, windowId: "", navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 }) as Tab;
  for (const p of park.tabs) {
    if (p.groupId) {
      const g = park.groups.find((x) => x.id === p.groupId);
      if (!g) continue;
      const entry = found.groups.get(g.id) ?? { group: g, members: [] };
      entry.members.push(parkedTab(p));
      found.groups.set(g.id, entry);
    } else if (p.pinnedAsRow) found.rows.set(p.id, parkedTab(p));
    else found.tiles.push(parkedTab(p));
  }
  return found;
}

const clip = (text: string | null | undefined, max = MAX_TEXT) => (text ? text.slice(0, max) : undefined);

function titleAt(s: Source, t: Tab, url: string): string | undefined {
  if (t.url && samePage(t.url, url)) return clip(t.title);
  return clip(s.history[t.profileId]?.find((h) => samePage(h.url, url))?.title ?? undefined);
}

function linkOf(s: Source, t: Tab, home: boolean, local: boolean): SpaceLink | null {
  const url = home ? t.pinnedUrl || t.url : t.url;
  if (!url || !shareableUrl(url, local)) return null;
  return compact({ url, title: titleAt(s, t, url), customTitle: clip(t.customTitle), customIcon: clip(t.customIcon, MAX_ICON) });
}

function compact<T extends object>(value: T): T {
  const out = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined && value[key] !== null && value[key] !== "") out[key] = value[key];
  return out;
}

function groupDoc(s: Source, group: FoundGroup, local: boolean, home: boolean): SpaceGroup | null {
  const tabs = group.members.map((t) => linkOf(s, t, home, local)).filter((l): l is SpaceLink => !!l);
  if (!tabs.length) return null;
  return compact({
    kind: "group" as const,
    name: clip(group.group.name) ?? "",
    icon: clip(group.group.icon, MAX_ICON),
    color: group.group.color ?? undefined,
    collapsed: group.group.collapsed || undefined,
    tabs,
  });
}

function nodesOf(s: Source, found: Found, tree: PinnedTree, nodes: ResolvedNode[], local: boolean): SpaceNode[] {
  const out: SpaceNode[] = [];
  for (const n of nodes) {
    if (isFolderRef(n.ref)) {
      const f = tree.folders[folderIdOf(n.ref)];
      if (!f) continue;
      out.push(compact({ kind: "folder" as const, name: clip(f.name) ?? "", collapsed: f.collapsed || undefined, children: nodesOf(s, found, tree, n.children ?? [], local) }));
    } else if (n.ref.startsWith("t:")) {
      const t = found.rows.get(n.ref.slice(2));
      const link = t && linkOf(s, t, true, local);
      if (link) out.push({ kind: "tab", ...link });
    } else if (n.ref.startsWith("g:")) {
      const g = found.groups.get(n.ref.slice(2));
      const doc = g && groupDoc(s, g, local, false);
      if (doc) out.push(doc);
    }
  }
  return out;
}

function todayOf(s: Source, profileId: string, local: boolean): SpaceTodayItem[] {
  const out: SpaceTodayItem[] = [];
  const pinnedMembers = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const groupOf = new Map<string, TabGroup>();
  for (const g of Object.values(s.groups)) if (!g.pinned && g.profileId === profileId) for (const id of g.tabIds) groupOf.set(id, g);
  const placed = new Map<string, SpaceGroup>();
  for (const w of spaceWindows(s, profileId)) {
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      if (!t || t.profileId !== profileId || t.pinned || pinnedMembers.has(id)) continue;
      const link = linkOf(s, t, false, local);
      if (!link) continue;
      const g = groupOf.get(id);
      if (!g) {
        out.push({ kind: "tab", ...link });
        continue;
      }
      const existing = placed.get(g.id);
      if (existing) existing.tabs.push(link);
      else {
        const doc = compact({ kind: "group" as const, name: clip(g.name) ?? "", icon: clip(g.icon, MAX_ICON), color: g.color ?? undefined, collapsed: g.collapsed || undefined, tabs: [link] });
        placed.set(g.id, doc);
        out.push(doc);
      }
    }
  }
  return out;
}

export function snapshotSpace(s: Source, tree: PinnedTree | undefined, profileId: string, options: SnapshotOptions = {}): SpaceDoc {
  const profile = s.profiles[profileId];
  const local = !!options.local;
  const found = findPins(s, profileId);
  const base = tree ?? EMPTY_TREE;
  const nodes = resolveTree(base, pinnedRefs(s, profileId));
  const theme = profile?.theme ? sanitizeTheme(profile.theme) : null;
  return compact({
    format: SPACE_FORMAT,
    version: SPACE_VERSION,
    kind: "space" as const,
    name: profile?.name ?? "Space",
    icon: clip(profile?.icon, MAX_ICON),
    color: profile?.color,
    savedAt: options.now ?? Date.now(),
    theme: theme ?? undefined,
    tiles: found.tiles.map((t) => linkOf(s, t, true, local)).filter((l): l is SpaceLink => !!l),
    pinned: nodesOf(s, found, base, nodes, local),
    ...(options.today ? { today: todayOf(s, profileId, local) } : {}),
  });
}

function findFolder(nodes: ResolvedNode[], ref: string): ResolvedNode | undefined {
  for (const n of nodes) {
    if (n.ref === ref) return n;
    const inner = n.children && findFolder(n.children, ref);
    if (inner) return inner;
  }
  return undefined;
}

export function snapshotFolder(s: Source, tree: PinnedTree, profileId: string, folderId: string, options: Omit<SnapshotOptions, "today"> = {}): SpaceDoc | null {
  const folder = tree.folders[folderId];
  if (!folder) return null;
  const found = findPins(s, profileId);
  const node = findFolder(resolveTree(tree, pinnedRefs(s, profileId)), `f:${folderId}`);
  if (!node) return null;
  return compact({
    format: SPACE_FORMAT,
    version: SPACE_VERSION,
    kind: "folder" as const,
    name: clip(folder.name) ?? "Folder",
    savedAt: options.now ?? Date.now(),
    tiles: [],
    pinned: nodesOf(s, found, tree, [node], !!options.local),
  });
}

export function serializeSpace(doc: SpaceDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function spaceSignature(doc: SpaceDoc): string {
  const { savedAt: _, ...rest } = doc;
  return JSON.stringify(rest);
}

export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${text.length.toString(36)}`;
}

const UPGRADES: ((doc: Record<string, unknown>) => Record<string, unknown>)[] = [];

const text = (v: unknown, max = MAX_TEXT) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

type Budget = { nodes: number; local: boolean };

function readLink(v: unknown, budget: Budget): SpaceLink | null {
  if (!v || typeof v !== "object" || budget.nodes >= MAX_NODES) return null;
  const o = v as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!shareableUrl(url, budget.local) || url.length > 8192) return null;
  budget.nodes++;
  return compact({ url, title: text(o.title), customTitle: text(o.customTitle), customIcon: text(o.customIcon, MAX_ICON) });
}

function readGroup(o: Record<string, unknown>, budget: Budget): SpaceGroup | null {
  const tabs = Array.isArray(o.tabs) ? o.tabs.map((t) => readLink(t, budget)).filter((l): l is SpaceLink => !!l) : [];
  if (!tabs.length) return null;
  return compact({
    kind: "group" as const,
    name: text(o.name) ?? "",
    icon: text(o.icon, MAX_ICON),
    color: GROUP_COLORS.includes(o.color as GroupColor) ? (o.color as GroupColor) : undefined,
    collapsed: o.collapsed === true || undefined,
    tabs,
  });
}

function readNode(v: unknown, depth: number, budget: Budget): SpaceNode | null {
  if (!v || typeof v !== "object" || budget.nodes >= MAX_NODES) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "tab") {
    const link = readLink(o, budget);
    return link ? { kind: "tab", ...link } : null;
  }
  if (o.kind === "group") return readGroup(o, budget);
  if (o.kind === "folder") {
    budget.nodes++;
    const children = depth < MAX_DEPTH && Array.isArray(o.children) ? readNodes(o.children, depth + 1, budget) : [];
    return compact({ kind: "folder" as const, name: text(o.name) ?? "Folder", collapsed: o.collapsed === true || undefined, children });
  }
  return null;
}

function readNodes(list: unknown[], depth: number, budget: Budget): SpaceNode[] {
  return list.map((n) => readNode(n, depth, budget)).filter((n): n is SpaceNode => !!n);
}

export function parseSpace(input: string | unknown, options: { local?: boolean } = {}): SpaceDoc {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new SpaceFileError("This file isn't an Orbit space.");
    }
  }
  if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).format !== SPACE_FORMAT) throw new SpaceFileError("This file isn't an Orbit space.");
  let o = raw as Record<string, unknown>;
  const version = o.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new SpaceFileError("This space file is damaged: it has no valid version.");
  if (version > SPACE_VERSION) throw new SpaceFileError("This space was shared from a newer version of Orbit. Update Orbit to open it.");
  for (let v = version; v < SPACE_VERSION; v++) o = UPGRADES[v - 1]!(o);
  const budget: Budget = { nodes: 0, local: !!options.local };
  const theme = o.theme ? sanitizeTheme(o.theme) : null;
  const tiles = Array.isArray(o.tiles) ? o.tiles.map((t) => readLink(t, budget)).filter((l): l is SpaceLink => !!l) : [];
  const pinned = Array.isArray(o.pinned) ? readNodes(o.pinned, 0, budget) : [];
  const today = Array.isArray(o.today)
    ? o.today
        .map((n) => readNode(n, MAX_DEPTH, budget))
        .filter((n): n is SpaceTodayItem => !!n && n.kind !== "folder")
    : undefined;
  return compact({
    format: SPACE_FORMAT,
    version: SPACE_VERSION,
    kind: o.kind === "folder" ? ("folder" as const) : ("space" as const),
    name: text(o.name, 100) ?? (o.kind === "folder" ? "Shared Folder" : "Shared Space"),
    icon: text(o.icon, MAX_ICON),
    color: PROFILE_COLORS.includes(o.color as ProfileColor) ? (o.color as ProfileColor) : undefined,
    savedAt: typeof o.savedAt === "number" && Number.isFinite(o.savedAt) ? o.savedAt : undefined,
    theme: theme ?? undefined,
    tiles,
    pinned,
    ...(today ? { today } : {}),
  });
}

export function extractSpaceJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

export type SpaceCounts = { tiles: number; pins: number; groups: number; folders: number; today: number };

export function spaceCounts(doc: SpaceDoc): SpaceCounts {
  const counts: SpaceCounts = { tiles: doc.tiles.length, pins: 0, groups: 0, folders: 0, today: 0 };
  const walk = (nodes: SpaceNode[]) => {
    for (const n of nodes) {
      if (n.kind === "tab") counts.pins++;
      else if (n.kind === "group") (counts.groups++, (counts.pins += n.tabs.length));
      else (counts.folders++, walk(n.children));
    }
  };
  walk(doc.pinned);
  for (const n of doc.today ?? []) counts.today += n.kind === "group" ? n.tabs.length : 1;
  return counts;
}

export type SpaceSection = "tiles" | "pinned" | "today";
export type SpaceLine = { depth: number; section: SpaceSection; kind: "tab" | "group" | "folder"; title: string; url?: string; icon?: string };

export const linkTitle = (l: SpaceLink) => l.customTitle || l.title || l.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

export function spaceLines(doc: SpaceDoc, options: { today?: boolean } = {}): SpaceLine[] {
  const out: SpaceLine[] = [];
  const link = (l: SpaceLink, depth: number, section: SpaceSection) => out.push({ depth, section, kind: "tab", title: linkTitle(l), url: l.url, icon: l.customIcon });
  const walk = (nodes: SpaceNode[], depth: number, section: SpaceSection) => {
    for (const n of nodes) {
      if (n.kind === "tab") link(n, depth, section);
      else if (n.kind === "group") {
        out.push({ depth, section, kind: "group", title: n.name || "Group", icon: n.icon });
        for (const l of n.tabs) link(l, depth + 1, section);
      } else {
        out.push({ depth, section, kind: "folder", title: n.name || "Folder" });
        walk(n.children, depth + 1, section);
      }
    }
  };
  for (const l of doc.tiles) link(l, 0, "tiles");
  walk(doc.pinned, 0, "pinned");
  if (options.today !== false) walk(doc.today ?? [], 0, "today");
  return out;
}

export function shareText(doc: SpaceDoc): string {
  const lines = [`${doc.icon && !doc.icon.startsWith("symbol:") ? `${doc.icon} ` : ""}${doc.name}`, ""];
  if (doc.tiles.length) lines.push(...doc.tiles.map((l) => `• ${linkTitle(l)}: ${l.url}`), "");
  const walk = (nodes: SpaceNode[], depth: number) => {
    const pad = "  ".repeat(depth);
    for (const n of nodes) {
      if (n.kind === "tab") lines.push(`${pad}• ${linkTitle(n)}: ${n.url}`);
      else if (n.kind === "group") {
        lines.push(`${pad}▸ ${n.name || "Group"}`);
        for (const l of n.tabs) lines.push(`${pad}  • ${linkTitle(l)}: ${l.url}`);
      } else {
        lines.push(`${pad}📁 ${n.name || "Folder"}`);
        walk(n.children, depth + 1);
      }
    }
  };
  walk(doc.pinned, 0);
  lines.push("", "To add this to Orbit, copy this whole message and choose Spaces › Import Space from Clipboard.", "", JSON.stringify(doc));
  return lines.join("\n");
}
