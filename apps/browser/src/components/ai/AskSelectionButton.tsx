import { Symbol } from "@ardia/shell";
import { Pressable, Text, View } from "react-native";
import { askAboutSelection } from "../../lib/ai/chat";
import { useAiEnabled } from "../../lib/ai/settings";
import { useTheme } from "../../lib/theme";
import { setPageSelection } from "../site/selection";
import { useHover } from "../primitives";

const HEIGHT = 26;

export function AskSelectionButton({ tabId, text }: { tabId: string; text: string }) {
  const enabled = useAiEnabled();
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (!enabled) return null;
  return (
    <View {...hoverProps} tooltip="Ask Orbit about the selection">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask Orbit"
        onPress={() => {
          setPageSelection(tabId, null);
          askAboutSelection(tabId, text);
        }}
      >
        {({ pressed }) => (
          <View
            style={{
              height: HEIGHT,
              paddingLeft: 7,
              paddingRight: 9,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: pressed || hovered ? (theme.dark ? `rgba(255,255,255,${pressed ? 0.12 : 0.07})` : `rgba(0,0,0,${pressed ? 0.1 : 0.06})`) : undefined,
            }}
          >
            <Symbol name="sparkles" size={12} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />
            <Text style={{ fontSize: 13, fontWeight: "500", color: theme.textPrimary }}>Ask</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
