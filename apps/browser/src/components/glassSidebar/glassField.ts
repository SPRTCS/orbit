import { GLASS, useGlassSidebar } from "../../lib/glassTheme";
import { useTheme } from "../../lib/theme";

export type GlassField = { radius: number; fill: string; hover: string };

export function useGlassField(inSidebar: boolean): GlassField | null {
  const glass = useGlassSidebar();
  const theme = useTheme();
  if (!glass || !inSidebar) return null;
  return { radius: GLASS.fieldRadius, fill: theme.urlPill, hover: theme.dark ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.085)" };
}
