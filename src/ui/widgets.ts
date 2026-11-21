import Phaser from 'phaser';
import { WEAPONS } from '../data/content';
import type { Appearance } from '../data/types';

export const WIDTH = 960;
export const HEIGHT = 640;
export const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

/**
 * The game is laid out in a fixed 960x640 coordinate space but rendered at the
 * real pixel size of the player's screen (up to 4x = 4K) so it stays sharp.
 * Every scene zooms its camera by this factor (see setupCamera) and text is
 * rasterized at the same resolution.
 */
function computeUiScale(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(window.screen?.width ?? 0, window.innerWidth) * dpr;
  const h = Math.max(window.screen?.height ?? 0, window.innerHeight) * dpr;
  const scale = Math.min(w / WIDTH, h / HEIGHT);
  return Math.max(1, Math.min(4, Math.round(scale * 4) / 4));
}
export const UI_SCALE = computeUiScale();

/** Zoom the scene camera so the 960x640 layout fills the high-resolution canvas. */
export function setupCamera(scene: Phaser.Scene, background: number = 0x0e1018): void {
  scene.cameras.main.setZoom(UI_SCALE).centerOn(WIDTH / 2, HEIGHT / 2).setBackgroundColor(background);
}

export const COLORS = {
  bg: 0x0e1018,
  panel: 0x181c2b,
  panelLight: 0x232a40,
  border: 0x3a4566,
  accent: 0xe0b44c,
  text: '#f4ecd8',
  dim: '#9aa3bd',
  good: '#6fdc8c',
  bad: '#ff6b6b',
  gold: '#e0b44c',
};

export const hex = (color: string) => parseInt(color.replace('#', ''), 16);

export function text(
  scene: Phaser.Scene, x: number, y: number, value: string,
  style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, value, { fontFamily: FONT, fontSize: '16px', color: COLORS.text, resolution: UI_SCALE, ...style });
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill = COLORS.panel) {
  return scene.add.rectangle(x, y, w, h, fill).setOrigin(0).setStrokeStyle(2, COLORS.border);
}

export interface ButtonOptions {
  enabled?: boolean;
  selected?: boolean;
  fontSize?: number;
  fill?: number;
  /** Called when the pointer hovers (for tooltips). */
  onHover?: () => void;
  /** Called when the pointer leaves the button. */
  onOut?: () => void;
}

/** A simple rectangular button. (x, y) is the top-left corner. */
export function button(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string,
  onClick: () => void, opts: ButtonOptions = {},
): Phaser.GameObjects.Container {
  const enabled = opts.enabled ?? true;
  const baseFill = opts.selected ? 0x4a3d1c : (opts.fill ?? COLORS.panelLight);
  const bg = scene.add.rectangle(0, 0, w, h, baseFill).setOrigin(0)
    .setStrokeStyle(2, opts.selected ? COLORS.accent : COLORS.border);
  const t = text(scene, w / 2, h / 2, label, {
    fontSize: `${opts.fontSize ?? 16}px`,
    color: enabled ? COLORS.text : '#5d6480',
    align: 'center',
  }).setOrigin(0.5);
  const c = scene.add.container(x, y, [bg, t]);
  bg.setInteractive({ useHandCursor: enabled });
  bg.on('pointerover', () => {
    if (enabled) bg.setFillStyle(opts.selected ? 0x5c4b22 : 0x2f3956);
    opts.onHover?.();
  });
  bg.on('pointerout', () => {
    bg.setFillStyle(baseFill);
    opts.onOut?.();
  });
  bg.on('pointerup', () => {
    if (enabled) onClick();
  });
  return c;
}

/** Modal yes/no dialog drawn on top of the scene. */
export function confirmDialog(scene: Phaser.Scene, message: string, onYes: () => void, yesLabel = 'Yes'): void {
  const layer = scene.add.container(0, 0).setDepth(1000);
  const shade = scene.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.6).setOrigin(0).setInteractive();
  const box = panel(scene, WIDTH / 2 - 220, HEIGHT / 2 - 90, 440, 180);
  const msg = text(scene, WIDTH / 2, HEIGHT / 2 - 40, message, { align: 'center', wordWrap: { width: 400 } }).setOrigin(0.5);
  const yes = button(scene, WIDTH / 2 - 170, HEIGHT / 2 + 20, 150, 44, yesLabel, () => {
    layer.destroy();
    onYes();
  });
  const no = button(scene, WIDTH / 2 + 20, HEIGHT / 2 + 20, 150, 44, 'Cancel', () => layer.destroy());
  layer.add([shade, box, msg, yes, no]);
}

/** Short message that fades out. */
export function toast(scene: Phaser.Scene, message: string, color = COLORS.text): void {
  const t = text(scene, WIDTH / 2, HEIGHT - 40, message, {
    color, backgroundColor: '#000000c0', padding: { x: 12, y: 6 }, align: 'center', wordWrap: { width: 800 },
  }).setOrigin(0.5).setDepth(2000);
  scene.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 600, onComplete: () => t.destroy() });
}

/**
 * A real HTML <input> laid over the canvas at layout coordinates (x, y, w, h).
 * Kept in place when the window resizes and removed when the scene shuts down.
 */
export function overlayInput(scene: Phaser.Scene, x: number, y: number, w: number, h: number): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'name-input';
  input.style.position = 'fixed';
  input.style.boxSizing = 'border-box';
  document.body.appendChild(input);
  const place = () => {
    const rect = scene.game.canvas.getBoundingClientRect();
    const k = rect.width / WIDTH;
    input.style.left = `${rect.left + x * k}px`;
    input.style.top = `${rect.top + y * k}px`;
    input.style.width = `${w * k}px`;
    input.style.height = `${h * k}px`;
    input.style.fontSize = `${18 * k}px`;
    input.style.padding = `0 ${10 * k}px`;
    input.style.borderWidth = `${Math.max(1, 2 * k)}px`;
    input.style.borderRadius = `${4 * k}px`;
  };
  place();
  // The canvas may still be settling on the first frame; re-place once it has.
  requestAnimationFrame(place);
  window.addEventListener('resize', place);
  scene.scale.on('resize', place);
  scene.events.once('shutdown', () => {
    window.removeEventListener('resize', place);
    scene.scale.off('resize', place);
    input.remove();
  });
  return input;
}

// ---- unit art -----------------------------------------------------------------

/** Unit art is a 64x80 SVG canvas with the feet at y = 76. */
export const ART_W = 64;
export const ART_H = 80;
const FEET = 76;
/** Textures are rasterized this many times larger than 64x80 so they stay sharp in big previews. */
export const ART_TEXTURE_SCALE = 1.6;

export const bodyKey = (model: string) => `body-${model}`;
export const weaponKey = (weaponId: string) => `weapon-${WEAPONS[weaponId]?.art ?? weaponId}`;

export interface FigureOptions {
  /** Enemies stand on a dark-rimmed base and face left. */
  enemy?: boolean;
  /** Draw the coloured base the figure stands on (default true). */
  base?: boolean;
}

/**
 * A unit figure: body + weapon art standing on a coloured base.
 * (x, feetY) is where the feet touch the ground; `height` is the full art height.
 */
export function figure(
  scene: Phaser.Scene, x: number, feetY: number, height: number,
  appearance: Appearance, weaponId: string, opts: FigureOptions = {},
): Phaser.GameObjects.Container {
  const scale = height / ART_H;
  const parts: Phaser.GameObjects.GameObject[] = [];
  if (opts.base !== false) {
    const g = scene.add.graphics();
    const rx = 17 * scale;
    const ry = 6 * scale;
    g.fillStyle(0x000000, 0.35).fillEllipse(0, 1.5 * scale, rx * 2 + 4, ry * 2 + 3);
    g.fillStyle(hex(appearance.color), 1).fillEllipse(0, 0, rx * 2, ry * 2);
    g.lineStyle(Math.max(1.5, 2 * scale), opts.enemy ? 0x2a0a0a : 0xffffff, 0.9).strokeEllipse(0, 0, rx * 2, ry * 2);
    parts.push(g);
  }
  for (const key of [bodyKey(appearance.model), weaponKey(weaponId)]) {
    if (!scene.textures.exists(key)) continue;
    const img = scene.add.image(0, 0, key).setOrigin(0.5, FEET / ART_H).setDisplaySize(ART_W * scale, height);
    if (opts.enemy) img.setFlipX(true);
    parts.push(img);
  }
  return scene.add.container(x, feetY, parts);
}

// ---- tooltip ------------------------------------------------------------------

/**
 * A floating tooltip that follows the pointer. Call `show(text)` on hover and
 * `hide()` on pointer-out. It flips sides to stay on screen.
 */
export class Tooltip {
  private readonly box: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private extra: Phaser.GameObjects.Container | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly width = 280) {
    this.bg = scene.add.rectangle(0, 0, width, 10, 0x0b0e18, 0.96).setOrigin(0).setStrokeStyle(1.5, COLORS.accent);
    this.label = text(scene, 10, 8, '', { fontSize: '13px', wordWrap: { width: width - 20 }, lineSpacing: 3 });
    this.box = scene.add.container(0, 0, [this.bg, this.label]).setDepth(5000).setVisible(false);
    scene.input.on('pointermove', () => this.box.visible && this.place());
  }

  /** Show text, optionally followed by a diagram (e.g. from `reachDiagram`). */
  show(value: string, diagram?: { container: Phaser.GameObjects.Container; size: number }): void {
    this.extra?.destroy();
    this.extra = null;
    this.label.setText(value);
    let h = this.label.height + 16;
    if (diagram) {
      diagram.container.setPosition(10, h);
      this.box.add(diagram.container);
      this.extra = diagram.container;
      h += diagram.size + 10;
    }
    this.bg.setSize(this.width, h);
    this.box.setVisible(true);
    this.place();
  }

  hide(): void {
    this.box.setVisible(false);
    this.extra?.destroy();
    this.extra = null;
  }

  private place(): void {
    const p = this.scene.input.activePointer;
    const h = this.bg.height;
    let x = p.worldX + 16;
    let y = p.worldY + 18;
    if (x + this.width > WIDTH - 4) x = p.worldX - this.width - 12;
    if (y + h > HEIGHT - 4) y = p.worldY - h - 10;
    this.box.setPosition(Math.max(4, x), Math.max(4, y));
  }
}

// ---- tile diagrams --------------------------------------------------------------

export interface ReachShape {
  kind: 'targets' | 'area' | 'cone' | 'self';
  tiles: { x: number; y: number }[];
}

/**
 * A small grid showing which tiles a skill covers: the user in gold at the centre,
 * covered tiles in red (attacks) or green (support). Top-left at (0,0) of the container.
 */
export function reachDiagram(
  scene: Phaser.Scene, shape: ReachShape, support: boolean, maxSize = 96,
): { container: Phaser.GameObjects.Container; size: number } {
  const R = Math.max(1, ...shape.tiles.map((t) => Math.max(Math.abs(t.x), Math.abs(t.y))));
  const n = R * 2 + 1;
  const cell = Math.max(6, Math.min(14, Math.floor(maxSize / n)));
  const size = cell * n;
  const covered = new Set(shape.tiles.map((t) => `${t.x},${t.y}`));
  const g = scene.add.graphics();
  const color = support ? 0x6fdc8c : 0xff6b6b;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const px = (x + R) * cell;
      const py = (y + R) * cell;
      const center = x === 0 && y === 0;
      g.fillStyle(center ? 0xffd166 : covered.has(`${x},${y}`) ? color : 0x2a3148, center || covered.has(`${x},${y}`) ? 0.9 : 0.7);
      g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    }
  }
  return { container: scene.add.container(0, 0, [g]), size };
}
