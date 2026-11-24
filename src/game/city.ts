// Arch City: the calendar, the quest board, food, upkeep and pay, the slave market and prisoners.
// Pure logic (no Phaser): scenes call these and show the messages they return.
import { MAX_PARTY_SIZE } from '../data/content';
import { GUILD, isResidence, type InnTier, type Lodging, type Ring } from '../data/guild';
import { RANKS, type Character, type GameState, type Offer, type Quest, type Rank } from '../data/types';
import { makeQuest, postQuests } from './board';
import { grantXp, type Rng } from './character';
import {
  bondOf, bounty, canFight, registrationFee, slaveTax, changeRelationship, isCompanion, isExpired, isHoused, isSlave, leaveParty, slaveContract, slavePrice, talentPriceFactor,
} from './contracts';
import {
  ACTIVITY_INFO, FOOD_EXPECT_TEXT, QUALITY_TEXT, activityOf, changeHealth, changeMorale, expectedQuality, foodOf, foodRelationship, healthLoss, healthOf,
  lodgingName, lodgingRelationship, moraleOf,
  type BattleCondition,
} from './condition';
import { createGuild, nextRank, promotionReady, rankThreshold, renownLoss, simulateGuildDay, updateRanks } from './guild';
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
    quest: null,
    lastQuestDay: 0,
    questMembers: [],
    schedule: {},
    food: {},
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
 * Members going on the next quest, in party order (drag members in Manage Party to reorder). Anyone can be benched,
 * the main character too: the others can go on quests without them.
 */
export function lineupMembers(state: GameState): Character[] {
  const picked = new Set(state.lineup);
  return state.party.filter((c) => picked.has(c.id) && canFight(state, c)).slice(0, MAX_PARTY_SIZE);
}

/** Put a member in or out of the lineup. Returns an error message if it can't be done. */
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

/** Move a party member to position `to` in the party list (which also sets the lineup's order). */
export function moveMember(state: GameState, id: string, to: number): void {
  const from = state.party.findIndex((c) => c.id === id);
  if (from < 0) return;
  const [c] = state.party.splice(from, 1);
  state.party.splice(Math.max(0, Math.min(state.party.length, to)), 0, c);
  tidyLineup(state);
}

/** Drop lineup entries for members who left or can't fight (lapsed contracts), and keep it in party order. */
export function tidyLineup(state: GameState): void {
  state.lineup = lineupMembers(state).map((c) => c.id);
}

/** Why the party can't set out on its quest right now (null if it can). */
export function departBlock(state: GameState): string | null {
  if (!state.quest) return 'Accept a quest at the Adventurer Guild first.';
  if (state.lastQuestDay === state.day) return 'One quest a day: the party is back from a quest today. Find somewhere to sleep first.';
  if (lineupMembers(state).length === 0) return 'Nobody is in the lineup. Pick who goes in Manage Party.';
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

/** The level modifier on a member's quest XP: +levelStep per level the enemies are above them, -levelStep per level below (never under 0). */
export const xpLevelFactor = (stage: number, level: number) => Math.max(0, 1 + GUILD.xp.levelStep * (stage - level));

/**
 * XP each member who comes back from a quest gets: a day of training's worth (schedule.trainingXp), plus an equal
 * share of the xp.pool split among all of them, times `defeated` (the share of the enemies killed or captured: 1 for a
 * won quest), then x their level modifier (xpLevelFactor). Same order as `members`.
 */
export function questXpShares(q: Pick<Quest, 'stage'>, members: Pick<Character, 'level'>[], defeated = 1): number[] {
  if (members.length === 0) return [];
  const each = GUILD.schedule.trainingXp + (GUILD.xp.pool * Math.max(0, Math.min(1, defeated))) / members.length;
  return members.map((c) => Math.round(each * xpLevelFactor(q.stage, c.level)));
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
 * somewhere to sleep (an inn, or outside). Enemies who `surrendered` are taken prisoner on a win. `turns` is how many turns (rounds) the battle lasted: each costs Morale. Returns report lines.
 */
/** How the enemies fared in a quest's battle: those killed (each worth a bounty) and how many there were in all. */
export interface FoeTally {
  killed: Character[];
  total: number;
}

/** Morale each member who went loses for a quest (before injuries): moralePerTurn per battle turn, and moraleFailedQuest more if it failed. */
export const questMoraleLoss = (turns: number, outcome: 'victory' | 'defeat') =>
  Math.round(Math.max(0, turns) * GUILD.condition.moralePerTurn) + (outcome === 'defeat' ? GUILD.condition.moraleFailedQuest : 0);

/** The bounty for an enemy killed on a quest: as much as turning in a prisoner of its level. */
export const killBounty = (level: number) => bounty(level);

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
    state.party = state.party.filter((m) => m !== c);
    state.lineup = state.lineup.filter((id) => id !== c.id);
    delete state.schedule[c.id];
    delete state.food[c.id];
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
      const p = randomAdventurer(foe.level, rng, { avoidNames: new Set(state.party.map((m) => m.name)) });
      if (foe.weaponId) p.weaponId = foe.weaponId;
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
  // Bounties for every enemy killed, claimed back in the city, win or lose.
  if (foes?.killed.length) {
    const gold = foes.killed.reduce((sum, f) => sum + killBounty(f.level), 0);
    state.gold += gold;
    lines.push(`Bounties: ${gold} gold for ${foes.killed.length} enem${foes.killed.length > 1 ? 'ies' : 'y'} slain.`);
  }
  lines.push(`Morale -${questMoraleLoss(turns, outcome)} (${turns} turn${turns === 1 ? '' : 's'} of battle${outcome === 'defeat' ? ', a failed quest' : ''}): ${members.map((c) => `${c.name} ${c.morale}`).join(', ')}.`);
  lines.push(...moraleDepartures(state));
  // Mercenaries were hired for this quest only.
  for (const c of members.filter((m) => m.contract?.type === 'mercenary')) {
    leaveParty(state, c);
    lines.push(`${c.name}'s mercenary contract is complete.`);
  }
  state.quest = null;
  note(state, outcome === 'victory' ? `Completed "${q.title}" (${q.rank} rank): ${q.reward} gold reward.` : `Failed "${q.title}" (${q.rank} rank).`);
  const ids = members.map((c) => c.id);
  // Multi-day trips: nights on the road; the members away don't follow their schedule.
  for (let i = 1; i < q.days; i++) lines.push(...advanceDay(state, rng, 'road', ids));
  state.lastQuestDay = state.day;
  state.questMembers = ids.filter((id) => state.party.some((c) => c.id === id));
  tidyLineup(state);
  lines.push(...rankNews(state));
  lines.push(`Back in ${GUILD.city} on day ${state.day}. Find an inn for the night, or sleep outside.`);
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

/** Members at 0 Morale leave the party (never the main character). Returns the messages. */
export function moraleDepartures(state: GameState): string[] {
  const out: string[] = [];
  for (const c of state.party.filter((m) => m.id !== state.mainId && moraleOf(m) <= 0)) {
    leaveParty(state, c, isCompanion(c) ? c.contract.greed : 1);
    out.push(note(state, `${c.name} has had enough (Morale 0) and left the party.`));
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

/** Lodging for one night: on the road (quests), at an inn, a residence (free), or outside. */
export function lodgingCost(state: GameState, lodging: Lodging = 'road'): number {
  // Nights on the road cost nothing (food is still paid).
  const per = lodging === 'road' ? 0
    : lodging === 'outside' ? GUILD.lodging.outsidePerPerson
      : isResidence(lodging) ? 0 : GUILD.inns[lodging].pricePerPerson;
  return boarders(state).length * per;
}

/** A day's food for everyone the party feeds, each at their own quality. */
export function foodCost(state: GameState): number {
  return boarders(state).reduce((s, c) => s + GUILD.food[foodOf(state, c)].pricePerPerson, 0);
}

/** Food and lodging for one day and night. */
export const dailyUpkeep = (state: GameState, lodging: Lodging = 'road') => lodgingCost(state, lodging) + foodCost(state);

/** Stay `nights` nights at an inn: the inn's price replaces the day's food and lodging. Returns the messages. */
export function stayAtInn(state: GameState, inn: InnTier, nights: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < nights; i++) out.push(...advanceDay(state, rng, inn));
  return out;
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

/** Sell a residence back to the Estate Office. Returns the gold received (0 if the party doesn't own it). */
export function sellResidence(state: GameState, ring: Ring): number {
  if (!state.residences.includes(ring)) return 0;
  const gold = residenceSellPrice(ring);
  state.residences = state.residences.filter((r) => r !== ring);
  state.gold += gold;
  note(state, `Sold the ${GUILD.residences[ring].name} to the Estate Office for ${gold} gold.`);
  return gold;
}

/** Stay `nights` nights at a residence the party owns: free. */
export function stayAtHome(state: GameState, ring: Ring, nights: number, rng: Rng): string[] {
  if (!state.residences.includes(ring)) throw new Error(`The party doesn't own the ${GUILD.residences[ring].name}`);
  const out: string[] = [];
  for (let i = 0; i < nights; i++) out.push(...advanceDay(state, rng, ring));
  return out;
}

/** Sleep outside for the night: free, but housed companions resent it. */
export function sleepOutside(state: GameState, rng: Rng): string[] {
  return advanceDay(state, rng, 'outside');
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
    if (!act) continue;
    if (act === 'training') {
      const levels = grantXp(c, S.trainingXp);
      if (levels > 0) out.push(`${c.name} reached level ${c.level} through training! +${levels} skill point${levels > 1 ? 's' : ''}.`);
    } else if (act === 'oddJobs') state.gold += S.oddJobsGold;
    else if (act === 'dayOff') changeMorale(c, S.dayOffMorale);
    (done[act] ??= []).push(c.name);
  }
  const parts = Object.entries(done).map(([a, names]) => `${ACTIVITY_INFO[a as keyof typeof ACTIVITY_INFO].name}: ${names.join(', ')}`);
  if (parts.length) out.unshift(`Today: ${parts.join(' · ')}.`);
  return out;
}

export function weeklyWages(state: GameState): number {
  return state.party.reduce((s, c) => s + (isCompanion(c) && !isExpired(c, state.day) ? c.contract.basePay : 0), 0);
}

/** Property tax on the party's slaves, due each payday (see slaveTax). */
export function weeklyTaxes(state: GameState): number {
  return state.party.reduce((s, c) => s + (isSlave(c) ? slaveTax(c) : 0), 0);
}

export const isPayday = (day: number) => day % 7 === 0;

/** Pass `days` days (nights on the road). Returns the messages for the player. */
export function advanceDays(state: GameState, days: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(...advanceDay(state, rng));
  return out;
}

/**
 * End the day with a night at `lodging`, then start the next one: the day's schedule and recovery, upkeep,
 * housed companions' feelings about where they slept, payday, contracts, the rest of the guild, the board and the market.
 * `away`: members out on a quest (they don't follow their schedule).
 */
export function advanceDay(state: GameState, rng: Rng, lodging: Lodging = 'road', away: string[] = []): string[] {
  const out: string[] = [];
  const say = (t: string) => out.push(note(state, t));
  for (const t of runSchedule(state, away)) say(t);
  state.day += 1;

  // Food and lodging.
  const upkeep = dailyUpkeep(state, lodging);
  if (upkeep > state.gold) {
    say(`Not enough gold for food and lodging (${upkeep} needed). Your companions and slaves are unhappy.`);
    state.gold = 0;
    for (const c of state.party) if (isHoused(c)) changeRelationship(c, -5);
  } else {
    state.gold -= upkeep;
    // Fed companions and slaves compare the day's food with what someone of their rank expects.
    const meals: string[] = [];
    for (const c of state.party) {
      if (!bondOf(c) || !isHoused(c)) continue;
      const d = foodRelationship(c, foodOf(state, c));
      if (!d) continue;
      changeRelationship(c, d);
      meals.push(`${c.name} ${d > 0 ? '+' : ''}${d} (expects ${FOOD_EXPECT_TEXT[expectedQuality(c)]})`);
    }
    if (meals.length) say(`Food. Relationship: ${meals.join(', ')}.`);
    // Housed companions and slaves compare the night with what someone of their rank expects.
    if (lodging !== 'road') {
      const moods: string[] = [];
      for (const c of state.party) {
        if (!bondOf(c) || !isHoused(c)) continue;
        const d = lodgingRelationship(c, lodging);
        if (!d) continue;
        changeRelationship(c, d);
        moods.push(`${c.name} ${d > 0 ? '+' : ''}${d} (expects ${QUALITY_TEXT[expectedQuality(c)]})`);
      }
      if (moods.length) say(`${lodging === 'outside' ? 'A night outside' : `A night at ${lodgingName(lodging)}`}. Relationship: ${moods.join(', ')}.`);
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
  out.push(...obedienceDrift(state));
  out.push(...moraleDepartures(state));

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
    // Property tax on slaves: one the party can't pay for is seized and sold at the slave market.
    let taxed = 0;
    for (const c of state.party.filter(isSlave)) {
      const tax = slaveTax(c);
      if (state.gold >= tax) {
        state.gold -= tax;
        taxed += tax;
      } else {
        seizeSlave(state, c, rng);
        say(`You couldn't pay the property tax on ${c.name} (${tax} gold): the city seized them for the slave market.`);
      }
    }
    if (taxed) say(`Slave property tax: ${taxed} gold.`);
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
  out.push(...rankNews(state));
  refillBoard(state, rng);
  out.push(...marketDay(state, rng));
  return out;
}

// ---- the slave market --------------------------------------------------------------------------------------

/** Levels of slaves for sale: around the party's rank's adventurers. */
const MARKET_LEVELS: Record<Rank, [number, number]> = { D: [1, 5], C: [4, 10], B: [9, 15], A: [14, 20] };
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

/** A slave for sale: a random adventurer near the party's rank, valued by level and talent. */
function marketSlave(state: GameState, rng: Rng) {
  const [lo, hi] = MARKET_LEVELS[state.rank];
  const c = randomAdventurer(randInt(lo, hi, rng), rng);
  return { character: c, price: slavePrice(c.level, rng, talentPriceFactor(c)) };
}

/** Asking price of a slave for sale: its value x the market's price index. */
export const askingPrice = (state: GameState, o: Offer) => round5(o.price * state.market.priceIndex);

/** What the market pays for one of the party's slaves right now (sellBackShare of the current price). It doesn't buy prisoners. */
export function marketBuyPrice(state: GameState, c: Character): number {
  const value = slavePrice(c.level, () => 0.5, talentPriceFactor(c));
  return Math.round(value * state.market.priceIndex * GUILD.slave.sellBackShare);
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

/** Sell a party slave to the market (sellBackShare of the current price). Returns the gold received. */
export function sellSlave(state: GameState, id: string, rng: Rng): number {
  const c = state.party.find((m) => m.id === id);
  if (!c || c.contract?.type !== 'slave') return 0;
  const gold = marketBuyPrice(state, c);
  state.gold += gold;
  state.party = state.party.filter((m) => m !== c);
  state.lineup = state.lineup.filter((x) => x !== c.id);
  delete state.schedule[c.id];
  delete state.food[c.id];
  const { contract: _k, ...character } = c;
  state.market.slaves.push({ character, price: slavePrice(c.level, rng, talentPriceFactor(c)) });
  return gold;
}

/** The city takes a slave whose property tax went unpaid; it goes up for sale at the slave market. */
function seizeSlave(state: GameState, c: Character, rng: Rng): void {
  state.party = state.party.filter((m) => m !== c);
  state.lineup = state.lineup.filter((x) => x !== c.id);
  delete state.schedule[c.id];
  delete state.food[c.id];
  const { contract: _k, ...character } = c;
  state.market.slaves.push({ character, price: slavePrice(c.level, rng, talentPriceFactor(c)) });
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
