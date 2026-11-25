import Phaser from 'phaser';
import { SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import { STAT_INFO, type Character, type CompanionTerms, type FreeAdventurer } from '../data/types';
import { TALENT_COLORS, talentOf, talentStats } from '../game/talent';
import { renewContract, toggleLineup } from '../game/city';
import {
  companionContract, evaluateOffer, talentPriceFactor, foodLodgingWeekly, isCompanion, joinParty, leaveParty, lootValue, openingTerms, patienceCost, rosterFull,
  type CompanionContract,
} from '../game/contracts';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, ScrollList, WIDTH, button, figure, fittedList, panel, setupCamera, talentTag, text, toast, clearScene } from '../ui/widgets';

interface NegotiateData {
  /** hire: a free adventurer from the guild hall. renew: a companion whose contract is ending. */
  mode: 'hire' | 'renew';
  id: string;
}

const greedWord = (g: number) => (g < 0.9 ? 'Modest' : g < 1.05 ? 'Fair-minded' : g < 1.15 ? 'Ambitious' : 'Greedy');

/** Negotiate a companion contract: base pay, loot cut, food & lodging and term length. */
export class NegotiateScene extends Phaser.Scene {
  private mode: 'hire' | 'renew' = 'hire';
  private id = '';
  private terms!: CompanionTerms;
  private talk: string[] = [];
  /** Patience for renewals (hall candidates keep theirs between visits). */
  private renewPatience = GUILD.companion.patience;
  private done = false;
  /** Who we're talking to, kept for display once they've joined (or left). */
  private last: ReturnType<NegotiateScene['who']> = null;

  constructor() {
    super('Negotiate');
  }

  init(data: NegotiateData): void {
    this.mode = data.mode;
    this.id = data.id;
    this.done = false;
    this.last = null;
    this.renewPatience = GUILD.companion.patience;
    const state = requireState();
    const who = this.who();
    if (!who) return;
    if (this.mode === 'renew' && isCompanion(who.character)) {
      const k = who.character.contract;
      this.terms = { basePay: k.basePay, lootPct: k.lootPct, foodLodging: k.foodLodging, termWeeks: k.termWeeks };
      this.talk = [`${who.character.name}: "My contract is up. Let's talk about what comes next."`];
    } else {
      this.terms = openingTerms(who.character.level, who.greed, state.rank, 0, talentPriceFactor(who.character));
      this.talk = [`${who.character.name}: "Looking for a companion, are you? Let's hear your offer."`];
    }
  }

  /** The person across the table. */
  private who(): { character: Character; greed: number; relationship: number; free?: FreeAdventurer; contract?: CompanionContract } | null {
    const state = requireState();
    if (this.mode === 'hire') {
      const free = state.guild.pool.find((a) => a.character.id === this.id);
      return free ? { character: free.character, greed: free.greed, relationship: 0, free } : null;
    }
    const c = state.party.find((m) => m.id === this.id);
    if (!c || !isCompanion(c)) return null;
    return { character: c, greed: c.contract.greed, relationship: c.contract.relationship, contract: c.contract };
  }

  private patience(): number {
    const w = this.who();
    return this.mode === 'hire' ? (w?.free?.patience ?? 0) : this.renewPatience;
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.render();
  }

  private leave(): void {
    if (this.mode === 'hire') this.scene.start('Guild', { tab: 'hall' });
    else this.scene.start('Party', { selected: this.id });
  }

  private render(): void {
    clearScene(this);
    const state = requireState();
    cityHeader(this, state, this.mode === 'hire' ? 'Negotiation' : 'Contract Renewal');
    const who = this.who() ?? this.last;
    this.last = who;
    if (!who) {
      text(this, WIDTH / 2, 300, 'They are no longer here.', { color: COLORS.dim }).setOrigin(0.5);
      button(this, WIDTH / 2 - 100, 360, 200, 44, 'Back', () => this.leave());
      return;
    }
    const c = who.character;
    const t = this.terms;

    // ---- left: who ----
    panel(this, 16, 76, 300, 488);
    figure(this, 90, 270, 170, c.appearance, c.weaponId);
    text(this, 170, 96, c.name, { fontSize: '22px', wordWrap: { width: 140 } });
    text(this, 170, 126, `Level ${c.level} · ${adventurerRank(c.level)}-rank`, { fontSize: '15px', color: COLORS.gold });
    text(this, 170, 148, WEAPONS[c.weaponId].name, { fontSize: '13px', color: COLORS.dim, wordWrap: { width: 140 } });
    text(this, 170, 170, greedWord(who.greed), { fontSize: '13px', color: COLORS.dim });
    talentTag(this, 170, 192, c, { fontSize: 13, detail: false });
    talentStats().forEach((k, i) => {
      const g = talentOf(c, k);
      text(this, 170, 212 + i * 16, STAT_INFO[k].short, { fontSize: '12px', color: COLORS.dim });
      text(this, 220, 212 + i * 16, g, { fontSize: '12px', color: TALENT_COLORS[g], fontStyle: 'bold' });
    });
    fittedList(this, 30, 314, c.skillIds.map((s) => SKILLS[s].name), 2, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 272 } },
      (shown, hidden) => `Skills: ${shown.join(', ')}${hidden ? ` +${hidden} more` : ''}`, 'Skills: none yet');
    if (this.mode === 'renew') {
      text(this, 30, 350, `Relationship ${Math.round(who.relationship)}/100`, { fontSize: '14px' });
      const g = this.add.graphics();
      g.fillStyle(0x0b0d14).fillRect(30, 372, 272, 10);
      g.fillStyle(0xe05a9b).fillRect(30, 372, 2.72 * who.relationship, 10);
      text(this, 30, 386, 'Quests together raise it. A good relationship lowers what they ask on renewal.', { fontSize: '11px', color: COLORS.dim, wordWrap: { width: 272 } });
    }
    text(this, 30, 420, 'How they value things', { fontSize: '13px', color: COLORS.dim });
    text(this, 30, 440, [
      `Food & lodging: ${foodLodgingWeekly(c.level)} gold/week (what a ${adventurerRank(c.level)}-rank expects)`,
      `1% loot cut: ~${lootValue(1, state.rank).toFixed(1)} gold/week`,
      `(a ${state.rank}-rank party earns about ${GUILD.companion.expectedWeeklyLoot[state.rank]} a week)`,
      'Longer terms: they ask a bit less per week.',
    ].join('\n'), { fontSize: '12px', lineSpacing: 3, wordWrap: { width: 272 } });
    const p = this.patience();
    text(this, 30, 528, `Patience: ${'●'.repeat(Math.max(0, p))}${'○'.repeat(Math.max(0, GUILD.companion.patience - p))}`, { fontSize: '16px', color: p > 1 ? COLORS.text : COLORS.bad });

    // ---- middle: terms ----
    const X = 332;
    panel(this, X, 76, 320, 488);
    text(this, X + 14, 86, 'Your offer', { fontSize: '18px', color: COLORS.gold });
    const step = (y: number, label: string, value: string, minus: () => void, plus: () => void, big?: [() => void, () => void]) => {
      text(this, X + 14, y, label, { fontSize: '13px', color: COLORS.dim });
      if (big) button(this, X + 14, y + 20, 44, 34, '−−', big[0], { fontSize: 14, enabled: !this.done });
      button(this, X + 62, y + 20, 40, 34, '−', minus, { fontSize: 16, enabled: !this.done });
      text(this, X + 160, y + 37, value, { fontSize: '18px' }).setOrigin(0.5);
      button(this, X + 218, y + 20, 40, 34, '+', plus, { fontSize: 16, enabled: !this.done });
      if (big) button(this, X + 262, y + 20, 44, 34, '++', big[1], { fontSize: 14, enabled: !this.done });
    };
    const set = (f: () => void) => () => {
      f();
      this.render();
    };
    step(118, 'Base pay (every 7th day)', `${t.basePay} gold`, set(() => (t.basePay = Math.max(0, t.basePay - 5))), set(() => (t.basePay += 5)),
      [set(() => (t.basePay = Math.max(0, t.basePay - 25))), set(() => (t.basePay += 25))]);
    step(184, 'Cut of each quest reward', `${t.lootPct}%`, set(() => (t.lootPct = Math.max(0, t.lootPct - 1))), set(() => (t.lootPct = Math.min(50, t.lootPct + 1))),
      [set(() => (t.lootPct = Math.max(0, t.lootPct - 5))), set(() => (t.lootPct = Math.min(50, t.lootPct + 5)))]);
    text(this, X + 14, 250, 'Food and lodging', { fontSize: '13px', color: COLORS.dim });
    button(this, X + 14, 270, 140, 34, 'Included', set(() => (t.foodLodging = true)), { selected: t.foodLodging, fontSize: 14, enabled: !this.done });
    button(this, X + 162, 270, 144, 34, 'Not included', set(() => (t.foodLodging = false)), { selected: !t.foodLodging, fontSize: 14, enabled: !this.done });
    text(this, X + 14, 316, 'Contract term', { fontSize: '13px', color: COLORS.dim });
    GUILD.companion.terms.forEach((w, i) => button(this, X + 14 + i * 74, 336, 68, 34, `${w} wk`, set(() => (t.termWeeks = w)), {
      selected: t.termWeeks === w, fontSize: 14, enabled: !this.done,
    }));
    const weekly = t.basePay + (t.foodLodging ? foodLodgingWeekly(who.character.level) : 0);
    text(this, X + 14, 384, [
      `Costs you ${weekly} gold a week${t.foodLodging ? ` (${t.basePay} pay + ${foodLodgingWeekly(who.character.level)} food & lodging)` : ''}`,
      `+ ${t.lootPct}% of rewards · ${weekly * t.termWeeks} gold over ${t.termWeeks} weeks`,
    ].join('\n'), { fontSize: '13px', lineSpacing: 4, wordWrap: { width: 292 } });
    button(this, X + 14, 456, 292, 46, 'Make offer', () => this.offer(), { fill: 0x2c4a2f, fontSize: 18, enabled: !this.done });
    button(this, X + 14, 510, 292, 40, this.done ? 'Done' : 'Leave the table', () => this.leave(), { fontSize: 15 });

    // ---- right: the conversation ----
    panel(this, 668, 76, 276, 488);
    text(this, 680, 86, 'Conversation', { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, 678, 108, 258, 448, 8);
    list.setItems(this.talk.map((line) => {
      const tx = text(this, 0, 0, line, { fontSize: '13px', wordWrap: { width: 246 }, lineSpacing: 2, color: line.startsWith('You') ? COLORS.dim : COLORS.text });
      return { obj: this.add.container(0, 0, [tx]), height: tx.height };
    }), 'end');
  }

  private offer(): void {
    const state = requireState();
    const who = this.who();
    if (!who || this.done) return;
    const t = this.terms;
    this.talk.push(`You offer ${t.basePay} gold a week, ${t.lootPct}% of rewards, food & lodging ${t.foodLodging ? 'included' : 'not included'}, for ${t.termWeeks} weeks.`);
    const res = evaluateOffer({ name: who.character.name, level: who.character.level, greed: who.greed, relationship: who.relationship, patience: this.patience(), talent: talentPriceFactor(who.character) }, t, state.rank);
    this.talk.push(res.message);
    const cost = patienceCost(res);
    if (res.verdict === 'accept') {
      this.done = true;
      if (this.mode === 'hire' && who.free) {
        if (rosterFull(state)) {
          toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
          return;
        }
        const c = joinParty(state, who.free, companionContract({ ...t }, state.day, who.greed, GUILD.companion.startingRelationship));
        const err = toggleLineup(state, c.id);
        this.talk.push(err ? `${c.name} joins the party. (The lineup is full; ${c.name} waits in reserve.)` : `${c.name} joins the party and the lineup.`);
      } else if (who.contract) {
        this.talk.push(...renewContract(state, who.character.id, { ...t }));
        this.talk.push(`The new contract runs until day ${who.contract.endDay}.`);
      }
      markDirty();
    } else if (this.mode === 'hire' && who.free) {
      who.free.patience = Math.max(0, who.free.patience - cost);
      if (res.verdict === 'walkout') {
        who.free.patience = 0;
        who.free.refusedUntil = state.day + 7;
        this.done = true;
      }
      markDirty();
    } else {
      this.renewPatience = Math.max(0, this.renewPatience - cost);
      if (res.verdict === 'walkout') {
        this.done = true;
        leaveParty(state, who.character, who.greed);
        this.talk.push(`${who.character.name} packs up and leaves the party.`);
        markDirty();
      }
    }
    this.render();
  }
}
