// Model predictions recorded next to each simulated cell, so a report compares the strength model with the battles.
import { partyFighters, powerRatio, questFighters, questParLevel, strengthAt, tempo, winChance } from '../../src/game/power';
import type { Cell } from './jobs';
import { buildParty } from './sim';

export function cellMeta(c: Cell): Record<string, number> {
  const party = partyFighters(buildParty(c.party));
  const quest = questFighters(c.quest);
  const ratio = powerRatio(party, quest);
  return { ratio, predicted: winChance(ratio), pS: strengthAt(party), par: questParLevel(c.quest), tempo: tempo(party, quest) };
}
