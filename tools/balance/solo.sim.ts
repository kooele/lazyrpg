// The half-skull anchor: the rat group (in threat points, at enemy level 1) that a lone level-1 Adventurer with Crude
// gear beats half the time by the model, for the Archer and the Sword and Shield warrior (with Kick), and that
// group's par level (what strength.skulls.from should be).
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/solo.sim.ts
import { test } from 'vitest';
import { partyFighters, powerRatio, questFighters, questParLevel, winChance } from '../../src/game/power';
import { buildParty } from './sim';

test('solo anchor', () => {
  const out: string[] = [];
  const win = (build: string, count: number) =>
    winChance(powerRatio(partyFighters(buildParty({ level: 1, size: 1, builds: [build], quality: 'crude' })), questFighters({ stage: 1, count, foes: ['rat'] }, { smooth: true })));
  const half: number[] = [];
  for (const build of ['archer', 'warrior']) {
    let lo = 0.05, hi = 10;
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2;
      if (win(build, m) > 0.5) lo = m;
      else hi = m;
    }
    half.push((lo + hi) / 2);
    out.push(`${build}: 50% at ${((lo + hi) / 2).toFixed(2)} threat points (${((lo + hi) / 2 / 0.5).toFixed(1)} rats); 2 rats ${(win(build, 1) * 100).toFixed(0)}%, 3 rats ${(win(build, 1.5) * 100).toFixed(0)}%`);
  }
  const c = (half[0] + half[1]) / 2;
  out.push(`anchor: ${c.toFixed(2)} threat points, par level ${questParLevel({ stage: 1, count: c, foes: ['rat'] }).toFixed(2)}; 2 rats par ${questParLevel({ stage: 1, count: 1, foes: ['rat'] }).toFixed(2)}`);
  process.stdout.write(out.join('\n') + '\n');
});
