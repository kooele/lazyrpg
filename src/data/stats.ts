// Loads and validates the stat tuning file (stats.json). Validation runs at
// startup and in the tests, so a typo in the file fails loudly with a clear message.
import raw from './stats.json';
import { STAT_KEYS, TALENT_GRADES, type Stats, type Talent } from './types';

export interface HitChanceRules {
  /** Off = every attack hits. */
  enabled: boolean;
  /** Dice rolled per attack; their average is the roll. */
  dice: number;
  /** Each die rolls a whole number from 0 to dieMax. */
  dieMax: number;
  /** Hit when roll + Accuracy - Evasion is greater than this. */
  hitAbove: number;
  /** Added to the roll of overwatch / intercept shots and opportunity attacks. */
  reactionModifier: number;
}

export interface VisionRules {
  /** Off = the whole map is visible (no fog of war). */
  enabled: boolean;
}

export interface RangeRoundingRules {
  /** Ranges >= this use distance rounded to the nearest tile; smaller ranges are exact. */
  fromRange: number;
}

export interface MovementCosts {
  grass: number;
  forest: number;
  river: number;
}

export interface MapRules {
  width: number;
  height: number;
}

export interface TalentRules {
  /** Growth multiplier per grade (1 = 100%). */
  growthRate: Record<Talent, number>;
  /** Relative weight of each grade when a stat's talent is rolled. */
  weight: Record<Talent, number>;
  /** Chance of each grade (0-1): its weight / the sum of the weights. */
  chance: Record<Talent, number>;
}

export interface StatConfig {
  base: Stats;
  growthPerLevel: Stats;
  talent: TalentRules;
  defenseScale: number;
  forestDefense: number;
  /** XP per Adventurer for winning a battle. */
  xpPerVictory: number;
  map: MapRules;
  movementCosts: MovementCosts;
  rangeRounding: RangeRoundingRules;
  hitChance: HitChanceRules;
  vision: VisionRules;
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`stats.json: "${path}" must be an object`);
  return v as Record<string, unknown>;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`stats.json: "${path}" must be a number`);
  return v;
}

function readStats(v: unknown, path: string): Stats {
  const rec = obj(v, path);
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = num(rec[k], `${path}.${k}`);
  return out;
}

const DEFAULT_TALENT = {
  growthRate: { S: 1.6, A: 1.4, B: 1.2, C: 1, D: 0.8, F: 0.6 },
  weight: { S: 5, A: 10, B: 20, C: 40, D: 20, F: 5 },
};

function readTalent(v: unknown): TalentRules {
  const t = obj(v ?? DEFAULT_TALENT, 'talent');
  const rate = obj(t.growthRate, 'talent.growthRate');
  const weight = obj(t.weight, 'talent.weight');
  const out: TalentRules = { growthRate: {} as Record<Talent, number>, weight: {} as Record<Talent, number>, chance: {} as Record<Talent, number> };
  for (const g of TALENT_GRADES) {
    out.growthRate[g] = num(rate[g], `talent.growthRate.${g}`);
    // A grade left out of weight never comes up.
    out.weight[g] = weight[g] === undefined ? 0 : num(weight[g], `talent.weight.${g}`);
    if (out.growthRate[g] < 0) throw new Error(`stats.json: "talent.growthRate.${g}" must not be negative`);
    if (out.weight[g] < 0) throw new Error(`stats.json: "talent.weight.${g}" must not be negative`);
  }
  const total = TALENT_GRADES.reduce((s, g) => s + out.weight[g], 0);
  if (!(total > 0)) throw new Error('stats.json: "talent.weight" needs at least one grade with a weight above 0');
  for (const g of TALENT_GRADES) out.chance[g] = out.weight[g] / total;
  return out;
}

export function parseStatConfig(data: unknown): StatConfig {
  const rec = obj(data, '(root)');
  const hit = obj(rec.hitChance ?? { enabled: false }, 'hitChance');
  const vision = obj(rec.vision ?? { enabled: false }, 'vision');
  const map = obj(rec.map ?? { width: 18, height: 13 }, 'map');
  const costs = obj(rec.movementCosts ?? { grass: 4, forest: 6, river: 8 }, 'movementCosts');
  const rounding = obj(rec.rangeRounding ?? { fromRange: 2 }, 'rangeRounding');
  const cfg: StatConfig = {
    base: readStats(rec.base, 'base'),
    growthPerLevel: readStats(rec.growthPerLevel, 'growthPerLevel'),
    talent: readTalent(rec.talent),
    defenseScale: num(rec.defenseScale, 'defenseScale'),
    xpPerVictory: num(rec.xpPerVictory ?? 100, 'xpPerVictory'),
    forestDefense: num(rec.forestDefense ?? 0, 'forestDefense'),
    map: { width: Math.round(num(map.width, 'map.width')), height: Math.round(num(map.height, 'map.height')) },
    movementCosts: {
      grass: num(costs.grass, 'movementCosts.grass'),
      forest: num(costs.forest, 'movementCosts.forest'),
      river: num(costs.river, 'movementCosts.river'),
    },
    rangeRounding: { fromRange: num(rounding.fromRange, 'rangeRounding.fromRange') },
    hitChance: {
      enabled: hit.enabled === true,
      dice: Math.round(num(hit.dice ?? 2, 'hitChance.dice')),
      dieMax: Math.round(num(hit.dieMax ?? 100, 'hitChance.dieMax')),
      hitAbove: num(hit.hitAbove ?? 50, 'hitChance.hitAbove'),
      reactionModifier: num(hit.reactionModifier ?? 0, 'hitChance.reactionModifier'),
    },
    vision: { enabled: vision.enabled === true },
  };
  if (!(cfg.defenseScale > 0)) throw new Error('stats.json: "defenseScale" must be a positive number');
  if (cfg.base.health <= 0) throw new Error('stats.json: "base.health" must be positive');
  if (cfg.base.movement < 1) throw new Error('stats.json: "base.movement" must be at least 1');
  if (!(cfg.movementCosts.grass > 0)) throw new Error('stats.json: "movementCosts.grass" must be positive');
  if (cfg.map.width < 8 || cfg.map.height < 6) throw new Error('stats.json: "map" must be at least 8 x 6 tiles');
  if (cfg.hitChance.dice < 1 || cfg.hitChance.dice > 10) throw new Error('stats.json: "hitChance.dice" must be from 1 to 10');
  if (cfg.hitChance.dieMax < 1) throw new Error('stats.json: "hitChance.dieMax" must be at least 1');
  return cfg;
}

export const STAT_CONFIG: StatConfig = parseStatConfig(raw);

/** Stats shown in the UI: the core five, plus hit/vision stats once those systems are enabled. */
export function visibleStatKeys(cfg: StatConfig = STAT_CONFIG): (typeof STAT_KEYS)[number][] {
  return STAT_KEYS.filter((k) => {
    if (k === 'accuracy' || k === 'evasion') return cfg.hitChance.enabled;
    if (k === 'vision') return cfg.vision.enabled;
    return true;
  });
}
