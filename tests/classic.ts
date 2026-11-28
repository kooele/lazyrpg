// Enemy strength from before the balance pass that made enemies a match for a geared party of their own level
// (tools/balance). The AI behaviour tests set up fair odds against level-1 heroes with it: what they test is how an
// enemy weighs its odds, not how strong it is.
import { ENEMIES } from '../src/data/enemies';
import type { Unit } from '../src/game/battle';

const CLASSIC: Record<string, { base: Record<'health' | 'pAtk' | 'mAtk', number>; growth: Record<'health' | 'pAtk' | 'mAtk', number> }> = {
  bandit: { base: { health: 560, pAtk: 130, mAtk: 110 }, growth: { health: 50, pAtk: 10, mAtk: 10 } },
  wraith: { base: { health: 760, pAtk: 95, mAtk: 228 }, growth: { health: 40, pAtk: 5, mAtk: 12 } },
};

/** Scale an enemy unit's Health and attack back to its type's classic strength (gear and the rest unchanged). */
export function classic(u: Unit): Unit {
  const type = u.character.enemyType!;
  const def = ENEMIES[type];
  const old = CLASSIC[type];
  if (!old) throw new Error(`No classic stats for ${type}`);
  const steps = u.character.level - def.levels[0];
  for (const k of ['health', 'pAtk', 'mAtk'] as const) {
    const now = def.stats[k] + (def.growthPerLevel[k] ?? 0) * steps;
    const then = old.base[k] + old.growth[k] * steps;
    if (now > 0) u.stats[k] = Math.round((u.stats[k] * then) / now);
  }
  u.hp = u.stats.health;
  return u;
}
