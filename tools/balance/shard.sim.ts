// One worker's share of a balance job (run by tools/balance/run.mjs through vitest, which loads the game's TypeScript).
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { cells, seedOf, type JobArgs } from './jobs';
import { cellMeta } from './meta';
import { runBattle } from './sim';

test('balance shard', () => {
  const args = JSON.parse(process.env.BALANCE_ARGS ?? '{}') as JobArgs;
  const shard = Number(process.env.BALANCE_SHARD ?? 0);
  const shards = Number(process.env.BALANCE_SHARDS ?? 1);
  const out = process.env.BALANCE_OUT!;
  const list = cells(args);
  const start = args.seedStart ?? 0;
  const runs: { cell: number; seed: number; r: ReturnType<typeof runBattle> }[] = [];
  let i = 0;
  for (let s = start; s < start + args.seeds; s++) {
    for (let c = 0; c < list.length; c++, i++) {
      if (i % shards !== shard) continue;
      runs.push({ cell: c, seed: s, r: runBattle(list[c].party, list[c].quest, seedOf(s)) });
    }
  }
  mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
  const meta = shard === 0 ? list.map((c) => ({ id: c.id, party: c.party, quest: c.quest, ...cellMeta(c) })) : undefined;
  writeFileSync(out, JSON.stringify({ meta, runs }));
}, 24 * 3600 * 1000);
