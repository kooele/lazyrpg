import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS, XP_PER_LEVEL } from '../data/content';
import { ACTIVITIES, FOOD_TIERS, GUILD } from '../data/guild';
import type { Character } from '../data/types';
import { bodyPoints, deriveStats, freePoints, skillPoints } from '../game/character';
import { lineupMembers, marketBuyPrice, scheduledMembers, sellSlave, toggleLineup } from '../game/city';
import {
  ACTIVITY_INFO, activityOf, combatPenalty, expectedQuality, foodOf, healthOf, injuryPenalty, isInjured, moraleOf, moralePenalty, obediencePenalty,
} from '../game/condition';
import { daysLeft, isCompanion, isHoused, isSlave, leaveParty, punishSlave } from '../game/contracts';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { MEMBER_COLOR, MEMBER_LABEL, cityHeader, memberStatus } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast } from '../ui/widgets';

/** Manage Party: everyone in the party, the lineup for the next quest, loadouts and contracts. */
export class PartyScene extends Phaser.Scene {
  private selected = '';

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
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('City'));
    this.render();
  }

  private render(): void {
    this.children.removeAll(true);
    const state = requireState();
    cityHeader(this, state, 'Manage Party');
    if (!state.party.some((c) => c.id === this.selected)) this.selected = state.mainId;
    const lineup = new Set(lineupMembers(state).map((c) => c.id));

    // ---- roster ----
    panel(this, 16, 76, 330, HEIGHT - 148);
    text(this, 28, 84, `Members ${state.party.length}/${GUILD.maxRoster} · Lineup ${lineup.size}/${MAX_PARTY_SIZE}`, { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, 22, 106, 318, HEIGHT - 184, 4);
    list.setItems(state.party.map((c) => {
      const row = this.add.container(0, 0);
      const sel = c.id === this.selected;
      const bg = this.add.rectangle(0, 0, 308, 58, sel ? 0x4a3d1c : COLORS.panelLight, sel ? 1 : 0.5).setOrigin(0)
        .setStrokeStyle(2, sel ? COLORS.accent : COLORS.border).setInteractive({ useHandCursor: true });
      bg.on('pointerup', () => {
        this.selected = c.id;
        this.render();
      });
      row.add(bg);
      row.add(figure(this, 28, 56, 52, c.appearance, c.weaponId, { base: false }));
      row.add(text(this, 58, 6, `${c.name}  Lv ${c.level} (${adventurerRank(c.level)})`, { fontSize: '15px' }));
      row.add(text(this, 58, 26, memberStatus(state, c), { fontSize: '11px', color: MEMBER_COLOR[c.contract?.type ?? 'main'], wordWrap: { width: 200 } }));
      if (lineup.has(c.id)) row.add(text(this, 300, 6, '⚔ lineup', { fontSize: '11px', color: COLORS.gold }).setOrigin(1, 0));
      const pen = Math.round(combatPenalty(c) * 100);
      const obey = isSlave(c) ? ` · Obd ${c.contract.obedience}` : '';
      const cond = `${isInjured(c) ? `Hurt ${healthOf(c)}` : 'Healthy'} · Mor ${moraleOf(c)}${obey}${pen ? ` · -${pen}%` : ''} · ${ACTIVITY_INFO[activityOf(state, c)].name}`;
      const low = moraleOf(c) < GUILD.condition.lowMorale;
      row.add(text(this, 58, 40, cond, { fontSize: '11px', color: isInjured(c) || low ? COLORS.bad : COLORS.dim }));
      return { obj: row, height: 58 };
    }), 'keep');

    const c = state.party.find((m) => m.id === this.selected)!;
    this.detail(c, lineup.has(c.id));

    button(this, 16, HEIGHT - 60, 200, 46, `Back to ${GUILD.city}`, () => this.scene.start('City'));
    button(this, 226, HEIGHT - 60, 120, 46, 'Hire', () => this.scene.start('Guild', { tab: 'hall' }), { fontSize: 15 });
  }

  private detail(c: Character, inLineup: boolean): void {
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
    g.fillStyle(0x7d6bd8).fillRect(X + 150, 150, 200 * (c.xp / XP_PER_LEVEL), 8);
    text(this, X + 356, 146, `${c.xp}/${XP_PER_LEVEL} XP`, { fontSize: '11px', color: COLORS.dim });
    // Strategic Layer condition: Health (not battle HP) and Morale.
    const bar = (y: number, label: string, v: number, color: number, note = '') => {
      const warn = label === 'Health' ? v < 100 : v < GUILD.condition.lowMorale;
      text(this, X + 420, y, `${label} ${v}/100${warn && note ? ` · ${note}` : ''}`, { fontSize: '11px', color: warn ? COLORS.bad : COLORS.text });
      g.fillStyle(0x0b0d14).fillRect(X + 420, y + 17, 150, 6);
      g.fillStyle(color).fillRect(X + 420, y + 17, 1.5 * v, 6);
    };
    bar(88, 'Health', healthOf(c), 0x6fdc8c, isInjured(c) ? `-${Math.round(injuryPenalty(c) * 100)}% stats` : '');
    bar(116, 'Morale', moraleOf(c), 0xe0b44c, c.id !== state.mainId ? 'unhappy' : '');
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
    text(this, X + 150, 247, `Skill points ${skillPoints(c) - free}/${skillPoints(c)}${free > 0 ? ` (${free} to spend)` : ''}: ${c.skillIds.map((s) => SKILLS[s].name).join(', ') || '—'}${bodyPoints(c) ? ` · Body ${bodyPoints(c)}` : ''}`, {
      fontSize: '12px', color: free > 0 ? COLORS.gold : COLORS.dim, wordWrap: { width: W - 170 },
    });

    // ---- contract ----
    const y0 = 290;
    text(this, X + 16, y0, 'Contract', { fontSize: '15px', color: COLORS.gold });
    const k = c.contract;
    const lines: string[] = [];
    if (!k || k.type === 'main') {
      lines.push('Your own character: permanent, always leads the party on quests.', 'The party pays your food (set below) and lodging.');
    } else if (k.type === 'mercenary') {
      lines.push(`Paid ${k.fee} gold up front; takes more from the reward if ${k.cutPct}% of it is worth more.`, 'Leaves after the next quest, win or lose. Finds their own food.');
    } else if (k.type === 'slave') {
      lines.push(`${k.origin === 'prisoner' ? 'A registered prisoner' : `Bought for ${k.price} gold`}. No wages.`, 'The party pays their food (set below) and lodging.');
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
      text(this, X + 16, y0 + 92, `Relationship ${Math.round(rel)}/100`, { fontSize: '13px' });
      g.fillStyle(0x0b0d14).fillRect(X + 160, y0 + 96, 220, 10);
      g.fillStyle(0xe05a9b).fillRect(X + 160, y0 + 96, 2.2 * rel, 10);
      text(this, X + 16, y0 + 112, `+${GUILD.companion.relationshipPerQuest} for each quest completed together. Higher relationship means lower demands on renewal.`, {
        fontSize: '11px', color: COLORS.dim, wordWrap: { width: W - 32 },
      });
    } else if (isSlave(c)) {
      const S = GUILD.slave;
      const { relationship: rel, obedience: ob } = c.contract;
      text(this, X + 16, y0 + 70, `Relationship ${Math.round(rel)}/100`, { fontSize: '13px' });
      g.fillStyle(0x0b0d14).fillRect(X + 160, y0 + 74, 220, 10);
      g.fillStyle(0xe05a9b).fillRect(X + 160, y0 + 74, 2.2 * rel, 10);
      text(this, X + 16, y0 + 92, `Obedience ${Math.round(ob)}/100`, { fontSize: '13px', color: ob < 50 ? COLORS.bad : COLORS.text });
      g.fillStyle(0x0b0d14).fillRect(X + 160, y0 + 96, 220, 10);
      g.fillStyle(0x9fb7d8).fillRect(X + 160, y0 + 96, 2.2 * ob, 10);
      const trend = rel >= S.obedienceRiseFrom ? `rising ${S.obedienceChangePerDay}/day` : rel < S.obedienceFallBelow ? `falling ${S.obedienceChangePerDay}/day` : 'steady';
      text(this, X + 390, y0 + 92, trend, { fontSize: '11px', color: trend.startsWith('falling') ? COLORS.bad : COLORS.dim });
      text(this, X + 16, y0 + 112, `Obedience rises while relationship is ${S.obedienceRiseFrom}+ and falls below ${S.obedienceFallBelow}. Punishing: +${S.punishObedience} Obedience, -${S.punishRelationship} relationship.`, {
        fontSize: '11px', color: COLORS.dim, wordWrap: { width: W - 32 },
      });
    }

    // ---- schedule: what they do on days they aren't on a quest ----
    const sy = 440;
    const busy = !scheduledMembers(state).some((m) => m.id === c.id);
    text(this, X + 16, sy, `Schedule${busy ? ' (back from a quest today: starts tomorrow)' : ' (days not on a quest)'}`, { fontSize: '13px', color: COLORS.gold });
    const now = activityOf(state, c);
    ACTIVITIES.forEach((a, i) => button(this, X + 16 + i * 140, sy + 20, 132, 30, ACTIVITY_INFO[a].name, () => {
      state.schedule[c.id] = a;
      markDirty();
      this.render();
    }, { fontSize: 13, selected: a === now }));
    text(this, X + 16, sy + 56, ACTIVITY_INFO[now].describe(), { fontSize: '11px', color: COLORS.dim, wordWrap: { width: W - 32 } });

    // ---- food: for members the party feeds; others find their own (greyed out) ----
    const fy = sy + 74;
    const fed = isHoused(c);
    const food = foodOf(state, c);
    const expects = FOOD_TIERS[expectedQuality(c)];
    text(this, X + 16, fy, 'Food', { fontSize: '13px', color: fed ? COLORS.gold : COLORS.dim });
    text(this, X + 16, fy + 16, fed ? (c.id === state.mainId ? 'no complaints' : `expects ${GUILD.food[expects].name}`) : 'finds their own', {
      fontSize: '10px', color: COLORS.dim,
    });
    FOOD_TIERS.forEach((t, i) => button(this, X + 110 + i * 114, fy - 2, 108, 28, `${GUILD.food[t].name} ${GUILD.food[t].pricePerPerson}g`, () => {
      state.food[c.id] = t;
      markDirty();
      this.render();
    }, { fontSize: 12, selected: fed && t === food, enabled: fed }));

    // ---- actions ----
    const by = HEIGHT - 76;
    const isMain = c.id === state.mainId;
    button(this, X + 16, by, 140, 44, inLineup ? 'Bench' : 'Add to lineup', () => {
      const err = toggleLineup(state, c.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
    }, { enabled: !isMain, selected: inLineup && !isMain, fontSize: 14 });
    button(this, X + 166, by, 130, 44, 'Loadout', () => this.scene.start('CharacterCreator', { mode: 'edit', characterId: c.id }), {
      enabled: k?.type !== 'mercenary', fontSize: 14, selected: free > 0 && k?.type !== 'mercenary',
    });
    if (isCompanion(c)) {
      const left = daysLeft(c.contract, state.day);
      button(this, X + 306, by, 120, 44, 'Renew', () => this.scene.start('Negotiate', { mode: 'renew', id: c.id }), {
        enabled: left <= 7, fontSize: 14, selected: left <= 0,
      });
      button(this, X + 436, by, 128, 44, 'Release', () => confirmDialog(this, `Release ${c.name} from their contract?\nThey go back to the guild hall.`, () => {
        leaveParty(state, c, c.contract.greed);
        markDirty();
        this.render();
      }, 'Release'), { fontSize: 14 });
      if (left > 7) text(this, X + 306, by - 18, 'Renewal opens in the last week.', { fontSize: '11px', color: COLORS.dim });
    } else if (k?.type === 'slave') {
      button(this, X + 306, by, 140, 44, 'Sell', () => confirmDialog(this, `Sell ${c.name} to the slave market for ${marketBuyPrice(state, c)} gold?`, () => {
        const gold = sellSlave(state, c.id, Math.random);
        markDirty();
        this.render();
        toast(this, `Sold for ${gold} gold.`);
      }, 'Sell'), { fontSize: 14 });
      const punished = isSlave(c) && c.contract.punishedDay === state.day;
      button(this, X + 456, by, 112, 44, 'Punish', () => confirmDialog(this,
        `Punish ${c.name}?\nObedience +${GUILD.slave.punishObedience}, relationship -${GUILD.slave.punishRelationship}.\nObedience will drift back down while relationship stays below ${GUILD.slave.obedienceFallBelow}.`, () => {
          const err = punishSlave(c, state.day);
          if (err) return toast(this, err, COLORS.bad);
          markDirty();
          this.render();
        }, 'Punish'), { fontSize: 14, enabled: !punished });
      if (punished) text(this, X + 456, by - 18, 'Punished today.', { fontSize: '11px', color: COLORS.dim });
    } else if (k?.type === 'mercenary') {
      button(this, X + 306, by, 140, 44, 'Dismiss', () => confirmDialog(this, `Dismiss ${c.name}? No refund.`, () => {
        leaveParty(state, c);
        markDirty();
        this.render();
      }, 'Dismiss'), { fontSize: 14 });
    }
  }
}
