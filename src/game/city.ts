// Arch City: the calendar, the quest board, upkeep and pay, the slave market and prisoners.
// Pure logic (no Phaser): scenes call these and show the messages they return.
import { MAX_PARTY_SIZE } from '../data/content';
import { ENEMIES } from '../data/enemies';
import { GUILD, type InnTier } from '../data/guild';
import { STAT_CONFIG } from '../data/stats';
import { RANKS, type Character, type GameState, type Quest, type Rank } from '../data/types';
import { enemyTypesForStage } from './battle';
import { grantXp, newId, type Rng } from './character';
import { bounty, canFight, isCompanion, isExpired, leaveParty, slavePrice, talentPriceFactor } from './contracts';
import { createGuild, simulateGuildDay, updateRanks } from './guild';
import { randInt, randomAdventurer } from './people';

// ---- a new campaign -----------------------------------------------------------------------------

export function newCampaign(main: Character, partyName: string, rng: Rng): GameState {
  main.contract = { type: 'main' };
  const state: GameState = {
    progress: { victories: 0, defeats: 0 },
    day: 1,
    gold: GUILD.startingGold,
    partyName,
    renown: GUILD.startingRenown,
    rank: 'D',
    mainId: main.id,
    party: [main],
    lineup: [main.id],
    guild: createGuild(rng),
    market: { slaves: [], restockDay: 1 },
    prisoners: [],
    quest: null,
    log: [],
  };
  updateRanks(state);
  restockMarket(state, rng);
  refillBoard(state, rng);
  note(state, `Welcome to ${GUILD.city}. ${partyName} is registered at the Adventurer Guild as a ${state.rank}-rank party.`);
  return state;
}

export function note(state: GameState, text: string): string {
  state.log.push({ day: state.day, text });
  state.log = state.log.slice(-60);
  return text;
}

export const mainCharacter = (state: GameState) => state.party.find((c) => c.id === state.mainId)!;

// ---- lineup -------------------------------------------------------------------------------------------

/** Members going on the next quest, in lineup order. The main character always goes. */
export function lineupMembers(state: GameState): Character[] {
  const ids = [state.mainId, ...state.lineup.filter((id) => id !== state.mainId)];
  return ids.map((id) => state.party.find((c) => c.id === id)).filter((c): c is Character => !!c && canFight(state, c)).slice(0, MAX_PARTY_SIZE);
}

/** Put a member in or out of the lineup. Returns an error message if it can't be done. */
export function toggleLineup(state: GameState, id: string): string | null {
  if (id === state.mainId) return 'Your main character leads the party and always goes.';
  if (state.lineup.includes(id)) {
    state.lineup = state.lineup.filter((x) => x !== id);
    return null;
  }
  const c = state.party.find((m) => m.id === id);
  if (!c) return 'Not in the party.';
  if (!canFight(state, c)) return `${c.name}'s contract has run out. Renew it first.`;
  if (lineupMembers(state).length >= MAX_PARTY_SIZE) return `At most ${MAX_PARTY_SIZE} members can go on a quest.`;
  state.lineup.push(id);
  return null;
}

/** Drop lineup entries for members who left or can't fight. */
export function tidyLineup(state: GameState): void {
  const keep = new Set(lineupMembers(state).map((c) => c.id));
  state.lineup = [state.mainId, ...state.lineup.filter((id) => id !== state.mainId && keep.has(id))];
}

// ---- quests --------------------------------------------------------------------------------------------

const PLACES = ['the Old Sewers', 'Mill Road', 'Briar Farm', 'the Eastern Woods', "Gallow's Pass", 'the Salt Marsh', 'Kestrel Ford',
  'the Ruined Chapel', 'Hollow Creek', 'the Quarry', 'Thornfield', 'the North Gate', 'Lantern Hill', 'the Old Watchtower'];
const KIND_TITLE: Record<string, string> = { rat: 'Rat Infestation', slime: 'Slime Outbreak', wolf: 'Wolf Pack', bandit: 'Bandit Bounty' };

export function makeQuest(rank: Rank, day: number, rng: Rng): Quest {
  const tier = GUILD.quests[rank];
  const stage = randInt(tier.stages[0], tier.stages[1], rng);
  const types = enemyTypesForStage(stage);
  const main = types[types.length - 1].type;
  const place = PLACES[Math.floor(rng() * PLACES.length)];
  const top = Math.max(...Object.values(ENEMIES).map((d) => d.levels[1]));
  const title = stage > top + 1 ? `Bandit Warband at ${place}` : `${KIND_TITLE[main] ?? 'Trouble'} at ${place}`;
  const names = types.map((t) => `${ENEMIES[t.type].name}s (Lv ${t.level})`);
  return {
    id: newId('q'),
    title,
    rank,
    stage,
    reward: Math.round(randInt(tier.reward[0], tier.reward[1], rng) / 5) * 5,
    renown: tier.renown,
    days: randInt(tier.days[0], tier.days[1], rng),
    expires: day + randInt(4, 8, rng),
    description: `${names.join(' and ')} reported at ${place}.${stage > top ? ' A large band: expect many of them.' : ''}`,
  };
}

/** Keep the board full: mostly quests at the party's rank, some below, some above (locked until promoted). */
export function refillBoard(state: GameState, rng: Rng): void {
  const g = state.guild;
  g.board = g.board.filter((q) => q.expires >= state.day);
  const own = RANKS.indexOf(state.rank);
  while (g.board.length < GUILD.boardSize) {
    const r = rng();
    const idx = r < 0.25 && own > 0 ? own - 1 : r < 0.5 && own < RANKS.length - 1 ? own + 1 : own;
    g.board.push(makeQuest(RANKS[idx], state.day, rng));
  }
  g.board.sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || a.stage - b.stage);
}

export const canTakeQuest = (state: GameState, q: Quest) => RANKS.indexOf(q.rank) >= RANKS.indexOf(state.rank);

export function acceptQuest(state: GameState, questId: string): string | null {
  const q = state.guild.board.find((x) => x.id === questId);
  if (!q) return 'That quest is no longer on the board.';
  if (state.quest) return 'You already have a quest. Finish it first.';
  if (!canTakeQuest(state, q)) return `Your party must be ${q.rank} rank or higher for this quest.`;
  state.guild.board = state.guild.board.filter((x) => x !== q);
  state.quest = q;
  return null;
}

/** XP for a won battle: full at the quest's level, more for punching up, less for easy work. */
export function questXp(stage: number, level: number): number {
  return Math.round(STAT_CONFIG.xpPerVictory * Math.max(0.15, Math.min(2, 1 + (stage - level) * 0.5)));
}

/** Who takes a share of a reward: mercenaries on a cut and companions with a loot cut. */
export function rewardShares(members: Character[], reward: number): { name: string; amount: number }[] {
  const out: { name: string; amount: number }[] = [];
  for (const c of members) {
    const k = c.contract;
    const pct = k?.type === 'mercenary' && k.pay === 'cut' ? k.amount : k?.type === 'companion' ? k.lootPct : 0;
    if (pct > 0) out.push({ name: c.name, amount: Math.round((reward * pct) / 100) });
  }
  return out;
}

/** Settle the accepted quest after its battle. Time passes for the trip. Returns report lines. */
export function resolveQuest(state: GameState, outcome: 'victory' | 'defeat', rng: Rng): string[] {
  const q = state.quest;
  if (!q) return [];
  const members = lineupMembers(state);
  const lines: string[] = [];
  if (outcome === 'victory') {
    state.progress.victories += 1;
    const shares = rewardShares(members, q.reward);
    const paid = shares.reduce((s, x) => s + x.amount, 0);
    state.gold += q.reward - paid;
    state.renown += q.renown;
    lines.push(`Reward: ${q.reward} gold${paid ? ` (${shares.map((s) => `${s.name} takes ${s.amount}`).join(', ')}; you keep ${q.reward - paid})` : ''}.`);
    lines.push(`Renown +${q.renown}.`);
    const gains = members.map((c) => `${c.name} +${questXp(q.stage, c.level)}`);
    lines.push(`XP: ${gains.join(', ')}.`);
    for (const c of members) {
      const levels = grantXp(c, questXp(q.stage, c.level));
      if (levels > 0) lines.push(`${c.name} reached level ${c.level}! +${levels} skill point${levels > 1 ? 's' : ''}.`);
      if (isCompanion(c)) c.contract.relationship = Math.min(100, c.contract.relationship + GUILD.companion.relationshipPerQuest);
    }
    const fought = enemyTypesForStage(q.stage);
    const bandits = fought.filter((t) => t.type === 'bandit');
    if (bandits.length && rng() < GUILD.slave.captureChance && state.prisoners.length < 4) {
      const p = randomAdventurer(Math.min(...bandits.map((b) => b.level)), rng);
      state.prisoners.push({ character: p, price: bounty(p.level) });
      lines.push(`You captured a bandit, ${p.name} (Lv ${p.level}). Take them to the market's magistrate.`);
    }
  } else {
    state.progress.defeats += 1;
    lines.push('No reward. The party limps home to recover.');
    for (const c of members) if (isCompanion(c)) c.contract.relationship = Math.max(0, c.contract.relationship - 2);
  }
  // Mercenaries were hired for this quest only.
  for (const c of members.filter((m) => m.contract?.type === 'mercenary')) {
    leaveParty(state, c);
    lines.push(`${c.name}'s mercenary contract is complete.`);
  }
  state.quest = null;
  note(state, outcome === 'victory' ? `Completed "${q.title}" (${q.rank} rank): ${q.reward} gold reward.` : `Failed "${q.title}" (${q.rank} rank).`);
  lines.push(...advanceDays(state, q.days, rng));
  return lines;
}

// ---- the calendar ------------------------------------------------------------------------------------

/** People the party feeds and houses each day. */
export function boarders(state: GameState): Character[] {
  return state.party.filter((c) => c.contract?.type === 'main' || c.contract?.type === 'slave' || (isCompanion(c) && c.contract.foodLodging));
}

/** Food and lodging for one day: on the road (quests), or a night at an inn. */
export function dailyUpkeep(state: GameState, inn?: InnTier): number {
  return boarders(state).length * (inn ? GUILD.inns[inn].pricePerPerson : GUILD.upkeep.foodLodgingPerDay);
}

/** Stay `nights` nights at an inn: the inn's price replaces the day's food and lodging. Returns the messages. */
export function stayAtInn(state: GameState, inn: InnTier, nights: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < nights; i++) out.push(...advanceDay(state, rng, inn));
  return out;
}

export function weeklyWages(state: GameState): number {
  return state.party.reduce((s, c) => s + (isCompanion(c) && !isExpired(c, state.day) ? c.contract.basePay : 0), 0);
}

export const isPayday = (day: number) => day % 7 === 0;

/** Pass `days` days. Returns the messages for the player. */
export function advanceDays(state: GameState, days: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(...advanceDay(state, rng));
  return out;
}

/** One day: upkeep (on the road, or at an inn), payday, contracts, the rest of the guild, the board and the market. */
export function advanceDay(state: GameState, rng: Rng, inn?: InnTier): string[] {
  state.day += 1;
  const out: string[] = [];
  const say = (t: string) => out.push(note(state, t));
  state.renown *= 1 - GUILD.renownDecayPerDay;

  // Food and lodging.
  const upkeep = dailyUpkeep(state, inn);
  if (upkeep > state.gold) {
    say(`Not enough gold for food and lodging (${upkeep} needed). Your companions are unhappy.`);
    state.gold = 0;
    for (const c of state.party) if (isCompanion(c) && c.contract.foodLodging) c.contract.relationship = Math.max(0, c.contract.relationship - 5);
  } else {
    state.gold -= upkeep;
    // A comfortable night pleases the companions the party houses.
    const bonus = inn ? GUILD.inns[inn].relationshipPerNight : 0;
    for (const c of state.party) if (bonus && isCompanion(c) && c.contract.foodLodging) c.contract.relationship = Math.min(100, c.contract.relationship + bonus);
  }

  // Payday every 7th day.
  if (isPayday(state.day)) {
    let paid = 0;
    for (const c of state.party.filter(isCompanion)) {
      if (isExpired(c, state.day)) continue;
      if (state.gold >= c.contract.basePay) {
        state.gold -= c.contract.basePay;
        paid += c.contract.basePay;
      } else {
        c.contract.relationship = Math.max(0, c.contract.relationship + GUILD.companion.relationshipUnpaid);
        say(`You couldn't pay ${c.name} (${c.contract.basePay} gold).`);
        if (c.contract.relationship <= 0) {
          leaveParty(state, c, c.contract.greed);
          say(`${c.name} quits over unpaid wages.`);
        }
      }
    }
    if (paid) say(`Payday: ${paid} gold in wages.`);
  }

  // Contracts running out.
  for (const c of state.party.filter(isCompanion)) {
    const k = c.contract;
    if (k.endDay === state.day) say(`${c.name}'s contract has ended. Renew it within ${GUILD.companion.graceDays} days (Party screen) or they will leave.`);
    if (state.day > k.endDay + GUILD.companion.graceDays) {
      leaveParty(state, c, k.greed);
      say(`${c.name} left the party: their contract was not renewed.`);
    }
  }
  tidyLineup(state);

  simulateGuildDay(state, rng);
  const ranks = updateRanks(state);
  for (const t of ranks.news) state.guild.news.push({ day: state.day, text: t });
  if (ranks.player) {
    const up = RANKS.indexOf(ranks.player.to) < RANKS.indexOf(ranks.player.from);
    say(up ? `Your party has been promoted to ${ranks.player.to} rank!` : `Your party has slipped to ${ranks.player.to} rank.`);
  }
  refillBoard(state, rng);
  if (state.day >= state.market.restockDay) restockMarket(state, rng);
  return out;
}

// ---- the slave market and the magistrate --------------------------------------------------------------

const MARKET_LEVELS: Record<Rank, [number, number]> = { D: [1, 3], C: [2, 5], B: [3, 7], A: [5, 9] };

export function restockMarket(state: GameState, rng: Rng): void {
  const [lo, hi] = MARKET_LEVELS[state.rank];
  state.market.slaves = Array.from({ length: GUILD.slave.marketSize }, () => {
    const c = randomAdventurer(randInt(lo, hi, rng), rng);
    return { character: c, price: slavePrice(c.level, rng, talentPriceFactor(c)) };
  }).sort((a, b) => a.character.level - b.character.level);
  state.market.restockDay = state.day + GUILD.slave.restockDays;
}

export function buySlave(state: GameState, id: string): string | null {
  const offer = state.market.slaves.find((o) => o.character.id === id);
  if (!offer) return 'No longer for sale.';
  if (state.party.length >= GUILD.maxRoster) return `Your party is full (${GUILD.maxRoster}).`;
  if (state.gold < offer.price) return `Not enough gold (${offer.price} needed).`;
  state.gold -= offer.price;
  state.market.slaves = state.market.slaves.filter((o) => o !== offer);
  state.party.push({ ...offer.character, contract: { type: 'slave', price: offer.price, origin: 'market' } });
  return null;
}

/** Sell a slave back to the market. Returns the gold received. */
export function sellSlave(state: GameState, id: string, rng: Rng): number {
  const c = state.party.find((m) => m.id === id);
  if (!c || c.contract?.type !== 'slave') return 0;
  const gold = Math.round(slavePrice(c.level, rng, talentPriceFactor(c)) * GUILD.slave.sellBackShare);
  state.gold += gold;
  state.party = state.party.filter((m) => m !== c);
  state.lineup = state.lineup.filter((x) => x !== c.id);
  const { contract: _k, ...character } = c;
  state.market.slaves.push({ character, price: slavePrice(c.level, rng, talentPriceFactor(c)) });
  return gold;
}

export function turnInPrisoner(state: GameState, id: string): number {
  const p = state.prisoners.find((o) => o.character.id === id);
  if (!p) return 0;
  state.prisoners = state.prisoners.filter((o) => o !== p);
  state.gold += p.price;
  return p.price;
}

export function registerPrisoner(state: GameState, id: string): string | null {
  const p = state.prisoners.find((o) => o.character.id === id);
  if (!p) return 'No such prisoner.';
  if (state.party.length >= GUILD.maxRoster) return `Your party is full (${GUILD.maxRoster}).`;
  if (state.gold < GUILD.slave.registrationFee) return `The registration fee is ${GUILD.slave.registrationFee} gold.`;
  state.gold -= GUILD.slave.registrationFee;
  state.prisoners = state.prisoners.filter((o) => o !== p);
  state.party.push({ ...p.character, contract: { type: 'slave', price: GUILD.slave.registrationFee, origin: 'prisoner' } });
  return null;
}
