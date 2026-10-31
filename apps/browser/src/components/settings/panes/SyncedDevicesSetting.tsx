import { useBrowser } from "../../../store/browser";
import { showsSyncedDevices } from "../../../lib/syncedDevices";
import { Row, Toggle } from "../controls";

export function SidebarDevicesRow() {
  const on = useBrowser((s) => showsSyncedDevices(s.settings));
  return (
    <Row title="Show devices in sidebar" description="Your other devices and their open tabs, above the sidebar footer.">
      <Toggle value={on} onChange={(value) => useBrowser.getState().updateSettings({ showSyncedDevices: value })} />
    </Row>
  );
}
