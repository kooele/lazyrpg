import Phaser from 'phaser';
import {
  EMBLEMS, NAME_MAX_LENGTH, PALETTE, SKILLS, SKILL_TABS, SKILL_TREES, WEAPONS, XP_PER_LEVEL, skillDetails,
} from '../data/content';
import { STAT_CONFIG, visibleStatKeys } from '../data/stats';
import { STAT_INFO, STAT_KEYS, type Character, type SkillDef, type SkillTab, type StatKey } from '../data/types';
import { cloneCharacter, createCharacter, deriveStats, levelStats, skillSlots } from '../game/character';
import { markDirty, requireState } from '../game/session';
import { COLORS, button, drawToken, hex, overlayInput, panel, setupCamera, text, toast } from '../ui/widgets';

interface CreatorData {
  mode: 'create' | 'edit';
  characterId?: string;
}

const DEFAULT_NAMES = ['Aldric', 'Brienne', 'Corvin', 'Dahlia', 'Edda', 'Fenwick', 'Gwyn', 'Halvard', 'Isolde', 'Jory'];

/** Create or customize an Adventurer: name, look, weapon, and skill-tree picks. */
export class CharacterCreatorScene extends Phaser.Scene {
  private mode: 'create' | 'edit' = 'create';
  private draft!: Character;
  private tab: SkillTab = 'mage';
  private layer!: Phaser.GameObjects.Container;
  private nameInput!: HTMLInputElement;
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super('CharacterCreator');
  }

  init(data: CreatorData): void {
    this.mode = data.mode ?? 'create';
    const party = requireState().party;
    if (this.mode === 'edit') {
      const existing = party.find((c) => c.id === data.characterId);
      if (!existing) throw new Error('Adventurer not found');
      this.draft = cloneCharacter(existing);
    } else {
      const usedColors = new Set(party.map((c) => c.appearance.color));
      const color = PALETTE.find((p) => !usedColors.has(p)) ?? PALETTE[0];
      const usedNames = new Set(party.map((c) => c.name));
      const name = DEFAULT_NAMES.filter((n) => !usedNames.has(n))[Math.floor(Math.random() * 6)] ?? 'Hero';
      const weapons = Object.keys(WEAPONS);
      this.draft = createCharacter(name, color, weapons[party.length % weapons.length]);
    }
  }

  create(): void {
    setupCamera(this, 0x111522);
    const title = this.mode === 'create' ? 'New Adventurer' : `Customize ${this.draft.name}`;
    text(this, 480, 30, title, { fontSize: '30px', color: COLORS.gold }).setOrigin(0.5);

    // Name field is a real HTML input so typing works everywhere (incl. mobile keyboards).
    text(this, 24, 66, 'Name', { color: COLORS.dim });
    const input = overlayInput(this, 24, 90, 290, 36);
    input.maxLength = NAME_MAX_LENGTH;
    input.value = this.draft.name;
    input.addEventListener('input', () => {
      this.draft.name = input.value;
      this.render();
    });
    this.nameInput = input;

    // Details box (persistent, updated on hover).
    panel(this, 636, 384, 300, 164);
    this.infoText = text(this, 648, 394, 'Hover over a weapon, skill or stat for details.', {
      fontSize: '14px', color: COLORS.dim, wordWrap: { width: 276 }, lineSpacing: 3,
    });

    this.render();
  }

  private setInfo(info: string): void {
    this.infoText.setText(info).setColor(COLORS.text);
  }

  private skillInfo(s: SkillDef): string {
    return `${s.name}\n${s.description}\n\n${skillDetails(s)}`;
  }

  private render(): void {
    this.layer?.destroy();
    this.layer = this.add.container(0, 0);
    const L = this.layer;
    const d = this.draft;

    // ---- Left: appearance, preview, stats -----------------------------------------
    L.add(text(this, 24, 138, 'Appearance', { color: COLORS.dim }));
    PALETTE.forEach((color, i) => {
      const sw = this.add.rectangle(24 + i * 36, 160, 30, 30, hex(color)).setOrigin(0)
        .setStrokeStyle(3, d.appearance.color === color ? 0xffffff : 0x222222)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          d.appearance.color = color;
          this.render();
        });
      L.add(sw);
    });
    EMBLEMS.forEach((emblem, i) => {
      L.add(button(this, 24 + i * 72, 198, 66, 30, emblem, () => {
        d.appearance.emblem = emblem;
        this.render();
      }, { selected: d.appearance.emblem === emblem, fontSize: 13 }));
    });

    L.add(panel(this, 24, 240, 290, 86));
    const g = this.add.graphics();
    drawToken(g, 66, 283, 28, d.appearance.color, d.appearance.emblem);
    L.add(g);
    L.add(text(this, 108, 252, d.name.trim() || '(no name)', { fontSize: '18px', wordWrap: { width: 196 } }));
    L.add(text(this, 108, 278, `Level ${d.level} Adventurer`, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 108, 298, `${d.xp}/${XP_PER_LEVEL} XP · ${WEAPONS[d.weaponId].name}`, { color: COLORS.dim, fontSize: '13px' }));

    L.add(panel(this, 24, 336, 290, 212));
    L.add(text(this, 36, 344, 'Stats', { color: COLORS.dim, fontSize: '14px' }));
    L.add(text(this, 302, 346, 'grows automatically each level', { color: COLORS.dim, fontSize: '11px' }).setOrigin(1, 0));
    const total = deriveStats(d);
    const fromLevel = levelStats(d.level);
    const shown = visibleStatKeys();
    const rowH = Math.min(34, Math.floor(170 / shown.length));
    shown.forEach((k: StatKey, i) => {
      const y = 372 + i * rowH;
      const info = STAT_INFO[k];
      const row = this.add.rectangle(30, y - 4, 278, rowH - 4, 0xffffff, 0).setOrigin(0).setInteractive();
      row.on('pointerover', () => this.setInfo(`${info.name} (${info.short})\n${info.description}\n\nLevel ${d.level}: ${fromLevel[k]} · +${STAT_CONFIG.growthPerLevel[k]} per level`));
      L.add(row);
      L.add(text(this, 40, y, info.name, { fontSize: '15px' }));
      L.add(text(this, 220, y, String(total[k]), { fontSize: '16px' }).setOrigin(1, 0));
      const bonus = WEAPONS[d.weaponId].bonus[k] ?? 0;
      if (bonus) L.add(text(this, 230, y + 2, `(+${bonus} weapon)`, { fontSize: '12px', color: COLORS.good }));
    });

    // ---- Middle: weapon -------------------------------------------------------------
    L.add(text(this, 330, 66, 'Weapon', { color: COLORS.dim }));
    Object.values(WEAPONS).forEach((w, i) => {
      L.add(button(this, 330 + (i % 2) * 149, 90 + Math.floor(i / 2) * 40, 141, 34, w.name, () => {
        d.weaponId = w.id;
        this.render();
      }, { selected: d.weaponId === w.id, fontSize: 14, onHover: () => this.setInfo(`${w.name}\n${w.description}`) }));
    });
    const w = WEAPONS[d.weaponId];
    L.add(panel(this, 330, 172, 290, 376));
    L.add(text(this, 342, 180, w.name, { fontSize: '18px', color: COLORS.gold }));
    L.add(text(this, 342, 204, w.description, { fontSize: '13px', color: COLORS.dim, wordWrap: { width: 266 } }));
    const bonusText = STAT_KEYS.filter((k) => w.bonus[k]).map((k) => `+${w.bonus[k]} ${STAT_INFO[k].short}`).join('   ');
    L.add(text(this, 342, 244, bonusText || 'No stat bonus', { fontSize: '15px', color: COLORS.good }));
    L.add(text(this, 342, 272, 'Weapon skills (always equipped)', { fontSize: '12px', color: COLORS.dim }));
    let sy = 292;
    w.skills.forEach((sid, i) => {
      const s = SKILLS[sid];
      const name = text(this, 342, sy, `${s.name}${i === 0 ? '  (basic attack)' : ''}`, { fontSize: '15px' }).setInteractive();
      name.on('pointerover', () => this.setInfo(this.skillInfo(s)));
      L.add(name);
      L.add(text(this, 342, sy + 20, skillDetails(s), { fontSize: '11px', color: COLORS.gold }));
      const desc = text(this, 342, sy + 36, s.description, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 266 } });
      L.add(desc);
      sy += 48 + desc.height;
    });

    // ---- Right: skill trees -----------------------------------------------------------
    const slots = skillSlots(d);
    L.add(text(this, 636, 66, `Skills  ${d.skillIds.length}/${slots}`, { color: d.skillIds.length < slots ? COLORS.gold : COLORS.dim }));
    L.add(text(this, 936, 68, 'mix and match · more slots at Lv 3 & 6', { color: COLORS.dim, fontSize: '11px' }).setOrigin(1, 0));
    SKILL_TABS.forEach((t, i) => {
      L.add(button(this, 636 + i * 154, 90, 146, 30, t.name, () => {
        this.tab = t.id;
        this.render();
      }, { selected: this.tab === t.id, fontSize: 14 }));
    });
    let ty = 130;
    for (const tree of SKILL_TREES.filter((t) => t.tab === this.tab)) {
      L.add(text(this, 636, ty, tree.name, { fontSize: '13px', color: COLORS.gold }));
      ty += 20;
      for (const sid of tree.skills) {
        const s = SKILLS[sid];
        const on = d.skillIds.includes(sid);
        L.add(button(this, 636, ty, 300, 30, `${on ? '✔ ' : ''}${s.name}`, () => this.toggleSkill(sid), {
          selected: on, fontSize: 14, onHover: () => this.setInfo(this.skillInfo(s)),
        }));
        ty += 34;
      }
    }
    // Picks from the other tab, so mixing is visible.
    const otherPicks = d.skillIds.filter((sid) => SKILL_TREES.find((t) => t.skills.includes(sid))?.tab !== this.tab);
    if (otherPicks.length) {
      const other = SKILL_TABS.find((t) => t.id !== this.tab)!.name;
      L.add(text(this, 636, ty + 4, `Also equipped (${other}): ${otherPicks.map((s) => SKILLS[s].name).join(', ')}`, {
        fontSize: '12px', color: COLORS.dim, wordWrap: { width: 300 },
      }));
    }

    // ---- Bottom buttons -------------------------------------------------------------
    L.add(button(this, 330, 560, 290, 50, 'Cancel', () => this.scene.start('Camp')));
    L.add(button(this, 636, 560, 300, 50, this.mode === 'create' ? 'Recruit' : 'Save changes', () => this.confirm(), { fill: 0x2c4a2f, fontSize: 18 }));
  }

  private toggleSkill(id: string): void {
    const d = this.draft;
    if (d.skillIds.includes(id)) {
      d.skillIds = d.skillIds.filter((s) => s !== id);
    } else if (d.skillIds.length < skillSlots(d)) {
      d.skillIds.push(id);
    } else {
      toast(this, 'All skill slots are full. Unequip a skill first.', COLORS.bad);
      return;
    }
    this.render();
  }

  private confirm(): void {
    const d = this.draft;
    d.name = this.nameInput.value.trim();
    if (!d.name) return toast(this, 'Give your adventurer a name.', COLORS.bad);
    const party = requireState().party;
    if (this.mode === 'create') party.push(d);
    else party[party.findIndex((c) => c.id === d.id)] = d;
    markDirty();
    this.scene.start('Camp');
  }
}
