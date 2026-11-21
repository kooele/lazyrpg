import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS, XP_PER_LEVEL } from '../data/content';
import type { Character } from '../data/types';
import { deriveStats, skillSlots } from '../game/character';
import { markDirty, requireState, session } from '../game/session';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, figure, panel, text, setupCamera } from '../ui/widgets';

/** Party hub between battles: view, recruit, edit and dismiss party members. */
export class CampScene extends Phaser.Scene {
  constructor() {
    super('Camp');
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MainMenu'));
    this.render();
  }

  private render(): void {
    this.children.removeAll(true);
    const state = requireState();
    const { progress, party } = state;

    text(this, 24, 18, 'Camp', { fontSize: '32px', color: COLORS.gold });
    text(this, 24, 58, `Stage ${progress.stage}   ·   Victories ${progress.victories}   ·   Defeats ${progress.defeats}`, { color: COLORS.dim });
    if (session.dirty) text(this, WIDTH - 24, 28, 'Unsaved progress', { color: COLORS.dim, fontSize: '13px' }).setOrigin(1, 0);

    for (let i = 0; i < MAX_PARTY_SIZE; i++) {
      const x = 24 + i * 232;
      const y = 92;
      const c = party[i];
      if (c) this.card(c, x, y);
      else {
        panel(this, x, y, 216, 440, 0x131726);
        button(this, x + 28, y + 196, 160, 48, '+ Recruit', () => this.scene.start('CharacterCreator', { mode: 'create' }), { fontSize: 18 });
      }
    }

    button(this, 24, HEIGHT - 84, 220, 56, 'Main Menu', () => this.scene.start('MainMenu'));
    button(this, 260, HEIGHT - 84, 220, 56, 'Save Game', () => this.scene.start('SaveLoad', { mode: 'save', returnTo: 'Camp' }));
    button(this, WIDTH - 324, HEIGHT - 84, 300, 56, `Start Battle — Stage ${progress.stage}`, () => this.scene.start('Battle'), {
      enabled: party.length > 0, fill: 0x4a2a22, fontSize: 18,
    });
    if (party.length === 0) {
      text(this, WIDTH - 174, HEIGHT - 20, 'Recruit at least one hero.', { color: COLORS.dim, fontSize: '13px' }).setOrigin(0.5);
    }
  }

  private card(c: Character, x: number, y: number): void {
    const stats = deriveStats(c);
    const freeSlots = skillSlots(c) - c.skillIds.length;
    panel(this, x, y, 216, 440);
    const g = this.add.graphics();
    figure(this, x + 40, y + 70, 62, c.appearance, c.weaponId);
    text(this, x + 76, y + 18, c.name, { fontSize: '18px', wordWrap: { width: 134 } });
    text(this, x + 76, y + 44, `Lv ${c.level} Adventurer`, { color: COLORS.dim, fontSize: '14px' });

    // XP bar
    g.fillStyle(0x0b0d14).fillRect(x + 14, y + 80, 188, 8);
    g.fillStyle(0x7d6bd8).fillRect(x + 14, y + 80, 188 * (c.xp / XP_PER_LEVEL), 8);
    text(this, x + 202, y + 90, `${c.xp}/${XP_PER_LEVEL} XP`, { color: COLORS.dim, fontSize: '11px' }).setOrigin(1, 0);

    const lines = [
      `HP ${stats.health}   Move ${stats.movement}`,
      `P.Atk ${stats.pAtk}   M.Atk ${stats.mAtk}`,
      `Def ${stats.defense}`,
    ];
    text(this, x + 14, y + 112, lines.join('\n'), { fontSize: '14px', lineSpacing: 6 });
    const weapon = WEAPONS[c.weaponId];
    text(this, x + 14, y + 184, 'Weapon', { color: COLORS.dim, fontSize: '12px' });
    text(this, x + 14, y + 200, weapon.name, { fontSize: '15px' });
    text(this, x + 14, y + 220, weapon.skills.map((s) => SKILLS[s].name).join(', '), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 188 } });
    text(this, x + 14, y + 262, `Skills ${c.skillIds.length}/${skillSlots(c)}`, { color: COLORS.dim, fontSize: '12px' });
    text(this, x + 14, y + 278, c.skillIds.map((s) => `• ${SKILLS[s].name}`).join('\n') || '—', { fontSize: '14px', lineSpacing: 2 });

    if (freeSlots > 0) {
      text(this, x + 108, y + 356, `${freeSlots} empty skill slot${freeSlots > 1 ? 's' : ''}`, { color: COLORS.gold, fontSize: '13px' }).setOrigin(0.5);
    }
    button(this, x + 14, y + 380, 110, 44, 'Customize', () => this.scene.start('CharacterCreator', { mode: 'edit', characterId: c.id }), {
      selected: freeSlots > 0, fontSize: 14,
    });
    button(this, x + 132, y + 380, 70, 44, 'Dismiss', () => {
      confirmDialog(this, `Dismiss ${c.name} from the party?\nThis cannot be undone.`, () => {
        const party = requireState().party;
        party.splice(party.indexOf(c), 1);
        markDirty();
        this.render();
      }, 'Dismiss');
    }, { fontSize: 13 });
  }
}
