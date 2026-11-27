import Phaser from 'phaser';
import { ENEMIES } from '../data/enemies';
import { STAT_ICONS } from '../data/types';
import { STAT_ICON_SVG } from '../art/statIcons';
import { CITY_MAP_KEY } from './CityScene';
import { ART_H, ART_TEXTURE_SCALE, ART_W, COLORS, HEIGHT, MONSTER_W, STAT_ICON_TEXTURE, UI_SCALE, WIDTH, monsterKey, setupCamera, statIconKey, svgIconTexture, text } from '../ui/widgets';

/** Loads the monster art and icons (SVG, rasterized at the screen's resolution), then opens the main menu. People are drawn at runtime. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    setupCamera(this);
    const label = text(this, WIDTH / 2, HEIGHT / 2, 'Loading…', { color: COLORS.dim }).setOrigin(0.5);
    this.load.on('progress', (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`));
    const size = { width: Math.round(ART_W * ART_TEXTURE_SCALE * UI_SCALE), height: Math.round(ART_H * ART_TEXTURE_SCALE * UI_SCALE) };
    const monsterSize = { width: Math.round(MONSTER_W * ART_TEXTURE_SCALE * UI_SCALE), height: size.height };
    const kinds = new Set(Object.values(ENEMIES).map((d) => d.art.kind).filter((k) => k !== 'human'));
    for (const kind of kinds) this.load.svg(monsterKey(kind), `art/monsters/${kind}.svg`, monsterSize);
    this.load.image(CITY_MAP_KEY, 'art/city/arch-city.webp');
  }

  create(): void {
    // Stat icons are bundled SVG text, drawn into textures here (no files to fetch).
    const icon = Math.round(STAT_ICON_TEXTURE * UI_SCALE);
    const icons = STAT_ICONS.map((k) => {
      const svg = STAT_ICON_SVG[k];
      return svg ? svgIconTexture(this, statIconKey(k), svg, icon) : Promise.resolve(false);
    });
    void Promise.all(icons).then(() => this.scene.start('MainMenu'));
  }
}
