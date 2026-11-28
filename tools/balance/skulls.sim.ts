// Skull anchors from the model (writes strength.skulls in guild.json) and the typical skulls by party level:
//  - half a skull: the threat of the rat group (enemy level 1) that random level-1 trios (8 of them, as the guild hall
//    makes them) score 95% on;
//  - ten skulls: the threat of the level-20 group (every fitting type) that the five-member level-20 reference party
//    scores 50% on;
//  - typical: for each party level, the skulls of the level-L group its reference party scores TARGET(L) on
//    (99% at level 1, 70% at 5, 60% at 10, 50% at 20). Writes out/skulls.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { partyFighters, powerRatio, questFighters, questThreat, referenceParty, skullsOfThreat, winChance } from '../../src/game/power';
import { GUILD } from '../../src/data/guild';
import { buildParty } from './sim';

/** Skull points between the anchors: the typical quest of these party levels shows these skulls. */
const RANK_POINTS: [number, number][] = [[5, 2.5], [10, 5], [15, 7.5]];

/** The score wanted for a party of a level against its typical quest. */
export const TARGET: [number, number][] = [[1, 0.99], [5, 0.7], [10, 0.6], [20, 0.5]];
export const target = (L: number) => {
  const t = TARGET;
  if (L <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (L <= t[i][0]) return t[i - 1][1] + ((t[i][1] - t[i - 1][1]) * (L - t[i - 1][0])) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
};

/** The smooth group size at which `party` scores `score` against level-`stage` enemies (`foes`, or every fitting type). */
function countFor(party: ReturnType<typeof referenceParty>[], stage: number, score: number, foes?: string[]): number {
  const s = (count: number) => party.reduce((t, p) => t + winChance(powerRatio(p, questFighters({ stage, count, foes }, { smooth: true }))), 0) / party.length;
  let lo = 0.01, hi = 400;
  for (let i = 0; i < 60; i++) {
    const m = Math.sqrt(lo * hi);
    if (s(m) > score) lo = m;
    else hi = m;
  }
  return Math.sqrt(lo * hi);
}

test('skulls', () => {
  const trios = Array.from({ length: 8 }, (_, i) => partyFighters(buildParty({ level: 1, size: 3, random: 100 + i })));
  // 98.5% by the model: random trios score about 7 points below it in battle (a clean win still costs some Health).
  const halfCount = countFor(trios, 1, 0.985, ['rat']);
  const half = questThreat({ stage: 1, count: halfCount, foes: ['rat'] }, { smooth: true });
  const tenCount = countFor([referenceParty(20, 5)], 20, 0.5);
  const ten = questThreat({ stage: 20, count: tenCount }, { smooth: true });
  // Typical quests' threats, then skull points: the anchors, and RANK_POINTS levels' typical quests at even steps.
  const typicalThreat = Array.from({ length: 25 }, (_, i) => {
    const L = i + 1;
    const c = countFor([referenceParty(L)], L, target(L));
    return { level: L, target: target(L), count: c, threat: questThreat({ stage: L, count: c }, { smooth: true }) };
  });
  const pts: [number, number][] = [[half, 0.5], ...RANK_POINTS.map(([L, s]) => [typicalThreat[L - 1].threat, s] as [number, number]), [ten, 10]];
  const round = (p: [number, number][]) => p.map(([t, s]) => [Number(t.toFixed(3)), s] as [number, number]);
  const path = 'src/data/guild.json';
  let g = readFileSync(path, 'utf8');
  g = g.replace(/"skulls": \[\[.*?\]\]/, `"skulls": ${JSON.stringify(round(pts))}`);
  writeFileSync(path, g);
  GUILD.strength.skulls = round(pts);
  const typical = typicalThreat.map((t) => ({ ...t, skulls: skullsOfThreat(t.threat) }));
  writeFileSync('tools/balance/out/skulls.json', JSON.stringify({ half: { count: halfCount, threat: half }, ten: { count: tenCount, threat: ten }, typical }));
  process.stdout.write(`half ${halfCount.toFixed(2)} rat threat points (threat ${half.toFixed(2)}), ten: ${tenCount.toFixed(1)} threat points at level 20 (threat ${ten.toFixed(2)})\n`);
  for (const t of typical) process.stdout.write(`L${t.level}: target ${(t.target * 100).toFixed(0)}% -> ${t.count.toFixed(1)} threat points, ${t.skulls.toFixed(2)} skulls\n`);
});
