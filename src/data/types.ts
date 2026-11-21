// Shared type definitions for game data. Everything here is plain data so it
// can be written to and read from human-readable JSON save files.

export const STAT_KEYS = ['health', 'pAtk', 'mAtk', 'defense', 'movement', 'accuracy', 'evasion', 'vision'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { name: string; short: string; description: string }> = {
  health: { name: 'Health', short: 'HP', description: 'Maximum health. The unit falls at 0.' },
  pAtk: { name: 'Physical Attack', short: 'P.Atk', description: 'Power of physical skills. A skill deals a % of this as damage.' },
  mAtk: { name: 'Magic Attack', short: 'M.Atk', description: 'Power of magic skills and healing.' },
  defense: { name: 'Defense', short: 'Def', description: 'Reduces damage taken: every 100 Defense = +100% effective health.' },
  movement: { name: 'Movement', short: 'Move', description: 'Movement points per turn (forest costs 2).' },
  accuracy: { name: 'Accuracy', short: 'Acc', description: 'Adds to hit chance (when hit chance is enabled).' },
  evasion: { name: 'Evasion', short: 'Eva', description: "Subtracts from enemies' hit chance (when hit chance is enabled)." },
  vision: { name: 'Vision', short: 'Vis', description: 'How far the unit can see (when fog of war is enabled).' },
};

/**
 * What must be clear between attacker and target:
 *  sight – no sight-blocking terrain (rock). Used by spells and arcing projectiles.
 *  fire  – line of FIRE: no blocking terrain AND no unit (friend or foe) in the way.
 */
export type LosRule = 'sight' | 'fire';

export type Emblem = 'circle' | 'square' | 'diamond' | 'triangle';

export interface WeaponDef {
  id: string;
  name: string;
  /** Short tag drawn on battle tokens. */
  tag: string;
  description: string;
  /** Sprite name: public/art/weapons/<art>.svg */
  art: string;
  /** Multipliers on the Adventurer's base stats (1.5 = 150%). Missing stats = 100%. */
  statMultipliers: Partial<Stats>;
  /** Skills granted by the weapon. The first one is the basic attack. */
  skills: string[];
}

export interface TagDef {
  id: string;
  name: string;
  description: string;
}

/** A status effect definition (Burn, Slow...). Shields are handled separately. */
export interface StatusDef {
  id: string;
  name: string;
  description: string;
  /** Cleanse removes debuffs. */
  debuff: boolean;
  /** Re-applying adds stacks (otherwise it just refreshes the duration). */
  stacking: boolean;
  /** When the duration counts down: at the start or the end of the affected unit's turn. */
  tick: 'start' | 'end';
  /** Damage per stack at the start of the unit's turn, as a fraction of max health. */
  damagePctMaxHpPerStack?: number;
  /** Stat changes while active (per stack for stacking effects). */
  statMods?: Partial<Stats>;
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
  los?: LosRule;
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
  /** Line requirement for the target tile (omit for melee / no requirement). */
  los?: LosRule;
  /** Added to hit chance (when hit chance is enabled). */
  accuracy?: number;
  /** Turns the skill is unavailable after use (1 = can't be used next turn; 0 = every turn). */
  cooldown: number;
  /** Classification tags (see skills.json "tags"). engage / movement / weapon / free change behavior. */
  tags: string[];
  /** For 'movement' skills: range = floor(rangeScale x Movement). */
  rangeScale?: number;
  /** Damage hits, applied in order. */
  hits?: DamagePart[];
  heal?: { mAtk: number };
  shield?: { maxHpPct: number; turns: number };
  applyStatus?: { status: string; turns: number; stacks?: number }[];
  knockback?: number;
  cleanse?: boolean;
  /** For target 'self': affect units within this distance of the caster. */
  aoeRadius?: number;
  /** For target 'line'. */
  lineLength?: number;
  cone?: ConeDef;
  teleport?: boolean;
  /** Dash next to the target (path of at most `range` steps, diagonals allowed) before hitting it. */
  charge?: boolean;
}

export type SkillTab = string;

export interface SkillTreeDef {
  id: string;
  name: string;
  tab: SkillTab;
  skills: string[];
}

export const BODY_MODELS = ['m1', 'm2', 'm3', 'm4', 'f1', 'f2', 'f3', 'f4'] as const;
export type BodyModel = (typeof BODY_MODELS)[number];

export interface Appearance {
  /** Color of the unit's base (the disc it stands on). */
  color: string;
  emblem: Emblem;
  /** Body art: public/art/units/<model>.svg. Older saves without it get one assigned. */
  model: BodyModel;
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
