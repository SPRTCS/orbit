import { ContextMenuArea, showMenu, Symbol } from "@ardia/shell";
import { memo, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useAiEnabled } from "../../lib/ai/settings";
import { canTidyWindow } from "../../lib/ai/tidyScope";
import { tidyTabs, useTidyTabs } from "../../lib/ai/tidyTabs";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useHover } from "../primitives";

const HEIGHT = 16;

async function openTidyMenu(windowId: string) {
  const choice = await showMenu([
    { id: "tidy", title: "Tidy Tabs", symbol: "wand.and.stars" },
    { id: "all", title: "Regroup All Tabs", symbol: "rectangle.stack" },
  ]);
  if (choice === "tidy") void tidyTabs(windowId);
  else if (choice === "all") void tidyTabs(windowId, { regroupAll: true });
}

function usePulse(on: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.35, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on]);
  return value;
}

export const TidyButton = memo(function TidyButton({ windowId }: { windowId: string }) {
  const enabled = useAiEnabled();
  const allowed = useBrowser((s) => canTidyWindow(s, windowId));
  const busy = useTidyTabs((s) => !!s.busy[windowId]);
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const pulse = usePulse(busy);
  if (!enabled || !allowed) return null;
  const tidy = () => void tidyTabs(windowId);
  return (
    <View {...hoverProps}>
      <ContextMenuArea onContextMenu={() => void openTidyMenu(windowId)}>
        <Pressable
          tooltip="Group these tabs with AI. Right-click to regroup all."
          accessibilityRole="button"
          accessibilityLabel="Tidy tabs"
          disabled={busy}
          onAccessibilityTap={tidy}
          onPress={tidy}
        >
          {({ pressed }) => {
            const color = hovered && !pressed && !busy ? theme.textPrimary : theme.textSecondary;
            return (
              <Animated.View style={{ height: HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8, opacity: pulse }}>
                <Symbol name="wand.and.stars" size={9} weight="bold" color={color} style={{ width: 11, height: 11, marginRight: 3 }} />
                <Text style={{ fontSize: 10, fontWeight: "600", color }}>{busy ? "Tidying…" : "Tidy"}</Text>
              </Animated.View>
            );
          }}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
});
