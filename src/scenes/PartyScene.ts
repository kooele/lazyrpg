import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS, xpToNext } from '../data/content';
import { ACTIVITIES, FOOD_TIERS, GUILD, INN_TIERS, LODGING_QUALITY, RINGS, foodQuality, isResidence, type Activity, type CityLodging, type FoodTier, trainingXp } from '../data/guild';
import { TRAITS } from '../data/traits';
import type { Character, GameState } from '../data/types';
import { bodyPoints, deriveStats, freePoints, skillPoints } from '../game/character';
import { benchMember, quitRenown, lineupMembers, lodgingPrice, marketBuyPrice, moveMember, releaseCompanion, residents, scheduledMembers, sellSlave, setLineupSlot, setLodging } from '../game/city';
import {
  ACTIVITY_INFO, QUALITY_TEXT, activityOf, lodgingOf, lodgingRelationship, combatPenalty, expectedQuality, foodOf, foodRelationship, healthOf, injuryPenalty, isInjured, moraleOf, moralePenalty,
  obediencePenalty, traitFactor,
} from '../game/condition';
import { bondOf, canFight, daysLeft, isCompanion, isHoused, isSlave, leaveParty, proratedWages, punishSlave, releaseCost, slaveTax, slaveValue } from '../game/contracts';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { MEMBER_COLOR, MEMBER_LABEL, cityHeader, memberStatus } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, Tooltip, WIDTH, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast } from '../ui/widgets';

const ROW_H = 58;
const ROW_GAP = 4;
/** The lineup slots along the top of the roster panel. */
const SLOT_X = 24;
const SLOT_Y = 104;
const SLOT_W = 60;
const SLOT_H = 78;
const SLOT_GAP = 3.5;
const LIST_Y = SLOT_Y + SLOT_H + 26;

/** Manage Party: everyone in the party, the lineup for the next quest, loadouts and contracts. */
export class PartyScene extends Phaser.Scene {
  private selected = '';
  private tip!: Tooltip;
  /** A roster row is being dragged (so letting go doesn't also select it). */
  private dragging = false;
  private slotFrames: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('Party');
  }

  init(data: { selected?: string }): void {
    if (data.selected) this.selected = data.selected;
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    // A click that wanders a little still selects; past this, it drags the row.
    this.input.dragDistanceThreshold = 8;
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('City'));
    this.render();
  }

  /** The lineup slot under a point, or -1. */
  private slotAt(x: number, y: number): number {
    if (y < SLOT_Y - 6 || y > SLOT_Y + SLOT_H + 6) return -1;
    const i = Math.floor((x - SLOT_X + SLOT_GAP / 2) / (SLOT_W + SLOT_GAP));
    return i >= 0 && i < MAX_PARTY_SIZE ? i : -1;
  }

  /** Highlight the lineup slot a dragged member would land in (-1: none). */
  private hoverSlot(i: number): void {
    this.slotFrames.forEach((f, j) => f.setStrokeStyle(2, j === i ? COLORS.accent : COLORS.border));
  }

  /**
   * Drag a roster row: drop it on a lineup slot at the top to put that member in the lineup there, or move it up
   * or down the list to reorder the roster (a gold line shows where it will land).
   */
  private dragRow(list: ScrollList, row: Phaser.GameObjects.Container, handle: Phaser.GameObjects.Rectangle, id: string): void {
    const step = ROW_H + ROW_GAP;
    let startY = 0;
    let grabY = 0;
    // Carried up to the lineup slots: a tag with the member's name (the row itself stays inside the list).
    let ghost: Phaser.GameObjects.Text | null = null;
    let from = 0;
    let target = 0;
    let slot = -1;
    const marker = this.add.rectangle(0, 0, 308, 3, COLORS.accent).setOrigin(0, 0.5).setVisible(false);
    const where = () => {
      const count = requireState().party.length;
      // The slot nearest the dragged row (rows are laid out from the list's scroll offset).
      const at = Math.round(row.y / step) + list.getOffset();
      return Math.max(0, Math.min(count - 1, at));
    };
    handle.on('dragstart', (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      from = requireState().party.findIndex((c) => c.id === id);
      target = from;
      startY = row.y;
      grabY = p.worldY;
      list.root.bringToTop(row);
      list.root.add(marker);
      handle.setFillStyle(0x2f3956, 1);
      const c = requireState().party.find((m) => m.id === id);
      ghost = text(this, p.worldX, p.worldY, `⚔ ${c?.name ?? ''}`, {
        fontSize: '13px', color: COLORS.gold, backgroundColor: '#14182ae0', padding: { x: 6, y: 3 },
      }).setOrigin(0.5).setDepth(100).setVisible(false);
    });
    handle.on('drag', (p: Phaser.Input.Pointer) => {
      slot = this.slotAt(p.worldX, p.worldY);
      this.hoverSlot(slot);
      // Above the list: carrying the member toward the lineup slots.
      const lifted = p.worldY < LIST_Y - 4;
      ghost?.setPosition(p.worldX, p.worldY).setVisible(lifted);
      if (lifted) {
        row.y = startY;
        marker.setVisible(false);
        target = from;
        return;
      }
      row.y = Math.max(-ROW_H / 2, Math.min(list.h - ROW_H / 2, startY + p.worldY - grabY));
      target = where();
      // The line goes above the slot when moving up, below it when moving down.
      const slotY = (target - list.getOffset()) * step;
      const lineY = target > from ? slotY + ROW_H + ROW_GAP / 2 : slotY - ROW_GAP / 2;
      marker.setY(Math.max(2, Math.min(list.h - 2, lineY))).setVisible(target !== from);
    });
    handle.on('dragend', () => {
      ghost?.destroy();
      // Re-render on the next tick: this row's own pointerup may still be on its way.
      this.time.delayedCall(0, () => {
        this.dragging = false;
        const state = requireState();
        if (slot >= 0) {
          const err = setLineupSlot(state, id, slot);
          if (err) toast(this, err, COLORS.bad);
          else markDirty();
        } else if (target !== from) {
          moveMember(state, id, target);
          markDirty();
        }
        this.render();
      });
    });
  }

  /**
   * The lineup slots: a member in one can be dragged to another slot (they swap) or anywhere off the slots to bench
   * them. Clicking one selects that member.
   */
  private lineupSlots(lineup: Character[]): void {
    this.slotFrames = [];
    for (let i = 0; i < MAX_PARTY_SIZE; i++) {
      const x = SLOT_X + i * (SLOT_W + SLOT_GAP);
      const c = lineup[i];
      const frame = this.add.rectangle(x, SLOT_Y, SLOT_W, SLOT_H, c ? COLORS.panelLight : 0x0b0d14, c ? 0.7 : 0.6).setOrigin(0)
        .setStrokeStyle(2, COLORS.border);
      this.slotFrames.push(frame);
      if (!c) {
        text(this, x + SLOT_W / 2, SLOT_Y + SLOT_H / 2, `${i + 1}\nempty`, { fontSize: '11px', color: COLORS.dim, align: 'center' }).setOrigin(0.5);
        continue;
      }
      const card = this.add.container(x, SLOT_Y);
      const hit = this.add.rectangle(0, 0, SLOT_W, SLOT_H, 0xffffff, 0.001).setOrigin(0).setInteractive({ useHandCursor: true, draggable: true });
      if (c.id === this.selected) frame.setFillStyle(0x4a3d1c, 1);
      card.add(hit);
      card.add(figure(this, SLOT_W / 2, SLOT_H - 16, 50, c.appearance, c.weaponId, { base: false }));
      card.add(text(this, 4, 2, `${i + 1}`, { fontSize: '11px', color: COLORS.gold }));
      card.add(text(this, SLOT_W / 2, SLOT_H - 14, c.name, { fontSize: '10px', color: isInjured(c) ? COLORS.bad : COLORS.text, fixedWidth: SLOT_W - 4, align: 'center' }).setOrigin(0.5, 0));
      hit.on('pointerup', () => {
        if (this.dragging) return;
        this.selected = c.id;
        this.render();
      });
      let target = i;
      let grabX = 0;
      let grabY = 0;
      hit.on('dragstart', (p: Phaser.Input.Pointer) => {
        this.dragging = true;
        grabX = p.worldX;
        grabY = p.worldY;
        card.setDepth(60);
      });
      hit.on('drag', (p: Phaser.Input.Pointer) => {
        card.setPosition(x + p.worldX - grabX, SLOT_Y + p.worldY - grabY);
        target = this.slotAt(p.worldX, p.worldY);
        this.hoverSlot(target);
      });
      hit.on('dragend', () => {
        this.time.delayedCall(0, () => {
          this.dragging = false;
          const state = requireState();
          if (target < 0) benchMember(state, c.id);
          else if (target !== i) setLineupSlot(state, c.id, target);
          if (target !== i) markDirty();
          this.render();
        });
      });
    }
  }

  private render(): void {
    this.children.removeAll(true);
    const state = requireState();
    cityHeader(this, state, 'Manage Party');
    this.tip = new Tooltip(this, 320);
    if (!state.party.some((c) => c.id === this.selected)) this.selected = state.mainId;
    const members = lineupMembers(state);
    const lineup = new Set(members.map((c) => c.id));

    // ---- lineup slots, then the roster ----
    panel(this, 16, 76, 330, HEIGHT - 148);
    text(this, 28, 84, `Lineup ${lineup.size}/${MAX_PARTY_SIZE} · drag members into the slots`, { fontSize: '13px', color: COLORS.dim });
    this.lineupSlots(members);
    text(this, 28, LIST_Y - 20, `Members ${state.party.length}/${GUILD.maxRoster} · drag off the slots to bench`, { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, 22, LIST_Y, 318, HEIGHT - 78 - LIST_Y, ROW_GAP);
    const rows = state.party.map((c) => {
      const row = this.add.container(0, 0);
      const sel = c.id === this.selected;
      const bg = this.add.rectangle(0, 0, 308, ROW_H, sel ? 0x4a3d1c : COLORS.panelLight, sel ? 1 : 0.5).setOrigin(0)
        .setStrokeStyle(2, sel ? COLORS.accent : COLORS.border).setInteractive({ useHandCursor: true, draggable: true });
      bg.on('pointerup', () => {
        if (this.dragging) return;
        this.selected = c.id;
        this.render();
      });
      this.dragRow(list, row, bg, c.id);
      row.add(bg);
      row.add(figure(this, 28, 56, 52, c.appearance, c.weaponId, { base: false }));
      row.add(text(this, 58, 6, `${c.name}  Lv ${c.level} (${adventurerRank(c.level)})`, { fontSize: '15px' }));
      row.add(text(this, 58, 26, memberStatus(state, c), { fontSize: '11px', color: MEMBER_COLOR[c.contract?.type ?? 'main'], wordWrap: { width: 200 } }));
      if (lineup.has(c.id)) row.add(text(this, 284, 6, `⚔ slot ${members.findIndex((m) => m.id === c.id) + 1}`, { fontSize: '11px', color: COLORS.gold }).setOrigin(1, 0));
      else if (!canFight(state, c)) row.add(text(this, 284, 6, 'can\'t go', { fontSize: '11px', color: COLORS.bad }).setOrigin(1, 0));
      // A grip: rows can be dragged into the lineup slots, or up and down to reorder the roster.
      row.add(text(this, 300, ROW_H / 2, '⋮⋮', { fontSize: '14px', color: COLORS.dim }).setOrigin(1, 0.5));
      const pen = Math.round(combatPenalty(c) * 100);
      const obey = isSlave(c) ? ` · Obd ${c.contract.obedience}` : '';
      const cond = `${isInjured(c) ? `Hurt ${healthOf(c)}` : 'Healthy'} · Mor ${moraleOf(c)}${obey}${pen ? ` · -${pen}%` : ''} · ${ACTIVITY_INFO[activityOf(state, c)].name}`;
      const low = moraleOf(c) < GUILD.condition.lowMorale;
      row.add(text(this, 58, 40, cond, { fontSize: '11px', color: isInjured(c) || low ? COLORS.bad : COLORS.dim }));
      return { obj: row, height: ROW_H };
    });
    list.setItems(rows, 'keep');

    const c = state.party.find((m) => m.id === this.selected)!;
    this.detail(c);

    button(this, 16, HEIGHT - 60, 200, 46, `Back to ${GUILD.city}`, () => this.scene.start('City'));
    button(this, 226, HEIGHT - 60, 120, 46, 'Hire', () => this.scene.start('Guild', { tab: 'hall' }), { fontSize: 15 });
  }

  private detail(c: Character): void {
    const state = requireState();
    const X = 360;
    const W = WIDTH - X - 16;
    panel(this, X, 76, W, HEIGHT - 92);
    figure(this, X + 70, 250, 150, c.appearance, c.weaponId);
    text(this, X + 150, 90, c.name, { fontSize: '26px' });
    const type = c.contract?.type ?? 'main';
    text(this, X + 150, 124, `Level ${c.level} · ${adventurerRank(c.level)}-rank · ${MEMBER_LABEL[type]}`, { fontSize: '15px', color: MEMBER_COLOR[type] });
    const g = this.add.graphics();
    g.fillStyle(0x0b0d14).fillRect(X + 150, 150, 200, 8);
    g.fillStyle(0x7d6bd8).fillRect(X + 150, 150, 200 * Math.min(1, c.xp / xpToNext(c.level)), 8);
    text(this, X + 356, 146, `${c.xp}/${xpToNext(c.level)} XP`, { fontSize: '11px', color: COLORS.dim });
    // Strategic Layer condition: Health (not battle HP) and Morale.
    const bar = (y: number, label: string, v: number, color: number, note: string, tip: () => string) => {
      const warn = label === 'Health' ? v < 100 : v < GUILD.condition.lowMorale;
      text(this, X + 420, y, `${label} ${v}/100${warn && note ? ` · ${note}` : ''} ⓘ`, { fontSize: '11px', color: warn ? COLORS.bad : COLORS.text });
      g.fillStyle(0x0b0d14).fillRect(X + 420, y + 17, 150, 6);
      g.fillStyle(color).fillRect(X + 420, y + 17, 1.5 * v, 6);
      this.hoverTip(X + 416, y - 2, 158, 28, tip);
    };
    bar(88, 'Health', healthOf(c), 0x6fdc8c, isInjured(c) ? `-${Math.round(injuryPenalty(c) * 100)}% stats` : '', () => this.healthTip(c));
    bar(116, 'Morale', moraleOf(c), 0xe0b44c, c.id !== state.mainId ? 'unhappy' : '', () => this.moraleTip(c));
    const pen = combatPenalty(c);
    if (pen > 0) {
      const parts = [
        injuryPenalty(c) ? `injury ${Math.round(injuryPenalty(c) * 100)}` : '',
        moralePenalty(c) ? `morale ${Math.round(moralePenalty(c) * 100)}` : '',
        obediencePenalty(c) ? `obey ${Math.round(obediencePenalty(c) * 100)}` : '',
      ].filter(Boolean);
      text(this, X + 570, 140, `In battle: -${Math.round(pen * 100)}% all stats`, { fontSize: '11px', color: COLORS.bad }).setOrigin(1, 0);
      text(this, X + 570, 153, parts.join(' × '), { fontSize: '10px', color: COLORS.dim }).setOrigin(1, 0);
    }

    const st = deriveStats(c);
    text(this, X + 150, 166, `HP ${st.health}   MP ${st.mana}   P.Atk ${st.pAtk}   M.Atk ${st.mAtk}\nDef ${st.defense}   Resist ${st.resist}   Move ${st.movement}`, { fontSize: '13px', lineSpacing: 4 });
    const w = WEAPONS[c.weaponId];
    talentTag(this, X + 150, 207, c, { fontSize: 11 });
    text(this, X + 150, 226, `${w.name}: ${w.skills.map((s) => SKILLS[s].name).join(', ')}`, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: W - 170 } });
    const free = freePoints(c);
    const names = c.skillIds.map((s) => SKILLS[s].name);
    const skillLine = (shown: number) => `Skill points ${skillPoints(c) - free}/${skillPoints(c)}${free > 0 ? ` (${free} to spend)` : ''}: ${names.slice(0, shown).join(', ') || '—'}${shown < names.length ? ` +${names.length - shown} more` : ''}${bodyPoints(c) ? ` · Body ${bodyPoints(c)}` : ''}`;
    const skillsText = text(this, X + 150, 247, skillLine(names.length), {
      fontSize: '12px', color: free > 0 ? COLORS.gold : COLORS.dim, wordWrap: { width: W - 170 },
    });
    // At most two lines, so the traits and the contract below always fit.
    for (let shown = names.length - 1; shown >= 0 && skillsText.height > 34; shown--) skillsText.setText(skillLine(shown));

    // ---- traits (under the skills) ----
    const ty = skillsText.y + skillsText.height + 4;
    let tx = X + 150 + text(this, X + 150, ty, 'Traits:', { fontSize: '12px', color: COLORS.dim }).width + 6;
    for (const id of c.traits ?? []) {
      const t = TRAITS[id];
      const label = text(this, tx, ty, `${t.name} ⓘ`, { fontSize: '12px', color: COLORS.gold });
      this.hoverTip(tx - 2, ty - 2, label.width + 4, label.height + 4, () => `${t.name}\n${t.description}`);
      tx += label.width + 12;
    }
    if (!c.traits?.length) text(this, tx, ty, '—', { fontSize: '12px', color: COLORS.dim });

    // ---- contract ----
    const y0 = Math.max(290, Math.round(ty + 26));
    text(this, X + 16, y0, 'Contract', { fontSize: '15px', color: COLORS.gold });
    const k = c.contract;
    const lines: string[] = [];
    if (!k || k.type === 'main') {
      lines.push('Your own character: permanent. Drag them off the lineup slots to rest in the city while the others go on quests.', 'The party pays your food (set below) and lodging.');
    } else if (k.type === 'mercenary') {
      lines.push(`Paid ${k.fee} gold up front; takes more from the reward if ${k.cutPct}% of it is worth more.`, 'Leaves after the next quest, win or lose. Finds their own food.');
    } else if (k.type === 'slave') {
      lines.push(`Market value ${Math.round(slaveValue(c))} gold · property tax ${slaveTax(c)} gold a week (paid on payday). No wages.`, 'The party pays their food (set below) and lodging.');
    } else if (isCompanion(c)) {
      const left = daysLeft(c.contract, state.day);
      lines.push(
        `Base pay ${k.basePay} gold a week (every 7th day) · ${k.lootPct}% of quest rewards`,
        k.foodLodging ? 'Food & lodging included: the party pays their food (set below) and lodging' : 'Food & lodging not included: finds their own',
        `${k.termWeeks}-week term: day ${k.startDay} to day ${k.endDay} · ${left > 0 ? `${left} days left` : `ENDED: renew within ${GUILD.companion.graceDays + left} day(s) or they leave`}`,
      );
    }
    text(this, X + 16, y0 + 24, lines.join('\n'), { fontSize: '13px', lineSpacing: 5, wordWrap: { width: W - 32 } });
    if (isCompanion(c)) {
      const rel = c.contract.relationship;
      text(this, X + 16, y0 + 92, `Relationship ${Math.round(rel)}/100 ⓘ`, { fontSize: '13px' });
      g.fillStyle(0x0b0d14).fillRect(X + 170, y0 + 96, 220, 10);
      g.fillStyle(0xe05a9b).fillRect(X + 170, y0 + 96, 2.2 * rel, 10);
      this.hoverTip(X + 12, y0 + 88, 382, 22, () => this.relationshipTip(c));
    } else if (isSlave(c)) {
      const { relationship: rel, obedience: ob } = c.contract;
      text(this, X + 16, y0 + 70, `Relationship ${Math.round(rel)}/100 ⓘ`, { fontSize: '13px' });
      g.fillStyle(0x0b0d14).fillRect(X + 170, y0 + 74, 220, 10);
      g.fillStyle(0xe05a9b).fillRect(X + 170, y0 + 74, 2.2 * rel, 10);
      this.hoverTip(X + 12, y0 + 66, 382, 22, () => this.relationshipTip(c));
      text(this, X + 16, y0 + 92, `Obedience ${Math.round(ob)}/100 ⓘ`, { fontSize: '13px', color: ob < 50 ? COLORS.bad : COLORS.text });
      g.fillStyle(0x0b0d14).fillRect(X + 170, y0 + 96, 220, 10);
      g.fillStyle(0x9fb7d8).fillRect(X + 170, y0 + 96, 2.2 * ob, 10);
      this.hoverTip(X + 12, y0 + 88, 382, 22, () => this.obedienceTip(c));
      const trend = obedienceTrend(rel);
      text(this, X + 400, y0 + 92, trend, { fontSize: '11px', color: trend.startsWith('falling') ? COLORS.bad : COLORS.dim });
    }

    // ---- schedule: what they do on days they aren't on a quest ----
    const sy = 418;
    const busy = !scheduledMembers(state).some((m) => m.id === c.id);
    text(this, X + 16, sy, 'Schedule', { fontSize: '13px', color: COLORS.gold });
    text(this, X + 16, sy + 16, busy ? 'starts tomorrow' : 'off-quest days', { fontSize: '10px', color: COLORS.dim });
    const now = activityOf(state, c);
    const auto = !state.schedule[c.id];
    const scheduleOption = (a: Activity): MenuOption => ({
      label: `${ACTIVITY_INFO[a].name}${auto && a === now ? ' (default)' : ''}`,
      effect: activityEffect(c, a),
      color: COLORS.dim,
      selected: a === now,
      pick: () => {
        state.schedule[c.id] = a;
        markDirty();
        this.render();
      },
    });
    this.dropdown(X + 110, sy - 2, DROP_W, scheduleOption(now), () => ACTIVITIES.map(scheduleOption));

    // ---- food and lodging: dropdowns for members the party houses; others find their own (greyed out) ----
    const fy = sy + 32;
    const fed = isHoused(c);
    const main = c.id === state.mainId;
    const food = foodOf(state, c);
    text(this, X + 16, fy, 'Food', { fontSize: '13px', color: fed ? COLORS.gold : COLORS.dim });
    text(this, X + 16, fy + 16, fed ? (main ? 'no complaints' : `expects ${GUILD.food[FOOD_TIERS[expectedQuality(c)]].name}`) : 'finds their own', {
      fontSize: '10px', color: COLORS.dim,
    });
    const foodOption = (t: FoodTier): MenuOption => ({
      label: `${GUILD.food[t].name} · ${GUILD.food[t].pricePerPerson}g`,
      ...effectOf(c, foodQuality(t), main ? 0 : foodRelationship(c, t), 'day'),
      selected: t === food,
      pick: () => {
        state.food[c.id] = t;
        markDirty();
        this.render();
      },
    });
    this.dropdown(X + 110, fy - 2, DROP_W, fed ? foodOption(food) : null, () => FOOD_TIERS.map(foodOption));

    const ly = fy + 32;
    const where = lodgingOf(state, c);
    text(this, X + 16, ly, 'Lodging', { fontSize: '13px', color: fed ? COLORS.gold : COLORS.dim });
    text(this, X + 16, ly + 16, fed ? (main ? 'no complaints' : `expects ${['the stables', 'an inn', 'high-end', 'luxury'][expectedQuality(c)]}`) : 'finds their own', {
      fontSize: '10px', color: COLORS.dim,
    });
    const lodgingOption = (o: CityLodging): MenuOption => {
      const full = isResidence(o) && o !== where && residents(state, o).length >= GUILD.residences.capacity;
      return {
        label: `${lodgingLabel(state, o)}${full ? ' (full)' : ''}`,
        ...effectOf(c, LODGING_QUALITY[o], main ? 0 : lodgingRelationship(c, o), 'night'),
        selected: o === where,
        enabled: !full,
        pick: () => {
          const err = setLodging(state, c.id, o);
          if (err) return toast(this, err, COLORS.bad);
          markDirty();
          this.render();
        },
      };
    };
    const lodgings: CityLodging[] = ['outside', ...INN_TIERS, ...RINGS.filter((r) => state.residences.includes(r))];
    this.dropdown(X + 110, ly - 2, DROP_W, fed ? lodgingOption(where) : null, () => lodgings.map(lodgingOption));

    // ---- actions ----
    const by = HEIGHT - 76;
    button(this, X + 16, by, 130, 44, 'Loadout', () => this.scene.start('CharacterCreator', { mode: 'edit', characterId: c.id }), {
      enabled: k?.type !== 'mercenary', fontSize: 14, selected: free > 0 && k?.type !== 'mercenary',
    });
    if (isCompanion(c)) {
      const left = daysLeft(c.contract, state.day);
      button(this, X + 156, by, 120, 44, 'Renew', () => this.scene.start('Negotiate', { mode: 'renew', id: c.id }), {
        enabled: left <= 7, fontSize: 14, selected: left <= 0,
      });
      const wages = proratedWages(c, state.day);
      const buyout = releaseCost(c, state.day, state.rank);
      const cost = wages + buyout;
      const why = [
        wages ? `Wages since payday: ${wages} gold.` : '',
        buyout ? `Breaking the contract early: ${buyout} gold\n(half the rest of the term, at most a week's pay).` : 'Their term is over: no buyout.',
      ].filter(Boolean).join('\n');
      button(this, X + 286, by, 128, 44, cost ? `Release\n(${cost}g)` : 'Release', () => confirmDialog(this, `Release ${c.name} from their contract?\n${why}\nThey go back to the guild hall.`, () => {
        const err = releaseCompanion(state, c.id);
        if (err) return toast(this, err, COLORS.bad);
        markDirty();
        this.render();
      }, 'Release'), { fontSize: cost ? 12 : 14 });
      if (left > 7) text(this, X + 156, by - 18, 'Renewal opens in the last week.', { fontSize: '11px', color: COLORS.dim });
    } else if (k?.type === 'slave') {
      button(this, X + 156, by, 140, 44, 'Sell', () => confirmDialog(this, `Sell ${c.name} to the slave market for ${marketBuyPrice(state, c)} gold?`, () => {
        const gold = sellSlave(state, c.id, Math.random);
        markDirty();
        this.render();
        toast(this, `Sold for ${gold} gold.`);
      }, 'Sell'), { fontSize: 14 });
      const punished = isSlave(c) && c.contract.punishedDay === state.day;
      button(this, X + 306, by, 112, 44, 'Punish', () => confirmDialog(this,
        `Punish ${c.name}?\nObedience +${GUILD.slave.punishObedience}, relationship -${GUILD.slave.punishRelationship}.\nObedience will drift back down while relationship stays below ${GUILD.slave.obedienceFallBelow}.`, () => {
          const err = punishSlave(c, state.day);
          if (err) return toast(this, err, COLORS.bad);
          markDirty();
          this.render();
        }, 'Punish'), { fontSize: 14, enabled: !punished });
      if (punished) text(this, X + 306, by - 18, 'Punished today.', { fontSize: '11px', color: COLORS.dim });
    } else if (k?.type === 'mercenary') {
      button(this, X + 156, by, 140, 44, 'Dismiss', () => confirmDialog(this, `Dismiss ${c.name}? No refund.`, () => {
        leaveParty(state, c);
        markDirty();
        this.render();
      }, 'Dismiss'), { fontSize: 14 });
    }
  }

  /** A row for a dropdown: the option's name on the left, its quality and relationship effect on the right. */
  private optionRow(x: number, y: number, w: number, h: number, o: MenuOption, onClick: () => void, arrow = false): Phaser.GameObjects.Container {
    const enabled = o.enabled ?? true;
    const row = button(this, x, y, w, h, '', onClick, { fontSize: 12, selected: o.selected && !arrow, enabled });
    row.add(text(this, 10, h / 2, o.label, { fontSize: '12px', color: enabled ? COLORS.text : '#5d6480' }).setOrigin(0, 0.5));
    row.add(text(this, w - (arrow ? 24 : 10), h / 2, o.effect, { fontSize: '11px', color: enabled ? o.color : '#5d6480' }).setOrigin(1, 0.5));
    if (arrow) row.add(text(this, w - 8, h / 2, '▾', { fontSize: '12px' }).setOrigin(1, 0.5));
    return row;
  }

  /**
   * A dropdown: a button showing the current option (or a greyed-out dash when `current` is null) that opens the
   * options above it; clicking outside closes it.
   */
  private dropdown(x: number, y: number, w: number, current: MenuOption | null, options: () => MenuOption[]): void {
    if (!current) {
      button(this, x, y, w, 28, '—', () => undefined, { fontSize: 12, enabled: false });
      return;
    }
    this.optionRow(x, y, w, 28, current, () => {
      const opts = options();
      const rowH = 30;
      const h = opts.length * rowH + 12;
      const top = y - h - 4;
      const layer = this.add.container(0, 0).setDepth(900);
      const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.35).setOrigin(0).setInteractive();
      shade.on('pointerup', () => layer.destroy());
      layer.add([shade, panel(this, x - 6, top, w + 12, h)]);
      opts.forEach((o, i) => layer.add(this.optionRow(x, top + 6 + i * rowH, w, rowH - 4, o, () => {
        layer.destroy();
        o.pick();
      })));
    }, true);
  }

  /** An invisible hover area that shows a floating tooltip. */
  private hoverTip(x: number, y: number, w: number, h: number, tip: () => string): void {
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.tip.show(tip()));
    zone.on('pointerout', () => this.tip.hide());
  }

  private healthTip(c: Character): string {
    const C = GUILD.condition;
    const k = traitFactor(c, 'healthRecovery');
    const night = C.healthPerDay * k;
    return [
      `Health ${healthOf(c)}/100: wear and tear between quests, not battle HP.`,
      `After a battle, a member loses up to ${C.maxHealthLoss} Health depending on how low their HP fell (falling: all ${C.maxHealthLoss}).`,
      `Below 100 they're injured: every battle stat drops by 1/3 of the missing Health${isInjured(c) ? ` (now -${Math.round(injuryPenalty(c) * 100)}%)` : ''}.`,
      `Recovers ${night} a night, ${night * GUILD.schedule.recoverMultiplier} on the Recover schedule${k !== 1 ? ` (x${k}: ${(c.traits ?? []).map((t) => TRAITS[t].name).join(', ')})` : ''}.`,
      `At 0 Health a member dies${c.contract?.type === 'main' ? '; you pull through at 1 instead' : ''}.`,
    ].join('\n');
  }

  private moraleTip(c: Character): string {
    const C = GUILD.condition;
    const k = traitFactor(c, 'moraleGain');
    const main = c.contract?.type === 'main';
    return [
      `Morale ${moraleOf(c)}/100.`,
      `Falls ${C.moralePerTurn} for each turn of a quest's battle (${C.moraleFailedQuest} more if it fails), 1 per ${Math.round(1 / C.moralePerHealthLost)} Health lost to injuries, and ${C.moraleMemberDied} for everyone when a member dies.`,
      `Rises with a round of drinks at an inn and with Day Off (+${GUILD.schedule.dayOffMorale * k} a day)${k !== 1 ? `: gains x${k} (${(c.traits ?? []).map((t) => TRAITS[t].name).join(', ')})` : ''}.`,
      `In battle: -${GUILD.combat.percentPer5}% to all stats per 5 below 100${moralePenalty(c) ? ` (now -${Math.round(moralePenalty(c) * 100)}%)` : ''}.`,
      main ? 'Your main character never leaves, however low it gets.'
        : `${c.contract?.type === 'mercenary' ? '' : `Below ${C.lowMorale} they lose ${C.lowMoraleRelationshipPerDay} relationship a day. `}At 0 they leave the party (renown -${quitRenown(c)}).`,
    ].join('\n');
  }

  private relationshipTip(c: Character): string {
    const state = requireState();
    const k = c.contract;
    if (k?.type !== 'companion' && k?.type !== 'slave') return '';
    const L = GUILD.lodging;
    const F = GUILD.food;
    const q = expectedQuality(c);
    const lines = [
      `Relationship ${Math.round(k.relationship)}/100.`,
      `+${GUILD.companion.relationshipPerQuest} for each quest completed together, -2 for a failed one.`,
    ];
    if (isHoused(c)) {
      lines.push(
        `Every night: +${L.relationshipAbovePerStep} per step of lodging better than they expect, -${L.relationshipBelowPerStep} per step worse. Every day, food: +${F.relationshipAbovePerStep} / -${F.relationshipBelowPerStep} per step.`,
        `As ${adventurerRank(c.level)}-rank, they expect ${QUALITY_TEXT[q]} and ${F[FOOD_TIERS[q]].name.toLowerCase()} food (now: ${F[foodOf(state, c)].name.toLowerCase()}).`,
        'If the party can\'t pay food and lodging: -5.',
      );
    } else lines.push('They find their own food and lodging, so where the party sleeps and eats doesn\'t matter to them.');
    lines.push(`-${GUILD.condition.lowMoraleRelationshipPerDay} a day while Morale is below ${GUILD.condition.lowMorale}.`);
    if (k.type === 'companion') {
      lines.push(
        `Unpaid wages: ${GUILD.companion.relationshipUnpaid} each payday; they quit at 0 (renown -${quitRenown(c)}).`,
        `A higher relationship lowers their demands when you renew (up to -${Math.round(GUILD.companion.renewalDiscountAtMax * 100)}% at 100).`,
      );
    } else {
      lines.push(`Drives Obedience: it rises while relationship is ${GUILD.slave.obedienceRiseFrom}+ and falls below ${GUILD.slave.obedienceFallBelow}. Punishing costs ${GUILD.slave.punishRelationship}.`);
    }
    return lines.join('\n');
  }

  private obedienceTip(c: Character): string {
    if (!isSlave(c)) return '';
    const S = GUILD.slave;
    return [
      `Obedience ${Math.round(c.contract.obedience)}/100: how willingly a slave fights.`,
      `In battle: -${GUILD.combat.percentPer5}% to all stats per 5 below 100${obediencePenalty(c) ? ` (now -${Math.round(obediencePenalty(c) * 100)}%)` : ''}.`,
      `Rises ${S.obedienceChangePerDay} a day while relationship is ${S.obedienceRiseFrom}+, falls ${S.obedienceChangePerDay} a day below ${S.obedienceFallBelow}, steady in between (now ${obedienceTrend(c.contract.relationship)}).`,
      `Punish (once a day): +${S.punishObedience} Obedience, -${S.punishRelationship} relationship. A quick boost that drains away unless the relationship recovers.`,
      `Market slaves start at ${S.obedienceMarket[0]}-${S.obedienceMarket[1]}, registered prisoners at ${S.obedienceCaptive[0]}-${S.obedienceCaptive[1]}.`,
    ].join('\n');
  }
}

const DROP_W = 460;

interface MenuOption {
  label: string;
  /** "quality 2 · +2 rel/night" */
  effect: string;
  color: string;
  selected?: boolean;
  enabled?: boolean;
  pick: () => void;
}

/** What a schedule activity does for `c` each day, for the dropdown. */
function activityEffect(c: Character, a: Activity): string {
  const S = GUILD.schedule;
  if (a === 'recover') return `+${S.recoverMultiplier * GUILD.condition.healthPerDay * traitFactor(c, 'healthRecovery')} Health a day (instead of +${GUILD.condition.healthPerDay * traitFactor(c, 'healthRecovery')})`;
  if (a === 'training') return `+${trainingXp(c.level)} XP a day`;
  if (a === 'oddJobs') return `+${S.oddJobsGold} gold a day`;
  return `+${S.dayOffMorale * traitFactor(c, 'moraleGain')} Morale a day`;
}

/** What a food or lodging choice means for `c`: its quality and, for companions and slaves, the relationship it moves. */
function effectOf(c: Character, quality: number, rel: number, per: 'day' | 'night'): { effect: string; color: string } {
  const bond = !!bondOf(c) && c.contract?.type !== 'main';
  if (!bond) return { effect: `quality ${quality}`, color: COLORS.dim };
  return {
    effect: `quality ${quality} · ${rel ? `${rel > 0 ? '+' : ''}${rel} rel/${per}` : 'as expected'}`,
    color: rel > 0 ? COLORS.good : rel < 0 ? COLORS.bad : COLORS.dim,
  };
}

/** "Silver Lantern Inn · 24g", "Outer City House · 3/6" (residents), "Stables · 6g". */
function lodgingLabel(state: GameState, where: CityLodging): string {
  if (where === 'outside') return GUILD.lodging.stablesPerPerson ? `Stables · ${GUILD.lodging.stablesPerPerson}g` : 'Stables · free';
  if (isResidence(where)) return `${GUILD.residences[where].name} · ${residents(state, where).length}/${GUILD.residences.capacity}`;
  return `${GUILD.inns[where].name} · ${lodgingPrice(where)}g`;
}

/** Which way a slave's Obedience is heading, from their relationship. */
function obedienceTrend(rel: number): string {
  const S = GUILD.slave;
  return rel >= S.obedienceRiseFrom ? `rising ${S.obedienceChangePerDay}/day` : rel < S.obedienceFallBelow ? `falling ${S.obedienceChangePerDay}/day` : 'steady';
}
