import Phaser from 'phaser';
import { penLine, statEffectPct } from '../game/battle';
import {
  BASIC_SKILLS, NAME_MAX_LENGTH, PALETTE, isSupport, SKILLS, SKILL_TABS, SKILL_TREES, WEAPONS, WEAPON_TYPES, xpToNext, maxBodyRank, modeWithTag, resolveWeaponSkill, skillStatText,
} from '../data/content';
import { STAT_CONFIG, visibleStatKeys } from '../data/stats';
import {
  FACE_COUNT, HAIR_COLORS, HAIR_STYLES, SEXES, SKIN_TONES, STAT_INFO, TALENT_GRADES, type Character, type Look, type SkillDef, type SkillTab, type StatKey,
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
import { figureKit, gear, gearBase, gearModifier, weaponName, weaponOf } from '../game/gear';

interface CreatorData {
  /** main: create the main character for a new game. edit: change a party member's look or skills (Manage Party). */
  mode: 'main' | 'edit' | 'demo' | 'demoEdit';
  /** edit: which screen (Customize or Skills); there are no page tabs then. */
  page?: Page;
  characterId?: string;
}

/** "x0.8" style multiplier label. */
const mult = (m: number) => `x${Number(m.toFixed(2))}`;

type Page = 'customize' | 'skills';
const PAGES: Page[] = ['customize', 'skills'];
const PAGE_NAMES: Record<Page, string> = { customize: 'Customize', skills: 'Skills' };

/**
 * Create the main character (name, look, party name, starting weapon) or change a member's loadout, on two pages:
 * Customize (name, look, stats and talent) and Skills (weapon skills, skill trees, the Body tab).
 */
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
  /** Which page is showing: name, look and stats, or skills. */
  private page: Page = 'customize';
  /** In the campaign (Manage Party's Customize / Skills buttons), the one page shown, with no tabs. */
  private fixedPage: Page | null = null;
  /** The skill shown in the Skills page's details panel (the last one hovered). */
  private focus: string | null = null;
  private detail: Phaser.GameObjects.Container | null = null;
  private skillList: ScrollList | null = null;

  constructor() {
    super('CharacterCreator');
  }

  init(data: CreatorData): void {
    this.mode = data.mode ?? 'main';
    this.fixedPage = this.mode === 'edit' ? (data.page ?? 'skills') : null;
    if (this.mode === 'edit' || this.mode === 'demoEdit') {
      const list = this.mode === 'edit' ? requireState().party : requireDemo().party;
      const existing = list.find((c) => c.id === data.characterId);
      if (!existing) throw new Error('Adventurer not found');
      this.draft = cloneCharacter(existing);
    } else {
      const look = randomLook(Math.random);
      const weapons = WEAPON_TYPES;
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
    const m = gearModifier(d, k);
    const fromGear = gearBase(d, k);
    const trained = (d.body?.[k] ?? 0) * bodyGain(k);
    const before = fromLevel[k] + trained + fromGear;
    const lines = [`${info.name} (${info.short})`, info.description, '',
      `Level ${d.level}: ${fromLevel[k]}${trained ? ` + ${trained} Body` : ''}${fromGear ? ` + ${fromGear} Gear` : ''}${trained || fromGear ? ` = ${before}` : ''}${m !== 1 ? ` ${mult(m)} Gear = ${total[k]}` : ''}`];
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
    setupCamera(this, 0x111522);
    this.skillList = null;
    this.page = this.fixedPage ?? (this.mode === 'demoEdit' ? 'skills' : 'customize');
    this.focus = null;

    // Name field is a real HTML input so typing works everywhere (incl. mobile keyboards).
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
    const weapon = weaponOf(this.draft)!;
    const raw = SKILLS[weapon.skills[0]];
    const basicMode = (tag: string) => {
      const m = modeWithTag(raw, tag);
      return m && resolveWeaponSkill(m, weapon);
    };
    return { movement: deriveStats(this.draft).movement, basic: resolveWeaponSkill(raw, weapon), basicMode };
  }

  /** Tile diagram for a skill (user in gold, covered tiles in red/green). */
  private diagram(s: SkillDef, maxSize = 96) {
    return reachDiagram(this, skillShape(s, this.reachContext()), isSupport(s), maxSize);
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
    // The weapon skill list lives outside the layer (lists place themselves in the scene).
    this.skillList?.destroy();
    this.skillList = null;
    this.layer?.destroy();
    this.layer = this.add.container(0, 0);
    const L = this.layer;
    const d = this.draft;

    // ---- Title and page tabs ------------------------------------------------------------
    const who = d.name.trim() || '(no name)';
    const title = this.mode === 'main' ? 'Your Character' : this.mode === 'demo' ? 'New Adventurer' : this.fixedPage ? `${PAGE_NAMES[this.fixedPage]}: ${who}` : `Loadout: ${who}`;
    L.add(text(this, 24, 14, title, { fontSize: '28px', color: COLORS.gold }));
    const free = freePoints(d);
    if (!this.fixedPage) PAGES.forEach((pg, i) => {
      L.add(button(this, 724 + i * 108, 14, 104, 34, pg === 'skills' && free > 0 ? `Skills (${free})` : PAGE_NAMES[pg], () => {
        this.page = pg;
        this.render();
      }, { selected: this.page === pg, fontSize: 15 }));
    });
    this.nameInput.style.display = this.page === 'customize' ? '' : 'none';
    if (this.partyInput) this.partyInput.style.display = this.page === 'customize' ? '' : 'none';

    if (this.page === 'customize') this.customizePage(L);
    else this.skillsPage(L);

    // ---- Bottom buttons -------------------------------------------------------------
    L.add(button(this, 330, 560, 290, 50, 'Cancel', () => this.leave()));
    L.add(button(this, 636, 560, 300, 50, this.mode === 'main' ? `Begin in ${GUILD.city}` : this.mode === 'demo' ? 'Recruit' : 'Save Changes', () => this.confirm(), { fill: 0x2c4a2f, fontSize: 18 }));
  }

  // ---- Customize page: name, look, preview, stats ------------------------------------------

  private customizePage(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    L.add(text(this, 24, 66, 'Name', { color: COLORS.dim }));
    if (this.lookEditable) this.lookPickers(L);
    else L.add(text(this, 24, 140, "Only your own character's name and look can be changed.", { color: COLORS.dim, fontSize: '13px', wordWrap: { width: 290 } }));

    // Middle: a big preview.
    L.add(panel(this, 330, 66, 290, 250));
    L.add(figure(this, 475, 300, 200, d.appearance, figureKit(d)));
    L.add(text(this, 342, 74, d.name.trim() || '(no name)', { fontSize: '16px', wordWrap: { width: 266 } }));
    L.add(text(this, 342, 96, `Level ${d.level}${this.mode === 'edit' ? ` · ${d.xp}/${xpToNext(d.level)} XP` : ''}`, { color: COLORS.dim, fontSize: '12px' }));
    // A new character picks a Crude starting weapon; after that, gear is changed in Manage Party > Equipment.
    if (this.mode !== 'edit') this.weaponPicker(L, 330, 330);

    // Right: stats and talent.
    const bottom = this.mode === 'main' ? 470 : 548;
    this.statsPanel(L, 636, 66, 300, bottom - 66, true);
    if (this.mode === 'main') L.add(text(this, 636, 478, 'Party Name (as registered at the guild)', { color: COLORS.dim, fontSize: '13px' }));
  }

  /** Starting weapon buttons (new characters only): a Crude weapon of the chosen type. */
  private weaponPicker(L: Phaser.GameObjects.Container, x: number, y: number): void {
    const d = this.draft;
    L.add(text(this, x, y, 'Starting Weapon (Crude)', { color: COLORS.dim, fontSize: '13px' }));
    WEAPON_TYPES.forEach((id, i) => {
      const w = WEAPONS[id];
      L.add(button(this, x + (i % 3) * 98, y + 22 + Math.floor(i / 3) * 32, 94, 28, w.name, () => {
        d.weapon = gear(w.id, d.weapon?.quality);
        this.render();
      }, { selected: d.weapon?.type === w.id, fontSize: 11, ...this.hoverTip(() => `${w.name} (${w.class} · Range ${w.range})\n${w.description}\nSkills: ${w.skills.map((sid) => SKILLS[sid].name).join(', ')}`) }));
    });
  }

  /** The stat table with talent grades (and, when they can be changed, ‹ › arrows and Reroll Talent). */
  private statsPanel(L: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, withTalent: boolean): void {
    const d = this.draft;
    L.add(panel(this, x, y, w, h));
    L.add(text(this, x + 12, y + 8, 'Stats', { color: COLORS.dim, fontSize: '14px' }));
    if (withTalent) L.add(text(this, x + w - 12, y + 8, `Talent ${overallTalentLabel(d)}`, { color: TALENT_COLORS[overallTalent(d)], fontSize: '14px' }).setOrigin(1, 0));
    let top = y + 34;
    if (withTalent && this.canReroll) {
      L.add(button(this, x + 12, top, 110, 24, 'Reroll Talent', () => this.reroll(), {
        fontSize: 12, ...this.hoverTip(() => `Roll new talent grades (F to S) for every growing stat.\nOr set each one with the ‹ › arrows next to it.\nTalent sets how fast a stat grows with level:\n${this.gradeTable()}\n\nOverall talent now: ${overallTalentLabel(d)}`),
      }));
      top += 32;
    }
    const total = deriveStats(d);
    const pen = penLine(total, '\n');
    const keys = visibleStatKeys();
    const rowH = Math.min(34, Math.floor((y + h - top - (pen ? 40 : 8)) / keys.length));
    const fs = rowH >= 26 ? 15 : rowH >= 20 ? 14 : 13;
    keys.forEach((k: StatKey, i) => {
      const ry = top + i * rowH;
      const row = this.add.rectangle(x + 6, ry - 3, w - 12, rowH - 2, 0xffffff, 0).setOrigin(0);
      L.add(this.tip(row, () => this.statInfo(k)));
      L.add(text(this, x + 16, ry, STAT_INFO[k].name, { fontSize: `${fs}px` }));
      if (withTalent) {
        this.grade(L, k, x + 150, ry, fs);
        this.gradeArrows(L, k, x + 150, ry, fs);
      }
      L.add(text(this, x + 222, ry, String(total[k]), { fontSize: `${fs}px` }).setOrigin(1, 0));
      const pct = statEffectPct(k, total[k]);
      if (pct !== null) L.add(text(this, x + 226, ry + 2, `(${pct}%)`, { fontSize: '12px', color: COLORS.dim }));
    });
    if (pen) L.add(text(this, x + 16, top + keys.length * rowH + 4, pen, { fontSize: '13px', lineSpacing: 2 }));
  }

  // ---- Skills page: weapon skills, skill trees and Body, details ----------------------------------

  private skillsPage(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    // Left: what the weapon gives, and the basic abilities everyone has.
    L.add(panel(this, 24, 66, 290, 482));
    L.add(text(this, 36, 74, 'Weapon Skills', { fontSize: '15px', color: COLORS.gold }));
    L.add(text(this, 302, 76, weaponName(d), { fontSize: '12px', color: COLORS.dim }).setOrigin(1, 0));
    const items: ScrollItem[] = [];
    const skillItem = (sid: string) => items.push(this.skillRow(sid));
    weaponOf(d)!.skills.forEach(skillItem);
    items.push({ height: 22, obj: this.add.container(0, 0, [text(this, 0, 4, 'Basic Abilities (everyone)', { fontSize: '13px', color: COLORS.gold })]) });
    BASIC_SKILLS.forEach(skillItem);
    this.skillList = new ScrollList(this, 32, 98, 278, 442, 8);
    this.skillList.setItems(items, 'top');

    // Middle: skill trees and the Body tab.
    const points = skillPoints(d);
    const free = freePoints(d);
    L.add(text(this, 330, 66, `Skill Points  ${pointsUsed(d)}/${points}`, { color: free > 0 ? COLORS.gold : COLORS.dim }));
    [...SKILL_TABS, { id: 'body', name: 'Body' }].forEach((t, i) => {
      L.add(button(this, 330 + i * 98, 90, 94, 30, t.name, () => {
        this.tab = t.id;
        this.render();
      }, { selected: this.tab === t.id, fontSize: 14 }));
    });
    if (this.tab === 'body') this.bodyTab(L);
    else this.skillTab(L);

    // Right: the hovered skill in full (or the stats, on the Body tab).
    if (this.tab === 'body') this.statsPanel(L, 636, 66, 300, 482, false);
    else {
      this.detail = this.add.container(0, 0);
      L.add(this.detail);
      this.showDetail(this.focus ? SKILLS[this.focus] : null);
    }
  }

  /** A weapon skill or basic ability in the left list: name, numbers and a small range diagram. Hover for the details panel. */
  private skillRow(sid: string): { obj: Phaser.GameObjects.Container; height: number } {
    const s = SKILLS[sid];
    const c = this.add.container(0, 0);
    const name = text(this, 0, 0, s.name, { fontSize: '15px' }).setInteractive();
    name.on('pointerover', () => this.showDetail(s));
    c.add(name);
    const stats = text(this, 0, 21, skillStatText(s), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 196 }, lineSpacing: 1 });
    c.add(stats);
    const mini = this.diagram(s, 56);
    mini.container.setPosition(266 - mini.size, 2);
    c.add(mini.container);
    return { obj: c, height: Math.max(28 + stats.height, mini.size + 6) };
  }

  /** The details panel on the Skills page: a skill's name, numbers, description and a big range diagram. */
  private showDetail(s: SkillDef | null): void {
    if (!this.detail?.active) return;
    this.detail.removeAll(true);
    this.focus = s?.id ?? null;
    const D = this.detail;
    D.add(panel(this, 636, 66, 300, 482));
    if (!s) {
      D.add(text(this, 786, 280, 'Hover a skill to see\nits details here.', { color: COLORS.dim, align: 'center', fontSize: '14px' }).setOrigin(0.5));
      return;
    }
    D.add(text(this, 650, 76, s.name, { fontSize: '20px', color: COLORS.gold, wordWrap: { width: 272 } }));
    const desc = text(this, 650, 108, s.description, { fontSize: '13px', color: COLORS.dim, wordWrap: { width: 272 } });
    D.add(desc);
    const stats = text(this, 650, 116 + desc.height, skillStatText(s), { fontSize: '13px', wordWrap: { width: 272 }, lineSpacing: 3 });
    D.add(stats);
    const top = 128 + desc.height + stats.height;
    const room = 540 - top;
    if (room > 60) {
      const dia = this.diagram(s, Math.min(200, room));
      dia.container.setPosition(786 - dia.size / 2, top + (room - dia.size) / 2);
      D.add(dia.container);
    }
  }

  /** A class tab: a second row of subclass tabs, then the selected subclass's skills. Click a skill to learn it (1 point) or unlearn it. */
  private skillTab(L: Phaser.GameObjects.Container): void {
    const d = this.draft;
    const trees = SKILL_TREES.filter((t) => t.tab === this.tab);
    const tree = trees.find((t) => t.id === this.subTab[this.tab]) ?? trees[0];
    if (!tree) return;
    // Subclass tabs, lined up with the class tabs above (same edges and gap).
    const subX = 330, subW = 290, gap = 6;
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
    const bottom = 550;
    const rowH = Math.max(22, Math.min(34, Math.floor((bottom - ty - 40) / Math.max(1, tree.skills.length))));
    for (const sid of tree.skills) {
      const s = SKILLS[sid];
      const on = d.skillIds.includes(sid);
      const locked = !isUnlocked(d, sid);
      const label = locked ? `${s.name}  (Lv ${s.level} Req.)` : `${on ? '✔ ' : ''}${s.name}${s.level > 1 ? ` (Lv ${s.level})` : ''}`;
      L.add(button(this, subX, ty, subW, rowH - 4, label, () => this.toggleSkill(sid), {
        selected: on, enabled: !locked, fontSize: rowH < 30 ? 13 : 14, onHover: () => this.showDetail(s),
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
    L.add(text(this, 330, 124, `Each point trains a stat by 2 levels of base growth. Max ${cap} per stat at level ${d.level} (level / 3, rounded up).`, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 290 } }));
    const free = freePoints(d);
    bodyStats().forEach((k, i) => {
      const y = 164 + i * 38;
      const n = d.body?.[k] ?? 0;
      const gain = bodyGain(k);
      const info = STAT_INFO[k];
      const row = this.add.rectangle(330, y, 290, 32, COLORS.panelLight, n ? 0.9 : 0.4).setOrigin(0).setStrokeStyle(1, n ? COLORS.accent : COLORS.border);
      L.add(this.tip(row, () => `${info.name} (${info.short})\n${info.description}\n\nEach point: +${gain} ${info.short} (2 x base growth ${STAT_CONFIG.growthPerLevel[k]}).\n${n ? `Invested ${n}: +${gain * n} ${info.short}.` : 'Not trained yet.'}\nMax rank ${cap} at level ${d.level}.`));
      L.add(text(this, 340, y + 8, info.name, { fontSize: '14px' }));
      L.add(text(this, 456, y + 9, `+${gain} Each`, { fontSize: '12px', color: COLORS.dim }));
      L.add(button(this, 526, y + 4, 26, 24, '−', () => this.invest(k, -1), { fontSize: 15, enabled: n > 0 }));
      L.add(text(this, 572, y + 7, `${n}/${cap}`, { fontSize: '13px', color: n ? COLORS.gold : COLORS.dim }).setOrigin(0.5, 0));
      L.add(button(this, 590, y + 4, 26, 24, '+', () => this.invest(k, 1), { fontSize: 15, enabled: free > 0 && n < cap }));
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
