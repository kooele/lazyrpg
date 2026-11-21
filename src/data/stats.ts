// Loads and validates the stat tuning file (stats.json). Validation runs at
// startup and in the tests, so a typo in the file fails loudly with a clear message.
import raw from './stats.json';
import { STAT_KEYS, type Stats } from './types';

export interface HitChanceRules {
  /** Off = every attack hits. */
  enabled: boolean;
  base: number;
  min: number;
  max: number;
  /** Added to the hit chance of overwatch / intercept shots. */
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

export interface StatConfig {
  base: Stats;
  growthPerLevel: Stats;
  defenseScale: number;
  forestDefense: number;
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

export function parseStatConfig(data: unknown): StatConfig {
  const rec = obj(data, '(root)');
  const hit = obj(rec.hitChance ?? { enabled: false, base: 100, min: 0, max: 100, reactionModifier: 0 }, 'hitChance');
  const vision = obj(rec.vision ?? { enabled: false }, 'vision');
  const map = obj(rec.map ?? { width: 18, height: 13 }, 'map');
  const costs = obj(rec.movementCosts ?? { grass: 4, forest: 6, river: 8 }, 'movementCosts');
  const rounding = obj(rec.rangeRounding ?? { fromRange: 2 }, 'rangeRounding');
  const cfg: StatConfig = {
    base: readStats(rec.base, 'base'),
    growthPerLevel: readStats(rec.growthPerLevel, 'growthPerLevel'),
    defenseScale: num(rec.defenseScale, 'defenseScale'),
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
      base: num(hit.base, 'hitChance.base'),
      min: num(hit.min, 'hitChance.min'),
      max: num(hit.max, 'hitChance.max'),
      reactionModifier: num(hit.reactionModifier ?? 0, 'hitChance.reactionModifier'),
    },
    vision: { enabled: vision.enabled === true },
  };
  if (!(cfg.defenseScale > 0)) throw new Error('stats.json: "defenseScale" must be a positive number');
  if (cfg.base.health <= 0) throw new Error('stats.json: "base.health" must be positive');
  if (cfg.base.movement < 1) throw new Error('stats.json: "base.movement" must be at least 1');
  if (!(cfg.movementCosts.grass > 0)) throw new Error('stats.json: "movementCosts.grass" must be positive');
  if (cfg.map.width < 8 || cfg.map.height < 6) throw new Error('stats.json: "map" must be at least 8 x 6 tiles');
  if (cfg.hitChance.min > cfg.hitChance.max) throw new Error('stats.json: "hitChance.min" must not exceed "hitChance.max"');
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
