import { writeFileSync } from "node:fs";

const root = new URL("../../../../../../", import.meta.url);
const src = (path) => new URL(`apps/browser/src/${path}`, root).href;
globalThis.__DEV__ = false;
const { glassSpaceTheme } = await import(src("lib/glassTheme.ts"));
const { sanitizeTheme } = await import(src("lib/profileTheme.ts"));

const colors = ["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral", "unknown"];
const stop = (r, g, b, a, x, y) => ({ color: { r, g, b, a }, x, y });
const inputs = [
  { stops: [stop(0.9, 0.5, 0.2, 1, 0.1, 0.2), stop(0.1, 0.2, 0.9, 0.5, 0.8, 0.9)], intensity: 0.7, grain: 0.3, texture: "denim", translucency: 0.4, mode: "dark", dark: { stops: [stop(0.1, 0.1, 0.1, 1, 0.5, 0.5)], intensity: 0.2, grain: 0, texture: "tweed", translucency: 1 } },
  { stops: [7, null, "x", { x: 0.3 }, { color: [1, 2, 3] }, stop(5, 0, 0, 1, 0, 0), stop(-3.9, 0.5, 3.99, -2, -1, 2), { color: { r: 0.5, g: 0.5, b: 0.5 } }, stop(0.2, 0.2, 0.2, 0.3, 0.4, 0.4), stop(0.3, 0.3, 0.3, 1, 0.1, 0.1), stop(0.4, 0.4, 0.4, 1, 0.2, 0.2)] },
  { stops: "nope" },
  { stops: [] },
  { stops: [stop(0.5, 0.5, 0.5, 1, 0.5, 0.5)], intensity: "high", grain: -1, texture: "plaid", translucency: 2, mode: "weird", dark: { stops: [] } },
  { stops: [stop(0.5, 0.5, 0.5, 1, 0.5, 0.5)], intensity: true, mode: "light", dark: 4 },
  [stop(0.5, 0.5, 0.5, 1, 0.5, 0.5)],
  null,
  3,
  { stops: [{ color: { r: "1", g: 0, b: 0 } }] },
  { stops: Array.from({ length: 20 }, () => ({ color: null })).concat([stop(0.5, 0.5, 0.5, 1, 0.5, 0.5)]) },
];
writeFileSync(process.argv[2], JSON.stringify({
  glass: Object.fromEntries(colors.map((c) => [c, glassSpaceTheme(c)])),
  sanitized: inputs.map((input) => ({ input, output: sanitizeTheme(input) })),
}));
