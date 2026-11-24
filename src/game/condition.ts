// Strategic Layer condition of party members: Health (0-100, separate from battle HP) and Morale (0-100).
// Pure logic (no Phaser).
import { GUILD, LODGING_QUALITY, foodQuality, isResidence, type Activity, type CityLodging, type FoodTier, type Lodging } from '../data/guild';
import { TRAITS, type TraitDef } from '../data/traits';
import type { Character, GameState } from '../data/types';
import { adventurerRank } from './guild';

export const MAX_HEALTH = 100;
export const MAX_MORALE = 100;

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

export const healthOf = (c: Character) => c.health ?? MAX_HEALTH;
export const moraleOf = (c: Character) => c.morale ?? GUILD.condition.startingMorale;
/** Below full Health: fights at a penalty (see injuryPenalty). */
export const isInjured = (c: Character) => healthOf(c) < MAX_HEALTH;

/** Share of every stat an injured member loses in battle: 1/3 of their missing Health (Health 70 = -10%). */
export const injuryPenalty = (c: Character) => (MAX_HEALTH - healthOf(c)) / 3 / 100;

/** Share lost for every full 5 points of a 0-100 value below 100 (combat.percentPer5: 1% by default). */
const per5 = (v: number) => (Math.floor((100 - Math.max(0, Math.min(100, v))) / 5) * GUILD.combat.percentPer5) / 100;

/** Share of every stat a member loses in battle from low Morale: 1% per 5 below 100. */
export const moralePenalty = (c: Character) => per5(moraleOf(c));

/** Slaves only: share of every stat lost from low Obedience, 1% per 5 below 100. */
export const obediencePenalty = (c: Character) => (c.contract?.type === 'slave' ? per5(c.contract.obedience) : 0);

/** Total share of every battle stat a party member loses: injury, Morale and Obedience, multiplied together. */
export function combatPenalty(c: Character): number {
  return 1 - (1 - injuryPenalty(c)) * (1 - moralePenalty(c)) * (1 - obediencePenalty(c));
}

/** A trait effect for a member: every trait's multiplier, multiplied together (1 without traits). */
export const traitFactor = (c: Character, key: 'healthRecovery' | 'moraleGain') =>
  (c.traits ?? []).reduce((m, t) => m * (TRAITS[t] as TraitDef)[key], 1);

/** Change Health. Recovery (a gain) is multiplied by traits (Protagonist: x2). */
export function changeHealth(c: Character, delta: number): void {
  const d = delta > 0 ? delta * traitFactor(c, 'healthRecovery') : delta;
  c.health = Math.round(clamp(healthOf(c) + d, MAX_HEALTH));
}

/** Change Morale. Gains are multiplied by traits (Protagonist: x2); losses aren't. */
export function changeMorale(c: Character, delta: number): void {
  const d = delta > 0 ? delta * traitFactor(c, 'moraleGain') : delta;
  c.morale = Math.round(clamp(moraleOf(c) + d, MAX_MORALE));
}

/** How a member came out of a battle: the lowest HP they were taken down to (0-1 of max) and whether they fell. */
export interface BattleCondition {
  id: string;
  lowestHp: number;
  fell: boolean;
}

/** Health a member loses after a battle: maxHealthLoss x the share of HP lost at the worst point. */
export function healthLoss(lowestHp: number): number {
  return Math.round(GUILD.condition.maxHealthLoss * (1 - clamp(lowestHp, 1)));
}

/** The food and night quality a member expects: slaves lodging.slaveExpectedQuality, everyone else lodging.expectedQuality for their rank. */
export function expectedQuality(c: Character): number {
  if (c.contract?.type === 'slave') return GUILD.lodging.slaveExpectedQuality;
  return GUILD.lodging.expectedQuality[adventurerRank(c.level)];
}

/** What a night quality means, for the UI. */
export const QUALITY_TEXT = ['the stables', 'an inn or the Outer City House', 'a high-end inn or the Inner City Townhouse', 'a luxury inn or the Inner City Mansion'];

/** Name of a place to spend the night. */
export function lodgingName(l: Lodging): string {
  if (l === 'outside') return 'the stables';
  if (l === 'road') return 'on the road';
  return isResidence(l) ? `your ${GUILD.residences[l].name}` : GUILD.inns[l].name;
}

/** Relationship change for a night spent at `where` (better than expected: up; worse: down per step). */
export function lodgingRelationship(c: Character, where: CityLodging): number {
  const diff = LODGING_QUALITY[where] - expectedQuality(c);
  if (diff > 0) return GUILD.lodging.relationshipAbove;
  return diff < 0 ? -GUILD.lodging.relationshipBelowPerStep * -diff : 0;
}

/**
 * Where a member sleeps in the city: as set in Manage Party, else the stables ('outside'). A residence the party
 * no longer owns counts as the stables.
 */
export function lodgingOf(state: GameState, c: Pick<Character, 'id'>): CityLodging {
  const l = state.lodging?.[c.id] ?? 'outside';
  return isResidence(l) && !state.residences.includes(l) ? 'outside' : l;
}

/** The food a member gets each day: as set in Manage Party, else food.default. */
export const foodOf = (state: GameState, c: Character): FoodTier => state.food[c.id] ?? GUILD.food.default;

/** Relationship change for a day's food (better than they expect: up; worse: down per step). */
export function foodRelationship(c: Character, tier: FoodTier): number {
  const diff = foodQuality(tier) - expectedQuality(c);
  if (diff > 0) return GUILD.food.relationshipAbove;
  return diff < 0 ? -GUILD.food.relationshipBelowPerStep * -diff : 0;
}

/** What a food quality means for someone's expectations, for the UI. */
export const FOOD_EXPECT_TEXT = ['poor food', 'common food', 'fine food', 'luxury food'];

export const ACTIVITY_INFO: Record<Activity, { name: string; describe: () => string }> = {
  recover: {
    name: 'Recover',
    describe: () => `Rest up: recovers ${GUILD.schedule.recoverMultiplier * GUILD.condition.healthPerDay} Health a day instead of ${GUILD.condition.healthPerDay}.`,
  },
  training: { name: 'Training', describe: () => `Drills and sparring: +${GUILD.schedule.trainingXp.perLevel} XP per level +${GUILD.schedule.trainingXp.flat} a day.` },
  oddJobs: { name: 'Odd Jobs', describe: () => `Work around the city: +${GUILD.schedule.oddJobsGold} gold a day.` },
  dayOff: { name: 'Day Off', describe: () => `Take it easy: +${GUILD.schedule.dayOffMorale} Morale a day.` },
};

/** What a member does on days they aren't on a quest: as scheduled, else Recover when injured and Day Off otherwise. */
export function activityOf(state: GameState, c: Character): Activity {
  return state.schedule[c.id] ?? (isInjured(c) ? 'recover' : 'dayOff');
}
