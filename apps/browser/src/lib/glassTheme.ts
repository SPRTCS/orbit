import { useBrowser } from "../store/browser";
import type { Settings } from "../store/settings";
import type { ProfileColor, ProfileTheme, ThemeColor, ThemeLook } from "../store/types";
import { fromOklab, hexColor, oklab } from "./profileTheme";

export type SidebarStyle = "glass" | "classic";

export function sidebarStyleOf(settings: Pick<Settings, "sidebarStyle">): SidebarStyle {
  return settings.sidebarStyle === "classic" ? "classic" : "glass";
}

export function glassSidebarOn(): boolean {
  return sidebarStyleOf(useBrowser.getState().settings) === "glass";
}

export function useGlassSidebar(): boolean {
  return useBrowser((s) => sidebarStyleOf(s.settings) === "glass");
}

const SWATCH_HUES: Record<ProfileColor, string | null> = {
  plum: null,
  blue: "#4691C3",
  purple: "#7873AF",
  pink: "#D37B8B",
  red: "#C1575C",
  orange: "#D87249",
  yellow: "#E3AC38",
  green: "#3EB489",
  neutral: null,
};

type Stop = { hex: string; alpha: number; x: number; y: number };

const LIGHT_STOPS: Stop[] = [
  { hex: "#EED2B8", alpha: 1, x: 0.2, y: 0.15 },
  { hex: "#F2DECC", alpha: 1, x: 0.8, y: 0.85 },
  { hex: "#E2ECCC", alpha: 0.92, x: 0.5, y: 0.95 },
];

const DARK_STOPS: Stop[] = [
  { hex: "#3E2E24", alpha: 1, x: 0.2, y: 0.15 },
  { hex: "#35292A", alpha: 1, x: 0.8, y: 0.85 },
  { hex: "#2D2A21", alpha: 0.7, x: 0.5, y: 0.95 },
];

const LOOK = { intensity: 0.6, grain: 0, texture: "grain", translucency: 0.25 } as const;

const hueOf = (hex: string) => {
  const [, a, b] = oklab(hexColor(hex));
  return Math.atan2(b, a);
};

const PEACH_HUE = hueOf(LIGHT_STOPS[0]!.hex);

function shifted(stop: Stop, turn: number, chroma: number): { x: number; y: number; color: ThemeColor } {
  const [L, a, b] = oklab(hexColor(stop.hex));
  const c = Math.hypot(a, b) * chroma;
  const h = Math.atan2(b, a) + turn;
  const [r, g, bl] = fromOklab([L, c * Math.cos(h), c * Math.sin(h)]);
  return { x: stop.x, y: stop.y, color: { r, g, b: bl, a: stop.alpha } };
}

function look(stops: Stop[], turn: number, chroma: number): ThemeLook {
  return { ...LOOK, stops: stops.map((s) => shifted(s, turn, chroma)) };
}

const spaceThemes = new Map<ProfileColor, ProfileTheme>();

export function glassSpaceTheme(color: ProfileColor): ProfileTheme {
  let theme = spaceThemes.get(color);
  if (!theme) {
    const swatch = SWATCH_HUES[color];
    const turn = swatch ? hueOf(swatch) - PEACH_HUE : 0;
    const chroma = color === "neutral" ? 0.2 : 1;
    theme = { ...look(LIGHT_STOPS, turn, chroma), mode: "auto", dark: look(DARK_STOPS, turn, chroma) };
    spaceThemes.set(color, theme);
  }
  return theme;
}

type SelectionTokens = {
  dark: boolean;
  profileColor: string;
  powerUpColor: string | null;
  powerUpPalette: string[] | null;
  tabHover: string;
  tabPressed: string;
  tabSelected: string;
  tabSelectedBorder: [string, string];
  tabSelectedShadow: string;
  tabSelectedShadowRadius: number;
  urlPill: string;
};

const LIGHT_TOKENS = {
  tabHover: "rgba(255,255,255,0.32)",
  tabPressed: "rgba(255,255,255,0.5)",
  tabSelected: "rgba(255,255,255,0.24)",
  tabSelectedBorder: ["rgba(255,255,255,0.95)", "rgba(0,0,0,0.1)"] as [string, string],
  tabSelectedShadow: "rgba(0,0,0,0.09)",
  tabSelectedShadowRadius: 6,
  urlPill: "rgba(0,0,0,0.055)",
};

const DARK_TOKENS: typeof LIGHT_TOKENS = {
  tabHover: "rgba(255,255,255,0.07)",
  tabPressed: "rgba(255,255,255,0.16)",
  tabSelected: "rgba(255,255,255,0.13)",
  tabSelectedBorder: ["rgba(255,255,255,0.2)", "rgba(0,0,0,0.3)"],
  tabSelectedShadow: "rgba(0,0,0,0.3)",
  tabSelectedShadowRadius: 6,
  urlPill: "rgba(0,0,0,0.2)",
};

const glassed = new WeakMap<object, object>();

export function withGlassTokens<T extends SelectionTokens>(theme: T, preset: T | null): T {
  let out = glassed.get(theme) as T | undefined;
  if (!out) {
    const identity = preset ? { profileColor: preset.profileColor, powerUpColor: preset.powerUpColor, powerUpPalette: preset.powerUpPalette } : null;
    out = { ...theme, ...identity, ...(theme.dark ? DARK_TOKENS : LIGHT_TOKENS) };
    glassed.set(theme, out);
  }
  return out;
}

export const GLASS = {
  button: 32,
  buttonHit: 40,
  buttonGap: 4,
  lightsY: 27,
  toggleX: 99,
  edge: 6.5,
  fieldRadius: 17,
  footer: 42,
  footerCenter: 21,
  footerInsetLeft: 6,
  footerInsetRight: 7,
  dotsWidth: 38,
  dotsHeight: 19,
  dot: 5,
  dotPitch: 12.8,
  cardRadius: 14,
  rowPadLeft: 11,
  labelGap: 11,
  menuRadius: 18,
  menuRow: 31,
  menuIcon: 20,
  menuGapAbove: 8,
} as const;

export type GlassChrome = {
  button: string;
  buttonPressed: string;
  buttonEdge: [string, string];
  buttonHighlight: [string, string];
  buttonShadow: string;
  ink: string;
  inkDisabled: string;
  menu: string;
  menuEdge: string;
  menuShadow: string;
  menuHover: string;
  menuSeparator: string;
  menuText: string;
  dotOn: string;
  dotOff: string;
  cardEdge: string;
  cardShadow: string;
  folder: string;
};

const LIGHT_CHROME: GlassChrome = {
  button: "rgba(255,255,255,0.45)",
  buttonPressed: "rgba(255,255,255,0.75)",
  buttonEdge: ["rgba(0,0,0,0.1)", "rgba(0,0,0,0.16)"],
  buttonHighlight: ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.25)"],
  buttonShadow: "rgba(0,0,0,0.08)",
  ink: "#000000BF",
  inkDisabled: "#00000040",
  menu: "rgba(250,248,246,0.94)",
  menuEdge: "rgba(0,0,0,0.1)",
  menuShadow: "rgba(0,0,0,0.18)",
  menuHover: "rgba(0,0,0,0.06)",
  menuSeparator: "rgba(0,0,0,0.08)",
  menuText: "#000000D9",
  dotOn: "#000000E6",
  dotOff: "#00000059",
  cardEdge: "rgba(0,0,0,0.08)",
  cardShadow: "rgba(0,0,0,0.1)",
  folder: "#3EA6F2",
};

const DARK_CHROME: GlassChrome = {
  button: "rgba(255,255,255,0.1)",
  buttonPressed: "rgba(255,255,255,0.2)",
  buttonEdge: ["rgba(255,255,255,0.16)", "rgba(0,0,0,0.35)"],
  buttonHighlight: ["rgba(255,255,255,0.22)", "rgba(255,255,255,0.03)"],
  buttonShadow: "rgba(0,0,0,0.3)",
  ink: "#FFFFFFD9",
  inkDisabled: "#FFFFFF47",
  menu: "rgba(44,40,38,0.94)",
  menuEdge: "rgba(255,255,255,0.12)",
  menuShadow: "rgba(0,0,0,0.45)",
  menuHover: "rgba(255,255,255,0.08)",
  menuSeparator: "rgba(255,255,255,0.1)",
  menuText: "#FFFFFFE6",
  dotOn: "#FFFFFFE6",
  dotOff: "#FFFFFF59",
  cardEdge: "rgba(255,255,255,0.08)",
  cardShadow: "rgba(0,0,0,0.35)",
  folder: "#4BAEF5",
};

export function glassChrome(dark: boolean): GlassChrome {
  return dark ? DARK_CHROME : LIGHT_CHROME;
}
