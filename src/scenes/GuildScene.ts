import Phaser from 'phaser';
import { MAX_PARTY_SIZE, SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import { ENEMIES } from '../data/enemies';
import type { FreeAdventurer, Quest } from '../data/types';
import { acceptQuest, canTakeQuest, lineupMembers, toggleLineup } from '../game/city';
import { joinParty, mercenaryRates, rosterFull, talentPriceFactor } from '../game/contracts';
import { dangerRating, expectedEnemies, payRating } from '../game/board';
import { adventurerCount, adventurerRank, leaderboard, nextRank, rankThreshold } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { PEOPLE_SORTS, QUEST_SORTS, nextSort, sortPeople, sortQuests, type PeopleSort, type QuestSort, type SortDir } from '../game/sorting';
import { cityHeader, rankBadge } from '../ui/hud';
import { ART_H, COLORS, HEIGHT, MONSTER_W, ScrollList, WIDTH, bakeGraphics, button, monsterKey, confirmDialog, figure, fittedList, panel, setupCamera, sortBar, talentTag, text, toast, type ScrollItem, clearScene } from '../ui/widgets';

type Tab = 'board' | 'hall' | 'ranks' | 'news';
const CARD_H = 132;
const TABS: [Tab, string][] = [['board', 'Quest Board'], ['hall', 'Guild Hall'], ['ranks', 'Leaderboard'], ['news', 'Guild News']];

/** The Adventurer Guild: quests, recruiting, the party leaderboard and the guild's news. */
export class GuildScene extends Phaser.Scene {
  private tab: Tab = 'board';
  /** Quest board filter: every quest, or only the ones the party can take. */
  private allQuests = false;
  /** Quest board order (highest rank first by default). */
  private questSort: { key: QuestSort; dir: SortDir } = { key: 'rank', dir: 'desc' };
  /** Guild hall order (highest level first by default). */
  private hallSort: { key: PeopleSort; dir: SortDir } = { key: 'level', dir: 'desc' };

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
    clearScene(this);
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
    const quests = sortQuests(this.allQuests ? all : mine, this.questSort.key, this.questSort.dir);
    button(this, 16, 156, 200, 28, `Quests you can take (${mine.length})`, () => {
      this.allQuests = false;
      this.render();
    }, { selected: !this.allQuests, fontSize: 12 });
    button(this, 224, 156, 160, 28, `All quests (${all.length})`, () => {
      this.allQuests = true;
      this.render();
    }, { selected: this.allQuests, fontSize: 12 });
    sortBar(this, 396, 157, QUEST_SORTS, this.questSort, (key) => {
      this.questSort = nextSort(this.questSort, key);
      this.render();
    }, { widths: { rank: 66, gold: 62, renown: 78, difficulty: 92, enemy: 100 } });
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

  /**
   * One foe on a quest card: a small copy of the enemy type's battle art for monsters, or a drawn head badge
   * for foes that are people in battle (see humanBadge).
   */
  private foeIcon(box: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, cx: number, y: number, allowed: boolean, type: string): void {
    const kind = ENEMIES[type]?.art.kind ?? 'human';
    const key = monsterKey(kind);
    if (kind !== 'human' && this.textures.exists(key)) {
      const h = 22; // small enough that big creatures (trolls, wyverns) stay clear of the title above
      const img = this.add.image(cx, y + 8, key).setOrigin(0.5, 76 / ART_H).setDisplaySize(MONSTER_W * (h / ART_H), h).setFlipX(true);
      if (!allowed) img.setTint(0x6d7286);
      box.add(img);
      return;
    }
    this.humanBadge(g, cx, y, type, allowed);
  }

  /** A head badge for foes drawn as people in battle: goblins, bandits, skeletons, orcs, sellswords, renegades. */
  private humanBadge(g: Phaser.GameObjects.Graphics, cx: number, y: number, type: string, allowed: boolean): void {
    const c = (v: number) => (allowed ? v : 0x6d7286);
    const eyes = (col: number, dy = 0) => g.fillStyle(c(col), 1).fillCircle(cx - 2.3, y - 0.5 + dy, 1.2).fillCircle(cx + 2.3, y - 0.5 + dy, 1.2);
    switch (type) {
      case 'goblin': // green, long pointed ears
        g.fillStyle(c(0x6fae4a), 1).fillTriangle(cx - 5, y - 2, cx - 4, y + 1, cx - 11, y - 5).fillTriangle(cx + 5, y - 2, cx + 4, y + 1, cx + 11, y - 5);
        g.fillEllipse(cx, y, 11, 12);
        eyes(0xffe27a);
        g.fillStyle(0x181c2b, 1).fillRect(cx - 2.5, y + 3, 5, 1.2);
        break;
      case 'bandit': // hood and a red face mask
        g.fillStyle(c(0x5a4636), 1).fillTriangle(cx - 7, y + 7, cx + 7, y + 7, cx, y - 9);
        g.fillEllipse(cx, y + 1, 12, 13);
        g.fillStyle(c(0xd8a882), 1).fillEllipse(cx, y + 1, 8, 9);
        g.fillStyle(c(0x2a2a30), 1).fillRect(cx - 4, y - 1.5, 8, 2.5);
        g.fillStyle(c(0xb03a2e), 1).fillRect(cx - 4, y + 2, 8, 3.5);
        break;
      case 'skeleton': // greenish bone under a rusted helmet, with green eyes (unlike the danger skulls)
        g.fillStyle(c(0xbfc6a4), 1).fillEllipse(cx, y + 0.5, 10, 10);
        g.fillRect(cx - 2.8, y + 3.5, 5.6, 3.5);
        g.fillStyle(c(0x6a4a32), 1).fillEllipse(cx, y - 3.5, 13, 7).fillRect(cx - 7, y - 2.5, 14, 2);
        g.fillStyle(c(0x8a6a4a), 1).fillRect(cx - 0.8, y - 7, 1.6, 4);
        g.fillStyle(0x0e1018, 1).fillEllipse(cx - 2.2, y + 0.8, 3, 3).fillEllipse(cx + 2.2, y + 0.8, 3, 3);
        g.fillStyle(c(0x7dff8a), 1).fillCircle(cx - 2.2, y + 0.8, 0.9).fillCircle(cx + 2.2, y + 0.8, 0.9);
        g.fillStyle(0x0e1018, 1).fillRect(cx - 1.6, y + 5, 0.8, 2).fillRect(cx + 0.8, y + 5, 0.8, 2);
        break;
      case 'orc': // square green head, dark brow, tusks
        g.fillStyle(c(0x6f8a4a), 1).fillRoundedRect(cx - 6.5, y - 6, 13, 13, 4);
        g.fillStyle(c(0x3a3a2a), 1).fillRect(cx - 6.5, y - 6, 13, 3);
        eyes(0xff5a3a);
        g.fillStyle(c(0xf0ead0), 1).fillTriangle(cx - 4, y + 4, cx - 2.5, y + 4, cx - 3.2, y + 1).fillTriangle(cx + 2.5, y + 4, cx + 4, y + 4, cx + 3.2, y + 1);
        break;
      case 'sellsword': // steel helmet with a nose guard
        g.fillStyle(c(0xd8a882), 1).fillEllipse(cx, y + 1.5, 9, 10);
        g.fillStyle(c(0xaab4c4), 1).fillEllipse(cx, y - 2.5, 13, 9).fillRect(cx - 7, y - 1, 14, 2);
        g.fillStyle(c(0x7a8494), 1).fillRect(cx - 0.7, y - 1, 1.4, 6);
        eyes(0x1a1a20, 1);
        break;
      default: // renegades (and any other people): a dark hood with red eyes
        g.fillStyle(c(0x3a2f4a), 1).fillTriangle(cx - 7, y + 8, cx + 7, y + 8, cx, y - 9);
        g.fillEllipse(cx, y + 1, 12, 12);
        g.fillStyle(0x0a0a12, 1).fillEllipse(cx, y + 1.5, 8, 8);
        eyes(0xff4a3a, 1.5);
    }
  }

  /**
   * A quest's foes at a glance: an icon per enemy expected, cycling through its enemy types (left), and skulls for how
   * hard it is on one scale for the whole game (right): `danger` 0.5-5 as white skulls, 5.5-10 as red ones over them.
   * Hovering says the same in words.
   */
  private questIcons(x: number, y: number, enemies: number, danger: number, cardW: number, allowed: boolean, types: string[]): Phaser.GameObjects.Container {
    const box = this.add.container(0, 0);
    // Drawn off the display list, then baked into a texture once everything is drawn (see bakeGraphics).
    const g = this.make.graphics({}, false);
    for (let i = 0; i < enemies; i++) this.foeIcon(box, g, x + 9 + i * 16, y, allowed, types[i % types.length]);
    // Skulls: white up to `danger` (in halves) for 0.5-5, then red laid over them for 5.5-10; the rest dark.
    const fromX = cardW - 12 - 5 * 18;
    const white = !allowed ? 0x9aa3bd : 0xe8dcc0;
    const red = !allowed ? 0x7a6470 : 0xe0503c;
    const dark = !allowed ? 0x4a5066 : 0x3a4158;
    const skull = (cx: number, color: number, half: boolean) => {
      if (half) {
        g.fillStyle(color, 1).slice(cx, y - 1, 6, Math.PI / 2, (3 * Math.PI) / 2).fillPath();
        g.fillRect(cx - 3.5, y + 2, 3.5, 5);
      } else {
        g.fillStyle(color, 1).fillCircle(cx, y - 1, 6);
        g.fillRect(cx - 3.5, y + 2, 7, 5);
      }
    };
    for (let i = 0; i < 5; i++) {
      const cx = fromX + 8 + i * 18;
      const w = danger - i; // white: 1+ whole, 0.5 left half
      const r = danger - 5 - i; // red over it: 1+ whole, 0.5 left half
      skull(cx, w >= 1 ? white : dark, false);
      if (w === 0.5) skull(cx, white, true);
      if (r >= 1) skull(cx, red, false);
      else if (r === 0.5) skull(cx, red, true);
      g.fillStyle(0x181c2b, 1).fillCircle(cx - 2.3, y - 1.5, 1.7).fillCircle(cx + 2.3, y - 1.5, 1.7);
      g.fillRect(cx - 2, y + 4.5, 1, 2.5).fillRect(cx + 1, y + 4.5, 1, 2.5);
    }
    // Badges reach from x - 3 (goblin ears) to the last skull at cardW - 16, and y - 9 to y + 8.
    box.addAt(bakeGraphics(this, g, { x: x - 4, y: y - 11, w: cardW - x + 4, h: 22 }), 0);
    const crowd = enemies <= 2 ? 'A couple of foes' : enemies <= 4 ? 'A handful of foes' : enemies <= 7 ? 'A sizeable band' : 'A horde';
    const peril = danger <= 2 ? 'Work for beginners' : danger <= 4 ? 'Work for seasoned hands' : danger <= 6 ? 'A job for veterans'
      : danger <= 8 ? 'A job for elites' : 'Only for the very best';
    const hit = this.add.rectangle(x - 4, y - 10, cardW - x - 4, 20, 0xffffff, 0).setOrigin(0).setInteractive();
    const tip = text(this, x, y + 10, `${crowd} (about ${enemies}). ${peril}.`, {
      fontSize: '11px', color: COLORS.text, backgroundColor: '#000000d0', padding: { x: 6, y: 3 },
    }).setVisible(false).setDepth(5);
    hit.on('pointerover', () => tip.setVisible(true));
    hit.on('pointerout', () => tip.setVisible(false));
    box.add([hit, tip]);
    return box;
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
    // The foes at a glance: an icon per enemy expected, and up to ten skulls (white, then red) for how hard the quest is.
    const enemies = expectedEnemies(q);
    const danger = dangerRating(q);
    c.add(this.questIcons(44, 40, enemies, danger, W, allowed, q.foes?.length ? q.foes : ['bandit']));
    c.add(text(this, 10, 56, q.description, { fontSize: '12px', wordWrap: { width: W - 20 }, color: allowed ? COLORS.text : COLORS.dim }));
    const days = ['', "A day's", 'A two-day', 'A three-day', 'A four-day', 'A five-day'][q.days] ?? `A ${q.days}-day`;
    const when = q.promotion ? 'The guild holds this trial open' : `The notice comes down after day ${q.expires}`;
    c.add(text(this, 10, 86, `${days} journey · ${when}.`, { fontSize: '11px', color: COLORS.dim, fontStyle: 'italic', wordWrap: { width: W - 140 } }));
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
    const fee = (a: FreeAdventurer) => mercenaryRates(a.character.level, a.greed, talentPriceFactor(a.character)).fee;
    const pool = sortPeople(state.guild.pool, (a) => a.character, fee, this.hallSort.key, this.hallSort.dir);
    text(this, 20, 118, `Free adventurers in the hall: ${pool.length}.  Hire one as a mercenary for your next quest, or negotiate a companion contract.`, {
      fontSize: '13px', wordWrap: { width: 920 },
    });
    text(this, 20, 138, `Your party: ${state.party.length}/${GUILD.maxRoster} members · ${state.gold} gold`, { fontSize: '12px', color: COLORS.dim });
    sortBar(this, WIDTH - 16 - 318, 134, PEOPLE_SORTS, this.hallSort, (key) => {
      this.hallSort = nextSort(this.hallSort, key);
      this.render();
    }, { h: 22, fontSize: 11, widths: { level: 66, talent: 68, name: 60, cost: 56 } });
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
    row.add(fittedList(this, 64, 64, c.skillIds.map((s) => SKILLS[s].name), 1, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 316 } }, undefined, 'No tree skills yet'));
    const rates = mercenaryRates(c.level, a.greed, talentPriceFactor(c));
    row.add(text(this, 392, 8, 'Mercenary (next quest only)', { fontSize: '12px', color: COLORS.dim }));
    row.add(button(this, 392, 28, 248, 32, `Hire: ${rates.fee}g or ${rates.cutPct}%, whichever is more`, () => this.hireMerc(a, rates.fee, rates.cutPct), {
      fontSize: 12, enabled: state.gold >= rates.fee,
    }));
    row.add(text(this, 392, 64, 'Fee paid now; a bigger cut is taken from the reward.', { fontSize: '11px', color: COLORS.dim }));
    row.add(text(this, 668, 8, 'Companion (permanent)', { fontSize: '12px', color: COLORS.dim }));
    const sulking = a.refusedUntil > state.day;
    row.add(button(this, 668, 28, 220, 32, sulking ? `Won't talk until day ${a.refusedUntil}` : 'Negotiate a contract', () => {
      if (rosterFull(state)) return toast(this, `Your party is full (${GUILD.maxRoster}).`, COLORS.bad);
      this.scene.start('Negotiate', { mode: 'hire', id: c.id });
    }, { fontSize: 12, enabled: !sulking }));
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
    const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    for (const e of board) counts[e.rank] += 1;
    text(this, 20, 118, `${board.length} parties · ${adventurerCount(state)} active adventurers · S ${counts.S}, A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D}. Rank up at C ${GUILD.ranks.renown.C} / B ${GUILD.ranks.renown.B} / A ${GUILD.ranks.renown.A} / S ${GUILD.ranks.renown.S} renown + a promotion quest.`, {
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
    if (items.length === 0) text(this, WIDTH / 2, 300, 'Nothing yet. End the day or go on a quest and see what happens.', { color: COLORS.dim }).setOrigin(0.5);
  }
}
