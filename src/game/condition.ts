// Strategic Layer condition of party members: Health (0-100, separate from battle HP) and Morale (0-100).
// Pure logic (no Phaser).
import { GUILD, LODGING_QUALITY, isResidence, type Activity, type CityLodging, type Lodging } from '../data/guild';
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

export function changeHealth(c: Character, delta: number): void {
  c.health = Math.round(clamp(healthOf(c) + delta, MAX_HEALTH));
}

export function changeMorale(c: Character, delta: number): void {
  c.morale = Math.round(clamp(moraleOf(c) + delta, MAX_MORALE));
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

/** The night quality an adventurer expects, from their rank: D 0 (outside is fine) up to A/S 3 (luxury). */
export function expectedQuality(c: Character): number {
  return GUILD.lodging.expectedQuality[adventurerRank(c.level)];
}

/** What a night quality means, for the UI. */
export const QUALITY_TEXT = ['sleeping outside', 'an inn or Outer Ring residence', 'a high-end inn or Middle Ring residence', 'a luxury inn or Inner Ring residence'];

/** Name of a place to spend the night. */
export function lodgingName(l: Lodging): string {
  if (l === 'outside') return 'outside';
  if (l === 'road') return 'on the road';
  return isResidence(l) ? `your ${GUILD.residences[l].name}` : GUILD.inns[l].name;
}

/** Relationship change for a night spent at `where` (better than expected: up; worse: down per step). */
export function lodgingRelationship(c: Character, where: CityLodging): number {
  const diff = LODGING_QUALITY[where] - expectedQuality(c);
  if (diff > 0) return GUILD.lodging.relationshipAbove;
  return diff < 0 ? -GUILD.lodging.relationshipBelowPerStep * -diff : 0;
}

export const ACTIVITY_INFO: Record<Activity, { name: string; describe: () => string }> = {
  recover: {
    name: 'Recover',
    describe: () => `Rest up: recovers ${GUILD.schedule.recoverMultiplier * GUILD.condition.healthPerDay} Health a day instead of ${GUILD.condition.healthPerDay}.`,
  },
  training: { name: 'Training', describe: () => `Drills and sparring: +${GUILD.schedule.trainingXp} XP a day.` },
  oddJobs: { name: 'Odd Jobs', describe: () => `Work around the city: +${GUILD.schedule.oddJobsGold} gold a day.` },
  dayOff: { name: 'Day Off', describe: () => `Take it easy: +${GUILD.schedule.dayOffMorale} Morale a day.` },
};

/** What a member does on days they aren't on a quest: as scheduled, else Recover when injured and Day Off otherwise. */
export function activityOf(state: GameState, c: Character): Activity {
  return state.schedule[c.id] ?? (isInjured(c) ? 'recover' : 'dayOff');
}
