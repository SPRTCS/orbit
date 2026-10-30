import { MouseArea, revealFile, Surface, VisualEffect } from "@ardia/shell";
import { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { openUrls } from "../../lib/actions";
import { copyCapture, dismissCapture, saveCapture, THUMBNAIL_MAX_ASPECT, THUMBNAIL_WIDTH, useCapture, type CapturePreview as Preview } from "../../lib/capture/capture";
import { sizeLabel } from "../../lib/capture/model";
import { hex, useTheme } from "../../lib/theme";
import { IconButton, useHover } from "../primitives";

const SHOWN_FOR = 8000;
const INSET = 16;
const PADDING = 8;

export const CapturePreview = memo(function CapturePreview({ windowId }: { windowId: string }) {
  const preview = useCapture((s) => s.previews[windowId] ?? null);
  const [shown, setShown] = useState<Preview | null>(preview);
  const appear = useRef(new Animated.Value(0)).current;
  const { hovered, hoverProps } = useHover();

  useEffect(() => {
    if (preview) {
      if (preview.id !== shown?.id) {
        appear.setValue(0);
        Animated.spring(appear, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 5 }).start();
      }
      setShown(preview);
      return;
    }
    if (!shown) return;
    Animated.timing(appear, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [preview]);

  useEffect(() => {
    if (!preview || hovered) return;
    const timer = setTimeout(() => dismissCapture(windowId, preview.id), SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [preview?.id, preview?.copied, preview?.saved, hovered]);

  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: INSET, bottom: INSET }}>
      <Animated.View
        style={{
          opacity: appear,
          transform: [
            { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        }}
      >
        <View {...hoverProps}>
          <Card preview={shown} />
        </View>
      </Animated.View>
    </View>
  );
});

function Card({ preview }: { preview: Preview }) {
  const theme = useTheme();
  const { windowId } = preview;
  const aspect = Math.min(preview.height / preview.width, THUMBNAIL_MAX_ASPECT);
  const status = preview.saved ? "Saved to Downloads" : preview.copied ? "Copied to clipboard" : "Captured";
  const detail = `${sizeLabel(preview.width, preview.height)}${preview.cropped ? " · cut to fit" : ""}`;
  return (
    <Surface
      fill={hex(theme.dark ? "rgba(44,42,43,0.9)" : "rgba(255,255,255,0.92)")}
      cornerRadius={14}
      borderColor={hex(theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)")}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.dark ? 0.4 : 0.16}
      shadowRadius={18}
      shadowOffset={[0, 8]}
      style={{ width: THUMBNAIL_WIDTH + PADDING * 2, padding: PADDING, gap: 6 }}
    >
      <VisualEffect material="hudWindow" cornerRadius={14} style={StyleSheet.absoluteFill} />
      <MouseArea path={preview.path}>
        <Pressable
          onPress={() => {
            dismissCapture(windowId, preview.id);
            openUrls([`file://${encodeURI(preview.path)}`], windowId);
          }}
        >
          <View
            tooltip="Open in a new tab, or drag it out"
            style={{
              width: THUMBNAIL_WIDTH,
              height: Math.round(THUMBNAIL_WIDTH * aspect),
              borderRadius: 8,
              overflow: "hidden",
              borderWidth: 0.5,
              borderColor: theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
              backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            }}
          >
            {preview.thumbnail ? <Image source={{ uri: preview.thumbnail }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : null}
          </View>
        </Pressable>
      </MouseArea>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, paddingLeft: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>
            {status}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textSecondary, marginTop: 1, fontVariant: ["tabular-nums"] }}>
            {detail}
          </Text>
        </View>
        <IconButton icon={preview.copied ? "checkmark" : "doc.on.doc"} box={26} size={13} tooltip="Copy" onPress={() => void copyCapture(windowId)} />
        <IconButton
          icon={preview.saved ? "magnifyingglass" : "square.and.arrow.down"}
          box={26}
          size={13}
          tooltip={preview.saved ? "Show in Finder" : "Save to Downloads"}
          onPress={() => (preview.saved ? void revealFile(preview.saved) : void saveCapture(windowId))}
        />
        <IconButton icon="xmark" box={26} size={12} tooltip="Close" onPress={() => dismissCapture(windowId, preview.id)} />
      </View>
    </Surface>
  );
}
