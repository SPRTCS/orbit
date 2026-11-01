import type { Adapter, Clock, ScopeState } from "@ardia/sync";

const deviceKeys = (id: string) => [`dev:${id}`, `tabs:${id}`];

export function forgottenKeys(ids: readonly string[], own: string | null): Set<string> {
  return new Set(ids.filter((id) => id && id !== own).flatMap(deviceKeys));
}

export function markForgotten(state: ScopeState, keys: ReadonlySet<string>, clock: Clock) {
  for (const key of keys) {
    const record = state.records[key];
    if (!record || record.v === null) continue;
    clock.observe(record.h);
    if (!(key in state.base)) state.base[key] = "null";
  }
}

export function reviveOwn(state: ScopeState, own: string) {
  for (const key of deviceKeys(own)) if (key in state.base && state.records[key]?.v === null) delete state.base[key];
}

export function forgetting(adapter: Adapter, keys: ReadonlySet<string>): Adapter {
  if (!keys.size) return adapter;
  return {
    ...adapter,
    extract: async (base, queued, now, known) => {
      const extraction = await adapter.extract(base, queued, now, known);
      if (!extraction) return extraction;
      const ignore = extraction.ignore;
      return { ...extraction, ignore: (key) => !keys.has(key) && !!ignore?.(key) };
    },
  };
}

export function stillListed(states: ScopeState[], id: string): boolean {
  return states.some((state) => deviceKeys(id).some((key) => key in state.base || (!!state.records[key] && state.records[key]!.v !== null)));
}
