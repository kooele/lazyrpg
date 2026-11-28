#!/usr/bin/env node
// Balance simulations: AI-played parties against quests, headless, split over worker processes.
//
//   npm run balance -- --name baseline --seeds 100 --level 4,8,12 --stageOffset -2,0,2 --count 3,4.5,6
//
// Every list flag is a comma list; the job is their cross product (see jobs.ts). Flags: name, seeds, seedStart,
// workers, level, talent (F-S), quality (crude, common, fine, masterwork), size, builds (guardian, caster, archer,
// cleric, bruiser), stage or stageOffset (quest enemy level, absolute or relative to the party), count (threat
// points), foes (enemy types). Writes tools/balance/out/<name>.json (every run, plus a summary per cell) and
// prints the summary table.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const NUMERIC = new Set(['seeds', 'seedStart', 'workers', 'level', 'size', 'stage', 'stageOffset', 'count', 'ratio']);
const SCALAR = new Set(['name', 'seeds', 'seedStart', 'workers', 'plan']);

const args = { name: 'run', seeds: 50 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = /^--(\w+)$/.exec(argv[i]);
  if (!m) throw new Error(`Unexpected argument ${argv[i]}`);
  const k = m[1];
  const raw = argv[++i] ?? '';
  const vals = raw.split(',').filter((s) => s !== '').map((s) => (NUMERIC.has(k) ? Number(s) : s));
  args[k] = SCALAR.has(k) ? vals[0] : vals;
}
const workers = args.workers ?? cpus().length;
delete args.workers;

const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const part = (i) => join(outDir, `${args.name}.part${i}.json`);

await Promise.all(Array.from({ length: workers }, (_, i) => new Promise((resolve, reject) => {
  const p = spawn('npx', ['vitest', 'run', '--config', 'tools/balance/vitest.config.ts', 'tools/balance/shard.sim.ts', '--silent'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, BALANCE_ARGS: JSON.stringify(args), BALANCE_SHARD: String(i), BALANCE_SHARDS: String(workers), BALANCE_OUT: part(i) },
  });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Worker ${i} failed (${code})`))));
})));

let meta;
const byCell = new Map();
for (let i = 0; i < workers; i++) {
  const data = JSON.parse(readFileSync(part(i), 'utf8'));
  meta ??= data.meta;
  for (const r of data.runs) {
    if (!byCell.has(r.cell)) byCell.set(r.cell, []);
    byCell.get(r.cell).push({ seed: r.seed, ...r.r });
  }
  rmSync(part(i));
}

const avg = (rs, f) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length);
const summary = meta.map((m, c) => {
  const rs = byCell.get(c) ?? [];
  return {
    ...m,
    n: rs.length,
    winRate: avg(rs, (r) => (r.win ? 1 : 0)),
    score: avg(rs, (r) => r.score ?? (r.win ? 1 : 0)),
    healthLoss: avg(rs, (r) => r.healthLoss ?? 0),
    rounds: avg(rs, (r) => r.rounds),
    hpLeft: avg(rs, (r) => r.hpLeft),
    survivors: avg(rs, (r) => r.survivors),
    defeated: avg(rs, (r) => r.defeated),
    timeouts: rs.filter((r) => r.timeout).length,
  };
});
const runs = meta.map((_, c) => byCell.get(c) ?? []);
writeFileSync(join(outDir, `${args.name}.json`), JSON.stringify({ args, seconds: (Date.now() - t0) / 1000, summary, runs }));

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const extra = (s) => Object.entries(s).filter(([k, v]) => typeof v === 'number' && !['n', 'winRate', 'score', 'healthLoss', 'rounds', 'hpLeft', 'survivors', 'defeated', 'timeouts'].includes(k))
  .map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`).join(' ');
console.log(`${args.name}: ${summary.length} cells x ${args.seeds} seeds in ${Math.round((Date.now() - t0) / 1000)}s`);
for (const s of summary) {
  console.log(`${s.id.padEnd(44)} win ${pct(s.winRate)} score ${pct(s.score)} rd ${s.rounds.toFixed(1).padStart(4)} hp ${pct(s.hpLeft)} kill ${pct(s.defeated)}${s.timeouts ? ` to ${s.timeouts}` : ''}  ${extra(s)}`);
}
