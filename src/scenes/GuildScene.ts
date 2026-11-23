import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import type { FreeAdventurer, Quest } from '../data/types';
import { acceptQuest, canTakeQuest, lineupMembers, toggleLineup } from '../game/city';
import { joinParty, mercenaryRates, rosterFull, talentPriceFactor } from '../game/contracts';
import { groupLabel, payRating } from '../game/board';
import { adventurerCount, adventurerRank, leaderboard, nextRank, rankThreshold } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast, type ScrollItem } from '../ui/widgets';

type Tab = 'board' | 'hall' | 'ranks' | 'news';
const CARD_H = 132;
const TABS: [Tab, string][] = [['board', 'Quest Board'], ['hall', 'Guild Hall'], ['ranks', 'Leaderboard'], ['news', 'Guild News']];

/** The Adventurer Guild: quests, recruiting, the party leaderboard and the guild's news. */
export class GuildScene extends Phaser.Scene {
  private tab: Tab = 'board';
  /** Quest board filter: every quest, or only the ones the party can take. */
  private allQuests = false;

  constructor() {
    super('Guild');
  }

  init(data: { tab?: Tab }): void {
    if (data.tab) this.tab = data.tab;
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
    cityHeader(this, state, 'Adventurer Guild');
    TABS.forEach(([id, label], i) => button(this, 16 + i * 158, 74, 150, 34, label, () => {
      this.tab = id;
      this.render();
    }, { selected: this.tab === id, fontSize: 15 }));
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    if (this.tab === 'board') this.board();
    else if (this.tab === 'hall') this.hall();
    else if (this.tab === 'ranks') this.ranks();
    else this.news();
  }

  // ---- quest board ------------------------------------------------------------------------------

  private board(): void {
    const state = requireState();
    const lineup = lineupMembers(state);
    const up = nextRank(state.rank);
    const status = state.quest
      ? `Accepted: ${state.quest.title}. Set out from the city screen.`
      : `Your party is ${state.rank} rank: it can take ${state.rank}-rank quests and below.${up ? ` ${up}-rank promotion quest at ${rankThreshold(up)} renown (you have ${Math.round(state.renown)}).` : ''}`;
    text(this, 20, 116, status, { fontSize: '14px', color: state.quest ? COLORS.gold : COLORS.text });
    text(this, 20, 136, `Lineup (${lineup.length}/${MAX_PARTY_SIZE}): ${lineup.map((c) => `${c.name} Lv${c.level}`).join(', ')}   (change it in Manage Party)`, {
      fontSize: '12px', color: COLORS.dim,
    });
    const all = state.guild.board;
    const mine = all.filter((q) => canTakeQuest(state, q));
    const quests = this.allQuests ? all : mine;
    button(this, 16, 156, 200, 28, `Quests you can take (${mine.length})`, () => {
      this.allQuests = false;
      this.render();
    }, { selected: !this.allQuests, fontSize: 12 });
    button(this, 224, 156, 160, 28, `All quests (${all.length})`, () => {
      this.allQuests = true;
      this.render();
    }, { selected: this.allQuests, fontSize: 12 });
    text(this, 396, 162, 'Rival parties take quests from this board every day; the best deals go first.', { fontSize: '12px', color: COLORS.dim });
    const list = new ScrollList(this, 16, 192, WIDTH - 32, HEIGHT - 208, 8);
    const rows: ScrollItem[] = [];
    for (let i = 0; i < quests.length; i += 2) {
      const row = this.add.container(0, 0);
      quests.slice(i, i + 2).forEach((q, k) => row.add(this.questCard(q, k * 464, 0)));
      rows.push({ obj: row, height: CARD_H });
    }
    list.setItems(rows, 'keep');
    if (quests.length === 0) text(this, WIDTH / 2, 320, 'No quests you can take right now. Check back tomorrow.', { color: COLORS.dim }).setOrigin(0.5);
    if (state.quest) {
      button(this, WIDTH - 196, 112, 180, 36, 'Set out now', () => this.scene.start('City'), { fill: 0x4a2a22, fontSize: 14 });
    }
  }

  private questCard(q: Quest, x: number, y: number): Phaser.GameObjects.Container {
    const state = requireState();
    const allowed = canTakeQuest(state, q);
    const W = 452;
    const c = this.add.container(x, y);
    c.add(panel(this, 0, 0, W, CARD_H, allowed ? COLORS.panel : 0x141722));
    if (q.promotion) c.add(this.add.rectangle(0, 0, W, CARD_H).setOrigin(0).setStrokeStyle(2, COLORS.accent));
    c.add(rankBadge(this, 10, 10, q.rank, 26));
    c.add(text(this, 44, 10, q.title, { fontSize: '16px', color: allowed ? COLORS.text : COLORS.dim, wordWrap: { width: W - 54 } }));
    const group = groupLabel(q);
    c.add(text(this, 44, 32, `${q.promotion ? 'PROMOTION · ' : ''}Enemy level ${q.stage}${group ? ` · ${group}` : ''} · ${q.days} day${q.days > 1 ? 's' : ''} away${q.promotion ? '' : ` · until day ${q.expires}`}`, {
      fontSize: '12px', color: group === 'Large band' ? '#e08a5a' : COLORS.dim,
    }));
    c.add(text(this, 10, 52, q.description, { fontSize: '12px', wordWrap: { width: W - 20 }, color: allowed ? COLORS.text : COLORS.dim }));
    c.add(text(this, 10, 100, `${q.reward} gold`, { fontSize: '17px', color: COLORS.gold }));
    const pay = payRating(q);
    if (pay !== 'fair') c.add(text(this, 100, 104, pay === 'generous' ? 'Generous pay' : 'Poor pay', { fontSize: '12px', color: pay === 'generous' ? '#6fdc8c' : COLORS.bad }));
    c.add(text(this, 196, 104, `Renown +${q.renown}`, { fontSize: '12px', color: COLORS.dim }));
    if (!allowed) {
      c.add(text(this, W - 10, 104, q.promotion ? `Needs ${rankThreshold(q.rank)} renown` : `Requires ${q.rank} rank`, { fontSize: '12px', color: COLORS.bad }).setOrigin(1, 0));
      return c;
    }
    c.add(button(this, W - 122, 92, 112, 32, 'Accept', () => {
      const err = acceptQuest(state, q.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `Accepted "${q.title}". Set out from the city screen when ready.`);
    }, { enabled: !state.quest, fontSize: 14 }));
    return c;
  }

  // ---- guild hall: mercenaries and companions -------------------------------------------------------

  private hall(): void {
    const state = requireState();
    const pool = [...state.guild.pool].sort((a, b) => b.character.level - a.character.level || a.character.name.localeCompare(b.character.name));
    text(this, 20, 118, `Free adventurers in the hall: ${pool.length}.  Hire one as a mercenary for your next quest, or negotiate a companion contract.`, {
      fontSize: '13px', wordWrap: { width: 920 },
    });
    text(this, 20, 138, `Your party: ${state.party.length}/${GUILD.maxRoster} members · ${state.gold} gold`, { fontSize: '12px', color: COLORS.dim });
    panel(this, 16, 160, WIDTH - 32, HEIGHT - 176);
    const list = new ScrollList(this, 24, 168, WIDTH - 46, HEIGHT - 192, 4);
    list.setItems(pool.map((a) => this.hallRow(a)), 'top');
    if (pool.length === 0) text(this, WIDTH / 2, 300, 'Nobody is looking for work today. Come back tomorrow.', { color: COLORS.dim }).setOrigin(0.5);
  }

  private hallRow(a: FreeAdventurer): ScrollItem {
    const state = requireState();
    const c = a.character;
    const row = this.add.container(0, 0);
    row.add(this.add.rectangle(0, 0, WIDTH - 54, 84, COLORS.panelLight, 0.5).setOrigin(0));
    row.add(figure(this, 30, 72, 64, c.appearance, c.weaponId, { base: false }));
    const name = text(this, 64, 6, `${c.name}`, { fontSize: '17px' });
    row.add(name);
    // Talent: a talented adventurer asks more.
    row.add(talentTag(this, 64 + name.width + 12, 10, c, { fontSize: 12, detail: false }));
    row.add(text(this, 64, 28, `Level ${c.level} (${adventurerRank(c.level)}-rank) · ${WEAPONS[c.weaponId].name}`, { fontSize: '13px', color: COLORS.gold }));
    row.add(talentTag(this, 64, 47, c, { fontSize: 11, overall: false, sep: '   ' }));
    row.add(text(this, 64, 64, c.skillIds.map((s) => SKILLS[s].name).join(', ') || 'No tree skills yet', { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 300 } }));
    const rates = mercenaryRates(c.level, a.greed, talentPriceFactor(c));
    row.add(text(this, 392, 8, 'Mercenary (next quest only)', { fontSize: '12px', color: COLORS.dim }));
    row.add(button(this, 392, 28, 248, 32, `Hire: ${rates.fee}g or ${rates.cutPct}%, whichever is more`, () => this.hireMerc(a, rates.fee, rates.cutPct), {
      fontSize: 12, enabled: state.gold >= rates.fee,
    }));
    row.add(text(this, 392, 64, 'Fee paid now; a bigger cut is taken from the reward.', { fontSize: '11px', color: COLORS.dim }));
    row.add(text(this, 668, 16, 'Companion (permanent)', { fontSize: '12px', color: COLORS.dim }));
    const sulking = a.refusedUntil > state.day;
    row.add(button(this, 668, 36, 220, 32, sulking ? `Won't talk until day ${a.refusedUntil}` : 'Negotiate a contract', () => {
      if (rosterFull(state)) return toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
      this.scene.start('Negotiate', { mode: 'hire', id: c.id });
    }, { fontSize: 14, enabled: !sulking }));
    return { obj: row, height: 84 };
  }

  private hireMerc(a: FreeAdventurer, fee: number, cutPct: number): void {
    const state = requireState();
    if (rosterFull(state)) return toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
    const msg = `Hire ${a.character.name} (Lv ${a.character.level})?\nPaid the larger of ${fee} gold (now) and ${cutPct}% of the reward.\nMercenaries leave after the next quest.`;
    confirmDialog(this, msg, () => {
      if (state.gold < fee) return toast(this, 'Not enough gold.', COLORS.bad);
      state.gold -= fee;
      const c = joinParty(state, a, { type: 'mercenary', fee, cutPct });
      const err = toggleLineup(state, c.id);
      markDirty();
      this.render();
      toast(this, err ? `${c.name} joined, but the lineup is full: swap someone out in Manage Party.` : `${c.name} joined and will go on your next quest.`);
    }, 'Hire');
  }

  // ---- leaderboard ----------------------------------------------------------------------------------

  private ranks(): void {
    const state = requireState();
    const board = leaderboard(state);
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of board) counts[e.rank] += 1;
    text(this, 20, 118, `${board.length} parties · ${adventurerCount(state)} active adventurers · A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D}. Rank up at C ${GUILD.ranks.renown.C} / B ${GUILD.ranks.renown.B} / A ${GUILD.ranks.renown.A} renown + a promotion quest.`, {
      fontSize: '13px', wordWrap: { width: 920 },
    });
    panel(this, 16, 144, WIDTH - 32, HEIGHT - 160);
    const cols = [[30, '#'], [64, 'Rank'], [110, 'Party'], [370, 'Renown'], [450, 'Members'], [530, 'Avg Lv'], [600, 'W / L'], [680, 'Latest']] as const;
    for (const [x, h] of cols) text(this, x, 152, h, { fontSize: '12px', color: COLORS.dim });
    const list = new ScrollList(this, 24, 174, WIDTH - 46, HEIGHT - 196, 2);
    list.setItems(board.map((e, i) => {
      const row = this.add.container(0, 0);
      const color = e.isPlayer ? COLORS.gold : COLORS.text;
      if (e.isPlayer) row.add(this.add.rectangle(0, 0, WIDTH - 54, 24, 0x4a3d1c, 0.6).setOrigin(0));
      row.add(text(this, 6, 4, String(i + 1), { fontSize: '14px', color }));
      row.add(rankBadge(this, 46, 1, e.rank, 22));
      row.add(text(this, 86, 4, e.isPlayer ? `${e.name} (you)` : e.name, { fontSize: '14px', color }));
      row.add(text(this, 346, 4, String(Math.round(e.renown)), { fontSize: '14px', color }));
      row.add(text(this, 426, 4, String(e.members), { fontSize: '14px', color }));
      row.add(text(this, 506, 4, e.avgLevel.toFixed(1), { fontSize: '14px', color }));
      row.add(text(this, 576, 4, `${e.wins} / ${e.losses}`, { fontSize: '14px', color }));
      row.add(text(this, 656, 5, e.last, { fontSize: '12px', color: COLORS.dim }));
      return { obj: row, height: 24 };
    }), 'top');
  }

  // ---- news -------------------------------------------------------------------------------------------

  private news(): void {
    const state = requireState();
    text(this, 20, 118, 'Comings and goings at the guild: quests, losses, new parties and new arrivals.', { fontSize: '13px' });
    panel(this, 16, 144, WIDTH - 32, HEIGHT - 160);
    const list = new ScrollList(this, 26, 152, WIDTH - 50, HEIGHT - 176, 6);
    const items = [...state.guild.news].reverse().map((n) => {
      const t = text(this, 0, 0, `Day ${n.day}: ${n.text}`, { fontSize: '13px', wordWrap: { width: WIDTH - 70 } });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    });
    list.setItems(items, 'top');
    if (items.length === 0) text(this, WIDTH / 2, 300, 'Nothing yet. Stay at an inn or go on a quest and see what happens.', { color: COLORS.dim }).setOrigin(0.5);
  }
}
