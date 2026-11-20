import Phaser from 'phaser';
import { CLASSES, CREATION_POINTS, EMBLEMS, MAX_ATTRIBUTE, NAME_MAX_LENGTH, PALETTE, SKILLS, WEAPONS } from '../data/content';
import { ATTRIBUTE_INFO, ATTRIBUTE_KEYS, type Attributes, type Character, type ClassId } from '../data/types';
import { cloneCharacter, createCharacter, deriveStats, skillSlots } from '../game/character';
import { markDirty, requireState } from '../game/session';
import { COLORS, button, drawToken, hex, panel, text, toast, overlayInput, setupCamera } from '../ui/widgets';

interface CreatorData {
  mode: 'create' | 'edit';
  characterId?: string;
}

const DEFAULT_NAMES = ['Aldric', 'Brienne', 'Corvin', 'Dahlia', 'Edda', 'Fenwick', 'Gwyn', 'Halvard', 'Isolde', 'Jory'];

export class CharacterCreatorScene extends Phaser.Scene {
  private mode: 'create' | 'edit' = 'create';
  private draft!: Character;
  /** Attributes can't be lowered below this (class base when creating, current values when editing). */
  private floor!: Attributes;
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
      if (!existing) throw new Error('Character not found');
      this.draft = cloneCharacter(existing);
    } else {
      const usedColors = new Set(party.map((c) => c.appearance.color));
      const color = PALETTE.find((p) => !usedColors.has(p)) ?? PALETTE[0];
      const usedNames = new Set(party.map((c) => c.name));
      const name = DEFAULT_NAMES.filter((n) => !usedNames.has(n))[Math.floor(Math.random() * 6)] ?? 'Hero';
      this.draft = createCharacter(name, (['knight', 'ranger', 'mage', 'cleric'] as const)[party.length % 4], color);
    }
    this.floor = { ...this.draft.attributes };
  }

  create(): void {
    setupCamera(this, 0x111522);
    const title = this.mode === 'create' ? 'Create Character' : `Edit ${this.draft.name}`;
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
    panel(this, 636, 428, 300, 92);
    this.infoText = text(this, 648, 438, 'Hover over anything for details.', {
      fontSize: '14px', color: COLORS.dim, wordWrap: { width: 276 },
    });

    this.render();
  }

  private render(): void {
    this.layer?.destroy();
    this.layer = this.add.container(0, 0);
    const L = this.layer;
    const d = this.draft;
    const cls = CLASSES[d.classId];
    const creating = this.mode === 'create';

    // ---- Left: class + appearance -----------------------------------------
    L.add(text(this, 24, 138, creating ? 'Class' : 'Class (fixed after creation)', { color: COLORS.dim }));
    (Object.keys(CLASSES) as ClassId[]).forEach((id, i) => {
      L.add(button(this, 24 + (i % 2) * 148, 162 + Math.floor(i / 2) * 46, 140, 40, CLASSES[id].name, () => this.setClass(id), {
        selected: d.classId === id, enabled: creating || d.classId === id,
        onHover: () => this.setInfo(`${CLASSES[id].name}: ${CLASSES[id].description} Move ${CLASSES[id].move}, armor ${CLASSES[id].armor}.`),
      }));
    });
    L.add(text(this, 24, 260, cls.description, { fontSize: '14px', color: COLORS.dim, wordWrap: { width: 290 } }));

    L.add(text(this, 24, 312, 'Color', { color: COLORS.dim }));
    PALETTE.forEach((color, i) => {
      const sw = this.add.rectangle(24 + i * 36, 338, 30, 30, hex(color)).setOrigin(0)
        .setStrokeStyle(3, d.appearance.color === color ? 0xffffff : 0x222222)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          d.appearance.color = color;
          this.render();
        });
      L.add(sw);
    });

    L.add(text(this, 24, 384, 'Emblem', { color: COLORS.dim }));
    EMBLEMS.forEach((emblem, i) => {
      L.add(button(this, 24 + i * 72, 408, 66, 36, emblem, () => {
        d.appearance.emblem = emblem;
        this.render();
      }, { selected: d.appearance.emblem === emblem, fontSize: 13 }));
    });

    L.add(panel(this, 24, 462, 290, 150));
    const g = this.add.graphics();
    drawToken(g, 94, 537, 44, d.appearance.color, d.appearance.emblem);
    L.add(g);
    L.add(text(this, 156, 492, d.name.trim() || '(no name)', { fontSize: '20px', wordWrap: { width: 150 } }));
    L.add(text(this, 156, 522, `Level ${d.level} ${cls.name}`, { color: COLORS.dim, fontSize: '14px' }));
    L.add(text(this, 156, 544, WEAPONS[d.weaponId].name, { color: COLORS.dim, fontSize: '14px' }));

    // ---- Middle: attributes + derived stats -----------------------------------
    L.add(text(this, 340, 66, 'Attributes', { color: COLORS.dim }));
    const pts = d.unspentPoints;
    L.add(text(this, 610, 66, `Points: ${pts}`, { color: pts > 0 ? COLORS.gold : COLORS.dim }).setOrigin(1, 0));
    const weapon = WEAPONS[d.weaponId];
    ATTRIBUTE_KEYS.forEach((k, i) => {
      const y = 96 + i * 44;
      const info = ATTRIBUTE_INFO[k];
      const label = text(this, 340, y + 6, info.name).setInteractive();
      label.on('pointerover', () => this.setInfo(`${info.name}: ${info.description}`));
      L.add(label);
      const bonus = weapon.bonus[k] ?? 0;
      L.add(text(this, 478, y + 6, String(d.attributes[k]), { fontSize: '18px' }).setOrigin(0.5, 0));
      if (bonus) {
        L.add(text(this, 500, y + 9, `${bonus > 0 ? '+' : ''}${bonus}`, { fontSize: '13px', color: bonus > 0 ? COLORS.good : COLORS.bad }));
      }
      L.add(button(this, 534, y, 34, 32, '−', () => this.adjust(k, -1), { enabled: d.attributes[k] > this.floor[k], fontSize: 20 }));
      L.add(button(this, 574, y, 34, 32, '+', () => this.adjust(k, 1), { enabled: pts > 0 && d.attributes[k] < MAX_ATTRIBUTE, fontSize: 20 }));
    });

    L.add(text(this, 340, 324, 'Battle stats', { color: COLORS.dim }));
    const s = deriveStats(d);
    const rows: [string, number | string][] = [
      ['Max HP', s.maxHp], ['Move', s.move],
      ['Phys. power', s.physPower], ['Magic power', s.magPower],
      ['Defense', s.defense], ['Resistance', s.resistance],
      ['Speed', s.speed], ['Crit %', s.crit],
      ['Hit bonus', `+${s.accuracy}`], ['Range', `${weapon.minRange}-${weapon.maxRange}`],
    ];
    L.add(panel(this, 340, 348, 270, 172));
    rows.forEach(([name, value], i) => {
      const x = 352 + (i % 2) * 132;
      const y = 358 + Math.floor(i / 2) * 32;
      L.add(text(this, x, y, name, { fontSize: '13px', color: COLORS.dim }));
      L.add(text(this, x + 120, y, String(value), { fontSize: '15px' }).setOrigin(1, 0));
    });

    // ---- Right: weapon + skills -----------------------------------------------
    L.add(text(this, 636, 66, 'Weapon', { color: COLORS.dim }));
    cls.weapons.forEach((wid, i) => {
      const w = WEAPONS[wid];
      L.add(button(this, 636, 90 + i * 42, 300, 36, `${w.name}  (${w.damageType === 'magical' ? 'mag' : 'phys'} ${w.power}, rng ${w.minRange}-${w.maxRange})`, () => {
        d.weaponId = wid;
        this.render();
      }, { selected: d.weaponId === wid, fontSize: 14, onHover: () => this.setInfo(`${w.name}: ${w.description}${this.bonusText(w.bonus)}`) }));
    });

    const slots = skillSlots(d);
    L.add(text(this, 636, 228, `Skills  ${d.skillIds.length}/${slots}`, { color: COLORS.dim }));
    L.add(text(this, 936, 228, 'more slots at Lv 3 and 6', { color: COLORS.dim, fontSize: '12px' }).setOrigin(1, 0));
    cls.skills.forEach((sid, i) => {
      const sk = SKILLS[sid];
      const on = d.skillIds.includes(sid);
      L.add(button(this, 636, 252 + i * 42, 300, 36, `${on ? '✔ ' : ''}${sk.name}  (cd ${sk.cooldown})`, () => this.toggleSkill(sid), {
        selected: on, fontSize: 14,
        onHover: () => this.setInfo(`${sk.name}: ${sk.description} Cooldown: ${sk.cooldown} turn${sk.cooldown > 1 ? 's' : ''}.`),
      }));
    });


    // ---- Bottom buttons ---------------------------------------------------------
    L.add(button(this, 340, 560, 270, 50, 'Cancel', () => this.scene.start('Camp')));
    L.add(button(this, 636, 560, 300, 50, creating ? 'Recruit' : 'Save changes', () => this.confirm(), { fill: 0x2c4a2f, fontSize: 18 }));
    if (creating && pts === CREATION_POINTS) {
      L.add(text(this, 340, 528, `Tip: spend your ${CREATION_POINTS} points with + to shape your build.`, { fontSize: '13px', color: COLORS.gold }));
    }
  }

  private bonusText(bonus: Partial<Attributes>): string {
    const parts = Object.entries(bonus).map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${k.toUpperCase()}`);
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  private setInfo(info: string): void {
    this.infoText.setText(info).setColor(COLORS.text);
  }

  private setClass(id: ClassId): void {
    if (this.mode !== 'create' || id === this.draft.classId) return;
    const fresh = createCharacter(this.draft.name, id, this.draft.appearance.color);
    fresh.id = this.draft.id;
    fresh.appearance = this.draft.appearance;
    this.draft = fresh;
    this.floor = { ...fresh.attributes };
    this.render();
  }

  private adjust(k: keyof Attributes, delta: number): void {
    const d = this.draft;
    if (delta > 0 && d.unspentPoints > 0 && d.attributes[k] < MAX_ATTRIBUTE) {
      d.attributes[k] += 1;
      d.unspentPoints -= 1;
    } else if (delta < 0 && d.attributes[k] > this.floor[k]) {
      d.attributes[k] -= 1;
      d.unspentPoints += 1;
    }
    this.render();
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
    if (!d.name) return toast(this, 'Give your character a name.', COLORS.bad);
    if (d.skillIds.length === 0) return toast(this, 'Equip at least one skill.', COLORS.bad);
    const party = requireState().party;
    if (this.mode === 'create') party.push(d);
    else party[party.findIndex((c) => c.id === d.id)] = d;
    markDirty();
    this.scene.start('Camp');
  }
}
