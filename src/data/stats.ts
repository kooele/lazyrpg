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

export interface StatConfig {
  base: Stats;
  growthPerLevel: Stats;
  defenseScale: number;
  forestDefense: number;
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
  const cfg: StatConfig = {
    base: readStats(rec.base, 'base'),
    growthPerLevel: readStats(rec.growthPerLevel, 'growthPerLevel'),
    defenseScale: num(rec.defenseScale, 'defenseScale'),
    forestDefense: num(rec.forestDefense ?? 0, 'forestDefense'),
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
