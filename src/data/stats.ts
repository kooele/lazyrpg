// Loads and validates the stat tuning file (stats.json). Validation runs at
// startup and in the tests, so a typo in the file fails loudly with a clear message.
import raw from './stats.json';
import { STAT_KEYS, type Stats } from './types';

export interface StatConfig {
  base: Stats;
  growthPerLevel: Stats;
  defenseScale: number;
  forestDefense: number;
}

function readStats(obj: unknown, path: string): Stats {
  if (typeof obj !== 'object' || obj === null) throw new Error(`stats.json: "${path}" must be an object`);
  const rec = obj as Record<string, unknown>;
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    const v = rec[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`stats.json: "${path}.${k}" must be a number`);
    out[k] = v;
  }
  return out;
}

export function parseStatConfig(data: unknown): StatConfig {
  const rec = data as Record<string, unknown>;
  const cfg: StatConfig = {
    base: readStats(rec.base, 'base'),
    growthPerLevel: readStats(rec.growthPerLevel, 'growthPerLevel'),
    defenseScale: Number(rec.defenseScale),
    forestDefense: Number(rec.forestDefense ?? 0),
  };
  if (!(cfg.defenseScale > 0)) throw new Error('stats.json: "defenseScale" must be a positive number');
  if (!Number.isFinite(cfg.forestDefense)) throw new Error('stats.json: "forestDefense" must be a number');
  if (cfg.base.health <= 0) throw new Error('stats.json: "base.health" must be positive');
  if (cfg.base.movement < 1) throw new Error('stats.json: "base.movement" must be at least 1');
  return cfg;
}

export const STAT_CONFIG: StatConfig = parseStatConfig(raw);
