import { DEFAULT_WEAPON, PALETTE, TREE_SKILLS, WEAPONS, XP_PER_LEVEL, skillSlotsForLevel } from '../data/content';
import { ENEMIES } from '../data/enemies';
import { STAT_CONFIG } from '../data/stats';
import { BODY_MODELS, STAT_KEYS, type BodyModel, type Character, type Stats } from '../data/types';

export function newId(prefix = 'c'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Base stats + automatic level growth (no weapon). */
export function levelStats(level: number): Stats {
  const { base, growthPerLevel } = STAT_CONFIG;
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = base[k] + growthPerLevel[k] * (level - 1);
  return out;
}

/** Stats of an enemy type at a level (before weapon multipliers). */
export function enemyLevelStats(type: string, level: number): Stats {
  const def = ENEMIES[type];
  const out = { ...def.stats };
  const steps = Math.max(0, level - def.levels[0]);
  for (const k of STAT_KEYS) out[k] += (def.growthPerLevel[k] ?? 0) * steps;
  return out;
}

/** Final stats: level stats (or the enemy type's stats) x weapon multipliers (rounded). */
export function deriveStats(c: Character): Stats {
  const out = c.enemyType ? enemyLevelStats(c.enemyType, c.level) : levelStats(c.level);
  const mult = WEAPONS[c.weaponId]?.statMultipliers ?? {};
  for (const k of STAT_KEYS) out[k] = Math.round(out[k] * (mult[k] ?? 1));
  out.movement = Math.max(1, out.movement);
  out.health = Math.max(1, out.health);
  return out;
}

/** Pick a body model deterministically from an id (used for old saves and enemies). */
export function modelFor(seed: string): BodyModel {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BODY_MODELS[h % BODY_MODELS.length];
}

export function skillSlots(c: Character): number {
  return skillSlotsForLevel(c.level);
}

/**
 * Every skill the unit has. Adventurers: weapon skills, then picked tree skills.
 * Enemies: weapon skills (if any), the type's skills, weapon extras, then skills unlocked by level.
 * The first skill is always the basic attack.
 */
export function allSkills(c: Character): string[] {
  const weaponSkills = WEAPONS[c.weaponId]?.skills ?? [];
  if (c.enemyType) {
    const def = ENEMIES[c.enemyType];
    const byLevel = Object.entries(def.skillsByLevel).filter(([lvl]) => c.level >= Number(lvl)).flatMap(([, s]) => s);
    const fromWeapon = def.weaponSkillUse === 'basic' ? weaponSkills.slice(0, 1) : weaponSkills;
    return [...new Set([...fromWeapon, ...def.skills, ...(def.weaponSkills[c.weaponId] ?? []), ...byLevel])];
  }
  return [...weaponSkills, ...c.skillIds.slice(0, skillSlots(c))];
}

export function createCharacter(name: string, color = PALETTE[0], weaponId = DEFAULT_WEAPON, model?: BodyModel): Character {
  const id = newId();
  return {
    id,
    name,
    level: 1,
    xp: 0,
    weaponId,
    skillIds: [],
    appearance: { color, model: model ?? modelFor(id) },
  };
}

/** Add XP and apply any level ups (stat growth is automatic). Returns levels gained. */
export function grantXp(c: Character, amount: number): number {
  c.xp += amount;
  let gained = 0;
  while (c.xp >= XP_PER_LEVEL) {
    c.xp -= XP_PER_LEVEL;
    c.level += 1;
    gained += 1;
  }
  return gained;
}

export function cloneCharacter(c: Character): Character {
  return JSON.parse(JSON.stringify(c)) as Character;
}

/** Ensure weapon/skills are legal for the character's level. */
export function sanitizeLoadout(c: Character): void {
  if (!WEAPONS[c.weaponId]) c.weaponId = DEFAULT_WEAPON;
  c.skillIds = [...new Set(c.skillIds)].filter((s) => TREE_SKILLS.includes(s)).slice(0, skillSlots(c));
}

/** Small deterministic RNG (mulberry32) so battles and tests can be seeded. */
export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
