import { BASIC_SKILLS, DEFAULT_WEAPON, PALETTE, SKILLS, TREE_SKILLS, WEAPONS, xpToNext, skillPointsForLevel, maxBodyRank } from '../data/content';
import { ENEMIES } from '../data/enemies';
import { STAT_CONFIG } from '../data/stats';
import { BODY_MODELS, STAT_KEYS, type BodyModel, type BodyInvestment, type Character, type Look, type StatKey, type Stats, type Talents, type UnitModel } from '../data/types';
import { lookFromModel } from './people';
import { talentGrowth, talentStats } from './talent';

export function newId(prefix = 'c'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Base stats + automatic level growth (no weapon). Each stat grows at growthPerLevel x its talent's growth rate. */
export function levelStats(level: number, talents?: Talents): Stats {
  const { base } = STAT_CONFIG;
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = base[k] + Math.round(talentGrowth({ talents }, k) * (level - 1));
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

// ---- skill points and the Body tab ---------------------------------------------------------

/** Stats skill points can be invested in: the ones that grow with level. */
export const bodyStats = (): StatKey[] => talentStats();

/** What one Body investment adds to a stat: twice its base growth per level (talent doesn't change it). */
export const bodyGain = (k: StatKey) => STAT_CONFIG.growthPerLevel[k] * 2;

export const bodyPoints = (c: Pick<Character, 'body'>) => Object.values(c.body ?? {}).reduce((s: number, n) => s + (n ?? 0), 0);

/** Skill points spent: one per tree skill, one per Body investment. */
export const pointsUsed = (c: Character) => c.skillIds.length + bodyPoints(c);
export const freePoints = (c: Character) => skillPoints(c) - pointsUsed(c);

/** Stat bonuses from Body investments. */
export function bodyBonus(body: BodyInvestment | undefined): Partial<Stats> {
  const out: Partial<Stats> = {};
  for (const [k, n] of Object.entries(body ?? {})) if (n) out[k as StatKey] = bodyGain(k as StatKey) * n;
  return out;
}

/** Final stats: level stats + Body investments (or the enemy type's stats) x weapon multipliers (rounded). */
export function deriveStats(c: Character): Stats {
  const out = c.enemyType ? enemyLevelStats(c.enemyType, c.level) : levelStats(c.level, c.talents);
  if (!c.enemyType) for (const [k, v] of Object.entries(bodyBonus(c.body))) out[k as StatKey] += v ?? 0;
  const mult = WEAPONS[c.weaponId]?.statMultipliers ?? {};
  for (const k of STAT_KEYS) out[k] = Math.round(out[k] * (mult[k] ?? 1));
  out.movement = Math.max(1, out.movement);
  out.health = Math.max(1, out.health);
  return out;
}

/** Pick a body model deterministically from an id (used for old saves and enemies). */
export function modelFor(seed: string): BodyModel;
export function modelFor(seed: string, models?: readonly UnitModel[]): UnitModel;
export function modelFor(seed: string, models: readonly UnitModel[] = BODY_MODELS): UnitModel {
  const list = models.length ? models : BODY_MODELS;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** Can the character learn this tree skill at its level? (Skills may need a minimum level.) */
export function isUnlocked(c: Character, skillId: string): boolean {
  return (SKILLS[skillId]?.level ?? 1) <= c.level;
}

/** Skill points the unit has at its level. */
export function skillPoints(c: Character): number {
  return skillPointsForLevel(c.level);
}

/**
 * Every skill the unit has. Adventurers: weapon skills, picked tree skills, then the basic abilities (Dash, Overwatch).
 * Enemies: weapon skills (if any), the type's skills, weapon extras, then skills unlocked by level.
 * The first skill is always the basic attack.
 */
export function allSkills(c: Character): string[] {
  const weaponSkills = WEAPONS[c.weaponId]?.skills ?? [];
  if (c.enemyType) {
    const def = ENEMIES[c.enemyType];
    const byLevel = Object.entries(def.skillsByLevel).filter(([lvl]) => c.level >= Number(lvl)).flatMap(([, s]) => s);
    // 'basic': only the basic attack (and Switch Mode, so archers can pick their bow mode).
    const fromWeapon = def.weaponSkillUse === 'basic' ? weaponSkills.filter((id, i) => i === 0 || SKILLS[id].switchMode) : weaponSkills;
    return [...new Set([...fromWeapon, ...def.skills, ...(def.weaponSkills[c.weaponId] ?? []), ...byLevel])];
  }
  return [...weaponSkills, ...c.skillIds.slice(0, skillPoints(c)), ...BASIC_SKILLS];
}

/** A new level-1 Adventurer. Without talents every stat grows at 100% (grade C). */
// ---- the battle skill bar ------------------------------------------------------------

/** Slots per skill-bar page (hotkeys 1-9, 0). */
export const BAR_PAGE = 10;

/** Default bar: basic attack, then the basic abilities (Overwatch, Dash), then everything else in order. */
export function defaultSkillBar(c: Character): string[] {
  const all = allSkills(c);
  const front = [all[0], ...BASIC_SKILLS.filter((s) => all.includes(s))];
  return [...front, ...all.filter((s) => !front.includes(s))];
}

/**
 * The unit's skill bar, padded to whole pages. Keeps the player's layout; skills the unit no longer
 * has leave an empty slot, and skills not on the bar yet are added after the last used slot.
 */
export function skillBarLayout(c: Character): (string | null)[] {
  const owned = new Set(allSkills(c));
  const seen = new Set<string>();
  const bar = (c.skillBar ?? defaultSkillBar(c)).map((id) => {
    if (!id || !owned.has(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  let last = bar.length - 1;
  while (last >= 0 && !bar[last]) last--;
  const out = bar.slice(0, last + 1);
  for (const id of allSkills(c)) if (!seen.has(id)) out.push(id);
  const pages = Math.max(1, Math.ceil(out.length / BAR_PAGE));
  while (out.length < pages * BAR_PAGE) out.push(null);
  return out;
}

/** Swap two bar slots (either may be empty, or past the last page: that adds a page). Saved on the character. */
export function swapBarSlots(c: Character, a: number, b: number): void {
  const bar = skillBarLayout(c);
  while (bar.length <= Math.max(a, b)) bar.push(null);
  [bar[a], bar[b]] = [bar[b], bar[a]];
  let last = bar.length - 1;
  while (last >= 0 && !bar[last]) last--;
  c.skillBar = bar.slice(0, last + 1);
}

export function createCharacter(name: string, color = PALETTE[0], weaponId = DEFAULT_WEAPON, look?: Look, talents?: Talents): Character {
  const id = newId();
  return {
    id,
    name,
    level: 1,
    xp: 0,
    weaponId,
    skillIds: [],
    appearance: { color, look: look ?? lookFromModel(modelFor(id)) },
    ...(talents ? { talents: { ...talents } } : {}),
  };
}

/** Add XP and apply any level ups (stat growth is automatic). Returns levels gained. */
export function grantXp(c: Character, amount: number): number {
  c.xp += amount;
  let gained = 0;
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
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
  c.skillIds = [...new Set(c.skillIds)].filter((s) => TREE_SKILLS.includes(s) && isUnlocked(c, s)).slice(0, skillPoints(c));
  // Body investments above the level's rank cap are refunded.
  const cap = maxBodyRank(c.level);
  for (const k of Object.keys(c.body ?? {}) as StatKey[]) if (c.body![k]! > cap) c.body![k] = cap;
  // Over budget: give back Body investments, last stat first.
  const keys = bodyStats();
  for (let i = keys.length - 1; i >= 0 && freePoints(c) < 0; i--) {
    const k = keys[i];
    const n = c.body?.[k] ?? 0;
    if (!n || !c.body) continue;
    const back = Math.min(n, -freePoints(c));
    c.body[k] = n - back;
    if (!c.body[k]) delete c.body[k];
  }
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
