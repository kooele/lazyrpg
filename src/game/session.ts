import type { GameState } from '../data/types';

/** The game currently being played (in memory). Scenes read and mutate this. */
export const session: { state: GameState | null; dirty: boolean } = {
  state: null,
  dirty: false,
};

export function requireState(): GameState {
  if (!session.state) throw new Error('No game in progress');
  return session.state;
}

export function markDirty(): void {
  session.dirty = true;
}
