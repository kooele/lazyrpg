// Model predictions recorded next to each simulated cell, so a report compares the strength model with the battles.
import { groupDefense, groupValue, partyFighters, referenceParty, referenceSize, powerRatio, questFighters, questParLevel, strengthAt, tempo, winChance } from '../../src/game/power';
import { dangerRating } from '../../src/game/board';
import type { Cell } from './jobs';
import { buildParty } from './sim';

export function cellMeta(c: Cell): Record<string, number> {
  // Expected gear (rolled per battle): the model fights the averaged reference party.
  const p = c.party;
  const party = p.quality === 'expected' && p.random === undefined && !p.builds ? referenceParty(p.level, p.size ?? referenceSize(p.level)) : partyFighters(buildParty(p));
  const quest = questFighters(c.quest);
  const ratio = powerRatio(party, quest);
  // The raw sums, so fits can try other ways of counting numbers (fitalpha.py).
  const n = (g: typeof party) => g.reduce((t, f) => t + (f.weight ?? 1), 0);
  const raw = { vP: groupValue(party, groupDefense(quest)), vQ: groupValue(quest, groupDefense(party)), nP: n(party), nQ: n(quest) };
  // Ranged and melee parts of each side (for testing how numbers count: fitlaws.py).
  const part = (g: typeof party, ranged: boolean) => g.filter((f) => !!f.ranged === ranged);
  const parts = {
    vPr: groupValue(part(party, true), groupDefense(quest)), vPm: groupValue(part(party, false), groupDefense(quest)),
    nPr: n(part(party, true)), nPm: n(part(party, false)),
    vQr: groupValue(part(quest, true), groupDefense(party)), vQm: groupValue(part(quest, false), groupDefense(party)),
    nQr: n(part(quest, true)), nQm: n(part(quest, false)),
  };
  return { ...raw, ...parts, skulls: dangerRating(c.quest), ratio, predicted: winChance(ratio), pS: strengthAt(party), par: questParLevel(c.quest), tempo: tempo(party, quest) };
}
