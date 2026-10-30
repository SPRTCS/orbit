import { requireOptionalNativeModule } from "expo-modules-core";
import { startAiChats } from "./chat";
import { startAiTidy } from "./tidy";
import { startAiSettings, subscribeAiSettings, useAiSettings } from "./settings";

type SelectionAskModule = { setSelectionAskName?: (name: string | null) => Promise<void> };

let started = false;

function syncSelectionAsk(on: boolean) {
  const module = requireOptionalNativeModule<SelectionAskModule>("ArdiaCEF");
  void module?.setSelectionAskName?.(on ? "Orbit" : null).catch(() => {});
}

export function startAi() {
  if (started) return;
  started = true;
  startAiSettings();
  startAiChats();
  startAiTidy();
  const on = () => useAiSettings.getState().loaded && useAiSettings.getState().enabled;
  let last = on();
  if (last) syncSelectionAsk(true);
  subscribeAiSettings(() => {
    const now = on();
    if (now === last) return;
    last = now;
    syncSelectionAsk(now);
  });
}
