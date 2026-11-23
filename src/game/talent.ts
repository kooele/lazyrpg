// Talent: a grade from F to S per growing stat that sets how fast it grows with level.
// Rolled when an Adventurer is created; C (100%) for anyone without one (enemies, old saves).
import { STAT_CONFIG, type StatConfig } from '../data/stats';
import { STAT_KEYS, TALENT_GRADES, type Character, type StatKey, type Talent, type Talents } from '../data/types';
import type { Rng } from './character';

/** Stats that have a talent: the ones that grow with level. */
export function talentStats(cfg: StatConfig = STAT_CONFIG): StatKey[] {
  return STAT_KEYS.filter((k) => cfg.growthPerLevel[k] > 0);
}

/** Roll one grade with the talent.chance odds. */
export function rollTalent(rng: Rng, cfg: StatConfig = STAT_CONFIG): Talent {
  let r = rng();
  for (const g of [...TALENT_GRADES].reverse()) {
    r -= cfg.talent.chance[g];
    if (r < 0) return g;
  }
  return 'C';
}

/** A grade for every growing stat. */
export function rollTalents(rng: Rng, cfg: StatConfig = STAT_CONFIG): Talents {
  const out: Talents = {};
  for (const k of talentStats(cfg)) out[k] = rollTalent(rng, cfg);
  return out;
}

export const talentOf = (c: Pick<Character, 'talents'>, k: StatKey): Talent => c.talents?.[k] ?? 'C';

export const growthRate = (g: Talent, cfg: StatConfig = STAT_CONFIG) => cfg.talent.growthRate[g];

/** Growth per level of a stat after talent (may be fractional; totals are rounded). */
export const talentGrowth = (c: Pick<Character, 'talents'>, k: StatKey, cfg: StatConfig = STAT_CONFIG) =>
  cfg.growthPerLevel[k] * growthRate(talentOf(c, k), cfg);

/** Average growth rate over the talented stats (1 = all C). */
export function talentScore(c: Pick<Character, 'talents'>, cfg: StatConfig = STAT_CONFIG): number {
  const keys = talentStats(cfg);
  if (!keys.length) return 1;
  return keys.reduce((s, k) => s + growthRate(talentOf(c, k), cfg), 0) / keys.length;
}

/** The grade closest to the unit's average growth rate (its overall talent). */
export function overallTalent(c: Pick<Character, 'talents'>, cfg: StatConfig = STAT_CONFIG): Talent {
  const score = talentScore(c, cfg);
  let best: Talent = 'C';
  for (const g of TALENT_GRADES) if (Math.abs(growthRate(g, cfg) - score) < Math.abs(growthRate(best, cfg) - score) - 1e-9) best = g;
  return best;
}

/**
 * The overall talent with a + or - for a more precise reading: each grade's band (halfway to the next grade either
 * side) is split in thirds, so an average just above a grade reads "C+" and just below the next one "B-".
 * S can't go above S (+) and F can't go below F (-), since no stat grows faster or slower than those.
 */
export function overallTalentLabel(c: Pick<Character, 'talents'>, cfg: StatConfig = STAT_CONFIG): string {
  const g = overallTalent(c, cfg);
  const diff = talentScore(c, cfg) - growthRate(g, cfg);
  const i = TALENT_GRADES.indexOf(g);
  // The neighboring grade on the side the average leans to (TALENT_GRADES runs worst first).
  const next = diff > 0 ? TALENT_GRADES[i + 1] : TALENT_GRADES[i - 1];
  if (!next || Math.abs(diff) < 1e-9) return g;
  const gap = Math.abs(growthRate(next, cfg) - growthRate(g, cfg));
  if (Math.abs(diff) < gap / 6 - 1e-9) return g;
  return `${g}${diff > 0 ? '+' : '-'}`;
}

/** Text color for a grade. */
export const TALENT_COLORS: Record<Talent, string> = {
  S: '#ff9f43', A: '#e0b44c', B: '#6fdc8c', C: '#f4ecd8', D: '#9aa3bd', F: '#ff6b6b',
};

/** "HP B · P.Atk C · ..." */
export function talentLine(c: Pick<Character, 'talents'>, short: (k: StatKey) => string): string {
  return talentStats().map((k) => `${short(k)} ${talentOf(c, k)}`).join(' · ');
}
