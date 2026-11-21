import Phaser from 'phaser';
import {
  NAME_MAX_LENGTH, PALETTE, SKILLS, SKILL_TABS, SKILL_TREES, WEAPONS, XP_PER_LEVEL, skillDetails, skillFormula, tagNames,
} from '../data/content';
import { STAT_CONFIG, visibleStatKeys } from '../data/stats';
import { BODY_MODELS, STAT_INFO, STAT_KEYS, type Character, type SkillDef, type SkillTab, type StatKey } from '../data/types';
import { cloneCharacter, createCharacter, deriveStats, levelStats, skillSlots } from '../game/character';
import { markDirty, requireState } from '../game/session';
import { COLORS, Tooltip, button, figure, hex, overlayInput, panel, reachDiagram, setupCamera, text, toast } from '../ui/widgets';
import { skillShape, type ReachContext } from '../game/reach';

interface CreatorData {
  mode: 'create' | 'edit';
  characterId?: string;
}

const DEFAULT_NAMES = ['Aldric', 'Brienne', 'Corvin', 'Dahlia', 'Edda', 'Fenwick', 'Gwyn', 'Halvard', 'Isolde', 'Jory'];

/** "x0.8" style multiplier label. */
const mult = (m: number) => `x${Number(m.toFixed(2))}`;

/** Create or customize an Adventurer: name, look, weapon, and skill-tree picks. */
export class CharacterCreatorScene extends Phaser.Scene {
  private mode: 'create' | 'edit' = 'create';
  private draft!: Character;
  private tab: SkillTab = 'mage';
  private layer!: Phaser.GameObjects.Container;
  private nameInput!: HTMLInputElement;
  private tooltip!: Tooltip;

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

    this.tooltip = new Tooltip(this);
    this.render();
  }

  /** What this adventurer's Movement / weapon-scaled skills reach. */
  private reachContext(): ReachContext {
    return { movement: deriveStats(this.draft).movement, basic: SKILLS[WEAPONS[this.draft.weaponId].skills[0]] };
  }

  private isSupport(s: SkillDef): boolean {
    return s.affects === 'ally';
  }

  /** Tile diagram for a skill (user in gold, covered tiles in red/green). */
  private diagram(s: SkillDef, maxSize = 96) {
    return reachDiagram(this, skillShape(s, this.reachContext()), this.isSupport(s), maxSize);
  }

  private skillInfo(s: SkillDef): string {
    const shape = skillShape(s, this.reachContext());
    const note = shape.kind === 'cone' ? '\nShown facing right; aim it any way.'
      : shape.kind === 'line' ? '\nPick one of the 8 directions.'
        : shape.kind === 'self' ? '\nAffects only you.' : '';
    return `${s.name}  [${tagNames(s).join(', ')}]\n${s.description}\n\n${skillFormula(s)}\n${skillDetails(s)}${note}`;
  }

  private showSkill(s: SkillDef): void {
    this.tooltip.show(this.skillInfo(s), this.diagram(s));
  }

  /** Make an object show a tooltip while hovered. */
  private tip<T extends Phaser.GameObjects.GameObject>(obj: T, info: () => string): T {
    obj.setInteractive();
    obj.on('pointerover', () => this.tooltip.show(info()));
    obj.on('pointerout', () => this.tooltip.hide());
    return obj;
  }

  private render(): void {
    this.tooltip.hide();
    this.layer?.destroy();
    this.layer = this.add.container(0, 0);
    const L = this.layer;
    const d = this.draft;
    const hover = (info: () => string) => ({ onHover: () => this.tooltip.show(info()), onOut: () => this.tooltip.hide() });

    // ---- Left: body, color, preview, stats ------------------------------------------
    L.add(text(this, 24, 132, 'Body', { color: COLORS.dim }));
    BODY_MODELS.forEach((model, i) => {
      const x = 24 + i * 36;
      const sel = d.appearance.model === model;
      const bg = this.add.rectangle(x, 152, 32, 48, sel ? 0x4a3d1c : COLORS.panelLight).setOrigin(0)
        .setStrokeStyle(2, sel ? COLORS.accent : COLORS.border);
      this.tip(bg, () => `Body ${i + 1} (${model.startsWith('f') ? 'female' : 'male'})`)
        .on('pointerup', () => {
          d.appearance.model = model;
          this.render();
        });
      bg.input!.cursor = 'pointer';
      L.add(bg);
      L.add(figure(this, x + 16, 196, 44, { ...d.appearance, model }, d.weaponId, { base: false }));
    });
    PALETTE.forEach((color, i) => {
      const sw = this.add.rectangle(24 + i * 36, 210, 30, 22, hex(color)).setOrigin(0)
        .setStrokeStyle(3, d.appearance.color === color ? 0xffffff : 0x222222);
      this.tip(sw, () => 'Base color: the disc your adventurer stands on.')
        .on('pointerup', () => {
          d.appearance.color = color;
          this.render();
        });
      sw.input!.cursor = 'pointer';
      L.add(sw);
    });

    L.add(panel(this, 24, 244, 290, 92));
    L.add(figure(this, 66, 326, 84, d.appearance, d.weaponId));
    L.add(text(this, 112, 258, d.name.trim() || '(no name)', { fontSize: '18px', wordWrap: { width: 192 } }));
    L.add(text(this, 112, 284, `Level ${d.level} Adventurer`, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 112, 304, `${d.xp}/${XP_PER_LEVEL} XP · ${WEAPONS[d.weaponId].name}`, { color: COLORS.dim, fontSize: '13px' }));

    L.add(panel(this, 24, 346, 290, 202));
    L.add(text(this, 36, 354, 'Stats', { color: COLORS.dim, fontSize: '14px' }));
    const total = deriveStats(d);
    const fromLevel = levelStats(d.level);
    const shown = visibleStatKeys();
    const rowH = Math.min(32, Math.floor(160 / shown.length));
    shown.forEach((k: StatKey, i) => {
      const y = 382 + i * rowH;
      const info = STAT_INFO[k];
      const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
      const row = this.add.rectangle(30, y - 4, 278, rowH - 2, 0xffffff, 0).setOrigin(0);
      L.add(this.tip(row, () => `${info.name} (${info.short})\n${info.description}\n\nLevel ${d.level}: ${fromLevel[k]}${m !== 1 ? ` ${mult(m)} weapon = ${total[k]}` : ''}\n+${STAT_CONFIG.growthPerLevel[k]} per level`));
      L.add(text(this, 40, y, info.name, { fontSize: '15px' }));
      L.add(text(this, 220, y, String(total[k]), { fontSize: '16px' }).setOrigin(1, 0));
      if (m !== 1) L.add(text(this, 232, y + 2, mult(m), { fontSize: '13px', color: m > 1 ? COLORS.good : COLORS.bad }));
    });

    // ---- Middle: weapon -------------------------------------------------------------
    L.add(text(this, 330, 66, 'Weapon', { color: COLORS.dim }));
    Object.values(WEAPONS).forEach((w, i) => {
      L.add(button(this, 330 + (i % 2) * 149, 90 + Math.floor(i / 2) * 40, 141, 34, w.name, () => {
        d.weaponId = w.id;
        this.render();
      }, { selected: d.weaponId === w.id, fontSize: 14, ...hover(() => `${w.name}\n${w.description}`) }));
    });
    const w = WEAPONS[d.weaponId];
    L.add(panel(this, 330, 172, 290, 376));
    L.add(text(this, 342, 180, w.name, { fontSize: '18px', color: COLORS.gold }));
    L.add(text(this, 342, 204, w.description, { fontSize: '13px', color: COLORS.dim, wordWrap: { width: 266 } }));
    const changed = STAT_KEYS.filter((k) => (w.statMultipliers[k] ?? 1) !== 1);
    if (changed.length === 0) L.add(text(this, 342, 244, 'No stat changes', { fontSize: '14px', color: COLORS.dim }));
    let mx = 342;
    for (const k of changed) {
      const m = w.statMultipliers[k]!;
      const t = text(this, mx, 244, `${mult(m)} ${STAT_INFO[k].short}`, { fontSize: '14px', color: m > 1 ? COLORS.good : COLORS.bad });
      L.add(t);
      mx += t.width + 16;
    }
    L.add(text(this, 342, 268, 'Weapon skills (always equipped)', { fontSize: '12px', color: COLORS.dim }));
    let sy = 286;
    w.skills.forEach((sid, i) => {
      const s = SKILLS[sid];
      const name = text(this, 342, sy, `${s.name}${i === 0 ? '  (basic)' : ''}`, { fontSize: '15px' }).setInteractive();
      name.on('pointerover', () => this.showSkill(s)).on('pointerout', () => this.tooltip.hide());
      L.add(name);
      L.add(text(this, 342, sy + 19, skillDetails(s), { fontSize: '11px', color: COLORS.gold }));
      const desc = text(this, 342, sy + 33, s.description, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 194 }, lineSpacing: -1 });
      L.add(desc);
      const mini = this.diagram(s, 56);
      mini.container.setPosition(608 - mini.size, sy + 2);
      L.add(mini.container);
      sy += Math.max(38 + desc.height, mini.size + 8);
    });

    // ---- Right: skill trees (hover a skill for details) --------------------------------
    const slots = skillSlots(d);
    L.add(text(this, 636, 66, `Skills  ${d.skillIds.length}/${slots}`, { color: d.skillIds.length < slots ? COLORS.gold : COLORS.dim }));
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
          selected: on, fontSize: 14, onHover: () => this.showSkill(s), onOut: () => this.tooltip.hide(),
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
