// Shared type definitions for game data. Everything here is plain data so it
// can be written to and read from human-readable JSON save files.

export const STAT_KEYS = ['health', 'pAtk', 'mAtk', 'defense', 'movement'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { name: string; short: string; description: string }> = {
  health: { name: 'Health', short: 'HP', description: 'Maximum health. The unit falls at 0.' },
  pAtk: { name: 'Physical Attack', short: 'P.Atk', description: 'Power of physical skills. A skill deals a % of this as damage.' },
  mAtk: { name: 'Magic Attack', short: 'M.Atk', description: 'Power of magic skills and healing.' },
  defense: { name: 'Defense', short: 'Def', description: 'Reduces damage taken: every 100 Defense = +100% effective health.' },
  movement: { name: 'Movement', short: 'Move', description: 'Movement points per turn (forest costs 2).' },
};

export type Emblem = 'circle' | 'square' | 'diamond' | 'triangle';

export interface WeaponDef {
  id: string;
  name: string;
  /** Short tag drawn on battle tokens. */
  tag: string;
  description: string;
  bonus: Partial<Stats>;
  /** Skills granted by the weapon. The first one is the basic attack. */
  skills: string[];
}

/** One hit of a damaging skill. Values are fractions (0.8 = 80%). */
export interface DamagePart {
  pAtk?: number;
  mAtk?: number;
  /** Scales with the attacker's Defense (e.g. a shield bash). */
  def?: number;
  /** Fraction of the target's missing health. */
  missingHp?: number;
}

/**
 * How a skill is aimed:
 *  unit      – click a tile in range; affects the unit standing there (empty tiles allowed)
 *  self      – centered on the caster (optionally hitting everything within aoeRadius)
 *  line      – pick one of 8 directions; hits the first matching unit within lineLength tiles
 *  cone      – pick a direction; sets up an overwatch cone
 *  emptyTile – an empty, walkable tile (e.g. teleport)
 */
export type SkillTarget = 'unit' | 'self' | 'line' | 'cone' | 'emptyTile';

export interface ConeDef {
  /** Full width of the cone in degrees. */
  angle: number;
  /** Reach in tiles (Euclidean). */
  radius: number;
  /** Stop the enemy's movement on the tile where it is hit. */
  interrupt: boolean;
  requiresLos: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  target: SkillTarget;
  /** Which units the skill affects. 'any' = friend and foe alike. */
  affects: 'enemy' | 'ally' | 'any';
  /** Euclidean range in tiles (1 = orthogonal neighbours, 1.5 = includes diagonals). */
  range: number;
  minRange: number;
  requiresLos?: boolean;
  /** Turns the skill is unavailable after use (1 = can't be used next turn; 0 = every turn). */
  cooldown: number;
  /** Costs no action: the unit can still act afterwards. */
  free?: boolean;
  /** Damage hits, applied in order. */
  hits?: DamagePart[];
  heal?: { mAtk: number };
  shield?: { maxHpPct: number; turns: number };
  burn?: { stacks: number; turns: number };
  knockback?: number;
  cleanse?: boolean;
  /** For target 'self': affect units within this distance of the caster. */
  aoeRadius?: number;
  /** For target 'line'. */
  lineLength?: number;
  cone?: ConeDef;
  teleport?: boolean;
  /** Dash next to the target (path of at most `range` steps) before hitting it. */
  charge?: boolean;
}

export type SkillTab = 'mage' | 'warrior';

export interface SkillTreeDef {
  id: string;
  name: string;
  tab: SkillTab;
  skills: string[];
}

export interface Appearance {
  color: string;
  emblem: Emblem;
}

/** An Adventurer as stored in the save file. Stats are derived from level + weapon. */
export interface Character {
  id: string;
  name: string;
  level: number;
  xp: number;
  weaponId: string;
  /** Skills picked from the skill trees (weapon skills are always available). */
  skillIds: string[];
  appearance: Appearance;
}

export interface Progress {
  stage: number;
  victories: number;
  defeats: number;
}

export interface GameState {
  progress: Progress;
  party: Character[];
}
