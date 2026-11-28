// Quick Battle (demo): build a party of up to 4 Adventurers at camp, pick their level (1 to 10), and fight random
// enemies of that level. It lives apart from the Arch City campaign and isn't saved.
import type { Character } from '../data/types';
import { sanitizeLoadout } from './character';

/** Levels the party can be set to. */
export const DEMO_LEVELS = { min: 1, max: 10 } as const;

/** Most Adventurers in a Quick Battle party. */
export const DEMO_PARTY_SIZE = 4;

export interface DemoState {
  party: Character[];
  /** Every Adventurer's level, and the level of the enemies they fight (the battle stage). */
  level: number;
  victories: number;
  defeats: number;
  /** Difficulty: enemy count multiplier (1x to 5x). Follows the party size (1x per Adventurer) until moved by hand. */
  mobMultiplier: number;
}

export const MOB_MULTIPLIER = { min: 1, max: 5, step: 0.5 } as const;

/**
 * What 1x on the Enemies slider is worth: this share of the usual group of the level's rank (which is sized for a
 * whole party, and is par for a party of 4 at that level: see src/game/power.ts). With 1x per Adventurer, a full party
 * of 4 meets 1 usual group.
 */
export const DEMO_GROUP_SHARE = 0.25;

/** Threat budget and enemy cap for a Quick Battle: the usual group (`usual`) x the slider x DEMO_GROUP_SHARE. */
export function demoEncounter(d: DemoState, usual: number, maxEnemies: number): { budget: number; cap: number } {
  const scale = d.mobMultiplier * DEMO_GROUP_SHARE;
  return { budget: usual * scale, cap: Math.max(1, Math.round(maxEnemies * scale)) };
}

export const demo: { state: DemoState | null } = { state: null };

export function newDemo(): DemoState {
  // A restart keeps the chosen level.
  demo.state = { party: [], level: demo.state?.level ?? 1, victories: 0, defeats: 0, mobMultiplier: 1 };
  return demo.state;
}

export function requireDemo(): DemoState {
  return demo.state ?? newDemo();
}

/** The Enemies slider's automatic setting: 1x per Adventurer (1x to 4x). */
export const autoMultiplier = (d: DemoState) => Math.max(1, Math.min(DEMO_PARTY_SIZE, d.party.length));

/** The party changed size: the Enemies slider follows it (1x per Adventurer). */
export function partyChanged(d: DemoState): void {
  d.mobMultiplier = autoMultiplier(d);
}

/**
 * Set the party's level (1 to 10): every Adventurer is put at that level with no XP. Lowering it unlearns skills
 * above the new level and refunds points past the new total (Body points first, see sanitizeLoadout).
 */
export function setDemoLevel(d: DemoState, level: number): void {
  d.level = Math.max(DEMO_LEVELS.min, Math.min(DEMO_LEVELS.max, Math.round(level)));
  for (const c of d.party) fitToLevel(c, d.level);
}

/** Put one Adventurer at the Quick Battle level (new recruits, and everyone when the level changes). */
export function fitToLevel(c: Character, level: number): void {
  c.level = level;
  c.xp = 0;
  const weapon = c.weapon;
  const armor = c.armor;
  sanitizeLoadout(c);
  // sanitizeLoadout drops gear the party couldn't own; Quick Battle gear is whatever the recruit was made with.
  c.weapon = weapon;
  c.armor = armor;
}

/** Settle a Quick Battle: only counts the result (the level is chosen at camp, not earned). Returns report lines. */
export function resolveDemoBattle(d: DemoState, outcome: 'victory' | 'defeat'): string[] {
  if (outcome === 'defeat') {
    d.defeats += 1;
    return ['Your party falls back to camp to recover.', 'Rethink your loadouts, or pick a lower level, and try again.'];
  }
  d.victories += 1;
  return ['Victory! The enemies are driven off.', `Fight again at level ${d.level}, or pick another level at camp.`];
}
