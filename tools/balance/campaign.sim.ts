// The campaign's pace: the expected party (3 members, 4 from level 8, 5 from 13) takes quests of its rank, one after
// another, and gains XP (a day of training plus its share of the quest's XP pool) as the game pays it. This fits the
// XP pool (xp.pool: a x skulls^2 + b x skulls + c) so each rank ends near the next adventurer rank's first level
// after QUESTS of its quests, and the renown thresholds (ranks.renown) so promotions come after the same counts.
// Prints the fit, the gold and renown of each rank's quests, and the level reached quest by quest.
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/campaign.sim.ts
import { test } from 'vitest';
import { xpToNext } from '../../src/data/content';
import { GUILD, trainingXp } from '../../src/data/guild';
import { RANKS, type Rank } from '../../src/data/types';
import { dangerRating, fairReward, makeQuest, questRenown } from '../../src/game/board';
import { makeRng } from '../../src/game/character';
import { referenceSize } from '../../src/game/power';

/** Quests the party takes at each rank before it's promoted (D at least 4, each rank more; 29 to A), and the level it should reach. */
const QUESTS: Record<Exclude<Rank, 'S'>, number> = { D: 5, C: 9, B: 15, A: 20 };
const END_LEVEL: Record<Exclude<Rank, 'S'>, number> = { D: 6, C: 11, B: 16, A: 20 };
const PATH = ['D', 'C', 'B', 'A'] as const;

test('campaign', () => {
  const out: string[] = [];
  // Each rank's quests: their skulls, gold and renown (at usual pay), from 400 generated ones.
  const stats = Object.fromEntries(RANKS.map((r) => {
    const qs = Array.from({ length: 400 }, (_, i) => makeQuest(r, 1, makeRng(4000 + i)));
    const avg = (f: (q: (typeof qs)[number]) => number) => qs.reduce((t, q) => t + f(q), 0) / qs.length;
    return [r, { skulls: avg((q) => dangerRating(q)), gold: avg((q) => fairReward(q)), renown: avg((q) => questRenown(q)), list: qs.map((q) => dangerRating(q)) }];
  })) as Record<Rank, { skulls: number; gold: number; renown: number; list: number[] }>;
  for (const r of [...RANKS].reverse()) out.push(`${r}: skulls ${stats[r].skulls.toFixed(2)} on average, usual gold ${stats[r].gold.toFixed(0)}, renown ${stats[r].renown.toFixed(1)}`);

  // Walk the campaign with an XP pool; returns the level (fractional) at the end of each rank and the path.
  const walk = (pool: (s: number) => number) => {
    let level = 1;
    let xp = 0;
    let n = 0;
    const ends: Record<string, number> = {};
    const trail: string[] = [];
    for (const rank of PATH) {
      for (let i = 0; i < QUESTS[rank]; i++) {
        const s = stats[rank].list[(n * 7) % stats[rank].list.length];
        xp += trainingXp(level) + pool(s) / referenceSize(level);
        while (xp >= xpToNext(level) && level < 25) {
          xp -= xpToNext(level);
          level++;
        }
        n++;
        if (n % 5 === 0) trail.push(`#${n} L${level}`);
      }
      ends[rank] = level + xp / xpToNext(level);
    }
    return { ends, trail };
  };
  // Fit pool = a s^2 + b s + c by a coarse search.
  let best = { a: 0, b: 0, c: 0, err: Infinity };
  for (let a = 0; a <= 40; a += 2)
    for (let b = 0; b <= 400; b += 10)
      for (let c = 0; c <= 400; c += 20) {
        const { ends } = walk((s) => a * s * s + b * s + c);
        const err = PATH.reduce((t, r) => t + (ends[r] - END_LEVEL[r]) ** 2, 0);
        if (err < best.err) best = { a, b, c, err };
      }
  const fit = walk((s) => best.a * s * s + best.b * s + best.c);
  out.push(`XP pool fit: ${best.a} x skulls^2 + ${best.b} x skulls + ${best.c}; levels at the end of each rank: ${PATH.map((r) => `${r} ${fit.ends[r].toFixed(1)} (want ${END_LEVEL[r]})`).join(', ')}`);
  out.push(`path: ${fit.trail.join(', ')}`);
  // Renown thresholds: promotion after QUESTS[rank] of the rank's usual quests.
  let total = 0;
  const thresholds: string[] = [];
  for (const rank of PATH) {
    total += QUESTS[rank] * stats[rank].renown;
    const up = RANKS[RANKS.indexOf(rank) - 1];
    thresholds.push(`${up} ${Math.round(total / 5) * 5}`);
  }
  out.push(`renown thresholds: ${thresholds.join(', ')} (now ${JSON.stringify(GUILD.ranks.renown)})`);
  process.stdout.write(out.join('\n') + '\n');
}, 600000);
