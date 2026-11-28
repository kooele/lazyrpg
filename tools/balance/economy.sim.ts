// Economy report: per quest rank, the strength, par level, skulls, gold and renown of its quests (small, usual and
// large), against what the game paid before the strength model (BALANCE_OLD: the old threat formula's numbers).
//
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/economy.sim.ts
import { test } from 'vitest';
import { GUILD } from '../../src/data/guild';
import { RANKS, type Rank } from '../../src/data/types';
import { dangerRating, fairReward, questDifficulty, questRenown, questStrength, usualCount } from '../../src/game/board';

// The old threat formula (before the strength model): count x 10 x 1.165^(level - 1), gold 1.75 per threat point,
// renown 2D^2 + 4D + 8 from the old skulls (difficulty -4 to 24).
const oldThreat = (stage: number, count: number) => count * 10 * 1.165 ** (stage - 1);
const oldDiff = (stage: number, count: number) => Math.log(oldThreat(stage, count) / 4 / 10) / Math.log(1.165);
const oldSkulls = (stage: number, count: number) => Math.max(0.5, Math.min(10, Math.round((0.5 + 9.5 * (oldDiff(stage, count) + 4) / 28) * 2) / 2));
const oldRenown = (stage: number, count: number) => { const d = oldSkulls(stage, count); return 2 * d * d + 4 * d + 8; };

test('economy', () => {
  const out: string[] = [];
  const row = (rank: Rank, label: string, stage: number, count: number) => {
    const q = { stage, count };
    out.push(`${rank} ${label.padEnd(6)} St${String(stage).padStart(2)} c${String(count).padEnd(4)} strength ${questStrength(q).toFixed(0).padStart(6)} par ${questDifficulty(q).toFixed(1).padStart(5)} skulls ${String(dangerRating(q)).padStart(4)} (old ${String(oldSkulls(stage, count)).padStart(4)})  gold ${fairReward(q).toFixed(0).padStart(5)} (old ${(oldThreat(stage, count) * 1.75).toFixed(0).padStart(5)})  renown ${String(questRenown(q)).padStart(4)} (old ${oldRenown(stage, count).toFixed(0).padStart(3)})`);
  };
  for (const r of [...RANKS].reverse()) {
    const t = GUILD.quests[r];
    const mid = Math.round((t.stages[0] + t.stages[1]) / 2);
    row(r, 'easy', t.stages[0], t.count[0]);
    row(r, 'usual', mid, usualCount(r));
    row(r, 'hard', t.stages[1], t.count[1]);
  }
  // Suggested constants: gold and renown per strength that keep each rank's usual quest where it was.
  for (const r of [...RANKS].reverse()) {
    const t = GUILD.quests[r];
    const mid = Math.round((t.stages[0] + t.stages[1]) / 2);
    const s = questStrength({ stage: mid, count: usualCount(r) });
    out.push(`usual ${r} quest: gold per strength ${(oldThreat(mid, usualCount(r)) * 1.75 / s).toFixed(4)}, renown per strength ${(oldRenown(mid, usualCount(r)) / s).toFixed(5)}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});
