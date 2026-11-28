// The quest board's mix: for each rank, the skulls, enemy types, levels and group sizes of 400 generated quests, and
// for each half-skull band from 0.5 to 10, how many enemy types can be posted at it (the variety rule: 3 or more).
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/questmix.sim.ts
import { test } from 'vitest';
import { RANKS } from '../../src/data/types';
import { ENEMIES } from '../../src/data/enemies';
import { dangerRating, enemiesForSkulls, makeQuest, questDifficulty } from '../../src/game/board';
import { makeRng } from '../../src/game/character';

test('quest mix', () => {
  const out: string[] = [];
  for (const rank of [...RANKS].reverse()) {
    const qs = Array.from({ length: 400 }, (_, i) => makeQuest(rank, 1, makeRng(9000 + i)));
    const types = new Map<string, number>();
    for (const q of qs) types.set(q.foes![0], (types.get(q.foes![0]) ?? 0) + 1);
    const sk = qs.map((q) => questDifficulty(q));
    const lv = qs.map((q) => q.stage);
    const ratio = qs.map((q) => q.count / ENEMIES[q.foes![0]].group);
    out.push(`${rank}: skulls ${Math.min(...sk).toFixed(1)}-${Math.max(...sk).toFixed(1)} (shown ${Math.min(...qs.map(dangerRating))}-${Math.max(...qs.map(dangerRating))}), levels ${Math.min(...lv)}-${Math.max(...lv)}, group ${Math.min(...ratio).toFixed(2)}-${Math.max(...ratio).toFixed(2)}x usual; types ${[...types].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  }
  for (let s = 0.5; s <= 10; s += 0.5) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i < 200; i++) {
      const e = enemiesForSkulls(s, makeRng(i * 31 + 7));
      const t = e.foes[0];
      if (!seen.has(t)) seen.set(t, []);
      seen.get(t)!.push(e.stage);
    }
    out.push(`${String(s).padStart(4)} skulls: ${seen.size} types: ${[...seen].map(([t, ls]) => `${t} L${Math.min(...ls)}${Math.max(...ls) > Math.min(...ls) ? `-${Math.max(...ls)}` : ''}`).join(', ')}`);
  }
  process.stdout.write(out.join('\n') + '\n');
});
