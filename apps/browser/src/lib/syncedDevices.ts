export type DeviceKind = "iphone" | "ipad" | "vision" | "imac" | "macmini" | "macstudio" | "macpro" | "laptop";

export type RemoteDeviceTabs = { deviceId: string; name: string; kind?: string; tabs: { url: string; title: string }[] };
export type SeenDevice = { id: string; lastSeen: number | null };

export type SidebarDeviceTab = { url: string; title: string; host: string };
export type SidebarDevice = { id: string; name: string; kind: DeviceKind; symbol: string; lastSeen: number | null; tabs: SidebarDeviceTab[] };

const KIND_WORDS: [DeviceKind, RegExp][] = [
  ["iphone", /\biphone\b|\bphone\b/i],
  ["ipad", /\bipad\b|\btablet\b/i],
  ["vision", /\bvision\b/i],
  ["imac", /\bimac\b/i],
  ["macmini", /\bmac\s*mini\b|\bmacmini\b/i],
  ["macstudio", /\bmac\s*studio\b|\bmacstudio\b/i],
  ["macpro", /\bmac\s*pro\b|\bmacpro\b/i],
  ["laptop", /\bmacbook\b|\bmac\b|\blaptop\b/i],
];

const SYMBOLS: Record<DeviceKind, string> = {
  iphone: "iphone",
  ipad: "ipad.landscape",
  vision: "visionpro",
  imac: "desktopcomputer",
  macmini: "macmini",
  macstudio: "macstudio",
  macpro: "macpro.gen3",
  laptop: "laptopcomputer",
};

function kindIn(text: string | null | undefined): DeviceKind | null {
  if (!text) return null;
  for (const [kind, words] of KIND_WORDS) if (words.test(text)) return kind;
  return null;
}

export function deviceKindOf(name: string, kind?: string | null): DeviceKind {
  return kindIn(kind) ?? kindIn(name) ?? "laptop";
}

export function deviceSymbol(kind: DeviceKind): string {
  return SYMBOLS[kind];
}

export function recordKind(value: unknown): { kind: string } | Record<string, never> {
  const raw = value && typeof value === "object" ? ((value as { k?: unknown }).k ?? (value as { kind?: unknown }).kind) : undefined;
  return typeof raw === "string" && raw.length > 0 && raw.length <= 32 ? { kind: raw } : {};
}

export function hostOf(url: string): string {
  if (/^file:/i.test(url)) return "File";
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]+)/i.exec(url);
  if (!match) return url;
  return match[1]!.toLowerCase().replace(/^www\./, "");
}

export function sidebarDevices(remote: readonly RemoteDeviceTabs[] | undefined, seen: readonly SeenDevice[]): SidebarDevice[] {
  if (!remote?.length) return [];
  const lastSeen = new Map(seen.map((d) => [d.id, d.lastSeen]));
  const devices: SidebarDevice[] = [];
  for (const d of remote) {
    const urls = new Set<string>();
    const tabs: SidebarDeviceTab[] = [];
    for (const t of d.tabs) {
      if (!t.url || urls.has(t.url)) continue;
      urls.add(t.url);
      const host = hostOf(t.url);
      tabs.push({ url: t.url, title: t.title.trim() || host || t.url, host });
    }
    if (!tabs.length) continue;
    const kind = deviceKindOf(d.name, d.kind);
    devices.push({ id: d.deviceId, name: d.name.trim() || "Unknown Device", kind, symbol: SYMBOLS[kind], lastSeen: lastSeen.get(d.deviceId) ?? null, tabs });
  }
  return devices.sort(byRecency);
}

function byRecency(a: SidebarDevice, b: SidebarDevice): number {
  if (a.lastSeen !== b.lastSeen) {
    if (a.lastSeen === null) return 1;
    if (b.lastSeen === null) return -1;
    return b.lastSeen - a.lastSeen;
  }
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function deviceSymbols(devices: readonly SidebarDevice[], max = 4): { symbols: string[]; more: number } {
  const shown = devices.slice(0, max).map((d) => d.symbol);
  return { symbols: shown, more: Math.max(0, devices.length - max) };
}

export function shortAgo(at: number | null, now = Date.now()): string | null {
  if (at === null) return null;
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function deviceDetail(device: SidebarDevice, now = Date.now()): string {
  const count = `${device.tabs.length} ${device.tabs.length === 1 ? "tab" : "tabs"}`;
  const ago = shortAgo(device.lastSeen, now);
  return ago ? `${count} · ${ago}` : count;
}

export type DevicesView = { open: boolean; devices: Record<string, boolean> };

export const CLOSED_VIEW: DevicesView = { open: false, devices: {} };

export function deviceOpen(view: DevicesView, deviceId: string, deviceCount: number): boolean {
  return view.devices[deviceId] ?? deviceCount === 1;
}

export type DevicesLayout = { rowHeight: number; rowGap: number; padTop: number; padBottom: number };

export function devicesBodyRows(devices: readonly SidebarDevice[], view: DevicesView): number {
  if (!view.open) return 0;
  let rows = devices.length;
  for (const d of devices) if (deviceOpen(view, d.id, devices.length)) rows += d.tabs.length;
  return rows;
}

export function devicesSectionHeight(rows: number, sidebarHeight: number, m: DevicesLayout, share = 0.45): { height: number; body: number; scrolls: boolean } {
  const header = m.padTop + m.rowHeight + m.padBottom;
  if (!rows) return { height: header, body: 0, scrolls: false };
  const full = rows * (m.rowHeight + m.rowGap);
  const room = Math.max(m.rowHeight + m.rowGap, Math.floor(sidebarHeight * share) - header);
  const body = sidebarHeight > 0 ? Math.min(full, room) : full;
  return { height: header + body, body, scrolls: body < full };
}

export function showsSyncedDevices(settings: { showSyncedDevices?: boolean }): boolean {
  return settings.showSyncedDevices !== false;
}
