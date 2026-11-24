/**
 * Graphics settings, chosen in the Settings screen and kept in the browser (not in save files).
 *
 * Resolution is how many real pixels the game draws per unit of its 960x640 layout. It is fixed when the game
 * starts (the canvas and the unit art are made at that size), so a change applies after a reload. So does the
 * graphics chip preference, which is asked for when the WebGL context is created. The frame cap applies at once.
 */

export type ResolutionSetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type FrameCapSetting = 30 | 60 | 0;
/** WebGL's powerPreference: which graphics chip a computer with two should use. */
export type GpuSetting = 'default' | 'high-performance' | 'low-power';

export interface GraphicsSettings {
  resolution: ResolutionSetting;
  /** Frames per second; 0 = as fast as the display refreshes. */
  frameCap: FrameCapSetting;
  gpu: GpuSetting;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = { resolution: 'auto', frameCap: 60, gpu: 'default' };

export const RESOLUTION_OPTIONS: { id: ResolutionSetting; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Matches the browser window, up to 2x. Sharp and fast on most screens.' },
  { id: 'low', label: 'Low (1x)', hint: '960x640. Fastest; blurry on large or high-DPI screens.' },
  { id: 'medium', label: 'Medium (1.5x)', hint: '1440x960.' },
  { id: 'high', label: 'High (2x)', hint: '1920x1280.' },
  { id: 'ultra', label: 'Ultra', hint: 'Matches the whole screen, up to 4x (4K). Sharpest, and much slower on Retina and 4K screens.' },
];

export const FRAME_CAP_OPTIONS: { id: FrameCapSetting; label: string; hint: string }[] = [
  { id: 30, label: '30 FPS', hint: 'Least work for the computer; animations are a little choppier.' },
  { id: 60, label: '60 FPS', hint: 'Smooth, and half the work of a 120 Hz display.' },
  { id: 0, label: 'Display rate', hint: 'As fast as the display refreshes (up to 120 Hz or more).' },
];

export const GPU_OPTIONS: { id: GpuSetting; label: string; hint: string }[] = [
  { id: 'default', label: 'Automatic', hint: 'The browser decides; on laptops with two graphics chips this is usually the slower, built-in one.' },
  { id: 'high-performance', label: 'Fast', hint: 'Asks for the faster graphics chip on laptops that have two (e.g. older MacBook Pros). Runs hotter and uses more battery.' },
  { id: 'low-power', label: 'Battery saver', hint: 'Asks for the built-in graphics chip, to save battery and heat.' },
];

const FIXED_SCALE: Partial<Record<ResolutionSetting, number>> = { low: 1, medium: 1.5, high: 2 };
/** Auto never goes above this: past 2x the extra sharpness is hard to see and costs a lot. */
const AUTO_MAX_SCALE = 2;
const ULTRA_MAX_SCALE = 4;

export interface Viewport {
  devicePixelRatio: number;
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/** Largest scale (to a quarter step) at which a 960x640 layout still fits w x h real pixels, between 1 and max. */
function fitScale(w: number, h: number, max: number): number {
  const scale = Math.min(w / 960, h / 640);
  return Math.max(1, Math.min(max, Math.round(scale * 4) / 4));
}

/** The render scale (real pixels per layout pixel) for a resolution setting on this viewport. */
export function uiScaleFor(resolution: ResolutionSetting, v: Viewport): number {
  const fixed = FIXED_SCALE[resolution];
  if (fixed) return fixed;
  const dpr = v.devicePixelRatio || 1;
  if (resolution === 'ultra') {
    return fitScale(Math.max(v.screenWidth, v.windowWidth) * dpr, Math.max(v.screenHeight, v.windowHeight) * dpr, ULTRA_MAX_SCALE);
  }
  return fitScale(v.windowWidth * dpr, v.windowHeight * dpr, AUTO_MAX_SCALE);
}

/** Reads settings from a JSON string, keeping defaults for anything missing or invalid. */
export function parseGraphics(raw: string | null | undefined): GraphicsSettings {
  const out = { ...DEFAULT_GRAPHICS };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Partial<GraphicsSettings>;
    if (RESOLUTION_OPTIONS.some((o) => o.id === v.resolution)) out.resolution = v.resolution!;
    if (FRAME_CAP_OPTIONS.some((o) => o.id === v.frameCap)) out.frameCap = v.frameCap!;
    if (GPU_OPTIONS.some((o) => o.id === v.gpu)) out.gpu = v.gpu!;
  } catch {
    // Keep the defaults.
  }
  return out;
}

const STORAGE_KEY = 'lazyrpg.graphics';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadGraphics(): GraphicsSettings {
  try {
    return parseGraphics(storage()?.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

/** Saves the settings; false if the browser won't store them (they then last until the page is closed). */
export function saveGraphics(s: GraphicsSettings): boolean {
  try {
    const st = storage();
    if (!st) return false;
    st.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The settings the game started with: resolution and graphics chip can only change on a reload. */
export const STARTUP_GRAPHICS: Readonly<GraphicsSettings> = loadGraphics();
