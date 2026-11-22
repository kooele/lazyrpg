import Phaser from 'phaser';
import {
  NAME_MAX_LENGTH, PALETTE, isSupport, SKILLS, SKILL_TABS, SKILL_TREES, WEAPONS, XP_PER_LEVEL, skillDetails, skillFormula, tagNames,
} from '../data/content';
import { STAT_CONFIG, visibleStatKeys } from '../data/stats';
import {
  FACE_COUNT, HAIR_COLORS, HAIR_STYLES, SEXES, SKIN_TONES, STAT_INFO, STAT_KEYS, TALENT_GRADES, type Character, type Look, type SkillDef, type SkillTab, type StatKey,
} from '../data/types';
import { HAIR_COLORS as HAIR_HEX, SKIN_TONES as SKIN_HEX } from '../art/unitArt';
import { cloneCharacter, createCharacter, deriveStats, levelStats, skillSlots } from '../game/character';
import { newCampaign } from '../game/city';
import { PARTY_NAME_MAX_LENGTH } from '../game/save';
import { FACE_NAMES, HAIR_COLOR_NAMES, HAIR_NAMES, SEX_NAMES, SKIN_NAMES, fixLook, randomLook, randomName, randomPartyName } from '../game/people';
import { requireDemo } from '../game/demo';
import { markDirty, requireState, session } from '../game/session';
import { COLORS, ScrollList, Tooltip, button, figure, hex, overlayInput, panel, reachDiagram, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';
import { GUILD } from '../data/guild';
import { skillShape, type ReachContext } from '../game/reach';
import { TALENT_COLORS, growthRate, overallTalent, rollTalents, talentGrowth, talentOf, talentStats } from '../game/talent';

interface CreatorData {
  /** main: create the main character for a new game. edit: change a party member's loadout (and the main character's look). */
  mode: 'main' | 'edit' | 'demo' | 'demoEdit';
  characterId?: string;
}

/** "x0.8" style multiplier label. */
const mult = (m: number) => `x${Number(m.toFixed(2))}`;

/** Create the main character (name, look, party name) or customize a member's weapon and skill picks. */
export class CharacterCreatorScene extends Phaser.Scene {
  private mode: CreatorData['mode'] = 'main';
  private partyName = '';
  private partyInput: HTMLInputElement | null = null;
  private draft!: Character;
  private tab: SkillTab = 'mage';
  private layer!: Phaser.GameObjects.Container;
  private nameInput!: HTMLInputElement;
  private tooltip!: Tooltip;
  private weaponList: ScrollList | null = null;
  /** Remember the weapon panel's scroll position across re-renders. */
  private weaponScroll = { weaponId: '', offset: 0 };

  constructor() {
    super('CharacterCreator');
  }

  init(data: CreatorData): void {
    this.mode = data.mode ?? 'main';
    if (this.mode === 'edit' || this.mode === 'demoEdit') {
      const list = this.mode === 'edit' ? requireState().party : requireDemo().party;
      const existing = list.find((c) => c.id === data.characterId);
      if (!existing) throw new Error('Adventurer not found');
      this.draft = cloneCharacter(existing);
    } else {
      const look = randomLook(Math.random);
      const weapons = Object.keys(WEAPONS);
      const n = this.mode === 'demo' ? requireDemo().party.length : 0;
      this.draft = createCharacter(randomName(look.sex, Math.random), PALETTE[Math.floor(Math.random() * PALETTE.length)], weapons[n % weapons.length], look, rollTalents(Math.random));
      this.partyName = randomPartyName(Math.random);
    }
  }

  /** Talents can be rerolled while making a new character (main character or Quick Battle recruit). */
  private get canReroll(): boolean {
    return this.mode === 'main' || this.mode === 'demo';
  }

  /** Tooltip text for a stat row: what it does, where the number comes from, and how its talent grows it. */
  private statInfo(k: StatKey): string {
    const d = this.draft;
    const info = STAT_INFO[k];
    const total = deriveStats(d);
    const fromLevel = levelStats(d.level, d.talents);
    const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
    const lines = [`${info.name} (${info.short})`, info.description, '', `Level ${d.level}: ${fromLevel[k]}${m !== 1 ? ` ${mult(m)} weapon = ${total[k]}` : ''}`];
    if (talentStats().includes(k)) {
      const g = talentOf(d, k);
      const per = talentGrowth(d, k);
      lines.push(`Talent ${g}: ${Math.round(growthRate(g) * 100)}% growth = +${Number(per.toFixed(1))} per level`);
    } else {
      lines.push("Doesn't grow with level.");
    }
    return lines.join('\n');
  }

  /** The talent grade drawn next to a stat (nothing for stats that don't grow). */
  private grade(L: Phaser.GameObjects.Container, k: StatKey, x: number, y: number, size: number): void {
    if (!talentStats().includes(k)) return;
    const g = talentOf(this.draft, k);
    L.add(text(this, x, y, g, { fontSize: `${size}px`, color: TALENT_COLORS[g], fontStyle: 'bold' }).setOrigin(0.5, 0));
  }

  private hoverTip(info: () => string) {
    return { onHover: () => this.tooltip.show(info()), onOut: () => this.tooltip.hide() };
  }

  /** "S 160% (5%) · A 140% (10%) ..." one grade per line. */
  private gradeTable(): string {
    const t = STAT_CONFIG.talent;
    return [...TALENT_GRADES].reverse().map((g) => `${g}: ${Math.round(t.growthRate[g] * 100)}% growth (${Math.round(t.chance[g] * 100)}% chance)`).join('\n');
  }

  private reroll(): void {
    this.draft.talents = rollTalents(Math.random);
    this.render();
  }

  /** Only your own character's look can change. */
  private get lookEditable(): boolean {
    return this.mode !== 'edit' || (session.state?.mainId === this.draft.id);
  }

  create(): void {
    this.weaponList = null;
    setupCamera(this, 0x111522);
    const title = this.mode === 'main' ? 'Your Character' : this.mode === 'demo' ? 'New Adventurer' : `Customize ${this.draft.name}`;
    text(this, 480, 30, title, { fontSize: '30px', color: COLORS.gold }).setOrigin(0.5);

    // Name field is a real HTML input so typing works everywhere (incl. mobile keyboards).
    text(this, 24, 66, 'Name', { color: COLORS.dim });
    const input = overlayInput(this, 24, 90, 290, 36);
    input.maxLength = NAME_MAX_LENGTH;
    input.value = this.draft.name;
    input.disabled = !this.lookEditable;
    input.addEventListener('input', () => {
      this.draft.name = input.value;
      this.render();
    });
    this.nameInput = input;
    this.partyInput = null;
    if (this.mode === 'main') {
      text(this, 636, 478, 'Party name (as registered at the guild)', { color: COLORS.dim, fontSize: '13px' });
      const p = overlayInput(this, 636, 498, 300, 36);
      p.maxLength = PARTY_NAME_MAX_LENGTH;
      p.value = this.partyName;
      p.addEventListener('input', () => (this.partyName = p.value));
      this.partyInput = p;
    }

    this.tooltip = new Tooltip(this);
    this.render();
  }

  /** What this adventurer's Movement / weapon-scaled skills reach. */
  private reachContext(): ReachContext {
    return { movement: deriveStats(this.draft).movement, basic: SKILLS[WEAPONS[this.draft.weaponId].skills[0]] };
  }

  private isSupport(s: SkillDef): boolean {
    return isSupport(s);
  }

  /** Tile diagram for a skill (user in gold, covered tiles in red/green). */
  private diagram(s: SkillDef, maxSize = 96) {
    return reachDiagram(this, skillShape(s, this.reachContext()), this.isSupport(s), maxSize);
  }

  private skillInfo(s: SkillDef): string {
    const shape = skillShape(s, this.reachContext());
    const note = shape.kind === 'cone' ? '\nShown facing right; aim it any way.'
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

    // ---- Left: look (main character), preview, stats ------------------------------------
    if (this.lookEditable) this.lookPickers(L);
    else this.previewAndStats(L, 132);

    // ---- Middle: weapon -------------------------------------------------------------
    L.add(text(this, 330, 66, 'Weapon', { color: COLORS.dim }));
    Object.values(WEAPONS).forEach((w, i) => {
      L.add(button(this, 330 + (i % 2) * 149, 90 + Math.floor(i / 2) * 40, 141, 34, w.name, () => {
        d.weaponId = w.id;
        this.render();
      }, { selected: d.weaponId === w.id, fontSize: 14, ...hover(() => `${w.name}\n${w.description}`) }));
    });
    // Weapon details scroll (wheel or drag the bar) so descriptions can be as long as needed.
    const w = WEAPONS[d.weaponId];
    L.add(panel(this, 330, 172, 290, 376));
    const items: ScrollItem[] = [];
    {
      const c = this.add.container(0, 0);
      c.add(text(this, 0, 0, w.name, { fontSize: '18px', color: COLORS.gold }));
      const wdesc = text(this, 0, 24, w.description, { fontSize: '13px', color: COLORS.dim, wordWrap: { width: 258 } });
      c.add(wdesc);
      const my = 24 + wdesc.height + 6;
      const changed = STAT_KEYS.filter((k) => (w.statMultipliers[k] ?? 1) !== 1);
      if (changed.length === 0) c.add(text(this, 0, my, 'No stat changes', { fontSize: '14px', color: COLORS.dim }));
      let mx = 0;
      for (const k of changed) {
        const m = w.statMultipliers[k]!;
        const t = text(this, mx, my, `${mult(m)} ${STAT_INFO[k].short}`, { fontSize: '14px', color: m > 1 ? COLORS.good : COLORS.bad });
        c.add(t);
        mx += t.width + 16;
      }
      c.add(text(this, 0, my + 26, 'Weapon skills (always equipped)', { fontSize: '12px', color: COLORS.dim }));
      items.push({ obj: c, height: my + 42 });
    }
    w.skills.forEach((sid, i) => {
      const s = SKILLS[sid];
      const c = this.add.container(0, 0);
      const name = text(this, 0, 0, `${s.name}${i === 0 ? '  (basic)' : ''}`, { fontSize: '15px' }).setInteractive();
      name.on('pointerover', () => this.showSkill(s)).on('pointerout', () => this.tooltip.hide());
      c.add(name);
      c.add(text(this, 0, 19, skillDetails(s), { fontSize: '11px', color: COLORS.gold }));
      const desc = text(this, 0, 34, s.description, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 190 } });
      c.add(desc);
      const mini = this.diagram(s, 56);
      mini.container.setPosition(266 - mini.size, 2);
      c.add(mini.container);
      items.push({ obj: c, height: Math.max(40 + desc.height, mini.size + 6) });
    });
    this.weaponList?.destroy();
    this.weaponList = new ScrollList(this, 342, 182, 272, 358, 10);
    this.weaponList.setItems(items, 'top');
    if (this.weaponScroll.weaponId === w.id) this.weaponList.scrollBy(this.weaponScroll.offset);
    this.weaponScroll = { weaponId: w.id, offset: this.weaponList.getOffset() };
    this.weaponList.onChange = (offset) => {
      this.weaponScroll = { weaponId: w.id, offset };
    };

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
    L.add(button(this, 330, 560, 290, 50, 'Cancel', () => this.leave()));
    L.add(button(this, 636, 560, 300, 50, this.mode === 'main' ? `Begin in ${GUILD.city}` : this.mode === 'demo' ? 'Recruit' : 'Save changes', () => this.confirm(), { fill: 0x2c4a2f, fontSize: 18 }));
  }

  /** Sex, skin, face, hair and colours, then a preview with the stats beside it. */
  private lookPickers(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    const look = d.appearance.look!;
    const setLook = (patch: Partial<Look>) => {
      d.appearance.look = fixLook({ ...look, ...patch });
      this.render();
    };
    const label = (y: number, t: string) => L.add(text(this, 24, y + 3, t, { color: COLORS.dim, fontSize: '13px' }));
    const swatch = (x: number, y: number, w: number, h: number, color: string, selected: boolean, info: string, onPick: () => void) => {
      const r = this.add.rectangle(x, y, w, h, hex(color)).setOrigin(0).setStrokeStyle(3, selected ? 0xffffff : 0x222222);
      this.tip(r, () => info).on('pointerup', onPick);
      r.input!.cursor = 'pointer';
      L.add(r);
    };
    label(128, 'Sex');
    SEXES.forEach((sex, i) => L.add(button(this, 100 + i * 108, 128, 104, 24, SEX_NAMES[sex], () => setLook({ sex }), { selected: look.sex === sex, fontSize: 13 })));
    label(158, 'Skin');
    SKIN_TONES.forEach((skin, i) => swatch(100 + i * 36, 158, 32, 22, SKIN_HEX[skin], look.skin === skin, `Skin: ${SKIN_NAMES[skin]}`, () => setLook({ skin })));
    label(188, 'Face');
    for (let f = 1; f <= FACE_COUNT; f++) {
      L.add(button(this, 100 + (f - 1) * 54, 188, 50, 24, FACE_NAMES[look.sex][f - 1], () => setLook({ face: f }), { selected: look.face === f, fontSize: 11 }));
    }
    label(218, 'Hair');
    const styles = HAIR_STYLES[look.sex];
    styles.forEach((hair, i) => L.add(button(this, 100 + (i % 2) * 108, 218 + Math.floor(i / 2) * 25, 104, 22, HAIR_NAMES[hair], () => setLook({ hair }), {
      selected: look.hair === hair, fontSize: 12,
    })));
    label(298, 'Hair color');
    HAIR_COLORS.forEach((hc, i) => swatch(100 + i * 30, 298, 26, 20, HAIR_HEX[hc], look.hairColor === hc, `Hair: ${HAIR_COLOR_NAMES[hc]}`, () => setLook({ hairColor: hc })));
    label(326, 'Clothes');
    PALETTE.forEach((color, i) => swatch(100 + i * 27, 326, 24, 20, color, d.appearance.color === color, 'Clothes and the disc you stand on', () => {
      d.appearance.color = color;
      this.render();
    }));
    L.add(button(this, 236, 66, 78, 22, 'Random', () => {
      d.appearance.look = randomLook(Math.random, look.sex);
      d.appearance.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      this.render();
    }, { fontSize: 12 }));

    L.add(panel(this, 24, 356, 290, 192));
    L.add(figure(this, 78, 538, 160, d.appearance, d.weaponId));
    L.add(text(this, 140, 366, d.name.trim() || '(no name)', { fontSize: '16px', wordWrap: { width: 168 } }));
    L.add(text(this, 140, 388, `Level ${d.level} · ${WEAPONS[d.weaponId].name}`, { color: COLORS.dim, fontSize: '12px', wordWrap: { width: 168 } }));
    if (this.canReroll) {
      L.add(button(this, 30, 362, 100, 22, 'Reroll talent', () => this.reroll(), {
        fontSize: 12, ...this.hoverTip(() => `Roll new talent grades (F to S) for every growing stat.\nTalent sets how fast a stat grows with level:\n${this.gradeTable()}\n\nOverall talent now: ${overallTalent(d)}`),
      }));
    }
    const total = deriveStats(d);
    visibleStatKeys().forEach((k: StatKey, i) => {
      const y = 418 + i * 24;
      const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
      const row = this.add.rectangle(136, y - 3, 172, 22, 0xffffff, 0).setOrigin(0);
      L.add(this.tip(row, () => this.statInfo(k)));
      L.add(text(this, 142, y, STAT_INFO[k].short, { fontSize: '14px' }));
      this.grade(L, k, 202, y, 14);
      L.add(text(this, 250, y, String(total[k]), { fontSize: '14px' }).setOrigin(1, 0));
      if (m !== 1) L.add(text(this, 258, y + 1, mult(m), { fontSize: '12px', color: m > 1 ? COLORS.good : COLORS.bad }));
    });
  }

  /** A party member's preview and stats (their look can't be changed). */
  private previewAndStats(L: Phaser.GameObjects.Container, top: number): void {
    const d = this.draft;
    L.add(panel(this, 24, top, 290, 120));
    L.add(figure(this, 70, top + 108, 100, d.appearance, d.weaponId));
    L.add(text(this, 124, top + 14, d.name, { fontSize: '18px', wordWrap: { width: 182 } }));
    L.add(text(this, 124, top + 40, `Level ${d.level} · ${d.xp}/${XP_PER_LEVEL} XP`, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 124, top + 60, WEAPONS[d.weaponId].name, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 124, top + 84, 'Only your own character\'s look can be changed.', { color: COLORS.dim, fontSize: '11px', wordWrap: { width: 182 } }));
    const y0 = top + 132;
    L.add(panel(this, 24, y0, 290, 548 - y0));
    L.add(text(this, 36, y0 + 8, 'Stats', { color: COLORS.dim, fontSize: '14px' }));
    L.add(text(this, 300, y0 + 8, `Talent ${overallTalent(d)}`, { color: TALENT_COLORS[overallTalent(d)], fontSize: '14px' }).setOrigin(1, 0));
    const shown = visibleStatKeys();
    const rowH = Math.min(36, Math.floor((548 - y0 - 50) / shown.length));
    shown.forEach((k: StatKey, i) => {
      const y = y0 + 36 + i * rowH;
      const info = STAT_INFO[k];
      const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
      const total = deriveStats(d);
      const row = this.add.rectangle(30, y - 4, 278, rowH - 2, 0xffffff, 0).setOrigin(0);
      L.add(this.tip(row, () => this.statInfo(k)));
      L.add(text(this, 40, y, info.name, { fontSize: '15px' }));
      this.grade(L, k, 166, y, 15);
      L.add(text(this, 220, y, String(total[k]), { fontSize: '16px' }).setOrigin(1, 0));
      if (m !== 1) L.add(text(this, 232, y + 2, mult(m), { fontSize: '13px', color: m > 1 ? COLORS.good : COLORS.bad }));
    });
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

  private leave(): void {
    if (this.mode === 'main') this.scene.start('MainMenu');
    else if (this.mode === 'demo' || this.mode === 'demoEdit') this.scene.start('DemoCamp');
    else this.scene.start('Party', { selected: this.draft.id });
  }

  private confirm(): void {
    const d = this.draft;
    d.name = this.nameInput.value.trim();
    if (!d.name) return toast(this, 'Give your character a name.', COLORS.bad);
    if (this.mode === 'main') {
      const partyName = (this.partyInput?.value ?? this.partyName).trim();
      if (!partyName) return toast(this, 'Give your party a name.', COLORS.bad);
      session.state = newCampaign(d, partyName, Math.random);
      session.dirty = true;
      this.scene.start('City');
      return;
    }
    if (this.mode === 'demo' || this.mode === 'demoEdit') {
      const party = requireDemo().party;
      if (this.mode === 'demo') party.push(d);
      else party[party.findIndex((c) => c.id === d.id)] = d;
      this.scene.start('DemoCamp');
      return;
    }
    const party = requireState().party;
    party[party.findIndex((c) => c.id === d.id)] = d;
    markDirty();
    this.scene.start('Party', { selected: d.id });
  }
}
