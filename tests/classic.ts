// Enemy strength from before the balance pass that made enemies a match for a geared party of their own level
// (tools/balance/enemies.orig.json). The AI behaviour tests set up fair odds against level-1 heroes with it: what they
// test is how an enemy weighs its odds, not how strong it is.
import orig from '../tools/balance/enemies.orig.json';
import { ENEMIES } from '../src/data/enemies';
import type { Unit } from '../src/game/battle';

type Line = { levels: number[]; stats: Record<string, number>; growthPerLevel: Record<string, number> };
const CLASSIC = (orig as unknown as { enemies: Record<string, Line> }).enemies;

/** A type's stat at a level, by the game's current data or the classic data. */
const now = (type: string, k: 'health' | 'pAtk' | 'mAtk', level: number) => {
  const d = ENEMIES[type];
  const steps = Math.max(0, level - d.levels[0]); // below its levels, a type has its lowest level's stats
  return d.stats[k] + (d.growthPerLevel[k] ?? 0) * steps + (d.growthBend[k] ?? 0) * steps * steps;
};
const then = (type: string, k: 'health' | 'pAtk' | 'mAtk', level: number) => {
  const d = CLASSIC[type];
  return (d.stats[k] ?? 0) + (d.growthPerLevel[k] ?? 0) * Math.max(0, level - d.levels[0]);
};

/** Scale an enemy unit's Health and attack back to its type's classic strength (gear and the rest unchanged). */
export function classic(u: Unit): Unit {
  const type = u.character.enemyType!;
  if (!CLASSIC[type]) throw new Error(`No classic stats for ${type}`);
  for (const k of ['health', 'pAtk', 'mAtk'] as const) {
    const n = now(type, k, u.character.level);
    if (n > 0) u.stats[k] = Math.round((u.stats[k] * then(type, k, u.character.level)) / n);
  }
  u.hp = u.stats.health;
  return u;
}
