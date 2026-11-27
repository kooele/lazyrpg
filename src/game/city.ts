// Arch City: the calendar, the quest board, food, upkeep and pay, the slave market and prisoners.
// Pure logic (no Phaser): scenes call these and show the messages they return.
import { MAX_PARTY_SIZE } from '../data/content';
import { GUILD, isResidence, trainingXp, type CityLodging, type InnTier, type Ring } from '../data/guild';
import { RANKS, type Character, type CompanionTerms, type GameState, type Item, type Offer, type Quest, type Rank } from '../data/types';
import { dangerRating, makeQuest, postQuests } from './board';
import { grantXp, type Rng } from './character';
import {
  bondOf, bounty, canFight, registrationFee, slaveTax, changeRelationship, isCompanion, isHoused, isSlave, leaveParty, releaseTotal, proratedWages, paydayWages, wagesBetween, lastPayday, type CompanionContract, slaveContract, slaveValue,
} from './contracts';
import {
  ACTIVITY_INFO, FOOD_EXPECT_TEXT, QUALITY_TEXT, activityOf, changeHealth, changeMorale, defaultLodging, expectedQuality, foodMorale, foodOf, healthLoss, healthOf,
  lodgingMorale, lodgingName, lodgingOf, moraleOf,
  type BattleCondition,
} from './condition';
import { createGuild, nextRank, promotionReady, rankThreshold, renownLoss, simulateGuildDay, updateRanks } from './guild';
import { itemName, itemValue, returnGear, stacks } from './inventory';
import { battleLoot } from './loot';
import { smithyDay } from './smithy';
import { marketplaceDay, salesPerDay } from './marketplace';
import { randInt, randomAdventurer } from './people';

// ---- a new campaign -----------------------------------------------------------------------------

export function newCampaign(main: Character, partyName: string, rng: Rng): GameState {
  main.contract = { type: 'main' };
  if (!main.traits?.includes('protagonist')) main.traits = [...(main.traits ?? []), 'protagonist'];
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
    market: { slaves: [], priceIndex: 1 },
    prisoners: [],
    inventory: [],
    smithyOrders: [],
    marketplace: [],
    quest: null,
    lastQuestDay: 0,
    questMembers: [],
    schedule: {},
    food: {},
    lodging: {},
    drinksDay: 0,
    belowRankSince: 0,
    residences: [],
    log: [],
  };
  updateRanks(state);
  restockMarket(state, rng);
  refillBoard(state, rng, true);
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

/**
 * Members going on the next quest, in lineup order (the five slots in Manage Party: who deploys first in battle).
 * Anyone can be benched, the main character too: the others can go on quests without them.
 */
export function lineupMembers(state: GameState): Character[] {
  const byId = new Map(state.party.map((c) => [c.id, c]));
  return state.lineup.map((id) => byId.get(id)).filter((c): c is Character => !!c && canFight(state, c)).slice(0, MAX_PARTY_SIZE);
}

/** Put a member in or out of the lineup (joining at the end). Returns an error message if it can't be done. */
export function toggleLineup(state: GameState, id: string): string | null {
  if (state.lineup.includes(id)) {
    state.lineup = state.lineup.filter((x) => x !== id);
    return null;
  }
  const c = state.party.find((m) => m.id === id);
  if (!c) return 'Not in the party.';
  if (!canFight(state, c)) return `${c.name}'s contract has run out. Renew it first.`;
  if (lineupMembers(state).length >= MAX_PARTY_SIZE) return `At most ${MAX_PARTY_SIZE} members can go on a quest.`;
  state.lineup.push(id);
  tidyLineup(state);
  return null;
}

/**
 * Drop a member into lineup slot `slot` (0-based). A member already in the lineup moves there (swapping with whoever
 * held it); a benched one takes the slot, and whoever held it goes to the bench. An empty slot past the end just
 * appends. Returns an error message if it can't be done.
 */
export function setLineupSlot(state: GameState, id: string, slot: number): string | null {
  const c = state.party.find((m) => m.id === id);
  if (!c) return 'Not in the party.';
  if (!canFight(state, c)) return `${c.name}'s contract has run out. Renew it first.`;
  tidyLineup(state);
  const line = state.lineup;
  const at = Math.max(0, Math.min(MAX_PARTY_SIZE - 1, slot));
  const from = line.indexOf(id);
  if (from >= 0) {
    // Move within the lineup: swap with the slot's holder, or move to the end if the slot is empty.
    if (at < line.length) [line[from], line[at]] = [line[at], line[from]];
    else line.push(...line.splice(from, 1));
  } else if (at < line.length) line[at] = id;
  else line.push(id);
  return null;
}

/** Bench a member: take them out of the lineup. */
export function benchMember(state: GameState, id: string): void {
  state.lineup = state.lineup.filter((x) => x !== id);
}

/** Move a party member to position `to` in the party list (the roster order; the lineup keeps its own order). */
export function moveMember(state: GameState, id: string, to: number): void {
  const from = state.party.findIndex((c) => c.id === id);
  if (from < 0) return;
  const [c] = state.party.splice(from, 1);
  state.party.splice(Math.max(0, Math.min(state.party.length, to)), 0, c);
}

/** Drop lineup entries for members who left or can't fight (lapsed contracts), keeping the lineup's order. */
export function tidyLineup(state: GameState): void {
  state.lineup = lineupMembers(state).map((c) => c.id);
}

/** Renown a party loses when a member quits on it: ranks.quitRenownPerLevel x their level. */
export const quitRenown = (c: Pick<Character, 'level'>) => GUILD.ranks.quitRenownPerLevel * c.level;

/** A member quits the party (unpaid wages, Morale 0): no payout, but the party loses renown (quitRenown). */
function quit(state: GameState, c: Character): number {
  const lost = Math.min(state.renown, quitRenown(c));
  state.renown -= lost;
  leaveParty(state, c, isCompanion(c) ? c.contract.greed : 1);
  return lost;
}

/** What the quest tab owes for one member: a companion's wages or a slave's tax from a payday on the road. */
export const tabOwed = (state: GameState, id: string) => (state.tab?.wages[id] ?? 0) + (state.tab?.taxes[id] ?? 0);

/**
 * Release a companion, paying their wages since payday, any on the quest tab and, before their term ends, the buyout
 * (releaseTotal). Returns an error message, or null.
 */
export function releaseCompanion(state: GameState, id: string): string | null {
  const c = state.party.find((m) => m.id === id);
  if (!c || !isCompanion(c)) return 'Only companions can be released.';
  const cost = releaseTotal(c, state.day, state.rank) + tabOwed(state, id);
  if (state.gold < cost) return `Not enough gold to release ${c.name} (${cost} needed).`;
  state.gold -= cost;
  if (state.tab) delete state.tab.wages[id];
  leaveParty(state, c, c.contract.greed);
  note(state, cost ? `Released ${c.name} from their contract: paid ${cost} gold.` : `${c.name} was released and went back to the guild hall.`);
  return null;
}

/** Why the party can't set out on its quest right now (null if it can). */
export function departBlock(state: GameState): string | null {
  if (!state.quest) return 'Accept a quest at the Adventurer Guild first.';
  if (state.lastQuestDay === state.day) return 'One quest a day: the party is back from a quest today. End the day first.';
  if (lineupMembers(state).length === 0) return 'No adventurers in the lineup. Pick who goes in Manage Party.';
  return null;
}

// ---- quests --------------------------------------------------------------------------------------------

export { makeQuest } from './board';

/**
 * The day's postings on the shared board (see board.ts), plus the player's promotion quest once they have the
 * renown for the next rank (until they pass it). Promotion quests first, then by rank and level.
 */
export function refillBoard(state: GameState, rng: Rng, fill = false): void {
  const g = state.guild;
  const up = nextRank(state.rank);
  g.board = g.board.filter((q) => !q.promotion || q.rank === up);
  postQuests(state, rng, fill ? Infinity : undefined);
  if (up && promotionReady(state.rank, state.renown) && !g.board.some((q) => q.promotion) && !state.quest?.promotion) {
    g.board.unshift(makeQuest(up, state.day, rng, true));
  }
  g.board.sort((a, b) => Number(!!b.promotion) - Number(!!a.promotion) || RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank) || a.stage - b.stage);
}

/** Quests at the party's rank or below, and the next rank's promotion quest once the party has the renown for it. */
export const canTakeQuest = (state: GameState, q: Quest) => (q.promotion
  ? q.rank === nextRank(state.rank) && promotionReady(state.rank, state.renown)
  : RANKS.indexOf(q.rank) >= RANKS.indexOf(state.rank));

export function acceptQuest(state: GameState, questId: string): string | null {
  const q = state.guild.board.find((x) => x.id === questId);
  if (!q) return 'That quest is no longer on the board.';
  if (state.quest) return 'You already have a quest. Finish it first.';
  if (!canTakeQuest(state, q)) {
    return q.promotion ? `The ${q.rank}-rank promotion quest needs ${rankThreshold(q.rank)} renown.` : `Your party must be ${q.rank} rank or higher for this quest.`;
  }
  state.guild.board = state.guild.board.filter((x) => x !== q);
  state.quest = q;
  return null;
}

/** A quest's XP pool from its danger D in skulls (dangerRating, 0.5-10): xp.pool a x D^2 + b x D + c (105 at half a skull, 2480 at ten). */
export function questXpPool(q: Pick<Quest, 'stage' | 'count'>): number {
  const { a, b, c } = GUILD.xp.pool;
  const d = dangerRating(q);
  return Math.round(a * d * d + b * d + c);
}

/**
 * XP each member who comes back from a quest gets: a day of training's worth at their level (trainingXp), plus an equal
 * share of the quest's XP pool (questXpPool) split among all of them, times `defeated` (the share of the enemies killed or captured: 1 for a
 * won quest). Same order as `members`.
 */
export function questXpShares(q: Pick<Quest, 'stage' | 'count'>, members: Pick<Character, 'level'>[], defeated = 1): number[] {
  if (members.length === 0) return [];
  const share = (questXpPool(q) * Math.max(0, Math.min(1, defeated))) / members.length;
  return members.map((c) => Math.round(trainingXp(c.level) + share));
}

/** Grant quest XP to the members who came back (see questXpShares) and report it. */
function questXpLines(q: Quest, members: Character[], defeated: number): string[] {
  const xp = questXpShares(q, members, defeated);
  const out = [`XP${defeated < 1 ? ` (${Math.round(defeated * 100)}% of the enemies defeated)` : ''}: ${members.map((c, i) => `${c.name} +${xp[i]}`).join(', ')}.`];
  for (const [i, c] of members.entries()) {
    const levels = grantXp(c, xp[i]);
    if (levels > 0) out.push(`${c.name} reached level ${c.level}! +${levels} skill point${levels > 1 ? 's' : ''}.`);
  }
  return out;
}

/**
 * Who takes a share of a reward: companions with a loot cut, and mercenaries whose cut is worth more than the fee
 * they were paid up front (they get the larger of the two, so they take the difference).
 */
export function rewardShares(members: Character[], reward: number): { name: string; amount: number }[] {
  const out: { name: string; amount: number }[] = [];
  const cut = (pct: number) => Math.round((reward * pct) / 100);
  for (const c of members) {
    const k = c.contract;
    const amount = k?.type === 'mercenary' ? Math.max(0, cut(k.cutPct) - k.fee) : k?.type === 'companion' ? cut(k.lootPct) : 0;
    if (amount > 0) out.push({ name: c.name, amount });
  }
  return out;
}

/**
 * Settle the accepted quest after its battle: injuries and deaths (from `conditions`, one per member who fought),
 * Morale, rewards. Nights on the road pass for multi-day trips; the party gets back in the evening and still needs
 * to end the day (everyone sleeps where they lodge). Enemies who `surrendered` are taken prisoner on a win. `turns` is how many turns (rounds) the battle lasted: each costs Morale. Returns report lines.
 */
/** How the enemies fared in a quest's battle: those killed (they drop loot) and how many there were in all. */
export interface FoeTally {
  killed: Character[];
  total: number;
}

/** Morale each member who went loses for a quest (before injuries): moralePerTurn per battle turn, and moraleFailedQuest more if it failed. */
export const questMoraleLoss = (turns: number, outcome: 'victory' | 'defeat') =>
  Math.round(Math.max(0, turns) * GUILD.condition.moralePerTurn) + (outcome === 'defeat' ? GUILD.condition.moraleFailedQuest : 0);


export function resolveQuest(
  state: GameState, outcome: 'victory' | 'defeat', rng: Rng, conditions: BattleCondition[] = [], surrendered: Character[] = [],
  foes?: FoeTally, turns = 0,
): string[] {
  const q = state.quest;
  if (!q) return [];
  const went = lineupMembers(state);
  const lines: string[] = [];
  const C = GUILD.condition;

  // Injuries, deaths (Health 0) and Morale.
  const dead: Character[] = [];
  for (const c of went) {
    changeMorale(c, -questMoraleLoss(turns, outcome));
    const r = conditions.find((x) => x.id === c.id);
    if (!r) continue;
    const loss = r.fell ? C.maxHealthLoss : healthLoss(r.lowestHp);
    if (loss <= 0) continue;
    changeHealth(c, -loss);
    if (healthOf(c) <= 0) {
      // The main character pulls through at 1 Health; anyone else dies.
      if (c.id === state.mainId) c.health = 1;
      else {
        dead.push(c);
        continue;
      }
    }
    changeMorale(c, -loss * C.moralePerHealthLost);
    lines.push(`${c.name} is injured: Health ${healthOf(c)}/100 (-${loss}).`);
  }
  for (const c of dead) {
    // The party brings back what they carried.
    const back = returnGear(state, c, true);
    if (back.length) lines.push(`${c.name}'s ${back.map(itemName).join(' and ')} went back to the stash.`);
    state.party = state.party.filter((m) => m !== c);
    state.lineup = state.lineup.filter((id) => id !== c.id);
    delete state.schedule[c.id];
    delete state.food[c.id];
    delete state.lodging[c.id];
    lines.push(`${c.name}'s wounds were fatal (Health 0). They did not survive.`);
    note(state, `${c.name} died on "${q.title}".`);
  }
  if (dead.length) for (const c of state.party) changeMorale(c, -C.moraleMemberDied * dead.length);
  // Renown: lost for a failed quest and for every death.
  const lostRenown = renownLoss(q.renown, outcome === 'defeat', dead.length);
  if (lostRenown > 0) {
    state.renown = Math.max(0, state.renown - lostRenown);
    lines.push(`Renown -${Math.round(lostRenown)}${dead.length ? ` (${outcome === 'defeat' ? 'a failed quest and ' : ''}${dead.length} death${dead.length > 1 ? 's' : ''})` : ' (failed quest)'}.`);
  }
  const members = went.filter((c) => !dead.includes(c));

  if (outcome === 'victory') {
    state.progress.victories += 1;
    const shares = rewardShares(members, q.reward);
    const paid = shares.reduce((s, x) => s + x.amount, 0);
    state.gold += q.reward - paid;
    state.renown += q.renown;
    lines.push(`Reward: ${q.reward} gold${paid ? ` (${shares.map((s) => `${s.name} takes ${s.amount}`).join(', ')}; you keep ${q.reward - paid})` : ''}.`);
    lines.push(`Renown +${q.renown}.`);
    if (q.promotion && q.rank === nextRank(state.rank)) {
      state.rank = q.rank;
      state.belowRankSince = 0;
      lines.push(note(state, `Your party passed the promotion quest and is now ${q.rank} rank!`));
    }
    lines.push(...questXpLines(q, members, 1));
    for (const c of members) changeRelationship(c, GUILD.companion.relationshipPerQuest);
    // Enemies who surrendered (only humans do) are taken prisoner, to be registered at the city gate.
    for (const foe of surrendered) {
      // Their gear stays on the battlefield: a prisoner comes with nothing.
      const p = randomAdventurer(foe.level, rng, { avoidNames: new Set(state.party.map((m) => m.name)), unarmed: true });
      state.prisoners.push({ character: p, price: bounty(p.level) });
      lines.push(`${p.name} (Lv ${p.level}, ${foe.name}) surrendered and was taken prisoner. Register them at the city gate.`);
    }
  } else {
    state.progress.defeats += 1;
    lines.push('No reward. The party limps home to recover.');
    // XP still counts: a day of training's worth, and the quest's pool for the share of enemies defeated.
    const defeated = foes && foes.total > 0 ? (foes.killed.length + surrendered.length) / foes.total : 0;
    lines.push(...questXpLines(q, members, defeated));
    for (const c of members) changeRelationship(c, -2);
  }
  // Loot (wins only: the battlefield can't be looted until the enemy is driven off): the gear of humans killed or
  // captured, and every other foe's trophy and junk. Trophies are turned in at the city gate; junk sells at the marketplace.
  const loot = battleLoot(foes?.killed ?? [], surrendered, outcome, rng);
  if (loot.length) {
    state.inventory.push(...loot);
    const list = (kind: (k: Item['kind']) => boolean) => stacks(loot.filter((i) => kind(i.kind))).map((s) => `${itemName(s.item)}${s.count > 1 ? ` ×${s.count}` : ''}`).join(', ');
    const gear = list((k) => k === 'weapon' || k === 'armor');
    const junk = list((k) => k === 'junk');
    const trophyList = list((k) => k === 'trophy');
    if (trophyList) lines.push(`Trophies: ${trophyList}. Turn them in at the city gate (${loot.filter((i) => i.kind === 'trophy').reduce((s, i) => s + itemValue(i), 0)} gold).`);
    if (gear) lines.push(`Gear: ${gear} (in the stash).`);
    if (junk) lines.push(`Junk: ${junk} (in the stash, to sell).`);
  }
  lines.push(`Morale -${questMoraleLoss(turns, outcome)} (${turns} turn${turns === 1 ? '' : 's'} of battle${outcome === 'defeat' ? ', a failed quest' : ''}): ${members.map((c) => `${c.name} ${c.morale}`).join(', ')}.`);
  lines.push(...moraleDepartures(state));
  // Mercenaries were hired for this quest only.
  for (const c of members.filter((m) => m.contract?.type === 'mercenary')) {
    leaveParty(state, c);
    lines.push(`${c.name}'s mercenary contract is complete.`);
  }
  state.quest = null;
  // A church blessing lasts one quest.
  if (state.blessing) {
    lines.push(`The church's blessing (+${state.blessing}% all stats) has faded.`);
    delete state.blessing;
  }
  note(state, outcome === 'victory' ? `Completed "${q.title}" (${q.rank} rank): ${q.reward} gold reward.` : `Failed "${q.title}" (${q.rank} rank).`);
  const ids = members.map((c) => c.id);
  // Multi-day trips: nights on the road; the members away don't follow their schedule.
  for (let i = 1; i < q.days; i++) lines.push(...advanceDay(state, rng, 'road', ids, true));
  if (state.tab) lines.push(`Due at the next End Day: ${tabList(state, ' gold')}.`);
  state.lastQuestDay = state.day;
  state.questMembers = ids.filter((id) => state.party.some((c) => c.id === id));
  tidyLineup(state);
  lines.push(...rankNews(state));
  lines.push(`Back in ${GUILD.city} on day ${state.day}. End the day when you're ready: everyone sleeps where they lodge.`);
  return lines;
}

/** Slaves' Obedience follows their relationship: up while it's good, down while it's poor. Returns messages for big moves. */
export function obedienceDrift(state: GameState): string[] {
  const S = GUILD.slave;
  const out: string[] = [];
  for (const c of state.party) {
    if (!isSlave(c)) continue;
    const k = c.contract;
    const before = k.obedience;
    if (k.relationship >= S.obedienceRiseFrom) k.obedience = Math.min(100, k.obedience + S.obedienceChangePerDay);
    else if (k.relationship < S.obedienceFallBelow) k.obedience = Math.max(0, k.obedience - S.obedienceChangePerDay);
    // Only mention it when it crosses a multiple of 10, to keep the log readable.
    if (Math.floor(before / 10) !== Math.floor(k.obedience / 10)) {
      out.push(note(state, `${c.name}'s Obedience ${k.obedience > before ? 'rose' : 'fell'} to ${k.obedience}.`));
    }
  }
  return out;
}

/** Change a member's Morale and return by how much it actually moved (after traits and the 0-100 limits). */
function moraleChange(c: Character, delta: number): number {
  if (!delta) return 0;
  const was = moraleOf(c);
  changeMorale(c, delta);
  return moraleOf(c) - was;
}

/** Members at 0 Morale leave the party (never the main character). Returns the messages. */
export function moraleDepartures(state: GameState): string[] {
  const out: string[] = [];
  for (const c of state.party.filter((m) => m.id !== state.mainId && moraleOf(m) <= 0)) {
    const lost = quit(state, c);
    out.push(note(state, `${c.name} has had enough (Morale 0) and left the party.${lost ? ` Renown -${Math.round(lost)}.` : ''}`));
  }
  return out;
}

/** At the end of the day, companions whose relationship has fallen to 0 quit, costing renown. */
export function relationshipDepartures(state: GameState): string[] {
  const out: string[] = [];
  for (const c of state.party.filter((m) => isCompanion(m) && m.contract.relationship <= 0)) {
    const lost = quit(state, c);
    out.push(note(state, `${c.name} has had enough of the party (relationship 0) and quit.${lost ? ` Renown -${Math.round(lost)}.` : ''}`));
  }
  return out;
}

/** Update the leaderboard ranks; returns the player's promotion or demotion message, if any. */
function rankNews(state: GameState): string[] {
  const ranks = updateRanks(state);
  for (const t of ranks.news) state.guild.news.push({ day: state.day, text: t });
  if (!ranks.player) return [];
  const up = RANKS.indexOf(ranks.player.to) < RANKS.indexOf(ranks.player.from);
  return [note(state, up ? `Your party has been promoted to ${ranks.player.to} rank!` : `Your party has slipped to ${ranks.player.to} rank.`)];
}

// ---- the calendar ------------------------------------------------------------------------------------

/** People the party feeds and houses each day. */
export function boarders(state: GameState): Character[] {
  return state.party.filter((c) => c.contract?.type === 'main' || c.contract?.type === 'slave' || (isCompanion(c) && c.contract.foodLodging));
}

/** A night's lodging for one member at `where`: an inn's price, free in a residence, stablesPerPerson in the stables ('outside'). */
export function lodgingPrice(where: CityLodging): number {
  if (where === 'outside') return GUILD.lodging.stablesPerPerson;
  return isResidence(where) ? 0 : GUILD.inns[where].pricePerPerson;
}

/**
 * Housed members who spend the night in the city (where they lodge, set in Manage Party). On a 'city' night that's
 * all of them. On a 'road' night (a multi-day quest) it's those not out on the quest (`away`); with no `away` list
 * the whole party is on the road.
 */
export function cityBoarders(state: GameState, night: 'road' | 'city' = 'road', away?: string[]): Character[] {
  if (night === 'road' && !away) return [];
  const out = new Set(night === 'road' ? away : []);
  return boarders(state).filter((c) => !out.has(c.id));
}

/**
 * Lodging for one night: each housed member in the city pays for where they lodge (Manage Party); nights on the
 * road (quests) are free (food is still paid). See cityBoarders.
 */
export function lodgingCost(state: GameState, night: 'road' | 'city' = 'road', away?: string[]): number {
  return cityBoarders(state, night, away).reduce((s, c) => s + lodgingPrice(lodgingOf(state, c)), 0);
}

/** A day's food for everyone the party feeds, each at their own quality. */
export function foodCost(state: GameState): number {
  return boarders(state).reduce((s, c) => s + GUILD.food[foodOf(state, c)].pricePerPerson, 0);
}

/** Food and lodging for one day and night. */
export const dailyUpkeep = (state: GameState, night: 'road' | 'city' = 'road', away?: string[]) => lodgingCost(state, night, away) + foodCost(state);

/** Members lodging at a residence. */
export function residents(state: GameState, ring: Ring): Character[] {
  return boarders(state).filter((c) => lodgingOf(state, c) === ring);
}

/**
 * Set where a member sleeps in the city. Only members the party houses (see boarders) need lodging; a residence
 * must be owned and have room (residences.capacity). Returns an error message, or null.
 */
export function setLodging(state: GameState, id: string, where: CityLodging): string | null {
  const c = state.party.find((m) => m.id === id);
  if (!c) return 'Not in the party.';
  if (!isHoused(c)) return `${c.name} finds their own lodging.`;
  if (isResidence(where)) {
    const home = GUILD.residences[where];
    if (!state.residences.includes(where)) return `You don't own the ${home.name}.`;
    if (lodgingOf(state, c) !== where && residents(state, where).length >= GUILD.residences.capacity) {
      return `The ${home.name} is full (${GUILD.residences.capacity} residents).`;
    }
  }
  // Their default (see defaultLodging) isn't stored, so a change of default in guild.json reaches them.
  if (where === defaultLodging(c)) delete state.lodging[id];
  else state.lodging[id] = where;
  return null;
}

/** Buy a residence in a ring. Returns an error message, or null. */
export function buyResidence(state: GameState, ring: Ring): string | null {
  const home = GUILD.residences[ring];
  if (state.residences.includes(ring)) return `You already own the ${home.name}.`;
  if (state.gold < home.price) return `Not enough gold (${home.price} needed).`;
  state.gold -= home.price;
  state.residences.push(ring);
  note(state, `Bought the ${home.name} for ${home.price} gold.`);
  return null;
}

/** What the Estate Office pays for a residence. */
export const residenceSellPrice = (ring: Ring) => Math.round(GUILD.residences[ring].price * GUILD.residences.sellShare);

/** Sell a residence back to the Estate Office; its residents go back to their default lodging until moved. Returns the gold received (0 if not owned). */
export function sellResidence(state: GameState, ring: Ring): number {
  if (!state.residences.includes(ring)) return 0;
  const gold = residenceSellPrice(ring);
  const moved = residents(state, ring);
  for (const c of moved) delete state.lodging[c.id];
  state.residences = state.residences.filter((r) => r !== ring);
  state.gold += gold;
  note(state, `Sold the ${GUILD.residences[ring].name} to the Estate Office for ${gold} gold.${moved.length ? ` ${moved.map((c) => `${c.name} goes back to ${lodgingName(defaultLodging(c))}`).join(', ')} until you find them somewhere.` : ''}`);
  return gold;
}

/** End the day in the city: every housed member spends the night where they lodge (see setLodging). Returns the messages. */
export function endDay(state: GameState, rng: Rng): string[] {
  return advanceDay(state, rng, 'city');
}

/** A round of drinks at an inn for the whole party (once a day). Returns an error message, or null. */
export function buyDrinks(state: GameState, inn: InnTier): string | null {
  const cost = drinksCost(state, inn);
  if (state.drinksDay === state.day) return 'The party already had a round today.';
  if (state.gold < cost) return `Not enough gold (${cost} needed).`;
  state.gold -= cost;
  state.drinksDay = state.day;
  for (const c of state.party) changeMorale(c, GUILD.inns[inn].drinksMorale);
  note(state, `A round of drinks at ${GUILD.inns[inn].name} (${cost} gold): Morale +${GUILD.inns[inn].drinksMorale}.`);
  return null;
}

export const drinksCost = (state: GameState, inn: InnTier) => state.party.length * GUILD.inns[inn].drinksPerPerson;

/** Members who follow their schedule today: everyone not on (or just back from) a quest. */
export function scheduledMembers(state: GameState, away: string[] = []): Character[] {
  const busy = new Set([...away, ...(state.lastQuestDay === state.day ? state.questMembers : [])]);
  return state.party.filter((c) => !busy.has(c.id));
}

/** The day's work: each member's scheduled activity, and everyone's nightly recovery. */
function runSchedule(state: GameState, away: string[]): string[] {
  const S = GUILD.schedule;
  const out: string[] = [];
  const home = new Set(scheduledMembers(state, away).map((c) => c.id));
  const done: Record<string, string[]> = {};
  for (const c of state.party) {
    const act = home.has(c.id) ? activityOf(state, c) : null;
    const was = healthOf(c);
    changeHealth(c, GUILD.condition.healthPerDay * (act === 'recover' ? S.recoverMultiplier : 1));
    if (was < 100 && healthOf(c) === 100) out.push(`${c.name} has fully recovered.`);
    // The schedule stays as the player set it, except Recover once Health is full: back to Day Off.
    if (state.schedule[c.id] === 'recover' && healthOf(c) === 100) {
      state.schedule[c.id] = 'dayOff';
      out.push(`${c.name} is at full Health: back to Day Off.`);
    }
    if (!act) continue;
    if (act === 'training') {
      const levels = grantXp(c, trainingXp(c.level));
      if (levels > 0) out.push(`${c.name} reached level ${c.level} through training! +${levels} skill point${levels > 1 ? 's' : ''}.`);
    } else if (act === 'oddJobs') state.gold += S.oddJobsGold;
    else if (act === 'dayOff') changeMorale(c, S.dayOffMorale);
    (done[act] ??= []).push(c.name);
  }
  const parts = Object.entries(done).map(([a, names]) => `${ACTIVITY_INFO[a as keyof typeof ACTIVITY_INFO].name}: ${names.join(', ')}`);
  if (parts.length) out.unshift(`Today: ${parts.join(' · ')}.`);
  const sales = marketplaceDay(state, state.party.filter((c) => home.has(c.id) && activityOf(state, c) === 'marketplace'));
  if (sales) out.push(sales);
  return out;
}

/** What the next payday's wages come to (the week ending on it, prorated for companions who joined or leave midweek, plus wages carried over from a renewal). */
export function weeklyWages(state: GameState): number {
  const next = lastPayday(state.day) + 7;
  return state.party.reduce((s, c) => s + (isCompanion(c) ? paydayWages(c, next) : 0), 0);
}

/**
 * Renew a companion's contract on new terms. The wages they've earned under the old terms since payday aren't paid
 * now: they carry over (carriedWages) and are paid with the rest on the next payday.
 */
export function renewContract(state: GameState, id: string, terms: CompanionTerms): string[] {
  const c = state.party.find((m) => m.id === id);
  if (!c || !isCompanion(c)) return [];
  const out: string[] = [];
  const owed = proratedWages(c, state.day);
  if (owed) {
    c.contract.carriedWages = owed;
    out.push(note(state, `${c.name}'s wages under the old contract (${owed} gold) will be paid on payday.`));
  }
  Object.assign(c.contract, { ...terms, startDay: state.day, endDay: state.day + terms.termWeeks * 7 });
  return out;
}

/** Property tax on the party's slaves, due each payday (see slaveTax). */
export function weeklyTaxes(state: GameState): number {
  return state.party.reduce((s, c) => s + (isSlave(c) ? slaveTax(c) : 0), 0);
}

export const isPayday = (day: number) => day % 7 === 0;

// ---- what the end of a day costs ---------------------------------------------------------------------------
// advanceDay and forecastNight both use these, so the End Day warning names exactly what End Day will charge.

/** The tabs a multi-day quest runs up (see GameState.tab), as the player sees them named. */
export const TAB_NAMES = { upkeep: 'Food and Lodging Tab', wages: 'Owed Wages Tab', taxes: 'Slave Tax Tab' } as const;

/** Where each tab comes from: the quest's nights, and a payday (wages) or tax day (slave tax; the same day) during it. */
export const TAB_SOURCES = { upkeep: 'nights on the quest', wages: 'payday on the quest', taxes: 'tax day on the quest' } as const;

/** A tab's name with where it comes from: "Owed Wages Tab (payday on the quest)". */
export const tabLabel = (k: keyof typeof TAB_NAMES) => `${TAB_NAMES[k]} (${TAB_SOURCES[k]})`;

/** What's on each tab, in gold. */
export function tabParts(state: GameState): Record<keyof typeof TAB_NAMES, number> {
  const t = state.tab;
  const sum = (r: Record<string, number> = {}) => Object.values(r).reduce((s, g) => s + g, 0);
  return { upkeep: t?.upkeep ?? 0, wages: sum(t?.wages), taxes: sum(t?.taxes) };
}

/** The tabs that have anything on them, as "Food and Lodging Tab 96, Owed Wages Tab 70" (with `unit` after each amount). */
export function tabList(state: GameState, unit = ''): string {
  const parts = tabParts(state);
  return (Object.keys(TAB_NAMES) as (keyof typeof TAB_NAMES)[]).filter((k) => parts[k]).map((k) => `${TAB_NAMES[k]} ${parts[k]}${unit}`).join(', ');
}

/** Everything on the quest's tabs. */
export function tabTotal(state: GameState): number {
  const p = tabParts(state);
  return p.upkeep + p.wages + p.taxes;
}

/** Wages paid as the day `day` begins: on payday each companion's week (paydayWages), plus what the quest tab owes them. */
function wagesDue(state: GameState, day: number): { c: Character & { contract: CompanionContract }; due: number }[] {
  return state.party.filter(isCompanion)
    .map((c) => ({ c, due: (isPayday(day) ? paydayWages(c, day) : 0) + (state.tab?.wages[c.id] ?? 0) }))
    .filter((w) => w.due > 0);
}

/** Slave tax paid as the day `day` begins: on payday each slave's (slaveTax), plus what the quest tab owes for them. */
function taxesDue(state: GameState, day: number): { c: Character; tax: number }[] {
  return state.party.filter(isSlave)
    .map((c) => ({ c, tax: (isPayday(day) ? slaveTax(c) : 0) + (state.tab?.taxes[c.id] ?? 0) }))
    .filter((t) => t.tax > 0);
}

/** Companions whose contract lapses as the day `day` begins: it ended and the grace period is over. */
const lapsing = (state: GameState, day: number) => state.party.filter(isCompanion).filter((c) => day > c.contract.endDay + GUILD.companion.graceDays);

/** A lapsing companion's final wages: the days of their term since the last payday (on payday, those were just paid). */
const finalWages = (c: Character & { contract: CompanionContract }, day: number) => wagesBetween(c, lastPayday(day), day) + (isPayday(day) ? 0 : c.contract.carriedWages ?? 0);

/** What ending the day in the city will cost, and what happens if the party can't pay (see forecastNight). */
export interface NightForecast {
  /** Gold the party has now, and what the day's odd jobs bring in before the bills. */
  gold: number;
  income: number;
  /** Tonight's food and lodging, and what's on the quest tab (food, lodging, wages and tax from a multi-day quest). */
  upkeep: number;
  tab: number;
  /** Does the next day start on a payday, and the wages and slave tax due (tab included). */
  payday: boolean;
  wages: number;
  taxes: number;
  /** Final wages of companions whose contract lapses tonight. */
  lapses: { id: string; name: string; owed: number }[];
  /** Everything due, and how much gold is missing (0 if the party can pay it all). */
  total: number;
  shortfall: number;
  /** The party can't pay for food and lodging: gold goes to 0 and housed members lose relationship. */
  unfed: boolean;
  /** Companions who won't be paid, and whether they're likely to quit over it. */
  unpaid: { id: string; name: string; due: number; quits: boolean; renown: number }[];
  /** Slaves whose tax can't be paid: the city seizes them. */
  seized: { id: string; name: string; tax: number }[];
  /** Lapsing companions whose final wages can't be paid: they leave without them, costing renown. */
  unpaidFinal: { id: string; name: string; owed: number; renown: number }[];
}

/**
 * Forecast the next End Day in the city: the day's odd jobs, then food and lodging (and the quest tab's), then wages
 * and slave tax (payday's and the tab's), then lapsing contracts' final wages, in the order advanceDay charges them.
 * Assumes nobody leaves the party during the day for other reasons.
 */
export function forecastNight(state: GameState): NightForecast {
  const day = state.day + 1;
  const { oddJobs, marketplace } = dayIncome(state);
  const income = oddJobs.gold + marketplace.gold;
  const upkeep = dailyUpkeep(state, 'city');
  let gold = state.gold + income;
  const unfed = upkeep + (state.tab?.upkeep ?? 0) > gold;
  gold = unfed ? 0 : gold - upkeep - (state.tab?.upkeep ?? 0);
  let wages = 0;
  let taxes = 0;
  const unpaid: NightForecast['unpaid'] = [];
  const seized: NightForecast['seized'] = [];
  const unpaidFinal: NightForecast['unpaidFinal'] = [];
  for (const { c, due } of wagesDue(state, day)) {
    wages += due;
    if (gold >= due) gold -= due;
    else {
      const rel = c.contract.relationship + (unfed && isHoused(c) ? -5 : 0) + GUILD.companion.relationshipUnpaid;
      unpaid.push({ id: c.id, name: c.name, due, quits: rel <= 0, renown: Math.min(state.renown, quitRenown(c)) });
    }
  }
  for (const { c, tax } of taxesDue(state, day)) {
    taxes += tax;
    if (gold >= tax) gold -= tax;
    else seized.push({ id: c.id, name: c.name, tax });
  }
  const lapses = lapsing(state, day).filter((c) => !unpaid.some((u) => u.id === c.id && u.quits))
    .map((c) => ({ id: c.id, name: c.name, owed: finalWages(c, day) }));
  for (const l of lapses) {
    if (gold >= l.owed) gold -= l.owed;
    else unpaidFinal.push({ ...l, renown: Math.min(state.renown, quitRenown(state.party.find((m) => m.id === l.id)!)) });
  }
  const tab = tabTotal(state);
  const total = upkeep + (state.tab?.upkeep ?? 0) + wages + taxes + lapses.reduce((s, l) => s + l.owed, 0);
  return {
    gold: state.gold, income, upkeep, tab, payday: isPayday(day), wages, taxes, lapses, total,
    shortfall: Math.max(0, total - state.gold - income), unfed, unpaid, seized, unpaidFinal,
  };
}

/**
 * What the party earns at the next End Day: odd jobs (oddJobsGold each) and the Marketplace (the items at the top of
 * the sale list that today's sellers will sell), with who earns it.
 */
export function dayIncome(state: GameState): {
  oddJobs: { names: string[]; gold: number };
  marketplace: { names: string[]; items: number; gold: number };
} {
  const home = scheduledMembers(state);
  const doing = (a: string) => home.filter((c) => activityOf(state, c) === a);
  const jobs = doing('oddJobs');
  const sellers = doing('marketplace');
  const sold = state.marketplace.slice(0, salesPerDay(sellers.length));
  return {
    oddJobs: { names: jobs.map((c) => c.name), gold: jobs.length * GUILD.schedule.oddJobsGold },
    marketplace: { names: sellers.map((c) => c.name), items: sold.length, gold: sold.reduce((s, i) => s + itemValue(i), 0) },
  };
}

/** One line of the Finances panel: what, who or how many, and the gold (+ income, - expense). */
export interface FinanceLine {
  label: string;
  detail: string;
  amount: number;
}

/** The party's money at a glance (the header's Finances panel): the next End Day's income and expenses, and payday's. */
export interface Finances {
  income: FinanceLine[];
  expenses: FinanceLine[];
  /** Income minus expenses, a day. */
  net: number;
  /** Payday's wages and slave tax (every 7th day). */
  weekly: FinanceLine[];
  /** Days to the next payday (0 = today). */
  paydayIn: number;
  /** What a multi-day quest ran up, due at the next End Day. */
  tab: number;
  /** Items on the Marketplace sale list, and what they're worth. */
  stall: { items: number; gold: number };
}

export function finances(state: GameState): Finances {
  const { oddJobs, marketplace } = dayIncome(state);
  const fed = boarders(state);
  const lodged = cityBoarders(state, 'city');
  const income: FinanceLine[] = [
    { label: 'Odd Jobs', detail: oddJobs.names.length ? oddJobs.names.join(', ') : 'Nobody', amount: oddJobs.gold },
    {
      label: 'Marketplace',
      detail: !marketplace.names.length ? 'Nobody on duty' : !marketplace.items ? `${marketplace.names.join(', ')} · nothing on sale` : `${marketplace.names.join(', ')} · ${marketplace.items} item${marketplace.items === 1 ? '' : 's'}`,
      amount: marketplace.gold,
    },
  ];
  const expenses: FinanceLine[] = [
    { label: 'Food', detail: `${fed.length} fed`, amount: -foodCost(state) },
    { label: 'Lodging', detail: `${lodged.length} housed`, amount: -lodgingCost(state, 'city') },
  ];
  const weekly: FinanceLine[] = [
    { label: 'Wages', detail: `${state.party.filter(isCompanion).length} companion${state.party.filter(isCompanion).length === 1 ? '' : 's'}`, amount: -weeklyWages(state) },
    { label: 'Slave Tax', detail: `${state.party.filter(isSlave).length} slave${state.party.filter(isSlave).length === 1 ? '' : 's'}`, amount: -weeklyTaxes(state) },
  ];
  return {
    income, expenses, weekly,
    net: [...income, ...expenses].reduce((s, l) => s + l.amount, 0),
    paydayIn: (7 - (state.day % 7)) % 7,
    tab: tabTotal(state),
    stall: { items: state.marketplace.length, gold: state.marketplace.reduce((s, i) => s + itemValue(i), 0) },
  };
}

/** Pass `days` days (nights on the road). Returns the messages for the player. */
export function advanceDays(state: GameState, days: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(...advanceDay(state, rng));
  return out;
}

/**
 * End the day with a night in the city (each housed member where they lodge) or on the road (a multi-day quest),
 * then start the next one: the day's schedule and recovery, upkeep, housed companions' and slaves' feelings about
 * their food and where they slept, payday, contracts, the rest of the guild, the board and the market.
 * `away`: on a road night, the members out on the quest: they sleep on the road for free and don't follow their
 * schedule, while everyone else lives a normal city day and night. Without it, the whole party is on the road.
 * `onTab`: a night of a multi-day quest. Nothing is paid: food, lodging and any payday go on the quest tab
 * (GameState.tab), settled at the next End Day, and contracts don't lapse until then.
 */
export function advanceDay(state: GameState, rng: Rng, night: 'road' | 'city' = 'road', away?: string[], onTab = false): string[] {
  const out: string[] = [];
  const say = (t: string) => out.push(note(state, t));
  for (const t of runSchedule(state, away ?? [])) say(t);
  state.day += 1;
  for (const t of smithyDay(state)) say(t);
  const tab = onTab ? (state.tab ??= { upkeep: 0, wages: {}, taxes: {} }) : null;

  // Food and lodging (tonight's, and the quest tab's when the party is back).
  const upkeep = dailyUpkeep(state, night, away);
  const owing = tab ? 0 : upkeep + (state.tab?.upkeep ?? 0);
  if (owing > state.gold) {
    say(`Not enough gold for food and lodging (${owing} needed${state.tab?.upkeep ? `, ${state.tab.upkeep} of it on the ${TAB_NAMES.upkeep}` : ''}). Your companions and slaves are unhappy.`);
    state.gold = 0;
    for (const c of state.party) if (isHoused(c)) changeRelationship(c, -5);
  } else {
    if (tab) tab.upkeep += upkeep;
    else {
      state.gold -= owing;
      if (state.tab?.upkeep) say(`Paid the ${tabLabel('upkeep')}: ${state.tab.upkeep} gold.`);
    }
    // Everyone the party feeds compares the day's food with what they expect: Morale up or down.
    const meals: string[] = [];
    for (const c of state.party) {
      if (!isHoused(c)) continue;
      const d = moraleChange(c, foodMorale(c, foodOf(state, c)));
      if (d) meals.push(`${c.name} ${d > 0 ? '+' : ''}${d} (expects ${FOOD_EXPECT_TEXT[expectedQuality(c)]})`);
    }
    if (meals.length) say(`Food. Morale: ${meals.join(', ')}.`);
    // Housed members who slept in the city compare it with what they expect.
    {
      const moods: string[] = [];
      for (const c of cityBoarders(state, night, away)) {
        const where = lodgingOf(state, c);
        const d = moraleChange(c, lodgingMorale(c, where));
        if (d) moods.push(`${c.name} ${d > 0 ? '+' : ''}${d} (${where === 'outside' ? 'slept in the stables' : `at ${lodgingName(where)}`}; expects ${QUALITY_TEXT[expectedQuality(c)]})`);
      }
      if (moods.length) say(`The night. Morale: ${moods.join(', ')}.`);
    }
  }

  // Low Morale sours companions and slaves a little more every day; at 0 Morale, members leave.
  const sour: string[] = [];
  for (const c of state.party) {
    if (!bondOf(c) || moraleOf(c) >= GUILD.condition.lowMorale) continue;
    changeRelationship(c, -GUILD.condition.lowMoraleRelationshipPerDay);
    sour.push(c.name);
  }
  if (sour.length) say(`Low morale (below ${GUILD.condition.lowMorale}): ${sour.join(', ')} -${GUILD.condition.lowMoraleRelationshipPerDay} relationship.`);
  // High Morale warms them a little every day.
  const warm: string[] = [];
  for (const c of state.party) {
    if (!bondOf(c) || moraleOf(c) <= GUILD.condition.highMorale) continue;
    changeRelationship(c, GUILD.condition.highMoraleRelationshipPerDay);
    warm.push(c.name);
  }
  if (warm.length) say(`High morale (above ${GUILD.condition.highMorale}): ${warm.join(', ')} +${GUILD.condition.highMoraleRelationshipPerDay} relationship.`);
  out.push(...obedienceDrift(state));
  out.push(...moraleDepartures(state), ...relationshipDepartures(state));

  if (tab) {
    // Payday on the road: wages and slave tax go on the tab.
    if (isPayday(state.day)) {
      let wages = 0;
      let taxes = 0;
      for (const c of state.party) {
        const due = isCompanion(c) ? paydayWages(c, state.day) : isSlave(c) ? slaveTax(c) : 0;
        if (!due) continue;
        const book = isCompanion(c) ? tab.wages : tab.taxes;
        book[c.id] = (book[c.id] ?? 0) + due;
        if (isCompanion(c)) {
          wages += due;
          delete c.contract.carriedWages;
        } else taxes += due;
      }
      const onto = [wages ? `${wages} gold in wages onto the ${TAB_NAMES.wages}` : '', taxes ? `${taxes} gold in slave tax onto the ${TAB_NAMES.taxes}` : ''].filter(Boolean);
      if (onto.length) say(`${taxes ? 'Payday and tax day' : 'Payday'} on the road: ${onto.join(', ')}, until you're back in ${GUILD.city}.`);
    }
  } else {
    // Wages (payday's, and the tab's), then slave property tax.
    const fromTab = tabParts(state);
    let paid = 0;
    for (const { c, due } of wagesDue(state, state.day)) {
      if (state.gold >= due) {
        state.gold -= due;
        paid += due;
      } else {
        c.contract.relationship = Math.max(0, c.contract.relationship + GUILD.companion.relationshipUnpaid);
        say(`You couldn't pay ${c.name} (${due} gold).`);
        if (c.contract.relationship <= 0) {
          const lost = quit(state, c);
          say(`${c.name} quits over unpaid wages.${lost ? ` Renown -${Math.round(lost)}.` : ''}`);
        }
      }
    }
    if (isPayday(state.day)) for (const c of state.party.filter(isCompanion)) delete c.contract.carriedWages;
    if (paid) {
      say(isPayday(state.day)
        ? `Payday: ${paid} gold in wages${fromTab.wages ? `, ${Math.min(paid, fromTab.wages)} of it the ${tabLabel('wages')}` : ''}.`
        : `Paid the ${tabLabel('wages')}: ${paid} gold.`);
    }
    // Property tax on slaves: one the party can't pay for is seized and sold at the slave market.
    let taxed = 0;
    for (const { c, tax } of taxesDue(state, state.day)) {
      if (state.gold >= tax) {
        state.gold -= tax;
        taxed += tax;
      } else {
        seizeSlave(state, c);
        say(`You couldn't pay the property tax on ${c.name} (${tax} gold): the city seized them for the slave market.`);
      }
    }
    if (taxed) {
      say(isPayday(state.day)
        ? `Slave property tax: ${taxed} gold${fromTab.taxes ? `, ${Math.min(taxed, fromTab.taxes)} of it the ${tabLabel('taxes')}` : ''}.`
        : `Paid the ${tabLabel('taxes')}: ${taxed} gold.`);
    }
    delete state.tab;
  }

  // Contracts running out (lapses wait until the party is back from a multi-day quest).
  for (const c of state.party.filter(isCompanion)) {
    const k = c.contract;
    if (k.endDay === state.day) say(`${c.name}'s contract has ended. Renew it within ${GUILD.companion.graceDays} days (Party screen) or they will leave.`);
  }
  if (!tab) {
    for (const c of lapsing(state, state.day)) {
      const owed = finalWages(c, state.day);
      if (state.gold >= owed) {
        state.gold -= owed;
        leaveParty(state, c, c.contract.greed);
        say(`${c.name} left the party: their contract was not renewed.${owed ? ` Final wages: ${owed} gold.` : ''}`);
      } else {
        const lost = quit(state, c);
        say(`${c.name} left the party: their contract was not renewed, and you couldn't pay their final wages (${owed} gold).${lost ? ` Renown -${Math.round(lost)}.` : ''}`);
      }
    }
  }
  tidyLineup(state);

  simulateGuildDay(state, rng);
  out.push(...rankNews(state));
  refillBoard(state, rng);
  out.push(...marketDay(state, rng));
  return out;
}

// ---- the slave market --------------------------------------------------------------------------------------

/** Levels of slaves for sale: around the party's rank's adventurers. */
const MARKET_LEVELS: Record<Rank, [number, number]> = { D: [1, 5], C: [4, 10], B: [9, 15], A: [14, 20], S: [19, 25] };
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

/** A slave for sale: a random adventurer near the party's rank, valued by level and talent. */
function marketSlave(state: GameState, rng: Rng) {
  const [lo, hi] = MARKET_LEVELS[state.rank];
  const c = randomAdventurer(randInt(lo, hi, rng), rng, { unarmed: true });
  return { character: c, price: round5(slaveValue(c)) };
}

/**
 * Asking price of a slave for sale: its value x the market's price index. Worked out from the slave itself, not the
 * offer's stored price, so it always matches the value shown once they're bought (and older saves' stored prices don't matter).
 */
export const askingPrice = (state: GameState, o: Offer) => round5(slaveValue(o.character) * state.market.priceIndex);

/** What the market pays for one of the party's slaves right now (sellBackShare of the current price). It doesn't buy prisoners. */
export function marketBuyPrice(state: GameState, c: Character): number {
  return Math.round(round5(slaveValue(c)) * state.market.priceIndex * GUILD.slave.sellBackShare);
}

/** Is a shipment due on `day` (market.shipmentWeekdays)? And the next shipment day from `day` on. */
export const isShipmentDay = (day: number) => GUILD.market.shipmentWeekdays.includes(day % 7);
export function nextShipmentDay(day: number): number {
  for (let d = day; d < day + 8; d++) if (isShipmentDay(d)) return d;
  return day;
}

/** Stock the market for a new game: somewhere in the middle of its range. */
export function restockMarket(state: GameState, rng: Rng): void {
  const [lo, hi] = GUILD.market.stock;
  const n = randInt(Math.round(lo + (hi - lo) * 0.25), Math.round(lo + (hi - lo) * 0.75), rng);
  state.market.slaves = Array.from({ length: n }, () => marketSlave(state, rng)).sort((a, b) => a.character.level - b.character.level);
  state.market.priceIndex = 1;
}

/** Keep the market's price index in step with supply (stock) and a little random demand. */
function updatePrices(state: GameState, rng: Rng): void {
  const M = GUILD.market;
  const stock = Math.max(1, state.market.slaves.length);
  const target = Math.sqrt(M.stockReference / stock);
  let idx = state.market.priceIndex * (1 + (rng() * 2 - 1) * M.drift);
  idx += (target - idx) * 0.15;
  state.market.priceIndex = Math.round(Math.max(M.priceIndex[0], Math.min(M.priceIndex[1], idx)) * 1000) / 1000;
}

/** A day at the slave market: a few slaves sold to other buyers, a shipment twice a week, prices follow supply. */
export function marketDay(state: GameState, rng: Rng): string[] {
  const M = GUILD.market;
  const m = state.market;
  const sales = randInt(M.dailySales[0], M.dailySales[1], rng);
  for (let i = 0; i < sales && m.slaves.length > M.stock[0]; i++) m.slaves.splice(Math.floor(rng() * m.slaves.length), 1);
  const out: string[] = [];
  if (isShipmentDay(state.day)) {
    const n = Math.min(randInt(M.shipmentSize[0], M.shipmentSize[1], rng), M.stock[1] - m.slaves.length);
    for (let i = 0; i < n; i++) m.slaves.push(marketSlave(state, rng));
    m.slaves.sort((a, b) => a.character.level - b.character.level);
    if (n > 0) state.guild.news.push({ day: state.day, text: `A shipment of ${n} slaves arrived at the Slave Market.` });
  }
  updatePrices(state, rng);
  return out;
}

export function buySlave(state: GameState, id: string, rng: Rng = Math.random): string | null {
  const offer = state.market.slaves.find((o) => o.character.id === id);
  if (!offer) return 'No longer for sale.';
  if (state.party.length >= GUILD.maxRoster) return `Your party is full (${GUILD.maxRoster}).`;
  const price = askingPrice(state, offer);
  if (state.gold < price) return `Not enough gold (${price} needed).`;
  state.gold -= price;
  state.market.slaves = state.market.slaves.filter((o) => o !== offer);
  state.party.push({ ...offer.character, contract: slaveContract('market', price, rng) });
  return null;
}

/**
 * Sell a party slave to the market (sellBackShare of the current price). Tax on the quest tab for them comes out of
 * the sale. Returns the gold received.
 */
export function sellSlave(state: GameState, id: string): number {
  const c = state.party.find((m) => m.id === id);
  if (!c || c.contract?.type !== 'slave') return 0;
  const gold = Math.max(0, marketBuyPrice(state, c) - tabOwed(state, id));
  if (state.tab) delete state.tab.taxes[id];
  state.gold += gold;
  // A slave is sold without their gear: it stays in the party's stash.
  returnGear(state, c, true);
  state.party = state.party.filter((m) => m !== c);
  state.lineup = state.lineup.filter((x) => x !== c.id);
  delete state.schedule[c.id];
  delete state.food[c.id];
  delete state.lodging[c.id];
  const { contract: _k, ...character } = c;
  state.market.slaves.push({ character, price: round5(slaveValue(c)) });
  return gold;
}

/** The city takes a slave whose property tax went unpaid; it goes up for sale at the slave market. */
function seizeSlave(state: GameState, c: Character): void {
  returnGear(state, c, true);
  state.party = state.party.filter((m) => m !== c);
  state.lineup = state.lineup.filter((x) => x !== c.id);
  delete state.schedule[c.id];
  delete state.food[c.id];
  delete state.lodging[c.id];
  const { contract: _k, ...character } = c;
  state.market.slaves.push({ character, price: round5(slaveValue(c)) });
}

// ---- prisoners: registered at the city gate --------------------------------------------------------

/** Prisoners waiting at the city gate: the party can't do anything else in the city until each one is registered. */
export const prisonersAtGate = (state: GameState) => state.prisoners.length > 0;

/** Turn a prisoner in for the bounty. Returns the gold received (0 if unknown). */
export function turnInPrisoner(state: GameState, id: string): number {
  const p = state.prisoners.find((o) => o.character.id === id);
  if (!p) return 0;
  state.prisoners = state.prisoners.filter((o) => o !== p);
  state.gold += p.price;
  return p.price;
}

/** Register a prisoner as the party's slave for its registration fee (see registrationFee). Returns an error message, or null. */
export function registerPrisoner(state: GameState, id: string, rng: Rng = Math.random): string | null {
  const p = state.prisoners.find((o) => o.character.id === id);
  if (!p) return 'No such prisoner.';
  if (state.party.length >= GUILD.maxRoster) return `Your party is full (${GUILD.maxRoster}).`;
  const fee = registrationFee(p);
  if (state.gold < fee) return `The registration fee is ${fee} gold.`;
  state.gold -= fee;
  state.prisoners = state.prisoners.filter((o) => o !== p);
  state.party.push({ ...p.character, contract: slaveContract('prisoner', fee, rng) });
  return null;
}
