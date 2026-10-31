import { systemInfo } from "@ardia/shell";
import type { ScopeState, Transport } from "@ardia/sync";
import { create } from "zustand";

export type SyncHome = { app: string; dir?: string };

type Stamped = {
  enabled: boolean;
  deviceId: string | null;
  home?: SyncHome;
  rejoin?: true;
  copyConflict?: number;
};

export const COPY_WARNING = "Another copy of Orbit is syncing as this Mac. Turn sync off and on to give this Mac its own identity.";

export const JOIN_PENDING = "This Mac's sync state came from another copy of Orbit, and its own sync key couldn't be saved, so it isn't syncing yet.";

export const useCopyWarning = create<{ conflict: boolean; joinPending: boolean }>(() => ({ conflict: false, joinPending: false }));

export function showJoinPending(joinPending: boolean) {
  if (useCopyWarning.getState().joinPending !== joinPending) useCopyWarning.setState({ joinPending });
}

export function currentHome(): SyncHome | null {
  try {
    const info = systemInfo() as { bundleId?: string; dataDirectoryId?: string | null };
    if (!info?.bundleId) return null;
    return info.dataDirectoryId ? { app: info.bundleId, dir: info.dataDirectoryId } : { app: info.bundleId };
  } catch {
    return null;
  }
}

export function writtenElsewhere(doc: Stamped): boolean {
  if (!doc.enabled || !doc.deviceId) return false;
  if (doc.rejoin) return true;
  const here = currentHome();
  const saved = doc.home;
  if (!saved || !here) return false;
  if (saved.app !== here.app) return true;
  return !!saved.dir && !!here.dir && saved.dir !== here.dir;
}

export function stampHome(doc: Stamped) {
  const here = currentHome();
  if (here) doc.home = here;
}

export const ownsIdentity = (doc: Stamped) => !writtenElsewhere(doc) && !doc.copyConflict;

export async function saveKeyFor(native: object, account: string): Promise<boolean> {
  const saveKey = (native as { saveKey?: (account: string) => Promise<boolean> }).saveKey;
  return saveKey ? await saveKey(account).catch(() => false) : false;
}

export function showCopyWarning(doc: Stamped) {
  const conflict = !!doc.enabled && !!doc.copyConflict;
  if (useCopyWarning.getState().conflict !== conflict) useCopyWarning.setState({ conflict });
}

export function noteCopyConflict(doc: Stamped, found: boolean) {
  if (found && !doc.copyConflict) doc.copyConflict = Date.now();
  showCopyWarning(doc);
}

export function watchingOwnBatches(transport: Transport, device: string, scopes: () => Record<string, ScopeState>, found: () => void): Transport {
  return {
    ...transport,
    read: async (scope, known) => {
      const listing = await transport.read(scope, known);
      const arriving = new Map<number, string[]>();
      for (const file of listing.files) {
        let parsed: { kind?: string; device?: string; seq?: number };
        try {
          parsed = JSON.parse(file.payload);
        } catch {
          continue;
        }
        if (parsed.kind !== "log" || parsed.device !== device || typeof parsed.seq !== "number") continue;
        arriving.set(parsed.seq, [...(arriving.get(parsed.seq) ?? []), file.payload]);
      }
      if (!arriving.size) return listing;
      const files = scopes()[scope]?.files ?? {};
      const ownAt = (seq: number) => Object.entries(files).filter(([, f]) => f.d === device && f.k === "log" && f.s === seq).map(([id]) => id);
      const wanted = new Set([...arriving.keys()].flatMap(ownAt));
      const mine = new Map<string, string>();
      if (wanted.size) {
        const own = await transport.read(scope, Object.keys(files).filter((id) => !wanted.has(id)));
        for (const file of own.files) if (wanted.has(file.id)) mine.set(file.id, file.payload);
      }
      for (const [seq, payloads] of arriving) {
        const known = ownAt(seq).flatMap((id) => (mine.has(id) ? [mine.get(id)!] : []));
        if (new Set([...payloads, ...known]).size > 1) found();
      }
      return listing;
    },
  };
}

export function anotherWriterAhead(state: ScopeState, device: string): boolean {
  return (state.vv[device] ?? 0) > state.seq || (state.extra[device] ?? []).some((seq) => seq > state.seq);
}

export async function conflictingBatch(state: ScopeState, scope: string, device: string, transport: Transport, checked: Set<string>): Promise<boolean> {
  const groups = new Map<number, string[]>();
  for (const [id, file] of Object.entries(state.files)) {
    if (file.d !== device || file.k !== "log" || file.s === undefined) continue;
    groups.set(file.s, [...(groups.get(file.s) ?? []), id]);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const key = `${scope} ${ids.sort().join(",")}`;
    if (checked.has(key)) continue;
    const wanted = new Set(ids);
    const listing = await transport.read(scope, Object.keys(state.files).filter((id) => !wanted.has(id)));
    const payloads = listing.files.filter((f) => wanted.has(f.id)).map((f) => f.payload);
    if (payloads.length < ids.length) continue;
    checked.add(key);
    if (new Set(payloads).size > 1) return true;
  }
  return false;
}
