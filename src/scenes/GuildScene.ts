import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import type { FreeAdventurer, Quest } from '../data/types';
import { acceptQuest, canTakeQuest, lineupMembers, toggleLineup } from '../game/city';
import { joinParty, mercenaryRates, rosterFull } from '../game/contracts';
import { adventurerCount, leaderboard } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';

type Tab = 'board' | 'hall' | 'ranks' | 'news';
const TABS: [Tab, string][] = [['board', 'Quest Board'], ['hall', 'Guild Hall'], ['ranks', 'Leaderboard'], ['news', 'Guild News']];

/** The Adventurer Guild: quests, recruiting, the party leaderboard and the guild's news. */
export class GuildScene extends Phaser.Scene {
  private tab: Tab = 'board';

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
    const status = state.quest
      ? `Accepted: ${state.quest.title}. Set out from the city screen.`
      : `Your party is ${state.rank} rank: it can take ${state.rank}-rank quests and below.`;
    text(this, 20, 118, status, { fontSize: '14px', color: state.quest ? COLORS.gold : COLORS.text });
    text(this, 20, 138, `Lineup (${lineup.length}/${MAX_PARTY_SIZE}): ${lineup.map((c) => `${c.name} Lv${c.level}`).join(', ')}   (change it in Party Quarters)`, {
      fontSize: '12px', color: COLORS.dim,
    });
    const quests = state.guild.board;
    quests.forEach((q, i) => this.questCard(q, 16 + (i % 2) * 468, 162 + Math.floor(i / 2) * 156));
    if (state.quest) {
      button(this, WIDTH - 236, HEIGHT - 50, 220, 40, 'Set out now', () => this.scene.start('City'), { fill: 0x4a2a22, fontSize: 15 });
    }
  }

  private questCard(q: Quest, x: number, y: number): void {
    const state = requireState();
    const allowed = canTakeQuest(state, q);
    panel(this, x, y, 460, 146, allowed ? COLORS.panel : 0x141722);
    rankBadge(this, x + 12, y + 12, q.rank, 28);
    text(this, x + 50, y + 12, q.title, { fontSize: '17px', color: allowed ? COLORS.text : COLORS.dim, wordWrap: { width: 396 } });
    text(this, x + 50, y + 36, `Stage ${q.stage} · ${q.days} day${q.days > 1 ? 's' : ''} away · on the board until day ${q.expires}`, { fontSize: '12px', color: COLORS.dim });
    text(this, x + 12, y + 58, q.description, { fontSize: '13px', wordWrap: { width: 436 }, color: allowed ? COLORS.text : COLORS.dim });
    text(this, x + 12, y + 110, `${q.reward} gold`, { fontSize: '18px', color: COLORS.gold });
    text(this, x + 120, y + 114, `Renown +${q.renown}`, { fontSize: '13px', color: COLORS.dim });
    if (!allowed) {
      text(this, x + 448, y + 116, `Requires ${q.rank} rank`, { fontSize: '13px', color: COLORS.bad }).setOrigin(1, 0);
      return;
    }
    button(this, x + 318, y + 102, 130, 34, 'Accept', () => {
      const err = acceptQuest(state, q.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `Accepted "${q.title}". Set out from the city screen when ready.`);
    }, { enabled: !state.quest, fontSize: 15 });
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
    row.add(this.add.rectangle(0, 0, WIDTH - 54, 68, COLORS.panelLight, 0.5).setOrigin(0));
    row.add(figure(this, 30, 64, 60, c.appearance, c.weaponId, { base: false }));
    row.add(text(this, 64, 6, `${c.name}`, { fontSize: '17px' }));
    row.add(text(this, 64, 28, `Level ${c.level} · ${WEAPONS[c.weaponId].name}`, { fontSize: '13px', color: COLORS.gold }));
    row.add(text(this, 64, 46, c.skillIds.map((s) => SKILLS[s].name).join(', ') || 'No tree skills yet', { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 300 } }));
    const rates = mercenaryRates(c.level, a.greed);
    row.add(text(this, 392, 8, 'Mercenary (next quest only)', { fontSize: '12px', color: COLORS.dim }));
    row.add(button(this, 392, 28, 120, 32, `${rates.fee} gold`, () => this.hireMerc(a, 'fixed', rates.fee), {
      fontSize: 14, enabled: state.gold >= rates.fee,
    }));
    row.add(button(this, 520, 28, 120, 32, `${rates.cutPct}% of reward`, () => this.hireMerc(a, 'cut', rates.cutPct), { fontSize: 14 }));
    row.add(text(this, 668, 8, 'Companion (permanent)', { fontSize: '12px', color: COLORS.dim }));
    const sulking = a.refusedUntil > state.day;
    row.add(button(this, 668, 28, 220, 32, sulking ? `Won't talk until day ${a.refusedUntil}` : 'Negotiate a contract', () => {
      if (rosterFull(state)) return toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
      this.scene.start('Negotiate', { mode: 'hire', id: c.id });
    }, { fontSize: 14, enabled: !sulking }));
    return { obj: row, height: 68 };
  }

  private hireMerc(a: FreeAdventurer, pay: 'fixed' | 'cut', amount: number): void {
    const state = requireState();
    if (rosterFull(state)) return toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
    const terms = pay === 'fixed' ? `${amount} gold now` : `${amount}% of the next quest's reward`;
    confirmDialog(this, `Hire ${a.character.name} (Lv ${a.character.level}) for ${terms}?\nMercenaries leave after the next quest.`, () => {
      if (pay === 'fixed') {
        if (state.gold < amount) return toast(this, 'Not enough gold.', COLORS.bad);
        state.gold -= amount;
      }
      const c = joinParty(state, a, { type: 'mercenary', pay, amount });
      const err = toggleLineup(state, c.id);
      markDirty();
      this.render();
      toast(this, err ? `${c.name} joined, but the lineup is full: swap someone out in Party Quarters.` : `${c.name} joined and will go on your next quest.`);
    }, 'Hire');
  }

  // ---- leaderboard ----------------------------------------------------------------------------------

  private ranks(): void {
    const state = requireState();
    const board = leaderboard(state);
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const e of board) counts[e.rank] += 1;
    text(this, 20, 118, `${board.length} parties · ${adventurerCount(state)} active adventurers · A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D}. Ranks follow the leaderboard; renown fades over time.`, {
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
    if (items.length === 0) text(this, WIDTH / 2, 300, 'Nothing yet. Rest a day or go on a quest and see what happens.', { color: COLORS.dim }).setOrigin(0.5);
  }
}
