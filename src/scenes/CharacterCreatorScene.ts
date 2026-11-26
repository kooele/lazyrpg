import Phaser from 'phaser';
import { statEffectPct } from '../game/battle';
import {
  NAME_MAX_LENGTH, PALETTE, isSupport, SKILLS, SKILL_TABS, SKILL_TREES, WEAPONS, xpToNext, maxBodyRank, modeWithTag, resolveWeaponSkill, skillStatText,
} from '../data/content';
import { STAT_CONFIG, visibleStatKeys } from '../data/stats';
import {
  FACE_COUNT, HAIR_COLORS, HAIR_STYLES, SEXES, SKIN_TONES, STAT_INFO, STAT_KEYS, TALENT_GRADES, type Character, type Look, type SkillDef, type SkillTab, type StatKey,
} from '../data/types';
import { HAIR_COLORS as HAIR_HEX, SKIN_TONES as SKIN_HEX } from '../art/unitArt';
import { bodyGain, bodyStats, cloneCharacter, createCharacter, deriveStats, freePoints, isUnlocked, levelStats, pointsUsed, skillPoints } from '../game/character';
import { newCampaign } from '../game/city';
import { PARTY_NAME_MAX_LENGTH } from '../game/save';
import { FACE_NAMES, HAIR_COLOR_NAMES, HAIR_NAMES, SEX_NAMES, SKIN_NAMES, fixLook, randomLook, randomName, randomPartyName } from '../game/people';
import { requireDemo } from '../game/demo';
import { markDirty, requireState, session } from '../game/session';
import { COLORS, ScrollList, Tooltip, button, figure, hex, overlayInput, panel, reachDiagram, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';
import { GUILD } from '../data/guild';
import { skillShape, type ReachContext } from '../game/reach';
import { TALENT_COLORS, growthRate, overallTalent, overallTalentLabel, rollTalents, talentGrowth, talentOf, talentStats } from '../game/talent';

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
  /** Selected subclass (skill tree id) under each class tab. */
  private subTab: Partial<Record<string, string>> = {};
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
  /** Talent grades can be rerolled or set by hand when creating a character and in Quick Battle (not in the campaign's Customize). */
  private get canReroll(): boolean {
    return this.mode === 'main' || this.mode === 'demo' || this.mode === 'demoEdit';
  }

  /** Raise (+1) or lower (-1) one stat's talent grade, F to S. */
  private stepTalent(k: StatKey, delta: number): void {
    const i = TALENT_GRADES.indexOf(talentOf(this.draft, k));
    const next = TALENT_GRADES[Math.max(0, Math.min(TALENT_GRADES.length - 1, i + delta))];
    this.draft.talents = { ...(this.draft.talents ?? {}), [k]: next };
    this.render();
  }

  /** Small ‹ › arrows beside a grade to change it. */
  private gradeArrows(L: Phaser.GameObjects.Container, k: StatKey, x: number, y: number, size: number): void {
    if (!this.canReroll || !talentStats().includes(k)) return;
    const g = talentOf(this.draft, k);
    const arrow = (ax: number, label: string, delta: number, enabled: boolean) => {
      const t = text(this, ax, y - 1, label, { fontSize: `${size + 2}px`, color: enabled ? COLORS.gold : '#3a4058', fontStyle: 'bold' }).setOrigin(0.5, 0);
      if (enabled) {
        t.setInteractive({ useHandCursor: true });
        t.on('pointerup', () => this.stepTalent(k, delta));
        t.on('pointerover', () => this.tooltip.show(`${delta > 0 ? 'Raise' : 'Lower'} ${STAT_INFO[k].name} talent (now ${g}).\n${this.gradeTable()}`));
        t.on('pointerout', () => this.tooltip.hide());
      }
      L.add(t);
    };
    arrow(x - 15, '‹', -1, g !== TALENT_GRADES[0]);
    arrow(x + 15, '›', 1, g !== TALENT_GRADES[TALENT_GRADES.length - 1]);
  }

  /** Tooltip text for a stat row: what it does, where the number comes from, and how its talent grows it. */
  private statInfo(k: StatKey): string {
    const d = this.draft;
    const info = STAT_INFO[k];
    const total = deriveStats(d);
    const fromLevel = levelStats(d.level, d.talents);
    const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
    const trained = (d.body?.[k] ?? 0) * bodyGain(k);
    const before = fromLevel[k] + trained;
    const lines = [`${info.name} (${info.short})`, info.description, '', `Level ${d.level}: ${fromLevel[k]}${trained ? ` + ${trained} Body = ${before}` : ''}${m !== 1 ? ` ${mult(m)} weapon = ${total[k]}` : ''}`];
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
      text(this, 636, 478, 'Party Name (as registered at the guild)', { color: COLORS.dim, fontSize: '13px' });
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
    const weapon = WEAPONS[this.draft.weaponId];
    const raw = SKILLS[weapon.skills[0]];
    const basicMode = (tag: string) => {
      const m = modeWithTag(raw, tag);
      return m && resolveWeaponSkill(m, weapon);
    };
    return { movement: deriveStats(this.draft).movement, basic: resolveWeaponSkill(raw, weapon), basicMode };
  }

  private isSupport(s: SkillDef): boolean {
    return isSupport(s);
  }

  /** Tile diagram for a skill (user in gold, covered tiles in red/green). */
  private diagram(s: SkillDef, maxSize = 96) {
    return reachDiagram(this, skillShape(s, this.reachContext()), this.isSupport(s), maxSize);
  }

  private skillInfo(s: SkillDef): string {
    return `${s.name}\n${skillStatText(s)}`;
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
      if (changed.length === 0) c.add(text(this, 0, my, 'No Stat Changes', { fontSize: '14px', color: COLORS.dim }));
      let mx = 0;
      for (const k of changed) {
        const m = w.statMultipliers[k]!;
        const t = text(this, mx, my, `${mult(m)} ${STAT_INFO[k].short}`, { fontSize: '14px', color: m > 1 ? COLORS.good : COLORS.bad });
        c.add(t);
        mx += t.width + 16;
      }
      c.add(text(this, 0, my + 26, 'Weapon Skills (always equipped)', { fontSize: '12px', color: COLORS.dim }));
      items.push({ obj: c, height: my + 42 });
    }
    const skillItem = (sid: string, note = '') => {
      const s = SKILLS[sid];
      const c = this.add.container(0, 0);
      const name = text(this, 0, 0, `${s.name}${note}`, { fontSize: '15px' }).setInteractive();
      name.on('pointerover', () => this.showSkill(s)).on('pointerout', () => this.tooltip.hide());
      c.add(name);
      const stats = text(this, 0, 21, skillStatText(s), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 196 }, lineSpacing: 1 });
      c.add(stats);
      const mini = this.diagram(s, 56);
      mini.container.setPosition(266 - mini.size, 2);
      c.add(mini.container);
      items.push({ obj: c, height: Math.max(28 + stats.height, mini.size + 6) });
    };
    w.skills.forEach((sid, i) => skillItem(sid, i === 0 ? '  (basic attack)' : ''));
    this.weaponList?.destroy();
    this.weaponList = new ScrollList(this, 342, 182, 272, 358, 10);
    this.weaponList.setItems(items, 'top');
    if (this.weaponScroll.weaponId === w.id) this.weaponList.scrollBy(this.weaponScroll.offset);
    this.weaponScroll = { weaponId: w.id, offset: this.weaponList.getOffset() };
    this.weaponList.onChange = (offset) => {
      this.weaponScroll = { weaponId: w.id, offset };
    };

    // ---- Right: skill trees (hover a skill for details) --------------------------------
    const points = skillPoints(d);
    const free = freePoints(d);
    L.add(text(this, 636, 66, `Skill Points  ${pointsUsed(d)}/${points}`, { color: free > 0 ? COLORS.gold : COLORS.dim }));
    [...SKILL_TABS, { id: 'body', name: 'Body' }].forEach((t, i) => {
      L.add(button(this, 636 + i * 102, 90, 96, 30, t.name, () => {
        this.tab = t.id;
        this.render();
      }, { selected: this.tab === t.id, fontSize: 14 }));
    });
    if (this.tab === 'body') {
      this.bodyTab(L);
    } else {
      this.skillTab(L);
    }
    // ---- Bottom buttons -------------------------------------------------------------
    L.add(button(this, 330, 560, 290, 50, 'Cancel', () => this.leave()));
    L.add(button(this, 636, 560, 300, 50, this.mode === 'main' ? `Begin in ${GUILD.city}` : this.mode === 'demo' ? 'Recruit' : 'Save Changes', () => this.confirm(), { fill: 0x2c4a2f, fontSize: 18 }));
  }

  /** A class tab: a second row of subclass tabs, then the selected subclass's skills. Click a skill to learn it (1 point) or unlearn it. */
  private skillTab(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    const trees = SKILL_TREES.filter((t) => t.tab === this.tab);
    const tree = trees.find((t) => t.id === this.subTab[this.tab]) ?? trees[0];
    if (!tree) return;
    // Subclass tabs, lined up with the class tabs above (same edges and gap).
    const subX = 636, subW = 300, gap = 6;
    const w = (subW - gap * (trees.length - 1)) / trees.length;
    trees.forEach((t, i) => {
      const learned = t.skills.filter((sid) => d.skillIds.includes(sid)).length;
      const label = w < 90 ? t.name.replace(' ', '\n') : t.name;
      L.add(button(this, subX + i * (w + gap), 126, w, 34, `${label}${learned ? ` (${learned})` : ''}`, () => {
        this.subTab[this.tab] = t.id;
        this.render();
      }, { selected: t.id === tree.id, fontSize: 12 }));
    });
    let ty = 168;
    // The main character's screen also has the party name field from y=478.
    const bottom = this.mode === 'main' ? 474 : 550;
    const rowH = Math.max(22, Math.min(34, Math.floor((bottom - ty - 40) / Math.max(1, tree.skills.length))));
    for (const sid of tree.skills) {
      const s = SKILLS[sid];
      const on = d.skillIds.includes(sid);
      const locked = !isUnlocked(d, sid);
      const label = locked ? `${s.name}  (Lv ${s.level} Req.)` : `${on ? '✔ ' : ''}${s.name}${s.level > 1 ? ` (Lv ${s.level})` : ''}`;
      L.add(button(this, subX, ty, subW, rowH - 4, label, () => this.toggleSkill(sid), {
        selected: on, enabled: !locked, fontSize: rowH < 30 ? 13 : 14, onHover: () => this.showSkill(s), onOut: () => this.tooltip.hide(),
      }));
      ty += rowH;
    }
    // Picks from other subclasses, so mixing is visible.
    const otherPicks = d.skillIds.filter((sid) => !tree.skills.includes(sid) && SKILL_TREES.some((t) => t.skills.includes(sid)));
    if (otherPicks.length) {
      const where = (sid: string) => SKILL_TREES.find((t) => t.skills.includes(sid))!.name;
      L.add(text(this, subX, ty + 4, `Also Equipped: ${otherPicks.map((sid) => `${SKILLS[sid].name} (${where(sid)})`).join(', ')}`, {
        fontSize: '12px', color: COLORS.dim, wordWrap: { width: subW },
      }));
    }
  }

  /** The Body tab: put skill points into stats. Each point adds twice the stat's base growth per level. */
  private bodyTab(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    const cap = maxBodyRank(d.level);
    L.add(text(this, 636, 120, `Each point trains a stat by 2 levels of base growth. Max ${cap} per stat at level ${d.level} (level / 3, rounded up).`, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 300 } }));
    const free = freePoints(d);
    bodyStats().forEach((k, i) => {
      const y = 150 + i * 36;
      const n = d.body?.[k] ?? 0;
      const gain = bodyGain(k);
      const info = STAT_INFO[k];
      const row = this.add.rectangle(636, y, 300, 32, COLORS.panelLight, n ? 0.9 : 0.4).setOrigin(0).setStrokeStyle(1, n ? COLORS.accent : COLORS.border);
      L.add(this.tip(row, () => `${info.name} (${info.short})\n${info.description}\n\nEach point: +${gain} ${info.short} (2 x base growth ${STAT_CONFIG.growthPerLevel[k]}).\n${n ? `Invested ${n}: +${gain * n} ${info.short}.` : 'Not trained yet.'}\nMax rank ${cap} at level ${d.level}.`));
      L.add(text(this, 646, y + 8, info.name, { fontSize: '14px' }));
      L.add(text(this, 766, y + 9, `+${gain} Each`, { fontSize: '12px', color: COLORS.dim }));
      L.add(button(this, 836, y + 4, 26, 24, '−', () => this.invest(k, -1), { fontSize: 15, enabled: n > 0 }));
      L.add(text(this, 880, y + 7, `${n}/${cap}`, { fontSize: '13px', color: n ? COLORS.gold : COLORS.dim }).setOrigin(0.5, 0));
      L.add(button(this, 900, y + 4, 26, 24, '+', () => this.invest(k, 1), { fontSize: 15, enabled: free > 0 && n < cap }));
    });
  }

  private invest(k: StatKey, delta: number): void {
    const d = this.draft;
    const n = (d.body?.[k] ?? 0) + delta;
    if (delta > 0 && freePoints(d) <= 0) return toast(this, 'No skill points left. Unlearn a skill or a Body point first.', COLORS.bad);
    if (n < 0) return;
    if (delta > 0 && n > maxBodyRank(d.level)) return toast(this, `${STAT_INFO[k].name} is at its max rank (${maxBodyRank(d.level)}) for level ${d.level}.`, COLORS.bad);
    d.body = { ...(d.body ?? {}), [k]: n };
    if (!n) delete d.body[k];
    if (!Object.keys(d.body).length) delete d.body;
    this.render();
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
    label(298, 'Hair Color');
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
      L.add(button(this, 30, 362, 100, 22, 'Reroll Talent', () => this.reroll(), {
        fontSize: 12, ...this.hoverTip(() => `Roll new talent grades (F to S) for every growing stat.\nOr set each one with the ‹ › arrows next to it.\nTalent sets how fast a stat grows with level:\n${this.gradeTable()}\n\nOverall talent now: ${overallTalentLabel(d)}`),
      }));
    }
    const total = deriveStats(d);
    // Rows shrink to fit however many stats are shown.
    const keys = visibleStatKeys();
    const rowH = Math.min(24, Math.floor(134 / keys.length));
    const fs = rowH >= 20 ? 14 : 13;
    keys.forEach((k: StatKey, i) => {
      const y = 410 + i * rowH;
      const m = WEAPONS[d.weaponId].statMultipliers[k] ?? 1;
      const row = this.add.rectangle(136, y - 1, 172, rowH, 0xffffff, 0).setOrigin(0);
      L.add(this.tip(row, () => this.statInfo(k)));
      L.add(text(this, 142, y, STAT_INFO[k].short, { fontSize: `${fs}px` }));
      this.grade(L, k, 198, y, fs);
      this.gradeArrows(L, k, 198, y, fs);
      L.add(text(this, 246, y, String(total[k]), { fontSize: `${fs}px` }).setOrigin(1, 0));
      const pct = statEffectPct(k, total[k]);
      if (pct !== null) L.add(text(this, 248, y + 1, `(${pct}%)`, { fontSize: '10px', color: COLORS.dim }));
      if (m !== 1) L.add(text(this, 282, y, mult(m), { fontSize: '12px', color: m > 1 ? COLORS.good : COLORS.bad }));
    });
  }

  /** A party member's preview and stats (their look can't be changed). */
  private previewAndStats(L: Phaser.GameObjects.Container, top: number): void {
    const d = this.draft;
    L.add(panel(this, 24, top, 290, 120));
    L.add(figure(this, 70, top + 108, 100, d.appearance, d.weaponId));
    L.add(text(this, 124, top + 14, d.name, { fontSize: '18px', wordWrap: { width: 182 } }));
    L.add(text(this, 124, top + 40, `Level ${d.level} · ${d.xp}/${xpToNext(d.level)} XP`, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 124, top + 60, WEAPONS[d.weaponId].name, { color: COLORS.dim, fontSize: '13px' }));
    L.add(text(this, 124, top + 84, 'Only your own character\'s look can be changed.', { color: COLORS.dim, fontSize: '11px', wordWrap: { width: 182 } }));
    const y0 = top + 132;
    L.add(panel(this, 24, y0, 290, 548 - y0));
    L.add(text(this, 36, y0 + 8, 'Stats', { color: COLORS.dim, fontSize: '14px' }));
    L.add(text(this, 300, y0 + 8, `Talent ${overallTalentLabel(d)}`, { color: TALENT_COLORS[overallTalent(d)], fontSize: '14px' }).setOrigin(1, 0));
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
      const pct = statEffectPct(k, total[k]);
      if (pct !== null) L.add(text(this, 224, y + 2, `(${pct}%)`, { fontSize: '13px', color: COLORS.dim }));
      if (m !== 1) L.add(text(this, 269, y + 2, mult(m), { fontSize: '13px', color: m > 1 ? COLORS.good : COLORS.bad }));
    });
  }

  private toggleSkill(id: string): void {
    const d = this.draft;
    if (d.skillIds.includes(id)) {
      d.skillIds = d.skillIds.filter((s) => s !== id);
    } else if (!isUnlocked(d, id)) {
      toast(this, `${SKILLS[id].name} unlocks at level ${SKILLS[id].level}.`, COLORS.bad);
      return;
    } else if (freePoints(d) > 0) {
      d.skillIds.push(id);
    } else {
      toast(this, 'No skill points left. Unlearn a skill or a Body point first.', COLORS.bad);
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
