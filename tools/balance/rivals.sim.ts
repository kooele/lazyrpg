// Rival parties over a year: rank spread, average levels, wins and losses, wipes (BALANCE_DAYS, default 365).
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/rivals.sim.ts
import { test } from 'vitest';
import { RANKS } from '../../src/data/types';
import { createCharacter, makeRng } from '../../src/game/character';
import { newCampaign } from '../../src/game/city';
import { simulateGuildDay } from '../../src/game/guild';

test('rivals', () => {
  const out: string[] = [];
  for (const seed of [1, 2, 3]) {
    const rng = makeRng(seed);
    const s = newCampaign(createCharacter('Hero'), 'Test', rng);
    const days = Number(process.env.BALANCE_DAYS ?? 365);
    const snap = (label: string) => {
      const g = s.guild;
      const by = RANKS.map((r) => {
        const ps = g.rivals.filter((p) => p.rank === r);
        const lv = ps.flatMap((p) => p.members.map((m) => m.level));
        return `${r} ${ps.length} (Lv ${lv.length ? (lv.reduce((a, b) => a + b, 0) / lv.length).toFixed(1) : '-'})`;
      }).join('  ');
      const wins = g.rivals.reduce((t, p) => t + p.wins, 0);
      const losses = g.rivals.reduce((t, p) => t + p.losses, 0);
      const wiped = g.news.filter((n) => /wiped out/.test(n.text)).length;
      const promoted = g.news.filter((n) => /rose to/.test(n.text)).length;
      out.push(`seed ${seed} ${label.padEnd(8)} ${by}  wins ${wins} losses ${losses} wipes ${wiped} promotions(B+) ${promoted} board ${g.board.length}`);
    };
    snap('start');
    for (let d = 0; d < days; d++) {
      s.day += 1;
      simulateGuildDay(s, rng);
      if (d === Math.floor(days / 2)) snap(`day ${s.day}`);
    }
    snap(`day ${s.day}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});
