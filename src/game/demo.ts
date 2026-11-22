// Quick Battle (demo): the original 5-stage game. Build a party of up to 4 Adventurers at camp,
// then fight stages 1 to 5. It lives apart from the Arch City campaign and isn't saved.
import { STAT_CONFIG } from '../data/stats';
import type { Character } from '../data/types';
import { grantXp } from './character';

export const DEMO_STAGES = 5;

export interface DemoState {
  party: Character[];
  stage: number;
  victories: number;
  defeats: number;
  /** All 5 stages cleared. */
  complete: boolean;
}

export const demo: { state: DemoState | null } = { state: null };

export function newDemo(): DemoState {
  demo.state = { party: [], stage: 1, victories: 0, defeats: 0, complete: false };
  return demo.state;
}

export function requireDemo(): DemoState {
  return demo.state ?? newDemo();
}

/** Settle a demo battle: a victory gives every Adventurer xpPerVictory and moves to the next stage. Returns report lines. */
export function resolveDemoBattle(d: DemoState, outcome: 'victory' | 'defeat'): string[] {
  const lines: string[] = [];
  if (outcome === 'defeat') {
    d.defeats += 1;
    return ['Your party falls back to camp to recover.', 'Rethink your loadouts and try again.'];
  }
  d.victories += 1;
  const xp = STAT_CONFIG.xpPerVictory;
  lines.push(`Each adventurer gains ${xp} XP.`);
  for (const c of d.party) if (grantXp(c, xp) > 0) lines.push(`${c.name} reached level ${c.level}! Stats grew automatically.`);
  if (d.stage >= DEMO_STAGES) {
    d.complete = true;
    lines.push('', `All ${DEMO_STAGES} stages cleared: the demo is complete!`, 'Start a new game to visit Arch City.');
  } else {
    d.stage += 1;
    lines.push('', `Next up: stage ${d.stage} of ${DEMO_STAGES}.`);
  }
  return lines;
}
