// Rescale enemy stats so a usual-sized group of each type (usualCountAt) is at par for the reference party at the
// same level: the power ratio at which the AI party wins parWinRate of its battles. Health, P.Atk and M.Atk scale
// together (each enemy's value scales with them); Defense and the rest stay. Solved at the bottom and top of each
// type's levels, so base stats and growth per level stay a straight line. Writes src/data/enemies.json.
//
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/rebalance.sim.ts
//   (env BALANCE_FIT: a fit from fitfac.py, whose par is used and whose per-type factors multiply each type's power;
//    BALANCE_PAR: the power ratio at par otherwise; BALANCE_TYPES: a comma list to only touch some types)
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { SKILLS } from '../../src/data/content';
import { ENEMIES } from '../../src/data/enemies';
import type { EnemyDef } from '../../src/data/types';
import type { Stats } from '../../src/data/types';
import { defenseMultiplier } from '../../src/game/battle';
import { clearEnemyCache, powerRatio, questFighters, referenceParty, usualCountAt } from '../../src/game/power';

const SCALED = ['health', 'pAtk', 'mAtk'] as const;
/** Most of the frailest reference Adventurer's effective Health one basic hit may take. */
const BURST = 0.35;

test('rebalance enemies', () => {
  const fit = process.env.BALANCE_FIT ? JSON.parse(readFileSync(process.env.BALANCE_FIT, 'utf8')) as { par: number; factors: Record<string, number>; tempo?: Record<string, Record<string, number>>; levelFactors?: Record<string, Record<string, number>> } : null;
  const par = fit?.par ?? Number(process.env.BALANCE_PAR ?? 0.49);
  // Damping: each fitted correction is applied as factor^GAIN, so noise from a few dozen battles per cell doesn't
  // swing the stats back and forth between iterations.
  const GAIN = Number(process.env.BALANCE_GAIN ?? 0.6);
  const damp = (f: number) => f ** GAIN;
  const only = process.env.BALANCE_TYPES?.split(',');
  const origPath = process.env.BALANCE_ORIG ?? 'tools/balance/enemies.orig.json';
  let origEnemies: Record<string, EnemyDef> | null = null;
  try {
    origEnemies = JSON.parse(readFileSync(origPath, 'utf8')).enemies;
  } catch {
    origEnemies = null;
  }
  const path = 'src/data/enemies.json';
  let text = readFileSync(path, 'utf8');
  const lines: string[] = [];
  for (const def of Object.values(ENEMIES)) {
    if (only && !only.includes(def.id)) continue;
    const [lo, hi] = def.levels;
    if (fit?.factors[def.id]) def.power = Math.round(def.power * damp(fit.factors[def.id]) * 1000) / 1000;
    const orig = { stats: { ...def.stats }, growth: { ...def.growthPerLevel } };
    const statsAt = (L: number) => {
      const out = { ...orig.stats } as Stats;
      for (const k of Object.keys(orig.growth) as (keyof Stats)[]) out[k] = (out[k] ?? 0) + (orig.growth[k] ?? 0) * (L - lo);
      return out;
    };
    // M.Atk that only heals (a Troll's Regenerate) is part of how long the type lasts, so it goes with Health.
    const skillIds = [...def.skills, ...Object.values(def.skillsByLevel ?? {}).flat(), ...def.loadouts.flatMap((l) => l.skills)];
    const mAtkDamage = skillIds.some((id) => SKILLS[id]?.hits?.some((h) => (h.mAtk ?? 0) > 0));
    // The type's original Health over attack (tools/balance/enemies.orig.json, BALANCE_ORIG): tempo stays within x0.4-x2.5 of it.
    const origDef = origEnemies?.[def.id];
    const atk = (s: Partial<Stats>) => Math.max(s.pAtk ?? 0, mAtkDamage ? (s.mAtk ?? 0) : 0) || 1;
    const origBalance = (L: number) => {
      if (!origDef) return null;
      const steps = L - origDef.levels[0];
      const h = origDef.stats.health + (origDef.growthPerLevel.health ?? 0) * steps;
      const a = atk({ pAtk: origDef.stats.pAtk + (origDef.growthPerLevel.pAtk ?? 0) * steps, mAtk: (origDef.stats.mAtk ?? 0) + (origDef.growthPerLevel.mAtk ?? 0) * steps });
      return h / a;
    };
    // Tempo: Health / k and attack x k leave the value alone and make fights about k times shorter (fitfac.py).
    const tempoedK = (L: number) => {
      let k = tempoAt(L);
      const ob = origBalance(L);
      if (ob) {
        const s = statsAt(L);
        const now = s.health / atk(s);
        // After this step Health / attack is now / k^2; keep it within [ob / 4, ob] x... i.e. a total k of 0.4-2.5 (the burst cap below guards the top).
        const total = Math.sqrt(ob / (now / (k * k)));
        k *= Math.max(0.4, Math.min(2.5, total)) / total;
      }
      return k;
    };
    const tempoed = (L: number) => {
      const s = statsAt(L);
      const k = tempoedK(L);
      return { ...s, health: s.health / k, pAtk: s.pAtk * k, mAtk: mAtkDamage ? s.mAtk * k : s.mAtk / k };
    };
    // The scale at level L that puts a usual group at par.
    // Tempo: Health / k and attack x k leave the value alone and make fights about k times shorter (fitfac.py).
    const tempoAt = (L: number) => {
      const t = fit?.tempo?.[def.id] ?? {};
      const near = Object.keys(t).map(Number).sort((a, b) => Math.abs(a - L) - Math.abs(b - L))[0];
      return near === undefined ? 1 : damp(t[String(near)]);
    };
    const scaleAt = (L: number) => {
      const base = tempoed(L);
      const ratioWith = (s: number) => {
        for (const k of SCALED) def.stats[k] = base[k] * s;
        def.growthPerLevel = {};
        // stats are read at levels[0] + growth x steps: with no growth, put L's stats at every level
        clearEnemyCache();
        return powerRatio(referenceParty(L), questFighters({ stage: L, count: usualCountAt(L), foes: [def.id] }));
      };
      // Fix the other stats at L too (Defense etc. as they would be at L).
      for (const k of Object.keys(base) as (keyof Stats)[]) def.stats[k] = base[k];
      let a = 0.05, b = 20;
      for (let i = 0; i < 60; i++) {
        const m = Math.sqrt(a * b);
        if (ratioWith(m) > par) a = m;
        else b = m;
      }
      // How much stronger than its type's factor the type turned out at this level: take it out of the stats.
      const lf = fit?.levelFactors?.[def.id] ?? {};
      const near = Object.keys(lf).map(Number).sort((x, y) => Math.abs(x - L) - Math.abs(y - L))[0];
      return Math.sqrt(a * b) / (near === undefined ? 1 : damp(lf[String(near)]));
    };
    const sLo0 = scaleAt(lo);
    const sHi0 = hi > lo ? scaleAt(hi) : sLo0;
    // Burst cap: one basic hit takes at most BURST of the frailest reference Adventurer's Health. Where the tempo knob
    // would break it, the type keeps more Health and less attack instead (a longer fight beats a one-shot).
    const burstCut = (L: number, sc: number) => {
      const t = tempoed(L);
      const hit = Math.max(t.pAtk, mAtkDamage ? t.mAtk : 0) * sc;
      const frail = referenceParty(L).reduce((m, r) => Math.min(m, r.stats.health / defenseMultiplier(r.stats.defense)), Infinity);
      // Defense of the target cuts the hit: use the frailest's effective Health.
      const share = hit / frail;
      return share > BURST ? Math.sqrt(share / BURST) : 1;
    };
    const cut = { [lo]: burstCut(lo, sLo0), [hi]: burstCut(hi, sHi0) };
    const tempoedFinal = (L: number) => {
      const t = tempoed(L);
      const c = cut[L] ?? 1;
      return { ...t, health: t.health * c, pAtk: t.pAtk / c, mAtk: mAtkDamage ? t.mAtk / c : t.mAtk * c };
    };
    const sLo = sLo0;
    const sHi = sHi0;
    const bottom = tempoedFinal(lo);
    const top = tempoedFinal(hi);
    const stats: Record<string, number> = { ...orig.stats };
    const growth: Record<string, number> = { ...orig.growth };
    for (const k of SCALED) {
      if (!(k in orig.stats) && !(k in orig.growth)) continue;
      const b = bottom[k] * sLo;
      const t = top[k] * sHi;
      stats[k] = Math.round(b);
      if (hi > lo && (k in orig.growth || Math.abs(t - b) > 0.5)) growth[k] = Math.round(((t - b) / (hi - lo)) * 10) / 10;
    }
    def.stats = orig.stats as Stats;
    def.growthPerLevel = orig.growth;
    lines.push(`${def.id.padEnd(10)} x${sLo.toFixed(2)} at ${lo}, x${sHi.toFixed(2)} at ${hi}, tempo ${(tempoedK(lo) / cut[lo]).toFixed(2)}/${(tempoedK(hi) / cut[hi]).toFixed(2)}, power ${def.power}`);
    // Rewrite the type's "stats" and "growthPerLevel" blocks in place (keeping the file's layout).
    const start = text.indexOf(`\n    "${def.id}": {`);
    const block = (name: string, obj: Record<string, number>, from: number) => {
      const i = text.indexOf(`"${name}": {`, from);
      const j = text.indexOf('}', i);
      const indent = '      ';
      const body = Object.entries(obj).map(([k, v]) => `${indent}  "${k}": ${v}`).join(',\n');
      text = `${text.slice(0, i)}"${name}": {\n${body}\n${indent}${text.slice(j)}`;
    };
    const pi = text.indexOf('"power": ', start);
    text = `${text.slice(0, pi)}"power": ${def.power}${text.slice(text.indexOf(',', pi))}`;
    block('stats', stats, start);
    block('growthPerLevel', growth, start);
  }
  clearEnemyCache();
  writeFileSync(path, text);
  process.stdout.write(lines.join('\n') + '\n');
});
