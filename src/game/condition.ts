// Strategic Layer condition of party members: Health (0-100, separate from battle HP) and Morale (0-100).
// Pure logic (no Phaser).
import { GUILD, LODGING_QUALITY, type Activity, type InnTier } from '../data/guild';
import type { Character, GameState } from '../data/types';

export const MAX_HEALTH = 100;
export const MAX_MORALE = 100;

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

export const healthOf = (c: Character) => c.health ?? MAX_HEALTH;
export const moraleOf = (c: Character) => c.morale ?? GUILD.condition.startingMorale;
/** Below full Health: can't go on quests. */
export const isInjured = (c: Character) => healthOf(c) < MAX_HEALTH;

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

/** The inn an adventurer expects for the night: standard, or luxury from lodging.luxuryFromLevel. */
export function expectedInn(c: Character): InnTier {
  return c.level >= GUILD.lodging.luxuryFromLevel ? 'luxury' : 'standard';
}

/** Relationship change for a night spent at `where` (better than expected: up; worse: down per step). */
export function lodgingRelationship(c: Character, where: 'outside' | InnTier): number {
  const diff = LODGING_QUALITY[where] - LODGING_QUALITY[expectedInn(c)];
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
