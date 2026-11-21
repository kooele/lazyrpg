import { PALETTE, TREE_SKILLS, WEAPONS, XP_PER_LEVEL, skillSlotsForLevel } from '../data/content';
import { STAT_CONFIG } from '../data/stats';
import { STAT_KEYS, type Character, type Stats } from '../data/types';

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

/** Final stats: level stats + weapon bonus. */
export function deriveStats(c: Character): Stats {
  const out = levelStats(c.level);
  const bonus = WEAPONS[c.weaponId]?.bonus ?? {};
  for (const k of STAT_KEYS) out[k] += bonus[k] ?? 0;
  out.movement = Math.max(1, out.movement);
  out.health = Math.max(1, out.health);
  return out;
}

export function skillSlots(c: Character): number {
  return skillSlotsForLevel(c.level);
}

/** Weapon skills (always available) followed by the picked tree skills. */
export function allSkills(c: Character): string[] {
  return [...(WEAPONS[c.weaponId]?.skills ?? []), ...c.skillIds.slice(0, skillSlots(c))];
}

export function createCharacter(name: string, color = PALETTE[0], weaponId = 'sword_shield'): Character {
  return {
    id: newId(),
    name,
    level: 1,
    xp: 0,
    weaponId,
    skillIds: [],
    appearance: { color, emblem: 'circle' },
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
  if (!WEAPONS[c.weaponId]) c.weaponId = 'sword_shield';
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
