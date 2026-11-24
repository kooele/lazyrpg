// Contracts: mercenary fees, companion negotiations, slaves. Pure logic (no Phaser).
import { GUILD } from '../data/guild';
import type { Character, CompanionTerms, Contract, FreeAdventurer, GameState, Rank } from '../data/types';
import { FOOD_TIERS, INN_TIERS } from '../data/guild';
import { adventurerRank } from './guild';
import { talentScore } from './talent';

const C = GUILD.companion;
const round5 = (v: number) => Math.max(0, Math.round(v / 5) * 5);

export type CompanionContract = Extract<Contract, { type: 'companion' }>;
export const isCompanion = (c: Character): c is Character & { contract: CompanionContract } => c.contract?.type === 'companion';
export type SlaveContract = Extract<Contract, { type: 'slave' }>;
export const isSlave = (c: Character): c is Character & { contract: SlaveContract } => c.contract?.type === 'slave';

/** Members with a relationship score: companions and slaves. */
export function bondOf(c: Character): CompanionContract | SlaveContract | null {
  return isCompanion(c) || isSlave(c) ? c.contract : null;
}

/** Change a companion's or slave's relationship (0-100). No-op for everyone else. */
export function changeRelationship(c: Character, delta: number): void {
  const b = bondOf(c);
  if (b) b.relationship = Math.max(0, Math.min(100, b.relationship + delta));
}

/** Members whose food and lodging the party pays: the main character, slaves, and companions with it in their contract. */
export const isHoused = (c: Character) => c.contract?.type === 'main' || c.contract?.type === 'slave' || (isCompanion(c) && c.contract.foodLodging);

// ---- talent ----------------------------------------------------------------------------------------

/**
 * Talent's price modifier: the adventurer's average stat growth rate (talentScore), so price follows how much more
 * (or less) they grow per level: all C = x1, all S = x1.6, all F = x0.6. It scales the per-level part of wages and
 * slave prices, and mercenary fees and cuts.
 */
export function talentPriceFactor(c: Pick<Character, 'talents'>): number {
  return talentScore(c);
}

// ---- mercenaries --------------------------------------------------------------------------------

/** What a mercenary asks: the larger of a fixed fee (paid up front) and a % of the next quest's reward. */
export function mercenaryRates(level: number, greed: number, talent = 1): { fee: number; cutPct: number } {
  const m = GUILD.mercenary;
  return {
    fee: round5(m.feePerLevel * level * greed * talent),
    cutPct: Math.max(1, Math.round((m.cutBase + m.cutPerLevel * level) * greed * talent)),
  };
}

// ---- companions -----------------------------------------------------------------------------------

/**
 * What food and lodging are worth per week to an adventurer of `level`: what the party would pay to give them the
 * food and the night their rank expects (lodging.expectedQuality): D and C-rank common food at the Sleeping Griffin,
 * B and A-rank fine food at the Silver Lantern, S-rank luxury food at the Gilded Crown.
 */
export function foodLodgingWeekly(level: number): number {
  const q = GUILD.lodging.expectedQuality[adventurerRank(level)];
  const food = GUILD.food[FOOD_TIERS[q]].pricePerPerson;
  const night = q === 0 ? GUILD.lodging.stablesPerPerson : GUILD.inns[INN_TIERS[q - 1]].pricePerPerson;
  return (food + night) * 7;
}

/** How much a loot cut is worth per week to a candidate, given the party's rank. */
export const lootValue = (lootPct: number, rank: Rank) => (lootPct / 100) * C.expectedWeeklyLoot[rank];

/** What the terms are worth to a companion of `level`, in gold per week. */
export function offerValue(t: CompanionTerms, rank: Rank, level: number): number {
  return t.basePay + lootValue(t.lootPct, rank) + (t.foodLodging ? foodLodgingWeekly(level) : 0);
}

/**
 * What a companion wants per week for a term: wageBase + wagePerLevel x level x talent (talentPriceFactor), x greed; short terms cost more,
 * long ones less. On renewal, a good relationship lowers it (up to renewalDiscountAtMax at 100).
 */
export function companionDemand(level: number, greed: number, termWeeks: number, relationship = 0, talent = 1): number {
  const base = (C.wageBase + C.wagePerLevel * level * talent) * greed;
  const term = C.termDemand[String(termWeeks)] ?? 1;
  return base * term * (1 - C.renewalDiscountAtMax * Math.max(0, Math.min(100, relationship)) / 100);
}

/** A reasonable first offer: food and lodging, a small cut, and a little under their asking pay. */
export function openingTerms(level: number, greed: number, rank: Rank, relationship = 0, talent = 1): CompanionTerms {
  const terms: CompanionTerms = { basePay: 0, lootPct: 5, foodLodging: true, termWeeks: 4 };
  const want = companionDemand(level, greed, terms.termWeeks, relationship, talent);
  terms.basePay = round5(Math.max(0, want * 0.85 - lootValue(terms.lootPct, rank) - foodLodgingWeekly(level)));
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
  who: { name: string; level: number; greed: number; relationship?: number; patience: number; talent?: number },
  terms: CompanionTerms, rank: Rank,
): NegotiationResult {
  const demand = companionDemand(who.level, who.greed, terms.termWeeks, who.relationship ?? 0, who.talent ?? 1);
  const value = offerValue(terms, rank, who.level);
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

/** Days left on a companion contract (negative = in the grace period). */
export const daysLeft = (c: CompanionContract, day: number) => c.endDay - day;
export const isExpired = (c: Character, day: number) => isCompanion(c) && c.contract.endDay <= day;

/**
 * Base pay a companion has earned since the last payday (paydays are every 7th day), prorated by the day: what
 * they're owed if they leave before the next one. Days after their term ended don't count (they aren't paid then).
 */
export function proratedWages(c: Character & { contract: CompanionContract }, day: number): number {
  const lastPayday = day - (day % 7);
  const worked = Math.max(0, Math.min(day, c.contract.endDay) - Math.max(lastPayday, c.contract.startDay));
  return Math.round((c.contract.basePay * worked) / 7);
}

/** Everything releasing a companion costs: the wages they've earned since payday, plus the buyout (releaseCost). */
export const releaseTotal = (c: Character & { contract: CompanionContract }, day: number, rank: Rank) => proratedWages(c, day) + releaseCost(c, day, rank);

/**
 * The buyout for releasing a companion before their term ends: the smaller of releaseMinWeeks weeks of their compensation
 * and releaseShareOfRemaining of the compensation for the days left. Compensation is their total weekly worth: base
 * pay + expected loot cut at the party's rank + food & lodging (see offerValue). Free once the term has ended.
 */
export function releaseCost(c: Character & { contract: CompanionContract }, day: number, rank: Rank): number {
  const left = daysLeft(c.contract, day);
  if (left <= 0) return 0;
  const weekly = offerValue(c.contract, rank, c.level);
  const weeks = Math.min(C.releaseMinWeeks, (C.releaseShareOfRemaining * left) / 7);
  return round5(weekly * weeks);
}

// ---- slaves ---------------------------------------------------------------------------------------

/** A slave's price: priceBase + pricePerLevel x level x talent (talentPriceFactor), with +-15% luck. */
export function slavePrice(level: number, rng: () => number, talent = 1): number {
  const s = GUILD.slave;
  return round5((s.priceBase + s.pricePerLevel * level * talent) * (0.85 + rng() * 0.3));
}

/** A slave's normal market value: what the market asks on average (price index 1, no haggling luck). */
export function slaveValue(c: Pick<Character, 'level' | 'talents'>): number {
  const s = GUILD.slave;
  return s.priceBase + s.pricePerLevel * c.level * talentPriceFactor(c);
}

export const bounty = (level: number) => GUILD.slave.bountyPerLevel * level;

/**
 * Registering a prisoner as the party's slave costs its normal market value minus its bounty: at a normal
 * market, enslaving it (and selling at full value) and turning it in come to the same.
 */
export const registrationFee = (p: { character: Pick<Character, 'level' | 'talents'>; price: number }) => Math.max(0, round5(slaveValue(p.character) - p.price));

/** Weekly property tax on a slave the party owns (paid on payday with the wages). */
export const slaveTax = (c: Pick<Character, 'level' | 'talents'>) => Math.max(1, Math.round(slaveValue(c) * GUILD.slave.weeklyTaxShare));

/** A new slave's contract: market slaves start fairly obedient, registered captives much less so. */
export function slaveContract(origin: SlaveContract['origin'], price: number, rng: () => number): SlaveContract {
  const [lo, hi] = origin === 'market' ? GUILD.slave.obedienceMarket : GUILD.slave.obedienceCaptive;
  return { type: 'slave', price, origin, relationship: GUILD.slave.startingRelationship, obedience: Math.round(lo + rng() * (hi - lo)) };
}

/**
 * Punish a slave: Obedience up by punishObedience, relationship down by punishRelationship (once a day).
 * Returns an error message, or null.
 */
export function punishSlave(c: Character, day: number): string | null {
  if (!isSlave(c)) return 'Only slaves can be punished.';
  if (c.contract.punishedDay === day) return `${c.name} was already punished today.`;
  c.contract.obedience = Math.min(100, c.contract.obedience + GUILD.slave.punishObedience);
  c.contract.relationship = Math.max(0, c.contract.relationship - GUILD.slave.punishRelationship);
  c.contract.punishedDay = day;
  return null;
}

// ---- the roster -------------------------------------------------------------------------------------

/** Members who can fight on the next quest (lapsed companions sit out; the injured fight at a penalty). */
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
  delete state.schedule[c.id];
  delete state.food[c.id];
  delete state.lodging[c.id];
  const { contract: _contract, ...character } = c;
  state.guild.pool.push({ character, greed, patience: GUILD.companion.patience, refusedUntil: state.day + 3 });
}
