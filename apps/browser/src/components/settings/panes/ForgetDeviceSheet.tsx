import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { forgetDevice } from "../../../sync/engine";
import { Button, Sheet } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

export function showForgetDevice(device: { id: string; name: string }) {
  showSettingsSheet(<ForgetDeviceSheet device={device} />);
}

function ForgetDeviceSheet({ device }: { device: { id: string; name: string } }) {
  const theme = useTheme();
  const remove = () => {
    forgetDevice(device.id);
    closeSettingsSheet();
  };
  return (
    <Sheet width={420} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Remove “{device.name}”?</Text>
      <Text style={{ fontSize: 12.5, lineHeight: 17, marginTop: 6, color: theme.textSecondary }}>
        It disappears from the device list and its open tabs leave the sidebar on all your devices. Use this for a device you no longer have, or an
        old copy of one. If that device is still syncing, it shows up again the next time it syncs.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 }}>
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Remove Device" kind="destructive" onPress={remove} />
      </View>
    </Sheet>
  );
}
