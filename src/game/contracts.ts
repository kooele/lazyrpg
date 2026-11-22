// Contracts: mercenary fees, companion negotiations, slaves. Pure logic (no Phaser).
import { GUILD } from '../data/guild';
import type { Character, CompanionTerms, Contract, FreeAdventurer, GameState, Rank } from '../data/types';

const C = GUILD.companion;
const round5 = (v: number) => Math.max(0, Math.round(v / 5) * 5);

export type CompanionContract = Extract<Contract, { type: 'companion' }>;
export const isCompanion = (c: Character): c is Character & { contract: CompanionContract } => c.contract?.type === 'companion';

// ---- mercenaries --------------------------------------------------------------------------------

/** What a mercenary asks: a fixed fee up front, or a % of the next quest's reward. */
export function mercenaryRates(level: number, greed: number): { fee: number; cutPct: number } {
  const m = GUILD.mercenary;
  return {
    fee: round5(m.feePerLevel * level * greed),
    cutPct: Math.max(1, Math.round((m.cutBase + m.cutPerLevel * level) * greed)),
  };
}

// ---- companions -----------------------------------------------------------------------------------

/** Food and lodging, valued per week. */
export const foodLodgingWeekly = () => GUILD.upkeep.foodLodgingPerDay * 7;

/** How much a loot cut is worth per week to a candidate, given the party's rank. */
export const lootValue = (lootPct: number, rank: Rank) => (lootPct / 100) * C.expectedWeeklyLoot[rank];

/** What the terms are worth to the companion, in gold per week. */
export function offerValue(t: CompanionTerms, rank: Rank): number {
  return t.basePay + lootValue(t.lootPct, rank) + (t.foodLodging ? foodLodgingWeekly() : 0);
}

/**
 * What a companion wants per week for a term: grows with level and greed; short terms cost more,
 * long ones less. On renewal, a good relationship lowers it (up to renewalDiscountAtMax at 100).
 */
export function companionDemand(level: number, greed: number, termWeeks: number, relationship = 0): number {
  const base = (C.wageBase + C.wagePerLevel * level) * greed;
  const term = C.termDemand[String(termWeeks)] ?? 1;
  return base * term * (1 - C.renewalDiscountAtMax * Math.max(0, Math.min(100, relationship)) / 100);
}

/** A reasonable first offer: food and lodging, a small cut, and a little under their asking pay. */
export function openingTerms(level: number, greed: number, rank: Rank, relationship = 0): CompanionTerms {
  const terms: CompanionTerms = { basePay: 0, lootPct: 5, foodLodging: true, termWeeks: 4 };
  const want = companionDemand(level, greed, terms.termWeeks, relationship);
  terms.basePay = round5(Math.max(0, want * 0.85 - lootValue(terms.lootPct, rank) - foodLodgingWeekly()));
  return terms;
}

export type Verdict = 'accept' | 'counter' | 'reject' | 'walkout';

export interface NegotiationResult {
  verdict: Verdict;
  /** offer / demand: 1 or more is a deal. */
  ratio: number;
  /** The base pay that would close the deal with the rest of the terms unchanged. */
  counterPay?: number;
  message: string;
}

/**
 * The candidate's answer to an offer. Close offers get a counter-offer (costs 1 patience),
 * low ones offend (costs 2). Out of patience, they walk away for a week.
 */
export function evaluateOffer(
  who: { name: string; level: number; greed: number; relationship?: number; patience: number },
  terms: CompanionTerms, rank: Rank,
): NegotiationResult {
  const demand = companionDemand(who.level, who.greed, terms.termWeeks, who.relationship ?? 0);
  const value = offerValue(terms, rank);
  const ratio = value / Math.max(1, demand);
  if (ratio >= 1) return { verdict: 'accept', ratio, message: `"You have a deal." ${who.name} signs the contract.` };
  const counterPay = round5(terms.basePay + (demand - value) + 2.5);
  const cost = ratio >= 0.8 ? 1 : 2;
  if (who.patience - cost <= 0) {
    return { verdict: 'walkout', ratio, message: `"I don't think we'll come to terms." ${who.name} leaves the table. (Try again in a week.)` };
  }
  if (ratio >= 0.8) {
    return { verdict: 'counter', ratio, counterPay, message: `"Close. Make it ${counterPay} gold a week and we can talk."` };
  }
  return { verdict: 'reject', ratio, counterPay, message: `"Is that a joke?" ${who.name} looks offended.` };
}

/** Patience an offer costs. */
export const patienceCost = (r: NegotiationResult) => (r.verdict === 'counter' ? 1 : r.verdict === 'accept' ? 0 : 2);

export function companionContract(terms: CompanionTerms, day: number, greed: number, relationship: number): CompanionContract {
  return {
    type: 'companion', ...terms, startDay: day, endDay: day + terms.termWeeks * 7, relationship, greed,
  };
}

/** Weekly cost of a companion: pay plus food and lodging if the party covers it. */
export function weeklyCost(c: Contract): number {
  if (c.type === 'companion') return c.basePay + (c.foodLodging ? foodLodgingWeekly() : 0);
  if (c.type === 'slave' || c.type === 'main') return foodLodgingWeekly();
  return 0;
}

/** Days left on a companion contract (negative = in the grace period). */
export const daysLeft = (c: CompanionContract, day: number) => c.endDay - day;
export const isExpired = (c: Character, day: number) => isCompanion(c) && c.contract.endDay <= day;

// ---- slaves ---------------------------------------------------------------------------------------

export function slavePrice(level: number, rng: () => number): number {
  const s = GUILD.slave;
  return round5((s.priceBase + s.pricePerLevel * (level - 1)) * (0.85 + rng() * 0.3));
}

export const bounty = (level: number) => GUILD.slave.bountyPerLevel * level;

// ---- the roster -------------------------------------------------------------------------------------

/** Members who can fight on the next quest (lapsed companions sit out). */
export function canFight(state: GameState, c: Character): boolean {
  return !isExpired(c, state.day);
}

export function rosterFull(state: GameState): boolean {
  return state.party.length >= GUILD.maxRoster;
}

/** Turn a free adventurer into a party member. */
export function joinParty(state: GameState, a: FreeAdventurer, contract: Contract): Character {
  state.guild.pool = state.guild.pool.filter((p) => p !== a);
  const c = { ...a.character, contract };
  state.party.push(c);
  return c;
}

/** A member leaves (released, contract over, mercenary job done) and goes back to the guild hall. */
export function leaveParty(state: GameState, c: Character, greed = 1): void {
  state.party = state.party.filter((m) => m.id !== c.id);
  state.lineup = state.lineup.filter((id) => id !== c.id);
  const { contract: _contract, ...character } = c;
  state.guild.pool.push({ character, greed, patience: GUILD.companion.patience, refusedUntil: state.day + 3 });
}
