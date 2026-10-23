import { create } from "zustand";
import type { BrowserState } from "./browser";
import { mirrored, pinKeyOf } from "./pinMirror";
import type { Tab, TabGroup } from "./types";

export type PinnedFolder = { id: string; name: string; collapsed: boolean; children: string[] };
export type PinnedTree = { root: string[]; folders: Record<string, PinnedFolder> };
export type FolderTarget = { parent: string | null; before?: string | null };
export type ResolvedNode = { ref: string; children?: ResolvedNode[] };
export type ImportPlan = { urls: string[]; layout: { parent: string | null; items: (string | number)[] }[]; expires: number };

export const EMPTY_TREE: PinnedTree = { root: [], folders: {} };

export const folderRef = (id: string) => `f:${id}`;
export const tabRef = (t: Pick<Tab, "id" | "pinKey">) => `t:${pinKeyOf(t)}`;
export const groupRef = (g: Pick<TabGroup, "id" | "pinKey">) => `g:${pinKeyOf(g)}`;
export const isFolderRef = (ref: string) => ref.startsWith("f:");
export const folderIdOf = (ref: string) => ref.slice(2);
export const hasFolders = (tree: PinnedTree | null | undefined): tree is PinnedTree => !!tree && Object.keys(tree.folders).length > 0;

export const usePinnedFolders = create<{ trees: Record<string, PinnedTree>; plans: Record<string, ImportPlan>; renaming: { windowId: string; folderId: string } | null }>(
  () => ({ trees: {}, plans: {}, renaming: null }),
);

export function childrenOf(tree: PinnedTree, parent: string | null): string[] {
  return parent === null ? tree.root : (tree.folders[parent]?.children ?? []);
}

function withChildren(tree: PinnedTree, parent: string | null, children: string[]): PinnedTree {
  if (parent === null) return { ...tree, root: children };
  const folder = tree.folders[parent];
  return folder ? { ...tree, folders: { ...tree.folders, [parent]: { ...folder, children } } } : tree;
}

export function parentOf(tree: PinnedTree, ref: string): string | null | undefined {
  if (tree.root.includes(ref)) return null;
  for (const f of Object.values(tree.folders)) if (f.children.includes(ref)) return f.id;
  return undefined;
}

export function refsIn(tree: PinnedTree): Set<string> {
  const out = new Set(tree.root);
  for (const f of Object.values(tree.folders)) for (const ref of f.children) out.add(ref);
  return out;
}

export function isWithin(tree: PinnedTree, ancestorId: string, folderId: string | null): boolean {
  const seen = new Set<string>();
  let at: string | null | undefined = folderId;
  while (at != null && !seen.has(at)) {
    if (at === ancestorId) return true;
    seen.add(at);
    at = parentOf(tree, folderRef(at));
  }
  return false;
}

export function folderDepth(tree: PinnedTree, folderId: string): number {
  let depth = 0;
  const seen = new Set<string>();
  let at = parentOf(tree, folderRef(folderId));
  while (at != null && !seen.has(at)) {
    seen.add(at);
    depth++;
    at = parentOf(tree, folderRef(at));
  }
  return depth;
}

function rootAncestor(tree: PinnedTree, ref: string): string | undefined {
  const seen = new Set<string>();
  let at = ref;
  for (;;) {
    const parent = parentOf(tree, at);
    if (parent === undefined) return undefined;
    if (parent === null) return at;
    if (seen.has(parent)) return undefined;
    seen.add(parent);
    at = folderRef(parent);
  }
}

function detach(tree: PinnedTree, refs: Set<string>): PinnedTree {
  const drop = (list: string[]) => (list.some((r) => refs.has(r)) ? list.filter((r) => !refs.has(r)) : list);
  const root = drop(tree.root);
  let folders = tree.folders;
  for (const f of Object.values(tree.folders)) {
    const children = drop(f.children);
    if (children !== f.children) folders = { ...folders, [f.id]: { ...f, children } };
  }
  return root === tree.root && folders === tree.folders ? tree : { root, folders };
}

export function moveNodes(tree: PinnedTree, refs: string[], target: FolderTarget): PinnedTree {
  if (target.parent !== null && !tree.folders[target.parent]) return tree;
  const moving = [...new Set(refs)].filter((r) => !isFolderRef(r) || !!tree.folders[folderIdOf(r)]);
  if (!moving.length) return tree;
  if (moving.some((r) => isFolderRef(r) && isWithin(tree, folderIdOf(r), target.parent))) return tree;
  const skip = new Set(moving);
  let before = target.before ?? null;
  if (before && skip.has(before)) {
    const siblings = childrenOf(tree, target.parent);
    before = siblings.slice(siblings.indexOf(before) + 1).find((r) => !skip.has(r)) ?? null;
  }
  const next = detach(tree, skip);
  const siblings = childrenOf(next, target.parent);
  const at = before ? siblings.indexOf(before) : -1;
  const index = at < 0 ? siblings.length : at;
  return withChildren(next, target.parent, [...siblings.slice(0, index), ...moving, ...siblings.slice(index)]);
}

export function createFolder(tree: PinnedTree, id: string, name: string, target: FolderTarget = { parent: null }, contents: string[] = []): PinnedTree {
  if (tree.folders[id]) return tree;
  const parent = target.parent !== null && !tree.folders[target.parent] ? null : target.parent;
  const added: PinnedTree = { ...tree, folders: { ...tree.folders, [id]: { id, name, collapsed: false, children: [] } } };
  const placed = moveNodes(added, [folderRef(id)], { parent, before: target.before });
  return contents.length ? moveNodes(placed, contents, { parent: id }) : placed;
}

export function renameFolder(tree: PinnedTree, id: string, name: string): PinnedTree {
  const f = tree.folders[id];
  return !f || f.name === name ? tree : { ...tree, folders: { ...tree.folders, [id]: { ...f, name } } };
}

export function setFolderCollapsed(tree: PinnedTree, id: string, collapsed: boolean): PinnedTree {
  const f = tree.folders[id];
  return !f || f.collapsed === collapsed ? tree : { ...tree, folders: { ...tree.folders, [id]: { ...f, collapsed } } };
}

export function deleteFolder(tree: PinnedTree, id: string): PinnedTree {
  const f = tree.folders[id];
  if (!f) return tree;
  const ref = folderRef(id);
  const parent = parentOf(tree, ref) ?? null;
  const { [id]: _gone, ...folders } = tree.folders;
  const rest: PinnedTree = { ...tree, folders };
  const siblings = childrenOf(rest, parent);
  const at = siblings.indexOf(ref);
  const children = f.children.filter((r) => r !== ref);
  const spliced = at < 0 ? [...siblings, ...children] : [...siblings.slice(0, at), ...children, ...siblings.slice(at + 1)];
  return withChildren(rest, parent, spliced);
}

export function placeNew(tree: PinnedTree, ordered: string[], fresh: Set<string>): PinnedTree {
  let next = tree;
  ordered.forEach((ref, i) => {
    if (!fresh.has(ref)) return;
    let anchor: string | undefined;
    for (let j = i - 1; j >= 0 && !anchor; j--) anchor = rootAncestor(next, ordered[j]!);
    let after = true;
    if (!anchor) {
      after = false;
      for (let j = i + 1; j < ordered.length && !anchor; j++) anchor = rootAncestor(next, ordered[j]!);
    }
    const at = anchor ? next.root.indexOf(anchor) + (after ? 1 : 0) : next.root.length;
    next = { ...next, root: [...next.root.slice(0, at), ref, ...next.root.slice(at)] };
  });
  return next;
}

export function resolveTree(tree: PinnedTree, refs: string[]): ResolvedNode[] {
  const known = refsIn(tree);
  const fresh = new Set(refs.filter((r) => !known.has(r)));
  const healed = fresh.size ? placeNew(tree, refs, fresh) : tree;
  const present = new Set(refs);
  const placed = new Set<string>();
  const build = (list: string[]): ResolvedNode[] => {
    const out: ResolvedNode[] = [];
    for (const ref of list) {
      if (placed.has(ref)) continue;
      if (isFolderRef(ref)) {
        const f = healed.folders[folderIdOf(ref)];
        if (!f) continue;
        placed.add(ref);
        out.push({ ref, children: build(f.children) });
      } else if (present.has(ref)) {
        placed.add(ref);
        out.push({ ref });
      }
    }
    return out;
  };
  const root = build(healed.root);
  for (const f of Object.values(healed.folders)) if (!placed.has(folderRef(f.id))) root.push(...build([folderRef(f.id)]));
  return root;
}

function longestRun(positions: number[]): Set<number> {
  const tails: number[] = [];
  const prevOf: number[] = [];
  positions.forEach((p, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positions[tails[mid]!]! < p) lo = mid + 1;
      else hi = mid;
    }
    prevOf[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prevOf[i]!) keep.add(i);
  return keep;
}

export function followMoves(tree: PinnedTree, prev: string[], next: string[]): PinnedTree {
  const was = new Map(prev.map((r, i) => [r, i]));
  const common = next.filter((r) => was.has(r));
  const keep = longestRun(common.map((r) => was.get(r)!));
  const settled = new Set(common.filter((_, i) => keep.has(i)));
  let out = tree;
  for (const ref of common) {
    if (settled.has(ref)) continue;
    const parent = parentOf(out, ref);
    settled.add(ref);
    if (parent === undefined) continue;
    const at = next.indexOf(ref);
    const sibling = (r: string) => settled.has(r) && r !== ref && parentOf(out, r) === parent;
    const successor = next.slice(at + 1).find(sibling);
    if (successor) {
      out = moveNodes(out, [ref], { parent, before: successor });
      continue;
    }
    const predecessor = next.slice(0, at).reverse().find(sibling);
    if (!predecessor) continue;
    const siblings = childrenOf(out, parent);
    out = moveNodes(out, [ref], { parent, before: siblings[siblings.indexOf(predecessor) + 1] ?? null });
  }
  return out;
}

export function reconcileTree(tree: PinnedTree, prev: string[] | null, next: string[]): PinnedTree {
  if (!next.length) return tree;
  let out = tree;
  if (prev) {
    const now = new Set(next);
    const gone = prev.filter((r) => !now.has(r));
    if (gone.length) out = detach(out, new Set(gone));
  }
  const known = refsIn(out);
  const fresh = new Set(next.filter((r) => !known.has(r)));
  if (fresh.size) out = placeNew(out, next, fresh);
  if (prev) out = followMoves(out, prev, next);
  return out;
}

type PinSource = Pick<BrowserState, "windows" | "windowOrder" | "tabs" | "groups" | "parkedPins"> & { ui: Pick<BrowserState["ui"], "focusOrder"> };

export function pinnedRefs(s: PinSource, profileId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (ref: string) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(ref);
  };
  const pinnedGroups = Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId && g.tabIds.length);
  for (const id of new Set([...s.ui.focusOrder, ...s.windowOrder])) {
    const w = s.windows[id];
    if (!mirrored(w)) continue;
    const at = new Map<string, number>();
    w.tabIds.forEach((tabId, i) => {
      at.set(tabId, i);
      const t = s.tabs[tabId];
      if (t?.pinned && t.pinnedAsRow && t.profileId === profileId) add(tabRef(t));
    });
    pinnedGroups
      .filter((g) => g.windowId === w.id)
      .sort((a, z) => (at.get(a.tabIds[0]!) ?? 0) - (at.get(z.tabIds[0]!) ?? 0))
      .forEach((g) => add(groupRef(g)));
  }
  if (out.length) return out;
  const park = s.parkedPins[profileId];
  if (!park) return out;
  for (const t of park.tabs) if (!t.groupId && t.pinnedAsRow) add(`t:${t.id}`);
  for (const g of park.groups) if (park.tabs.some((t) => t.groupId === g.id)) add(`g:${g.id}`);
  return out;
}

export function windowRefs(s: Pick<BrowserState, "tabs" | "groups">, rows: string[], groups: string[]): { refs: string[]; idOf: Map<string, string> } {
  const idOf = new Map<string, string>();
  const refs: string[] = [];
  for (const id of rows) {
    const t = s.tabs[id];
    if (!t) continue;
    const ref = tabRef(t);
    refs.push(ref);
    idOf.set(ref, id);
  }
  for (const id of groups) {
    const g = s.groups[id];
    if (!g) continue;
    const ref = groupRef(g);
    refs.push(ref);
    idOf.set(ref, id);
  }
  return { refs, idOf };
}

const urlKey = (url: string) => url.trim().replace(/#$/, "").replace(/\/$/, "").toLowerCase();

export function applyImportPlan(tree: PinnedTree, plan: ImportPlan, fresh: { ref: string; url: string }[]): { tree: PinnedTree; matched: number } {
  const used = new Set<number>();
  const refOf = new Map<number, string>();
  for (const f of fresh) {
    const key = urlKey(f.url);
    const i = plan.urls.findIndex((url, n) => !used.has(n) && urlKey(url) === key);
    if (i < 0) continue;
    used.add(i);
    refOf.set(i, f.ref);
  }
  if (!refOf.size) return { tree, matched: 0 };
  let out = tree;
  for (const { parent, items } of plan.layout) {
    const refs = items.map((x) => (typeof x === "number" ? refOf.get(x) : x)).filter((r): r is string => !!r);
    if (parent !== null) {
      if (out.folders[parent]) out = moveNodes(out, refs, { parent });
      continue;
    }
    const block = refs.filter((r) => parentOf(out, r) === null);
    if (!block.length) continue;
    const first = out.root.findIndex((r) => block.includes(r));
    const rest = out.root.filter((r) => !block.includes(r));
    const before = out.root.slice(0, first).filter((r) => !block.includes(r)).length;
    out = { ...out, root: [...rest.slice(0, before), ...block, ...rest.slice(before)] };
  }
  return { tree: out, matched: refOf.size };
}
