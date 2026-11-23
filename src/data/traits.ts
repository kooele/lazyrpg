// Traits: lasting qualities of an adventurer, shown under their skills in Manage Party.
import type { TraitId } from './types';

export interface TraitDef {
  name: string;
  description: string;
  /** Multiplies Health recovered (nightly recovery and the Recover schedule). */
  healthRecovery: number;
  /** Multiplies Morale gained (drinks, days off). Morale losses are unchanged. */
  moraleGain: number;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  protagonist: {
    name: 'Protagonist',
    description: 'The hero of this story. Recovers from injuries twice as fast and gains twice as much Morale.',
    healthRecovery: 2,
    moraleGain: 2,
  },
};
