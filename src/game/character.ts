import {
  CLASSES, CREATION_POINTS, PALETTE, POINTS_PER_LEVEL, SKILLS, WEAPONS, XP_PER_LEVEL, skillSlotsForLevel,
} from '../data/content';
import { ATTRIBUTE_KEYS, type Attributes, type Character, type ClassId } from '../data/types';

export interface DerivedStats {
  maxHp: number;
  physPower: number;
  magPower: number;
  defense: number;
  resistance: number;
  speed: number;
  move: number;
  /** Bonus to hit chance (percentage points). */
  accuracy: number;
  /** Critical hit chance (percentage). */
  crit: number;
}

export function newId(prefix = 'c'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Attributes after weapon bonuses are applied (minimum 1 each). */
export function effectiveAttributes(c: Character): Attributes {
  const weapon = WEAPONS[c.weaponId];
  const out = { ...c.attributes };
  for (const key of ATTRIBUTE_KEYS) {
    out[key] = Math.max(1, out[key] + (weapon?.bonus[key] ?? 0));
  }
  return out;
}

export function deriveStats(c: Character): DerivedStats {
  const cls = CLASSES[c.classId];
  const weapon = WEAPONS[c.weaponId];
  const a = effectiveAttributes(c);
  return {
    maxHp: cls.baseHp + a.vit * 3 + (c.level - 1) * 3,
    physPower: a.str + (weapon?.damageType === 'physical' ? weapon.power : 0),
    magPower: a.int + (weapon?.damageType === 'magical' ? weapon.power : 0),
    defense: Math.floor(a.vit / 2) + cls.armor,
    resistance: Math.floor((a.int + a.vit) / 3) + Math.floor(cls.armor / 2),
    speed: a.spd,
    move: cls.move + (a.spd >= 9 ? 1 : 0),
    accuracy: a.dex * 2,
    crit: a.dex * 2,
  };
}

export function skillSlots(c: Character): number {
  return skillSlotsForLevel(c.level);
}

export function createCharacter(name: string, classId: ClassId, color = PALETTE[0]): Character {
  const cls = CLASSES[classId];
  return {
    id: newId(),
    name,
    classId,
    level: 1,
    xp: 0,
    attributes: { ...cls.baseAttributes },
    unspentPoints: CREATION_POINTS,
    weaponId: cls.weapons[0],
    skillIds: cls.skills.slice(0, 2),
    appearance: { color, emblem: 'circle' },
  };
}

/**
 * Add XP and apply any level ups. Returns the number of levels gained.
 */
export function grantXp(c: Character, amount: number): number {
  c.xp += amount;
  let gained = 0;
  while (c.xp >= XP_PER_LEVEL) {
    c.xp -= XP_PER_LEVEL;
    c.level += 1;
    c.unspentPoints += POINTS_PER_LEVEL;
    gained += 1;
  }
  return gained;
}

export function cloneCharacter(c: Character): Character {
  return JSON.parse(JSON.stringify(c)) as Character;
}

/** Ensure weapon/skills are legal for the character's class and level. */
export function sanitizeLoadout(c: Character): void {
  const cls = CLASSES[c.classId];
  if (!cls.weapons.includes(c.weaponId)) c.weaponId = cls.weapons[0];
  const unique = [...new Set(c.skillIds)].filter((s) => cls.skills.includes(s) && SKILLS[s]);
  c.skillIds = unique.slice(0, skillSlots(c));
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
