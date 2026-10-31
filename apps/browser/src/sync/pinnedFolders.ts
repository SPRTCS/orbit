import { assignPositions, canonical, type Adapter, type Extraction } from "@ardia/sync";
import { useBrowser } from "../store/browser";
import {
  appearanceOf,
  folderIdOf,
  folderRef,
  isFolderRef,
  pinnedRefs,
  reconcileTree,
  usePinnedFolders,
  type FolderAppearance,
  type FolderColor,
  type PinnedTree,
} from "../store/pinnedFolders";
import { adoptSyncedTree, appearanceRef, pinnedChoices, pinnedFoldersStarted, settlePinnedChoices } from "../lib/pinnedFolders";

export const PIN_FOLDER = "pinfolder:";

export type PinnedNodeValue = { p: string | null; pos: string };
export type PinnedFolderValue = PinnedNodeValue & { n: string };
export type PinnedAppearanceValue = { e?: string; c?: FolderColor };

type Records = Record<string, { v: unknown }> | undefined;

const keyOf = (ref: string) => `${PIN_FOLDER}${ref}`;
const refOf = (key: string) => key.slice(PIN_FOLDER.length);
const pinRecordOf = (ref: string) => `pin:${ref}`;
const isLeafRef = (ref: string) => ref.startsWith("t:") || ref.startsWith("g:");
const isAppearanceRef = (ref: string) => ref.startsWith("a:") && ref.length > 2;

export function appearanceValue(value: unknown): FolderAppearance | null {
  if (!value || typeof value !== "object") return null;
  const { e, c } = value as Record<string, unknown>;
  return appearanceOf({ emoji: e as string, color: c as FolderColor });
}

function appearanceRecord(appearance: FolderAppearance): PinnedAppearanceValue | null {
  const { emoji, color } = appearanceOf(appearance);
  return emoji || color ? { ...(emoji ? { e: emoji } : {}), ...(color ? { c: color } : {}) } : null;
}

function nodeValue(ref: string, value: unknown): PinnedNodeValue | PinnedFolderValue | null {
  if (!value || typeof value !== "object") return null;
  const { p, pos, n } = value as Record<string, unknown>;
  if (typeof pos !== "string" || !pos || (p !== null && typeof p !== "string")) return null;
  if (isFolderRef(ref)) return typeof n === "string" && ref.length > 2 ? { n, p, pos } : null;
  return isLeafRef(ref) && ref.length > 2 ? { p, pos } : null;
}

function layout(tree: PinnedTree, keep: (ref: string) => boolean): Map<string | null, string[]> {
  const lists = new Map<string | null, string[]>();
  const placed = new Set<string>();
  const reachable = new Set<string>();
  const reach = (list: string[]) => {
    for (const ref of list) {
      if (!isFolderRef(ref) || reachable.has(ref) || !tree.folders[folderIdOf(ref)]) continue;
      reachable.add(ref);
      reach(tree.folders[folderIdOf(ref)]!.children);
    }
  };
  reach(tree.root);
  const orphans = Object.keys(tree.folders).map(folderRef).filter((ref) => !reachable.has(ref));
  const visit = (parent: string | null, list: string[]) => {
    const kids = list.filter((ref) => !placed.has(ref) && (isFolderRef(ref) ? !!tree.folders[folderIdOf(ref)] : keep(ref)));
    kids.forEach((ref) => placed.add(ref));
    lists.set(parent, [...(lists.get(parent) ?? []), ...kids]);
    for (const ref of kids) if (isFolderRef(ref)) visit(folderIdOf(ref), tree.folders[folderIdOf(ref)]!.children);
  };
  visit(null, tree.root);
  for (const ref of orphans) if (!placed.has(ref)) visit(null, [ref]);
  return lists;
}

export function breakCycles(parent: Map<string, string | null>, folderIds: Iterable<string>) {
  for (const id of [...folderIds].sort()) {
    for (;;) {
      const path: string[] = [];
      let at: string | null = id;
      while (at !== null && !path.includes(at)) {
        path.push(at);
        at = parent.get(at) ?? null;
      }
      if (at === null) break;
      const lowest = path.slice(path.indexOf(at)).sort()[0]!;
      parent.set(lowest, null);
    }
  }
}

export function treeFromRecords(visible: Map<string, unknown>, pinGone: (ref: string) => boolean, collapsed: (folderId: string) => boolean): PinnedTree {
  const folders = new Map<string, PinnedFolderValue>();
  const nodes = new Map<string, PinnedNodeValue>();
  const looks = new Map<string, FolderAppearance>();
  for (const [key, raw] of visible) {
    if (!key.startsWith(PIN_FOLDER)) continue;
    const ref = refOf(key);
    if (isAppearanceRef(ref)) {
      const look = appearanceValue(raw);
      if (look) looks.set(ref.slice(2), look);
      continue;
    }
    const value = nodeValue(ref, raw);
    if (!value) continue;
    if (isFolderRef(ref)) folders.set(folderIdOf(ref), value as PinnedFolderValue);
    else if (pinGone(ref)) continue;
    nodes.set(ref, value);
  }
  const folderParent = new Map<string, string | null>();
  const parentOfRef = (ref: string, v: PinnedNodeValue) => (v.p !== null && folders.has(v.p) && (!isFolderRef(ref) || v.p !== folderIdOf(ref)) ? v.p : null);
  for (const [id, v] of folders) folderParent.set(id, parentOfRef(folderRef(id), v));
  breakCycles(folderParent, folders.keys());
  const children = new Map<string | null, string[]>([[null, []]]);
  for (const [ref, v] of nodes) {
    const p = isFolderRef(ref) ? folderParent.get(folderIdOf(ref))! : parentOfRef(ref, v);
    children.set(p, [...(children.get(p) ?? []), ref]);
  }
  const byPosition = (a: string, z: string) => {
    const pa = nodes.get(a)!.pos;
    const pz = nodes.get(z)!.pos;
    return pa < pz ? -1 : pa > pz ? 1 : a < z ? -1 : 1;
  };
  for (const list of children.values()) list.sort(byPosition);
  return {
    root: children.get(null)!,
    folders: Object.fromEntries(
      [...folders].map(([id, v]) => [id, { id, name: v.n, collapsed: collapsed(id), children: children.get(id) ?? [], ...looks.get(id) }]),
    ),
  };
}

export function pinnedFoldersAdapter(profileId: string, records: () => Records): Adapter {
  const pinGone = (ref: string) => records()?.[pinRecordOf(ref)]?.v === null;
  const folderOnItsWay = (id: string, base: (key: string) => unknown) => {
    const key = keyOf(folderRef(id));
    return base(key) === undefined && records()?.[key]?.v !== null;
  };
  const unapplied = (key: string, base: (key: string) => unknown) => {
    const record = records()?.[key];
    return !!record && canonical(record.v) !== canonical(base(key) ?? null);
  };
  return {
    prefix: PIN_FOLDER,
    extract: (base, queued) => {
      if (!pinnedFoldersStarted()) return null;
      const tree = usePinnedFolders.getState().trees[profileId] ?? { root: [], folders: {} };
      const values = new Map<string, unknown>();
      const held = new Set<string>();
      const chosen = new Map(pinnedChoices().get(profileId) ?? []);
      const present = new Set(pinnedRefs(useBrowser.getState(), profileId));
      const waitingIn = (key: string, local: PinnedTree) => {
        const was = nodeValue(refOf(key), base(key));
        return !!was && was.p !== null && !local.folders[was.p] && folderOnItsWay(was.p, base) ? was : null;
      };
      const keep = (ref: string) => isLeafRef(ref) && !pinGone(ref) && (present.has(ref) || base(keyOf(ref)) !== undefined);
      for (const [parent, refs] of layout(tree, keep)) {
        const waiting = refs.map((ref) => (parent === null && !chosen.has(ref) ? waitingIn(keyOf(ref), tree) : null));
        const placed = refs.filter((_, i) => !waiting[i]);
        const positions = assignPositions(
          placed.map((ref) => {
            const was = nodeValue(ref, base(keyOf(ref)));
            return was?.p === parent && !chosen.has(ref) ? was.pos : undefined;
          }),
        );
        let next = 0;
        refs.forEach((ref, i) => {
          const key = keyOf(ref);
          const placement: PinnedNodeValue = waiting[i] ? { p: waiting[i]!.p, pos: waiting[i]!.pos } : { p: parent, pos: positions[next++]! };
          if (!chosen.has(ref) && unapplied(key, base)) return void held.add(key);
          values.set(key, isFolderRef(ref) ? ({ n: tree.folders[folderIdOf(ref)]!.name, ...placement } satisfies PinnedFolderValue) : placement);
        });
      }
      for (const folder of Object.values(tree.folders)) {
        const ref = appearanceRef(folder.id);
        const key = keyOf(ref);
        const look = appearanceRecord(folder);
        const same = base(key) !== undefined && canonical(appearanceRecord(appearanceValue(base(key)) ?? {})) === canonical(look);
        if (!chosen.has(ref) && (same || unapplied(key, base))) held.add(key);
        else if (look) values.set(key, look);
      }
      const ignore = (key: string) => {
        if (held.has(key)) return true;
        const ref = refOf(key);
        if (isAppearanceRef(ref)) {
          const id = ref.slice(2);
          if (tree.folders[id]) return false;
          return !chosen.has(folderRef(id)) && records()?.[keyOf(folderRef(id))]?.v !== null;
        }
        if (!nodeValue(ref, base(key))) return true;
        return isLeafRef(ref) && !pinGone(ref) && !chosen.has(ref) && !!waitingIn(key, tree);
      };
      const republish = (key: string) => chosen.has(refOf(key)) && !queued(key);
      const goesOut = (ref: string) => {
        const key = keyOf(ref);
        if (values.has(key)) return republish(key) || canonical(values.get(key)) !== canonical(base(key) ?? null);
        return base(key) !== undefined && !ignore(key);
      };
      settlePinnedChoices(profileId, [...chosen].filter(([ref]) => !goesOut(ref)));
      const settle = (keys: Set<string>) => {
        const shown = new Set(pinnedRefs(useBrowser.getState(), profileId));
        settlePinnedChoices(profileId, [...chosen].filter(([ref]) => keys.has(keyOf(ref))));
        const gone = new Set([...keys].map(refOf).filter((ref) => isLeafRef(ref) && pinGone(ref) && !shown.has(ref)));
        const now = usePinnedFolders.getState().trees[profileId];
        if (!gone.size || !now) return;
        const without = (list: string[]) => list.filter((ref) => !gone.has(ref));
        adoptSyncedTree(profileId, { root: without(now.root), folders: Object.fromEntries(Object.entries(now.folders).map(([id, f]) => [id, { ...f, children: without(f.children) }])) });
      };
      return { values, ignore, republish, published: settle } satisfies Extraction;
    },
    apply: (visible) => {
      if (!pinnedFoldersStarted()) return false;
      const old = usePinnedFolders.getState().trees[profileId];
      const synced = treeFromRecords(visible, pinGone, (id) => old?.folders[id]?.collapsed ?? false);
      if (!Object.keys(synced.folders).length) return void adoptSyncedTree(profileId, null);
      adoptSyncedTree(profileId, reconcileTree(synced, null, pinnedRefs(useBrowser.getState(), profileId)));
    },
  };
}

export const watchPinnedFolders = (edited: () => void) =>
  usePinnedFolders.subscribe((f, prev) => {
    if (f.trees !== prev.trees) edited();
  });
