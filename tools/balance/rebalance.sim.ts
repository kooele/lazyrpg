// Rescale enemy stats so the AI-played reference party at a level scores TARGET_WIN against a usual group of each
// type (its `group`) at that level (95% at level 1, 70% at 5, 60% at 10, 50% at 20: targets.json). Health, P.Atk and M.Atk scale
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
import { GUILD } from '../../src/data/guild';
import type { EnemyDef } from '../../src/data/types';
import type { Stats } from '../../src/data/types';
import { defenseMultiplier } from '../../src/game/battle';
import { clearEnemyCache, powerRatio, questFighters, referenceParty } from '../../src/game/power';

const SCALED = ['health', 'pAtk', 'mAtk'] as const;
/**
 * How a scale s on an enemy's value is split between Health and attack: Health x s^(2(1 - b)), attack x s^(2b), so
 * the value (sqrt(HP x attack)) moves by s either way. b is 0.5 (even) up to level 5 and 0.75 from level 20: at high
 * levels the party's skills outscale the enemies', so enemies get more of their strength as attack, not Health.
 */
const attackShare = (L: number) => 0.5 + 0.25 * Math.max(0, Math.min(1, (L - 5) / 15));
/**
 * The AI party's win rate against a usual group, by level: [level, win rate] knots, linear between them and flat
 * outside: BALANCE_TARGETS, else tools/balance/targets.json (written by tune2.py from the win rate wanted by skulls).
 */
const TARGET_WIN: [number, number][] = process.env.BALANCE_TARGETS
  ? JSON.parse(process.env.BALANCE_TARGETS)
  : (() => {
      try {
        return JSON.parse(readFileSync('tools/balance/targets.json', 'utf8')).targets;
      } catch {
        return [[3, 0.5], [8, 0.4], [13, 0.33]];
      }
    })();
const targetWin = (L: number) => {
  const t = TARGET_WIN;
  if (L <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (L <= t[i][0]) return t[i - 1][1] + ((t[i][1] - t[i - 1][1]) * (L - t[i - 1][0])) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
};
/** Most of the frailest reference Adventurer's effective Health one basic hit may take. */
const BURST = 0.35;

/**
 * Least-squares polynomial (degree 0-2) through (x, y), weighting each point by 1 / y^2 so the error is relative.
 * Returns [constant, linear, square] coefficients.
 */
function fitCurve(x: number[], y: number[], degree: number): [number, number, number] {
  const n = degree + 1;
  const A = Array.from({ length: n }, () => Array(n).fill(0));
  const v = Array(n).fill(0);
  x.forEach((xi, i) => {
    const w = 1 / Math.max(1e-9, y[i] * y[i]);
    const f = [1, xi, xi * xi].slice(0, n);
    for (let r = 0; r < n; r++) {
      v[r] += w * f[r] * y[i];
      for (let c = 0; c < n; c++) A[r][c] += w * f[r] * f[c];
    }
  });
  // Gaussian elimination.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = A[j][i] / A[i][i];
      for (let k = i; k < n; k++) A[j][k] -= m * A[i][k];
      v[j] -= m * v[i];
    }
  }
  const out = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) out[i] = (v[i] - A[i].slice(i + 1).reduce((t, a, k) => t + a * out[i + 1 + k], 0)) / A[i][i];
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

test('rebalance enemies', () => {
  const fit = process.env.BALANCE_FIT ? JSON.parse(readFileSync(process.env.BALANCE_FIT, 'utf8')) as { par: number; a: number; b: number; factors: Record<string, number>; tempo?: Record<string, Record<string, number>>; levelFactors?: Record<string, Record<string, number>> } : null;
  const par = fit?.par ?? Number(process.env.BALANCE_PAR ?? 0.49);
  // The power ratio at which the AI party wins p of the time (the fitted curve, else the game's).
  const curve = fit ?? GUILD.strength.winCurve;
  const ratioFor = (p: number) => Math.exp((Math.log(p / (1 - p)) - curve.a) / curve.b);
  void par;
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
    const orig = { stats: { ...def.stats }, growth: { ...def.growthPerLevel }, bend: { ...def.growthBend } };
    const statsAt = (L: number) => {
      const out = { ...orig.stats } as Stats;
      for (const k of Object.keys(orig.growth) as (keyof Stats)[]) out[k] = (out[k] ?? 0) + (orig.growth[k] ?? 0) * (L - lo);
      for (const k of Object.keys(orig.bend) as (keyof Stats)[]) out[k] = (out[k] ?? 0) + (orig.bend[k] ?? 0) * (L - lo) ** 2;
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
    // M.Atk that only heals stays at the type's original value (a Troll's Regenerate stays small).
    const origMAtk = (L: number) => (origDef ? (origDef.stats.mAtk ?? 0) + (origDef.growthPerLevel.mAtk ?? 0) * (L - origDef.levels[0]) : statsAt(L).mAtk);
    const scaleOf = (k: (typeof SCALED)[number], sc: number, L: number) => {
      const b = attackShare(L);
      if (k === 'health') return sc ** (2 * (1 - b));
      if (k === 'mAtk' && !mAtkDamage) return 1;
      return sc ** (2 * b);
    };
    const tempoed = (L: number) => {
      const s = statsAt(L);
      const k = tempoedK(L);
      return { ...s, health: s.health / k, pAtk: s.pAtk * k, mAtk: mAtkDamage ? s.mAtk * k : origMAtk(L) };
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
        for (const k of SCALED) def.stats[k] = base[k] * scaleOf(k, s, L);
        def.growthPerLevel = {};
        def.growthBend = {};
        // stats are read at levels[0] + growth x steps: with no growth, put L's stats at every level
        clearEnemyCache();
        return powerRatio(referenceParty(L), questFighters({ stage: L, count: def.group, foes: [def.id] }, { smooth: true }));
      };
      // Fix the other stats at L too (Defense etc. as they would be at L).
      for (const k of Object.keys(base) as (keyof Stats)[]) def.stats[k] = base[k];
      let a = 0.05, b = 20;
      for (let i = 0; i < 60; i++) {
        const m = Math.sqrt(a * b);
        if (ratioWith(m) > ratioFor(targetWin(L))) a = m;
        else b = m;
      }
      // How much stronger than its type's factor the type turned out at this level: take it out of the stats.
      const lf = fit?.levelFactors?.[def.id] ?? {};
      const near = Object.keys(lf).map(Number).sort((x, y) => Math.abs(x - L) - Math.abs(y - L))[0];
      return Math.sqrt(a * b) / (near === undefined ? 1 : damp(lf[String(near)]));
    };
    // Solved at every level of the type's range, then fitted with a straight line plus a bend (growthBend) by least
    // squares, so the stats follow the party's strength as closely as a curve can.
    const points = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const sc: Record<number, number> = Object.fromEntries(points.map((L) => [L, scaleAt(L)]));
    // Burst cap: one basic hit takes at most BURST of the frailest reference Adventurer's Health. Where the tempo knob
    // would break it, the type keeps more Health and less attack instead (a longer fight beats a one-shot).
    const burstCut = (L: number, sc: number) => {
      const t = tempoed(L);
      const hit = Math.max(t.pAtk, mAtkDamage ? t.mAtk : 0) * scaleOf('pAtk', sc, L);
      const frail = referenceParty(L).reduce((m, r) => Math.min(m, r.stats.health / defenseMultiplier(r.stats.defense)), Infinity);
      // Defense of the target cuts the hit: use the frailest's effective Health.
      const share = hit / frail;
      return share > BURST ? Math.sqrt(share / BURST) : 1;
    };
    const cut: Record<number, number> = Object.fromEntries(points.map((L) => [L, burstCut(L, sc[L])]));
    const tempoedFinal = (L: number) => {
      const t = tempoed(L);
      const c = cut[L] ?? 1;
      return { ...t, health: t.health * c, pAtk: t.pAtk / c, mAtk: mAtkDamage ? t.mAtk / c : t.mAtk };
    };
    const stats: Record<string, number> = { ...orig.stats };
    const growth: Record<string, number> = { ...orig.growth };
    const bend: Record<string, number> = {};
    for (const k of SCALED) {
      if (!(k in orig.stats) && !(k in orig.growth)) continue;
      const y = points.map((L) => tempoedFinal(L)[k] * scaleOf(k, sc[L], L));
      const x = points.map((L) => L - lo);
      // Least squares in log space (relative error counts the same at every level): y = b + g x + c x^2.
      const [b0, g, c] = fitCurve(x, y, points.length >= 3 ? 2 : points.length - 1);
      stats[k] = Math.round(b0);
      if (points.length > 1 && (k in orig.growth || Math.abs(g) > 0.05)) growth[k] = Math.round(g * 10) / 10;
      if (Math.abs(c) >= 0.005) bend[k] = Math.round(c * 100) / 100;
    }
    def.stats = orig.stats as Stats;
    def.growthPerLevel = orig.growth;
    def.growthBend = orig.bend;
    const ends = [...new Set([lo, hi])];
    lines.push(`${def.id.padEnd(10)} ${ends.map((L) => `x${sc[L].toFixed(2)} at ${L}`).join(', ')}, tempo ${ends.map((L) => (tempoedK(L) / cut[L]).toFixed(2)).join('/')}, power ${def.power}`);
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
    // growthBend: replace it, add it after growthPerLevel, or drop it when the line is straight.
    const next = text.indexOf(`\n    "`, start + 5);
    const bi = text.indexOf('"growthBend": {', start);
    const has = bi >= 0 && (next < 0 || bi < next);
    if (Object.keys(bend).length) {
      if (has) block('growthBend', bend, start);
      else {
        const gi = text.indexOf('"growthPerLevel": {', start);
        const ge = text.indexOf('}', gi) + 1;
        text = `${text.slice(0, ge)},\n      "growthBend": {}${text.slice(ge)}`;
        block('growthBend', bend, start);
      }
    } else if (has) {
      const be = text.indexOf('}', bi) + 1;
      text = `${text.slice(0, text.lastIndexOf(',', bi))}${text.slice(be)}`;
    }
  }
  clearEnemyCache();
  writeFileSync(path, text);
  process.stdout.write(lines.join('\n') + '\n');
});
