import Phaser from 'phaser';
import type { Emblem } from '../data/types';

export const WIDTH = 960;
export const HEIGHT = 640;
export const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

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
  return scene.add.text(x, y, value, { fontFamily: FONT, fontSize: '16px', color: COLORS.text, ...style });
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
  const t = scene.add.text(w / 2, h / 2, label, {
    fontFamily: FONT,
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
  bg.on('pointerout', () => bg.setFillStyle(baseFill));
  bg.on('pointerup', () => {
    if (enabled) onClick();
  });
  return c;
}

/** Draw a character token: colored disc with an emblem. */
export function drawToken(
  g: Phaser.GameObjects.Graphics, x: number, y: number, r: number,
  color: string, emblem: Emblem, ring = 0xffffff,
): void {
  g.fillStyle(0x000000, 0.35).fillCircle(x + 2, y + 3, r);
  g.fillStyle(hex(color), 1).fillCircle(x, y, r);
  g.lineStyle(Math.max(2, r / 8), ring, 1).strokeCircle(x, y, r);
  const s = r * 0.45;
  g.fillStyle(0xffffff, 0.9);
  switch (emblem) {
    case 'circle':
      g.fillCircle(x, y, s * 0.8);
      break;
    case 'square':
      g.fillRect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
      break;
    case 'diamond':
      g.fillTriangle(x, y - s, x + s, y, x, y + s);
      g.fillTriangle(x, y - s, x - s, y, x, y + s);
      break;
    case 'triangle':
      g.fillTriangle(x, y - s, x + s, y + s * 0.8, x - s, y + s * 0.8);
      break;
  }
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
