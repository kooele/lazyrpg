import Phaser from 'phaser';
import { statText } from '../game/battle';
import { SKILLS } from '../data/content';
import type { Character } from '../data/types';
import { bodyPoints, deriveStats, freePoints, skillPoints } from '../game/character';
import { DEMO_LEVELS, DEMO_PARTY_SIZE, MOB_MULTIPLIER, autoMultiplier, newDemo, partyChanged, requireDemo, setDemoLevel } from '../game/demo';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, figure, fittedList, panel, talentTag, text, setupCamera, clearScene } from '../ui/widgets';
import { figureKit, weaponName, weaponOf } from '../game/gear';

/** Quick Battle (demo) camp: recruit, customize and dismiss up to 4 Adventurers, pick their level, then fight. */
export class DemoCampScene extends Phaser.Scene {
  constructor() {
    super('DemoCamp');
  }

  /** Is the difficulty slider being dragged? */
  private sliding = false;

  create(): void {
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MainMenu'));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.sliding) this.slideTo(p.worldX);
    });
    this.input.on('pointerup', () => {
      this.sliding = false;
    });
    this.render();
  }

  // ---- difficulty slider (enemy count 1x-5x) --------------------------------------------

  private static readonly SLIDER = { x: 640, y: 66, w: 270 };

  /** Set the multiplier from a pointer x position (snaps to 0.5 steps). */
  private slideTo(px: number): void {
    const { x, w } = DemoCampScene.SLIDER;
    const { min, max, step } = MOB_MULTIPLIER;
    const t = Math.max(0, Math.min(1, (px - x) / w));
    const value = Math.round((min + t * (max - min)) / step) * step;
    const d = requireDemo();
    if (value !== d.mobMultiplier) {
      d.mobMultiplier = value;
      this.render();
    }
  }

  private difficultySlider(): void {
    const d = requireDemo();
    const { x, y, w } = DemoCampScene.SLIDER;
    const { min, max, step } = MOB_MULTIPLIER;
    const pos = (v: number) => x + ((v - min) / (max - min)) * w;
    text(this, x - 12, y - 8, 'Enemies', { color: COLORS.dim, fontSize: '13px' }).setOrigin(1, 0.5);
    text(this, x - 12, y + 8, `${d.mobMultiplier}x`, { color: d.mobMultiplier > autoMultiplier(d) ? COLORS.bad : COLORS.text, fontSize: '15px', fontStyle: 'bold' }).setOrigin(1, 0.5);
    const g = this.add.graphics();
    g.fillStyle(0x0b0d14).fillRect(x, y - 3, w, 6);
    g.fillStyle(0xc0392b).fillRect(x, y - 3, pos(d.mobMultiplier) - x, 6);
    for (let v: number = min; v <= max + 1e-9; v += step) {
      g.fillStyle(Number.isInteger(v) ? 0x9aa3bd : 0x3a4566).fillRect(pos(v) - 1, y + 6, 2, Number.isInteger(v) ? 6 : 3);
      if (Number.isInteger(v)) text(this, pos(v), y + 13, `${v}x`, { color: COLORS.dim, fontSize: '10px' }).setOrigin(0.5, 0);
    }
    this.add.circle(pos(d.mobMultiplier), y, 9, 0xe0b44c).setStrokeStyle(2, 0x0b0d14);
    // A generous hit area so the slider is easy to grab.
    const hit = this.add.rectangle(x - 10, y - 14, w + 20, 28, 0xffffff, 0).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.sliding = true;
      this.slideTo(p.worldX);
    });
  }

  /** Level 1 to 10 for the whole party; the enemies come at the same level. */
  private levelPicker(): void {
    const d = requireDemo();
    text(this, 24, 58, 'Level', { color: COLORS.dim, fontSize: '13px' }).setOrigin(0, 0.5);
    for (let lv: number = DEMO_LEVELS.min; lv <= DEMO_LEVELS.max; lv++) {
      button(this, 70 + (lv - DEMO_LEVELS.min) * 31, 46, 28, 24, String(lv), () => {
        setDemoLevel(d, lv);
        this.render();
      }, { selected: lv === d.level, fontSize: 13 });
    }
    text(this, 70 + 10 * 31 + 6, 58, 'adventurers and enemies', { color: COLORS.dim, fontSize: '12px' }).setOrigin(0, 0.5);
  }

  private render(): void {
    clearScene(this);
    const d = requireDemo();
    const { party } = d;

    text(this, 24, 14, 'Quick Battle: Camp', { fontSize: '28px', color: COLORS.gold });
    text(this, WIDTH - 24, 14, `Victories ${d.victories}   ·   Defeats ${d.defeats}   ·   Demo: Not Saved`, { color: COLORS.dim, fontSize: '12px' }).setOrigin(1, 0);
    this.levelPicker();
    this.difficultySlider();

    for (let i = 0; i < DEMO_PARTY_SIZE; i++) {
      const x = 24 + i * 232;
      const y = 92;
      const c = party[i];
      if (c) this.card(c, x, y);
      else {
        panel(this, x, y, 216, 440, 0x131726);
        // Only the first empty slot recruits (the party fills left to right).
        if (i === party.length) button(this, x + 28, y + 196, 160, 48, '+ Recruit', () => this.scene.start('CharacterCreator', { mode: 'demo' }), { fontSize: 18 });
      }
    }

    button(this, 24, HEIGHT - 84, 220, 56, 'Main Menu', () => this.scene.start('MainMenu'));
    button(this, 260, HEIGHT - 84, 220, 56, 'Restart Demo', () => confirmDialog(this, 'Start the demo over?\nThis party will be lost.', () => {
      newDemo();
      this.render();
    }, 'Restart'));
    button(this, WIDTH - 324, HEIGHT - 84, 300, 56, `Start Battle — Level ${d.level}`, () => this.scene.start('Battle', { demo: true }), {
      enabled: party.length > 0, fill: 0x4a2a22, fontSize: 18,
    });
    if (party.length === 0) {
      text(this, WIDTH - 174, HEIGHT - 20, 'Recruit at least one hero.', { color: COLORS.dim, fontSize: '13px' }).setOrigin(0.5);
    }
  }

  private card(c: Character, x: number, y: number): void {
    const stats = deriveStats(c);
    const freeSlots = freePoints(c);
    panel(this, x, y, 216, 440);
    figure(this, x + 40, y + 70, 62, c.appearance, figureKit(c));
    text(this, x + 76, y + 18, c.name, { fontSize: '18px', wordWrap: { width: 134 } });
    text(this, x + 76, y + 44, `Lv ${c.level} Adventurer`, { color: COLORS.dim, fontSize: '14px' });
    talentTag(this, x + 76, y + 62, c, { fontSize: 12, detail: false });


    const lines = [
      `HP ${stats.health}   MP ${stats.mana}`,
      `P.Atk ${stats.pAtk}   M.Atk ${stats.mAtk}`,
      `Def ${statText('defense', stats.defense)}   Move ${stats.movement}`,
      `Res ${statText('resist', stats.resist)}`,
    ];
    text(this, x + 14, y + 108, lines.join('\n'), { fontSize: '13px', lineSpacing: 3 });
    const weapon = weaponOf(c)!;
    text(this, x + 14, y + 192, 'Weapon', { color: COLORS.dim, fontSize: '12px' });
    text(this, x + 14, y + 207, weaponName(c), { fontSize: '15px' });
    text(this, x + 14, y + 226, weapon.skills.map((s) => SKILLS[s].name).join(', '), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 188 } });
    text(this, x + 14, y + 266, `Skill Points ${skillPoints(c) - freeSlots}/${skillPoints(c)}${bodyPoints(c) ? ` (${bodyPoints(c)} in Body)` : ''}`, { color: COLORS.dim, fontSize: '12px' });
    // Bullets down to the "points to spend" line: at most 3 lines (4 when there's nothing to spend), then "+N more".
    fittedList(this, x + 14, y + 282, c.skillIds.map((s) => SKILLS[s].name), freeSlots > 0 ? 3 : 4, { fontSize: '14px', lineSpacing: 2, wordWrap: { width: 188 } },
      (shown, hidden) => [...shown.map((n) => `• ${n}`), ...(hidden ? [`+${hidden} More`] : [])].join('\n'));

    if (freeSlots > 0) {
      text(this, x + 108, y + 356, `${freeSlots} Skill Point${freeSlots > 1 ? 's' : ''} to Spend`, { color: COLORS.gold, fontSize: '13px' }).setOrigin(0.5);
    }
    button(this, x + 14, y + 380, 110, 44, 'Customize', () => this.scene.start('CharacterCreator', { mode: 'demoEdit', characterId: c.id }), {
      selected: freeSlots > 0, fontSize: 14,
    });
    button(this, x + 132, y + 380, 70, 44, 'Dismiss', () => {
      confirmDialog(this, `Dismiss ${c.name} from the party?\nThis cannot be undone.`, () => {
        const p = requireDemo().party;
        p.splice(p.indexOf(c), 1);
        partyChanged(requireDemo());
        this.render();
      }, 'Dismiss');
    }, { fontSize: 13 });
  }
}
