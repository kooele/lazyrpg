// The churches: donate for a blessing on the next quest, or pay for healing. Pure logic (no Phaser).
import { GUILD, type ChurchId } from '../data/guild';
import type { Character, GameState } from '../data/types';
import { note } from './city';
import { MAX_HEALTH, healthOf } from './condition';

/** The party's blessing as a share of every battle stat (0.06 = +6%), 0 without one. */
export const blessingBonus = (state: GameState) => (state.blessing ?? 0) / 100;

/**
 * Donate `GUILD.churches[church].donations[i]` for a blessing on the next quest. One blessing at a time: a bigger one
 * replaces it, a smaller or equal one is refused. Returns an error message, or null.
 */
export function donate(state: GameState, church: ChurchId, i: number): string | null {
  const d = GUILD.churches[church].donations[i];
  if (!d) return 'No such donation.';
  if ((state.blessing ?? 0) >= d.blessingPct) return `The party already has a blessing of +${state.blessing}%.`;
  if (state.gold < d.gold) return `Not enough gold (${d.gold} needed).`;
  state.gold -= d.gold;
  state.blessing = d.blessingPct;
  note(state, `Donated ${d.gold} gold at the ${GUILD.churches[church].name}: the party is blessed (+${d.blessingPct}% all stats) for the next quest.`);
  return null;
}

/** Days until `c` can be healed again at either church (0 = now). */
export function healCooldown(state: GameState, c: Pick<Character, 'id'>): number {
  const last = state.healedDay?.[c.id];
  return last === undefined ? 0 : Math.max(0, last + GUILD.churches.healCooldownDays - state.day);
}

/** Why `c` can't be healed at `church` right now (null if they can). */
export function healBlock(state: GameState, church: ChurchId, c: Character): string | null {
  const wait = healCooldown(state, c);
  if (healthOf(c) >= MAX_HEALTH) return `${c.name} is at full Health.`;
  if (wait > 0) return `${c.name} was healed recently: again in ${wait} day${wait === 1 ? '' : 's'}.`;
  const cost = GUILD.churches[church].heal.gold;
  if (state.gold < cost) return `Not enough gold (${cost} needed).`;
  return null;
}

/**
 * Pay for healing at `church`: restores its heal.health Health to one member at once (traits don't multiply it), and
 * starts their cooldown, shared by both churches. Returns an error message, or null.
 */
export function heal(state: GameState, church: ChurchId, id: string): string | null {
  const c = state.party.find((m) => m.id === id);
  if (!c) return 'They are not in the party.';
  const block = healBlock(state, church, c);
  if (block) return block;
  const h = GUILD.churches[church].heal;
  const before = healthOf(c);
  state.gold -= h.gold;
  c.health = Math.min(MAX_HEALTH, before + h.health);
  state.healedDay = { ...state.healedDay, [c.id]: state.day };
  note(state, `${c.name} was healed at the ${GUILD.churches[church].name} (${h.gold} gold): Health ${before} → ${c.health}.`);
  return null;
}
