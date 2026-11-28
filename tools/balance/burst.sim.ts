// Burst check: how much of each reference Adventurer's Health one basic hit of each enemy type takes, at the bottom and
// top of its levels (against the reference party of the same level, after Defense and penetration).
//   npx vitest run --config tools/balance/vitest.config.ts tools/balance/burst.sim.ts
import { test } from 'vitest';
import { ENEMIES } from '../../src/data/enemies';
import { POWER, damagePerTurn, expectedEnemy, referenceParty } from '../../src/game/power';

test('burst', () => {
  const out: string[] = [];
  for (const def of Object.values(ENEMIES)) {
    for (const L of [...new Set(def.levels)]) {
      const foe = expectedEnemy(def.id, L)[0];
      const ref = referenceParty(L);
      const share = ref.map((r) => damagePerTurn(foe.stats, r.stats.defense) / r.stats.health);
      out.push(`${def.id.padEnd(10)} L${String(L).padEnd(3)} hit / Health: ${POWER.referenceParty.map((b, i) => `${b} ${Math.round(share[i] * 100)}%`).join('  ')}`);
    }
  }
  process.stdout.write(out.join('\n') + '\n');
});
