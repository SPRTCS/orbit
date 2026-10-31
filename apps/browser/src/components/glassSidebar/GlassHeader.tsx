import { MouseArea, Symbol } from "@ardia/shell";
import { useHover } from "../primitives";
import { Pressable, View } from "react-native";
import { glassChrome, GLASS } from "../../lib/glassTheme";
import { withLivePage } from "../../lib/livePage";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { useActiveTabId, useTabLive, useWindowId } from "../../store/hooks";
import { openModeFor, openUrl } from "../bookmarks/actions";
import { modifiersOf, type ClickModifiers } from "../layout/controls";
import { closeHistoryMenu, goBack, goForward, historyItems, openHistoryMenu, useHistoryAvailability, useHistoryMenu } from "../layout/history";
import { useToolbarTab } from "../Toolbar";
import { GlassIconButton, GlassSurface } from "./GlassSurface";

const HALF = GLASS.button / 2;
const HIT = GLASS.buttonHit;
const TOP = GLASS.lightsY - HIT / 2;

export function navLayout(width: number, toggle: boolean, forward: boolean) {
  const sidebarToggle = width - GLASS.edge - HALF;
  const reload = toggle ? sidebarToggle - GLASS.button - GLASS.buttonGap : sidebarToggle;
  const navRight = reload - HALF - GLASS.buttonGap;
  const floor = GLASS.toggleX - HALF;
  const fits = (segments: number) => navRight - segments * GLASS.button >= floor;
  const segments = forward && fits(2) ? 2 : fits(1) ? 1 : 0;
  return { sidebarToggle, reload, navLeft: navRight - segments * GLASS.button, segments };
}

export function GlassHeaderTools({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const toggle = useBrowser((s) => s.settings.showSidebarButton !== false);
  return (
    <>
      {toggle ? (
        <GlassIconButton
          icon="sidebar.left"
          glyph={15}
          hit={{ width: HIT, height: HIT }}
          style={{ position: "absolute", top: TOP, left: navLayout(width, true, false).sidebarToggle - HIT / 2 }}
          tooltip="Auto-Hide Tabs (⌘S)"
          onPress={() => useBrowser.getState().toggleSidebar(windowId)}
        />
      ) : null}
      {tab ? <Navigation tab={tab} width={width} toggle={toggle} /> : null}
    </>
  );
}

type NavTab = NonNullable<ReturnType<typeof useToolbarTab>>;

function Navigation({ tab, width, toggle }: { tab: NavTab; width: number; toggle: boolean }) {
  const history = useHistoryAvailability(tab.id);
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const { reload, navLeft, segments } = navLayout(width, toggle, history.forward);
  const web = () => webviews.get(tab.id);
  return (
    <>
      {segments ? <HistoryCapsule tab={tab} left={navLeft} segments={segments} back={history.back} forward={history.forward} /> : null}
      <GlassIconButton
        icon={loading ? "xmark" : "arrow.clockwise"}
        glyph={15}
        disabled={!tab.url}
        hit={{ width: GLASS.button + GLASS.buttonGap, height: HIT }}
        style={{ position: "absolute", top: TOP, left: reload - HALF - GLASS.buttonGap / 2 }}
        tooltip={loading ? "Stop Loading This Page" : "Refresh (⌘R)"}
        onPress={(m) => {
          if (loading) return void web()?.stopLoading();
          if (m.metaKey) return void useBrowser.getState().newTab(tab.windowId, { url: tab.url, background: true, openerId: tab.id });
          void withLivePage(tab.id, (page) => (m.shiftKey ? page.forceReload() : page.reload()));
        }}
      />
    </>
  );
}

function HistoryCapsule({ tab, left, segments, back, forward }: { tab: NavTab; left: number; segments: number; back: boolean; forward: boolean }) {
  const width = segments * GLASS.button;
  if (segments === 1)
    return (
      <HistoryButtonGlass tab={tab} direction={-1} disabled={!back} style={{ position: "absolute", top: TOP, left: left - GLASS.buttonGap / 2 }} hitWidth={GLASS.button + GLASS.buttonGap} />
    );
  return (
    <View style={{ position: "absolute", top: TOP, left, width, height: HIT }}>
      <GlassSurface width={width} height={GLASS.button} style={{ position: "absolute", left: 0, top: (HIT - GLASS.button) / 2 }} />
      <View style={{ flexDirection: "row" }}>
        <HistorySegment tab={tab} direction={-1} disabled={!back} />
        <HistorySegment tab={tab} direction={1} disabled={!forward} />
      </View>
    </View>
  );
}

function useHistoryPress(tab: NavTab, direction: -1 | 1) {
  const openMenu = () => {
    const open = useHistoryMenu.getState().menu;
    if (open?.tabId === tab.id && open.direction === direction) return closeHistoryMenu();
    void openHistoryMenu(tab.id, direction);
  };
  const press = async (m: ClickModifiers & { middle?: boolean }) => {
    closeHistoryMenu();
    const mode = openModeFor(m);
    if (mode === "current" || mode === "split") return direction < 0 ? goBack(tab.id) : goForward(tab.id);
    const [target] = await historyItems(tab.id, direction, 1);
    if (target?.url) openUrl(target.url, tab.windowId, mode);
  };
  return { openMenu, press };
}

const historyTooltip = (direction: -1 | 1) => (direction < 0 ? "Go Back (⌘[)" : "Go Forward (⌘])");

function HistoryButtonGlass({ tab, direction, disabled, style, hitWidth }: { tab: NavTab; direction: -1 | 1; disabled: boolean; style: object; hitWidth: number }) {
  const { openMenu, press } = useHistoryPress(tab, direction);
  return (
    <MouseArea style={style} onMiddleClick={(e) => !disabled && void press({ ...e, middle: true })}>
      <GlassIconButton
        icon={direction < 0 ? "chevron.left" : "chevron.right"}
        glyph={15}
        disabled={disabled}
        hit={{ width: hitWidth, height: HIT }}
        tooltip={historyTooltip(direction)}
        onPress={(m) => void press(m)}
        onLongPress={openMenu}
        onContextMenu={openMenu}
      />
    </MouseArea>
  );
}

function HistorySegment({ tab, direction, disabled }: { tab: NavTab; direction: -1 | 1; disabled: boolean }) {
  const chrome = glassChrome(useTheme().dark);
  const { openMenu, press } = useHistoryPress(tab, direction);
  const { hovered, hoverProps } = useHover();
  return (
    <MouseArea onMiddleClick={(e) => !disabled && void press({ ...e, middle: true })}>
      <View {...hoverProps} tooltip={historyTooltip(direction)} mouseDownCanMoveWindow={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={historyTooltip(direction)}
          disabled={disabled}
          delayLongPress={450}
          onLongPress={openMenu}
          onPress={(e) => void press(modifiersOf(e))}
          style={{ width: GLASS.button, height: HIT, alignItems: "center", justifyContent: "center" }}
        >
          {({ pressed }) => (
            <View
              style={{
                width: GLASS.button - 4,
                height: GLASS.button - 4,
                borderRadius: (GLASS.button - 4) / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: disabled ? undefined : pressed ? chrome.buttonPressed : hovered ? chrome.button : undefined,
              }}
            >
              <Symbol name={direction < 0 ? "chevron.left" : "chevron.right"} size={15} weight="medium" color={disabled ? chrome.inkDisabled : chrome.ink} style={{ width: 20, height: 20 }} />
            </View>
          )}
        </Pressable>
      </View>
    </MouseArea>
  );
}
