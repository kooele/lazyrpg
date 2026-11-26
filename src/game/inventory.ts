// The party's stash and equipping: weapons and armor nobody is using, and moving them on and off members.
import { ARMORS, QUALITIES, WEAPONS } from '../data/content';
import { ITEM_KINDS, STAT_KEYS, type Character, type GameState, type Gear, type Item, type ItemKind, type StatKey } from '../data/types';
import { deriveStats, newId } from './character';
import { gearName } from './gear';

/** The character's slot for an item kind. */
export const slotOf = (kind: ItemKind): 'weapon' | 'armor' => kind;

/** A new stash item. */
export function makeItem(kind: ItemKind, g: Gear): Item {
  return { id: newId('i'), kind, type: g.type, quality: g.quality };
}

/** "Fine Longbow". */
export const itemName = (item: Item) => gearName(item, item.kind);

/** What the item is worth in gold (its quality's value). */
export const itemValue = (item: Pick<Item, 'quality'>) => QUALITIES[item.quality]?.value ?? 0;

/** Put a piece of equipment in the stash. */
export function addItem(state: GameState, kind: ItemKind, g: Gear): Item {
  const item = makeItem(kind, g);
  state.inventory.push(item);
  return item;
}

const QUALITY_ORDER = Object.keys(QUALITIES);
const TYPE_ORDER = { weapon: Object.keys(WEAPONS), armor: Object.keys(ARMORS) };

/** The stash in display order: weapons then armor, in equipment.json order, best quality first. */
export function sortedInventory(state: GameState, kind?: ItemKind): Item[] {
  return state.inventory
    .filter((i) => !kind || i.kind === kind)
    .sort((a, b) => ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind)
      || TYPE_ORDER[a.kind].indexOf(a.type) - TYPE_ORDER[b.kind].indexOf(b.type)
      || QUALITY_ORDER.indexOf(b.quality) - QUALITY_ORDER.indexOf(a.quality));
}

/** Why the member can't change gear, or null if they can. Mercenaries fight with their own. */
export function equipBlock(c: Character | undefined): string | null {
  if (!c) return 'No such party member.';
  if (c.contract?.type === 'mercenary') return `${c.name} is a mercenary and fights with their own gear.`;
  return null;
}

/** Equip a stash item on a party member; what they had in that slot goes to the stash. Returns an error or null. */
export function equipItem(state: GameState, memberId: string, itemId: string): string | null {
  const c = state.party.find((m) => m.id === memberId);
  const block = equipBlock(c);
  if (block) return block;
  const item = state.inventory.find((i) => i.id === itemId);
  if (!item) return 'That item is no longer in the stash.';
  const slot = slotOf(item.kind);
  const old = c![slot];
  state.inventory = state.inventory.filter((i) => i !== item);
  if (old) addItem(state, item.kind, old);
  c![slot] = { type: item.type, quality: item.quality, issued: true };
  return null;
}

/** Take a member's weapon or armor off and put it in the stash. Returns an error or null. */
export function unequip(state: GameState, memberId: string, kind: ItemKind): string | null {
  const c = state.party.find((m) => m.id === memberId);
  const block = equipBlock(c);
  if (block) return block;
  const slot = slotOf(kind);
  const g = c![slot];
  if (!g) return `${c!.name} has no ${kind} to take off.`;
  addItem(state, kind, g);
  c![slot] = null;
  return null;
}

/**
 * A member is leaving the party: gear handed out from the stash goes back to it (`all`: everything they carry, for
 * slaves sold or seized and members who died). Returns the items returned.
 */
export function returnGear(state: GameState, c: Character, all = false): Item[] {
  const out: Item[] = [];
  for (const kind of ITEM_KINDS) {
    const g = c[slotOf(kind)];
    if (!g || !(all || g.issued)) continue;
    out.push(addItem(state, kind, g));
    c[slotOf(kind)] = null;
  }
  return out;
}

/** A stat the gear changes: its amount now and with the item equipped. */
export interface StatChange {
  key: StatKey;
  before: number;
  after: number;
}

/** What equipping `item` would do to the member's stats (only the stats that change). */
export function statChanges(c: Character, item: Pick<Item, 'kind' | 'type' | 'quality'>): StatChange[] {
  const before = deriveStats(c);
  const after = deriveStats({ ...c, [slotOf(item.kind)]: { type: item.type, quality: item.quality } });
  return STAT_KEYS.filter((k) => before[k] !== after[k]).map((key) => ({ key, before: before[key], after: after[key] }));
}
