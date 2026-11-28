// Model-only board check: per quest rank, the AI-played reference party's average win chance (strength.winCurve) on
// 300 board quests (makeQuest), fought at the quest's enemy level with the reference gear. Writes out/boardavg.json.
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/boardavg.sim.ts
import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { RANKS } from '../../src/data/types';
import { GUILD } from '../../src/data/guild';
import { makeQuest, usualCount } from '../../src/game/board';
import { makeRng } from '../../src/game/character';
import { partyFighters, powerRatio, questFighters, referenceSize, winChance } from '../../src/game/power';
import { referenceQuality } from './jobs';
import { buildParty } from './sim';

test('board average', () => {
  const out: Record<string, number> = {};
  for (const rank of RANKS) {
    let sum = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const q = makeQuest(rank, 1, makeRng(5000 + i * 31 + RANKS.indexOf(rank)));
      const party = partyFighters(buildParty({ level: q.stage, quality: referenceQuality(q.stage), size: referenceSize(q.stage) }));
      sum += winChance(powerRatio(party, questFighters(q)));
    }
    out[rank] = sum / n;
    // The usual quest: the middle of the rank's levels and group sizes, all its fitting enemy types.
    const t = GUILD.quests[rank];
    const stage = Math.round((t.stages[0] + t.stages[1]) / 2);
    const party = partyFighters(buildParty({ level: stage, quality: referenceQuality(stage), size: referenceSize(stage) }));
    out[`${rank} usual`] = winChance(powerRatio(party, questFighters({ stage, count: usualCount(rank) })));
  }
  writeFileSync('tools/balance/out/boardavg.json', JSON.stringify(out));
  process.stdout.write(`board average ${JSON.stringify(out)}\n`);
});
