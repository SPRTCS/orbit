import { useEffect, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { ArchiveWindow } from "../archive/ArchiveWindow";
import { BoostsWindow } from "../boosts/BoostsWindow";
import { ImportWindow } from "../import/ImportWindow";
import { SessionsWindow } from "../spaces/SessionsWindow";
import { SpaceImportWindow } from "../spaces/SpaceImportWindow";
import { SettingsWindow } from "./SettingsWindow";
import { ARCHIVE_WINDOW_ID, BOOSTS_WINDOW_ID, SESSIONS_WINDOW_ID, SETTINGS_WINDOW_ID, SPACE_IMPORT_WINDOW_ID } from "./windows";

const EMPTY_CHECK_MS = 2000;

function useReportEmptyContent(id: string) {
  const size = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const laidOut = size.current;
      if (laidOut && laidOut.width > 0 && laidOut.height > 0) return;
      const shown = laidOut ? `${Math.round(laidOut.width)}x${Math.round(laidOut.height)}` : "never laid out";
      console.warn(`[window] ${id} content is empty ${EMPTY_CHECK_MS} ms after opening: ${shown}`);
    }, EMPTY_CHECK_MS);
    return () => clearTimeout(timer);
  }, [id]);
  return (e: LayoutChangeEvent) => {
    size.current = e.nativeEvent.layout;
  };
}

export function UtilityWindow({ id }: { id: string }) {
  const onLayout = useReportEmptyContent(id);
  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {id === SETTINGS_WINDOW_ID ? <SettingsWindow /> : id === ARCHIVE_WINDOW_ID ? <ArchiveWindow /> : id === BOOSTS_WINDOW_ID ? <BoostsWindow /> : id === SESSIONS_WINDOW_ID ? <SessionsWindow /> : id === SPACE_IMPORT_WINDOW_ID ? <SpaceImportWindow /> : <ImportWindow />}
    </View>
  );
}
