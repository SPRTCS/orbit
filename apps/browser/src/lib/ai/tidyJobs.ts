import { aiEnabled, subscribeAiSettings } from "./settings";

export type TidyJob = { signal: AbortSignal; live(): boolean };

let controller: AbortController | null = null;
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  subscribeAiSettings(() => {
    if (aiEnabled()) return;
    controller?.abort();
    controller = null;
  });
}

export function tidyJob(): TidyJob | null {
  if (!aiEnabled()) return null;
  watch();
  controller ??= new AbortController();
  const signal = controller.signal;
  return { signal, live: () => aiEnabled() && !signal.aborted };
}
