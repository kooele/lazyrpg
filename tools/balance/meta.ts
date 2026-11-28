// Model predictions recorded next to each simulated cell, so a report compares the strength model with the battles.
import { groupDefense, groupValue, partyFighters, powerRatio, questFighters, questParLevel, strengthAt, tempo, winChance } from '../../src/game/power';
import type { Cell } from './jobs';
import { buildParty } from './sim';

export function cellMeta(c: Cell): Record<string, number> {
  const party = partyFighters(buildParty(c.party));
  const quest = questFighters(c.quest);
  const ratio = powerRatio(party, quest);
  // The raw sums, so fits can try other ways of counting numbers (fitalpha.py).
  const n = (g: typeof party) => g.reduce((t, f) => t + (f.weight ?? 1), 0);
  const raw = { vP: groupValue(party, groupDefense(quest)), vQ: groupValue(quest, groupDefense(party)), nP: n(party), nQ: n(quest) };
  return { ...raw, ratio, predicted: winChance(ratio), pS: strengthAt(party), par: questParLevel(c.quest), tempo: tempo(party, quest) };
}
