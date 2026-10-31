import * as shell from "@ardia/shell";
import { readDocument, writeDocument } from "@ardia/shell";
import { omniboxDrivers } from "../components/omnibox/devDriver";
import { pagesDrivers } from "../components/pages/devDrivers";
import { usePages } from "../components/layout/pageState";
import { openSettings } from "../components/settings/windows";
import { useSidebarUi } from "../components/sidebar/state";
import { useBrowser } from "../store/browser";
import * as actions from "./actions";
import { runCommand } from "./commands";
import * as favicons from "./favicons";
import { probeStore } from "./perfProbe";
import { useLifecycle } from "./tabLifecycle";
import { webviews } from "./webviews";

export function startDevHarness() {
  probeStore("pages", usePages);
  probeStore("sidebarUi", useSidebarUi);
  probeStore("favicons", favicons.useFavicons);
  probeStore("lifecycle", useLifecycle);
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        const line = `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ")}\n`;
        writeDocument("dev-console.log", (readDocument("dev-console.log") ?? "").slice(-200_000) + line);
      } catch {}
    };
  }

  const ac = {
    store: useBrowser, actions, runCommand, webviews, shell, omnibox: omniboxDrivers, pages: pagesDrivers,
    pageState: usePages,
    openSettings,
    favicons,
    get boosts(): typeof import("./boosts/runtime") & typeof import("./boosts/actions") & typeof import("./boosts/zap") & typeof import("../store/boosts") {
      return { ...require("./boosts/runtime"), ...require("./boosts/actions"), ...require("./boosts/zap"), ...require("../store/boosts") };
    },
    get archive(): typeof import("./archive") & typeof import("../store/archive") {
      return { ...require("./archive"), ...require("../store/archive") };
    },
    get spaces(): typeof import("./spaces") & typeof import("./spaceSessions") & typeof import("./spaceSubscriptions") & typeof import("../components/spaces/spaceFiles") & typeof import("../store/spaceSnapshot") {
      return { ...require("./spaces"), ...require("./spaceSessions"), ...require("./spaceSubscriptions"), ...require("../components/spaces/spaceFiles"), ...require("../store/spaceSnapshot") };
    },
    get pinnedFolders(): typeof import("./pinnedFolders") & typeof import("../store/pinnedFolders") & typeof import("../components/sidebar/pinnedFolderMenus") {
      return { ...require("./pinnedFolders"), ...require("../store/pinnedFolders"), ...require("../components/sidebar/pinnedFolderMenus") };
    },
    get capture(): typeof import("./capture/capture") & typeof import("./capture/model") {
      return { ...require("./capture/capture"), ...require("./capture/model") };
    },
    get airTraffic(): typeof import("./airTraffic/store") & typeof import("./airTraffic/rules") & typeof import("./airTraffic/flights") & typeof import("./airTraffic/actions") & typeof import("../components/littleArdia/actions") & typeof import("../components/settings/panes/AirTraffic") {
      return { ...require("./airTraffic/store"), ...require("./airTraffic/rules"), ...require("./airTraffic/flights"), ...require("./airTraffic/actions"), ...require("../components/littleArdia/actions"), ...require("../components/settings/panes/AirTraffic") };
    },
    get ai(): typeof import("./ai/settings") & typeof import("./ai/client") & typeof import("./ai/chat") & typeof import("./ai/commands") & typeof import("./ai/run") & typeof import("./ai/tidy") {
      return { ...require("./ai/settings"), ...require("./ai/client"), ...require("./ai/chat"), ...require("./ai/commands"), ...require("./ai/run"), ...require("./ai/tidy") };
    },
    get checkIn(): typeof import("./defaultBrowserCheckIn") {
      return require("./defaultBrowserCheckIn");
    },
    get media(): typeof import("../components/media/state").useMedia {
      return require("../components/media/state").useMedia;
    },
    get permissions(): typeof import("../components/site/permissions") {
      return require("../components/site/permissions");
    },
    get translate(): typeof import("../components/site/translate") {
      return require("../components/site/translate");
    },
    get toasts(): typeof import("../components/layout/splitActions").useToasts {
      return require("../components/layout/splitActions").useToasts;
    },
    get extensions(): typeof import("../components/extensions/state") {
      return require("../components/extensions/state");
    },
    get themes(): typeof import("../components/import/apply") & typeof import("../components/settings/ThemeEditor") {
      return { ...require("../components/import/apply"), ...require("../components/settings/ThemeEditor") };
    },
    get switcher(): typeof import("../components/sidebar/switcher") {
      return require("../components/sidebar/switcher");
    },
    get sidebarRows(): typeof import("../components/sidebar/state") {
      return require("../components/sidebar/state");
    },
    get sidebarHover(): typeof import("../components/sidebar/hover") & typeof import("../components/sidebar/hoverMotion") {
      return { ...require("../components/sidebar/hover"), ...require("../components/sidebar/hoverMotion") };
    },
    get toolbarAutoHide(): typeof import("../components/layout/toolbarAutoHide") {
      return require("../components/layout/toolbarAutoHide");
    },
    get hoverShift(): typeof import("./hoverShift") {
      return require("./hoverShift");
    },
    get preload(): typeof import("./preload") {
      return require("./preload");
    },
    get live(): { store: typeof import("../live/store"); engine: typeof import("../live/engine") } {
      return { store: require("../live/store"), engine: require("../live/engine") };
    },
  };
  (globalThis as { ac?: typeof ac }).ac = ac;
  const scriptId = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = scriptId(readDocument("dev-eval.js")) ?? "";
  setInterval(function pollDevEval() {
    const source = readDocument("dev-eval.js");
    const id = scriptId(source);
    if (!source || !id || id === lastId) return;
    lastId = id;
    const done = (body: object) => writeDocument("dev-eval-result.json", JSON.stringify({ id, ...body }));
    try {
      const fn = new Function("ac", source) as (n: typeof ac) => unknown;
      Promise.resolve(fn(ac)).then(
        (result) => done({ result: result ?? null }),
        (error: unknown) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
  }, __DEV__ ? 50 : 250);
}
