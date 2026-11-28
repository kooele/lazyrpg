// Recompute the model columns (meta.ts) of an existing report, e.g. after the model changed: BALANCE_REPORT=<name>.
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { cellMeta } from './meta';

test('remeta', () => {
  const path = `tools/balance/out/${process.env.BALANCE_REPORT}.json`;
  const r = JSON.parse(readFileSync(path, 'utf8'));
  r.summary = r.summary.map((s: Parameters<typeof cellMeta>[0]) => ({ ...s, ...cellMeta(s) }));
  writeFileSync(path, JSON.stringify(r));
});
