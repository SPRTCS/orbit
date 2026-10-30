import { ContextMenuArea, Surface, Symbol } from "@ardia/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { glassChrome, GLASS } from "../../lib/glassTheme";
import { hex, useTheme } from "../../lib/theme";
import { modifiersOf, type ClickModifiers } from "../layout/controls";
import { useHover } from "../primitives";

export const BLOOM = 1.18;
const PRESS_SPRING = { stiffness: 520, damping: 30, mass: 1 };

export function useBloom(pressed: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: pressed ? BLOOM : 1, ...PRESS_SPRING, useNativeDriver: true }).start();
  }, [pressed]);
  return scale;
}

export function GlassSurface({ width, height, pressed = false, hovered = false, style }: { width: number; height: number; pressed?: boolean; hovered?: boolean; style?: ViewStyle }) {
  const chrome = glassChrome(useTheme().dark);
  const radius = Math.min(width, height) / 2;
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <Surface
        fill={hex(pressed || hovered ? chrome.buttonPressed : chrome.button)}
        cornerRadius={radius}
        borderWidth={0.5}
        borderColors={chrome.buttonEdge.map(hex)}
        shadowColor={hex(chrome.buttonShadow)}
        shadowOpacity={1}
        shadowRadius={3}
        shadowOffset={[0, 1]}
        style={{ position: "absolute", left: 0, top: 0, width, height }}
      />
      <Surface
        fill="#00000000"
        cornerRadius={radius - 0.5}
        borderWidth={0.5}
        borderColors={chrome.buttonHighlight.map(hex)}
        style={{ position: "absolute", left: 0.5, top: 0.5, width: width - 1, height: height - 1 }}
      />
    </View>
  );
}

type Press = (modifiers: ClickModifiers) => void;

export function GlassIconButton({
  icon,
  glyph = 15,
  weight = "medium",
  onPress,
  onLongPress,
  onContextMenu,
  disabled,
  tooltip,
  hit,
  style,
  children,
}: {
  icon?: string;
  glyph?: number;
  weight?: "regular" | "medium" | "semibold";
  onPress?: Press;
  onLongPress?: () => void;
  onContextMenu?: () => void;
  disabled?: boolean;
  tooltip?: string;
  hit: { width: number; height: number };
  style?: ViewStyle;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const chrome = glassChrome(theme.dark);
  const { hovered, hoverProps } = useHover();
  const size = GLASS.button;
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tooltip}
      disabled={disabled}
      delayLongPress={450}
      onLongPress={onLongPress}
      onPress={(e: GestureResponderEvent) => onPress?.(modifiersOf(e))}
      style={{ width: hit.width, height: hit.height, alignItems: "center", justifyContent: "center" }}
    >
      {({ pressed }) => <Bloomed pressed={pressed && !disabled} hovered={hovered && !disabled} size={size} icon={icon} glyph={glyph} weight={weight} color={disabled ? chrome.inkDisabled : chrome.ink}>{children}</Bloomed>}
    </Pressable>
  );
  return (
    <View {...hoverProps} tooltip={tooltip} mouseDownCanMoveWindow={false} style={style}>
      {onContextMenu && !disabled ? <ContextMenuArea onContextMenu={onContextMenu}>{button}</ContextMenuArea> : button}
    </View>
  );
}

function Bloomed({ pressed, hovered, size, icon, glyph, weight, color, children }: { pressed: boolean; hovered: boolean; size: number; icon?: string; glyph: number; weight: "regular" | "medium" | "semibold"; color: string; children?: ReactNode }) {
  const scale = useBloom(pressed);
  return (
    <Animated.View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ scale }] }}>
      <GlassSurface width={size} height={size} pressed={pressed} hovered={hovered} style={{ position: "absolute", left: 0, top: 0 }} />
      {children ?? (icon ? <Symbol name={icon} size={glyph} weight={weight} color={color} style={{ width: size, height: size }} /> : null)}
    </Animated.View>
  );
}
