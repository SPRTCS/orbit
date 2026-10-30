import { Surface } from "@ardia/shell";
import { StyleSheet } from "react-native";
import { glassChrome, GLASS, useGlassSidebar } from "../../lib/glassTheme";
import { hex, layout, useTheme } from "../../lib/theme";

export function useCardRadius(): number {
  return useGlassSidebar() ? GLASS.cardRadius : layout.cardRadius;
}

export function GlassCardEdge({ shown }: { shown: boolean }) {
  const glass = useGlassSidebar();
  const chrome = glassChrome(useTheme().dark);
  if (!glass || !shown) return null;
  return <Surface pointerEvents="none" fill="#00000000" cornerRadius={GLASS.cardRadius} borderWidth={0.5} borderColor={hex(chrome.cardEdge)} style={StyleSheet.absoluteFill} />;
}
