import Phaser from 'phaser';
import { WEAPONS } from '../data/content';
import { BODY_MODELS } from '../data/types';
import { ART_H, ART_TEXTURE_SCALE, ART_W, COLORS, HEIGHT, UI_SCALE, WIDTH, bodyKey, setupCamera, text, weaponKey } from '../ui/widgets';

/** Loads the unit art (SVG, rasterized at the screen's resolution), then opens the main menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    setupCamera(this);
    const label = text(this, WIDTH / 2, HEIGHT / 2, 'Loading…', { color: COLORS.dim }).setOrigin(0.5);
    this.load.on('progress', (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`));
    const size = { width: Math.round(ART_W * ART_TEXTURE_SCALE * UI_SCALE), height: Math.round(ART_H * ART_TEXTURE_SCALE * UI_SCALE) };
    for (const m of BODY_MODELS) this.load.svg(bodyKey(m), `art/units/${m}.svg`, size);
    for (const id of Object.keys(WEAPONS)) this.load.svg(weaponKey(id), `art/weapons/${WEAPONS[id].art}.svg`, size);
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
