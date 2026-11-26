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
    description: 'The hero of this story. Recovers from injuries 50% faster and gains 50% more Morale.',
    healthRecovery: 1.5,
    moraleGain: 1.5,
  },
};
