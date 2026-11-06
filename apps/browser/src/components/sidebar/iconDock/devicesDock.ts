export const DEVICES_DOCK = { row: 40, gap: 4, groupPad: 4, pad: 6, root: 44, share: 0.5 };

type DockDeviceInput = { id: string; tabs: readonly { url: string }[] };

export type DevicesDockRow =
  | { kind: "device"; key: string; deviceId: string; y: number }
  | { kind: "tab"; key: string; deviceId: string; index: number; y: number };

export type DevicesDockGroup = { deviceId: string; top: number; height: number };

export type DevicesDockLayout = { rows: DevicesDockRow[]; groups: DevicesDockGroup[]; height: number };

export function devicesDockLayout(devices: readonly DockDeviceInput[], isOpen: (deviceId: string) => boolean): DevicesDockLayout {
  const m = DEVICES_DOCK;
  const rows: DevicesDockRow[] = [];
  const groups: DevicesDockGroup[] = [];
  let y = m.pad;
  [...devices].reverse().forEach((device, i) => {
    if (i) y += m.gap;
    const open = isOpen(device.id) && device.tabs.length > 0;
    const top = y;
    if (open) {
      y += m.groupPad;
      for (let t = device.tabs.length - 1; t >= 0; t--) {
        rows.push({ kind: "tab", key: `${device.id}|${t}|${device.tabs[t]!.url}`, deviceId: device.id, index: t, y });
        y += m.row;
      }
    }
    rows.push({ kind: "device", key: `device|${device.id}`, deviceId: device.id, y });
    y += m.row;
    if (open) {
      y += m.groupPad;
      groups.push({ deviceId: device.id, top, height: y - top });
    }
  });
  return { rows, groups, height: devices.length ? y + m.pad : 0 };
}

export function devicesDockHeight(content: number, available: number): number {
  return Math.max(0, Math.min(content, Math.floor(available * DEVICES_DOCK.share)));
}
