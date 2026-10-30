import type { PageRect, PageView } from "./pageScript";

export type CaptureMode = "region" | "visible" | "fullPage";

export type Clip = { x: number; y: number; width: number; height: number; scale: number };

type Viewport = { clientWidth?: number; clientHeight?: number; pageX?: number; pageY?: number; zoom?: number; scale?: number };

export type LayoutMetrics = {
  cssVisualViewport?: Viewport;
  visualViewport?: Viewport;
  cssLayoutViewport?: Viewport;
  cssContentSize?: { width?: number; height?: number };
};

export const MAX_CAPTURE_SIDE = 16384;
export const MIN_FULL_PAGE_SCALE = 0.5;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

export function captureMode(arg: string | null | undefined): CaptureMode {
  return arg === "fullPage" || arg === "visible" ? arg : "region";
}

export function pageZoom(m: LayoutMetrics | null | undefined): number {
  const zoom = m?.cssVisualViewport?.zoom;
  return positive(zoom) ? zoom : 1;
}

export function deviceScale(m: LayoutMetrics | null | undefined): number {
  const css = m?.cssVisualViewport?.clientWidth;
  const device = m?.visualViewport?.clientWidth;
  if (!positive(css) || !positive(device)) return 1;
  return round(device / (css * pageZoom(m)));
}

export function insideViewport(rect: PageRect, view: Pick<PageView, "innerWidth" | "innerHeight">): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= view.innerWidth + 0.5 && rect.y + rect.height <= view.innerHeight + 0.5;
}

export function regionClip(rect: PageRect, view: Pick<PageView, "scrollX" | "scrollY">, zoom: number): Clip | null {
  const left = Math.max(0, rect.x + view.scrollX);
  const top = Math.max(0, rect.y + view.scrollY);
  const right = rect.x + view.scrollX + rect.width;
  const bottom = rect.y + view.scrollY + rect.height;
  const width = right - left;
  const height = bottom - top;
  if (!(width >= 1) || !(height >= 1) || !positive(zoom)) return null;
  return { x: round(left * zoom), y: round(top * zoom), width: round(width * zoom), height: round(height * zoom), scale: 1 };
}

export function fullPageClip(m: LayoutMetrics | null | undefined, maxSide = MAX_CAPTURE_SIDE): { clip: Clip; cropped: boolean } | null {
  const width = m?.cssContentSize?.width;
  const height = m?.cssContentSize?.height;
  if (!positive(width) || !positive(height)) return null;
  const zoom = pageZoom(m);
  const dsf = deviceScale(m);
  const dipWidth = width * zoom;
  const dipHeight = height * zoom;
  const fit = Math.min(1, maxSide / (dipWidth * dsf), maxSide / (dipHeight * dsf));
  const scale = Math.max(MIN_FULL_PAGE_SCALE, Math.floor(fit * 10000) / 10000);
  const maxDip = Math.floor(maxSide / (dsf * scale));
  const cropped = dipHeight > maxDip;
  return {
    clip: { x: 0, y: 0, width: round(Math.min(dipWidth, maxDip)), height: round(Math.min(dipHeight, maxDip)), scale },
    cropped,
  };
}

export function outputSize(clip: Clip, dsf: number): { width: number; height: number } {
  return { width: Math.round(clip.width * clip.scale * dsf), height: Math.round(clip.height * clip.scale * dsf) };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function captureFileName(date: Date, copy = 1): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Orbit Capture ${day} at ${time}${copy > 1 ? ` (${copy})` : ""}.png`;
}

export function freeFileName(date: Date, taken: (name: string) => boolean, limit = 1000): string | null {
  for (let copy = 1; copy <= limit; copy++) {
    const name = captureFileName(date, copy);
    if (!taken(name)) return name;
  }
  return null;
}

export function sizeLabel(width: number, height: number): string {
  return `${width} × ${height}`;
}
