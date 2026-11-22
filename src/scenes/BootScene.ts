import Phaser from 'phaser';
import { WEAPONS } from '../data/content';
import { ENEMIES } from '../data/enemies';
import { BODY_MODELS, ENEMY_MODELS } from '../data/types';
import { CITY_MAP_KEY } from './CityScene';
import { ART_H, ART_TEXTURE_SCALE, ART_W, COLORS, HEIGHT, MONSTER_W, UI_SCALE, WIDTH, monsterKey, setupCamera, text, unitKey } from '../ui/widgets';

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
    const arts = [...new Set(Object.values(WEAPONS).map((w) => w.art))];
    for (const m of [...BODY_MODELS, ...ENEMY_MODELS]) for (const art of arts) this.load.svg(unitKey(m, art), `art/units/${m}_${art}.svg`, size);
    const monsterSize = { width: Math.round(MONSTER_W * ART_TEXTURE_SCALE * UI_SCALE), height: size.height };
    const kinds = new Set(Object.values(ENEMIES).map((d) => d.art.kind).filter((k) => k !== 'human'));
    for (const kind of kinds) this.load.svg(monsterKey(kind), `art/monsters/${kind}.svg`, monsterSize);
    this.load.image(CITY_MAP_KEY, 'art/city/arch-city.webp');
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
