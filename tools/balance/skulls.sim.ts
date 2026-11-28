// Skull anchors and usual-quest par levels from the model, for tune2.py: writes out/skulls.json.
//  - half a skull and one skull: the rat groups (enemy level 1, smooth sizes) that random level-1 trios (8 of them,
//    as the guild hall makes them) beat 97% and 75% of the time on average, as par levels;
//  - ten skulls: the hardest S quest's par level;
//  - per level 1-25: the par level of the usual quest (usualCountAt, every fitting type).
import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { partyFighters, powerRatio, questFighters, questParLevel, usualCountAt, winChance } from '../../src/game/power';
import { buildParty } from './sim';

test('skulls', () => {
  const trios = Array.from({ length: 8 }, (_, i) => partyFighters(buildParty({ level: 1, size: 3, random: 100 + i })));
  const win = (count: number) => trios.reduce((t, p) => t + winChance(powerRatio(p, questFighters({ stage: 1, count, foes: ['rat'] }, { smooth: true }))), 0) / trios.length;
  const countFor = (p: number) => {
    let lo = 0.05, hi = 30;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (win(m) > p) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const half = countFor(0.97);
  const one = countFor(0.75);
  const par = (count: number) => questParLevel({ stage: 1, count, foes: ['rat'] }, { smooth: true });
  const out = {
    half: { count: half, par: par(half) },
    one: { count: one, par: par(one) },
    ten: { par: questParLevel({ stage: 25, count: 18 }) },
    usual: Array.from({ length: 25 }, (_, i) => ({ level: i + 1, par: questParLevel({ stage: i + 1, count: usualCountAt(i + 1) }, { smooth: true }) })),
  };
  writeFileSync('tools/balance/out/skulls.json', JSON.stringify(out));
  process.stdout.write(`skulls ${JSON.stringify({ half: out.half, one: out.one, ten: out.ten })}\n`);
});
