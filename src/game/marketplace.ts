// The Marketplace (Outer City): the party's stall. Items put up for sale (moved out of the stash) are sold, top of the
// list first, by members on Marketplace duty: each sells up to schedule.marketplaceItemsPerDay a day, at full value.
import { GUILD } from '../data/guild';
import type { Character, GameState, Item } from '../data/types';
import { itemName, itemValue } from './inventory';

/** Can this item go up for sale? Everything but trophies (those are turned in at the city gate). */
export const canSell = (item: Item) => item.kind !== 'trophy';

/** Put stash items up for sale, at the bottom of the list. Returns an error or null. */
export function listItems(state: GameState, ids: string[]): string | null {
  const items = ids.map((id) => state.inventory.find((i) => i.id === id));
  if (items.some((i) => !i)) return 'That item is no longer in the stash.';
  if (items.some((i) => !canSell(i!))) return 'Trophies are turned in at the city gate, not sold.';
  state.inventory = state.inventory.filter((i) => !ids.includes(i.id));
  state.marketplace.push(...(items as Item[]));
  return null;
}

/** Take items off sale, back to the stash. */
export function unlistItems(state: GameState, ids: string[]): void {
  const back = state.marketplace.filter((i) => ids.includes(i.id));
  state.marketplace = state.marketplace.filter((i) => !ids.includes(i.id));
  state.inventory.push(...back);
}

/** The sale list as groups of identical items next to each other ("Wolf Pelt ×3"), top first. */
export function saleGroups(state: GameState): { item: Item; ids: string[] }[] {
  const out: { item: Item; ids: string[] }[] = [];
  const key = (i: Item) => `${i.kind}|${itemName(i)}|${itemValue(i)}`;
  for (const i of state.marketplace) {
    const last = out[out.length - 1];
    if (last && key(last.item) === key(i)) last.ids.push(i.id);
    else out.push({ item: i, ids: [i.id] });
  }
  return out;
}

/** Move a group up (-1) or down (+1) past its neighbouring group; to the top ('top') or the bottom ('bottom'). */
export function moveGroup(state: GameState, index: number, to: -1 | 1 | 'top' | 'bottom'): void {
  const groups = saleGroups(state);
  const g = groups[index];
  if (!g) return;
  groups.splice(index, 1);
  const at = to === 'top' ? 0 : to === 'bottom' ? groups.length : Math.max(0, Math.min(groups.length, index + to));
  groups.splice(at, 0, g);
  const byId = new Map(state.marketplace.map((i) => [i.id, i]));
  state.marketplace = groups.flatMap((x) => x.ids.map((id) => byId.get(id)!));
}

/** Members minding the stall today (Marketplace on their schedule, not away on a quest). */
export const sellersOf = (members: Character[], activity: (c: Character) => string) => members.filter((c) => activity(c) === 'marketplace');

/** Items the stall sells a day with this many sellers. */
export const salesPerDay = (sellers: number) => sellers * GUILD.schedule.marketplaceItemsPerDay;

/** A day at the stall: each seller sells up to marketplaceItemsPerDay items from the top of the list. Returns a message, or null. */
export function marketplaceDay(state: GameState, sellers: Character[]): string | null {
  const n = Math.min(state.marketplace.length, salesPerDay(sellers.length));
  if (!sellers.length) return null;
  if (!n) return `Nothing on sale at the Marketplace: ${sellers.map((c) => c.name).join(', ')} minded an empty stall.`;
  const sold = state.marketplace.splice(0, n);
  const gold = sold.reduce((s, i) => s + itemValue(i), 0);
  state.gold += gold;
  const names = new Map<string, number>();
  for (const i of sold) names.set(itemName(i), (names.get(itemName(i)) ?? 0) + 1);
  return `Sold at the Marketplace for ${gold} gold: ${[...names].map(([name, k]) => `${name}${k > 1 ? ` ×${k}` : ''}`).join(', ')}.${state.marketplace.length ? '' : ' The stall is empty now.'}`;
}
