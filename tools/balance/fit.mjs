#!/usr/bin/env node
// Fit the win curve to simulated battles: P(win) = 1 / (1 + e^-(a + b ln ratio)), ratio being the strength model's
// power ratio of the party against the quest (recorded per cell by meta.ts).
//
//   node tools/balance/fit.mjs <report name> [more reports...] [--group foes]
//
// Prints a and b, the power ratio at which the AI party wins 33% (par) and 50%, and per cell (or per group) how
// far the battles are from the curve.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const gi = argv.indexOf('--group');
const group = gi >= 0 ? argv.splice(gi, 2)[1] : null;
const reports = argv.map((n) => JSON.parse(readFileSync(join(here, 'out', `${n}.json`), 'utf8')));

const points = [];
const cells = [];
for (const r of reports) {
  r.summary.forEach((s, c) => {
    const x = Math.log(s.ratio);
    cells.push({ ...s, x });
    for (const run of r.runs[c]) points.push({ x, y: run.win ? 1 : 0 });
  });
}

const sig = (z) => 1 / (1 + Math.exp(-z));
/** Logistic regression on (x, y) by Newton's method. */
export function fit(pts) {
  let a = 0;
  let b = 1;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const { x, y } of pts) {
      const p = sig(a + b * x);
      const w = p * (1 - p) + 1e-9;
      ga += y - p;
      gb += (y - p) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

const { a, b } = fit(points);
const logit = (p) => Math.log(p / (1 - p));
const at = (p) => Math.exp((logit(p) - a) / b);
console.log(`${points.length} battles, ${cells.length} cells: a ${a.toFixed(3)} b ${b.toFixed(3)}; ratio at 33% ${at(0.33).toFixed(3)}, 50% ${at(0.5).toFixed(3)}`);

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
if (group) {
  const by = new Map();
  for (const c of cells) {
    const k = JSON.stringify(group.split('.').reduce((o, p) => o?.[p], c));
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(c);
  }
  for (const [k, cs] of by) {
    const n = cs.reduce((s, c) => s + c.n, 0);
    const won = cs.reduce((s, c) => s + c.winRate * c.n, 0) / n;
    const pred = cs.reduce((s, c) => s + sig(a + b * c.x) * c.n, 0) / n;
    // The power factor that would put this group on the curve: shift x until the predicted rate matches.
    let lo = -5, hi = 5;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      const p = cs.reduce((s, c) => s + sig(a + b * (c.x - m)) * c.n, 0) / n;
      if (p > won) lo = m; else hi = m;
    }
    const shift = (lo + hi) / 2;
    console.log(`${k.padEnd(28)} n ${String(n).padStart(5)} win ${pct(won)} model ${pct(pred)}  value factor x${Math.exp(-shift / 2).toFixed(3)}`);
  }
} else {
  for (const c of cells) console.log(`${c.id.padEnd(48)} ratio ${c.ratio.toFixed(2).padStart(6)} win ${pct(c.winRate)} model ${pct(sig(a + b * c.x))}`);
}
