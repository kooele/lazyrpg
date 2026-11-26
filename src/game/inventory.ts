// The party's stash and equipping: weapons, armor and loot nobody is using, and moving gear on and off members.
import { ARMORS, QUALITIES, WEAPONS } from '../data/content';
import {
  GEAR_KINDS, ITEM_KINDS, STAT_KEYS, isGearItem,
  type Character, type GameState, type Gear, type GearItem, type GearKind, type Item, type LootItem, type StatKey,
} from '../data/types';
import { deriveStats, newId } from './character';
import { gearName } from './gear';

/** The character's slot for an item kind. */
export const slotOf = (kind: GearKind): 'weapon' | 'armor' => kind;

/** A new stash item. */
export function makeItem(kind: GearKind, g: Gear): GearItem {
  return { id: newId('i'), kind, type: g.type, quality: g.quality };
}

/** A new junk or trophy item. */
export function makeLoot(kind: LootItem['kind'], name: string, value: number, source: string): LootItem {
  return { id: newId('i'), kind, name, value: Math.max(0, Math.round(value)), source };
}

/** "Fine Longbow", "Wolf Pelt". */
export const itemName = (item: Item) => (isGearItem(item) ? gearName(item, item.kind) : item.name);

/** What the item is worth in gold: gear by its quality, loot as it dropped. */
export const itemValue = (item: Item | Pick<GearItem, 'quality'>) => ('value' in item ? item.value : (QUALITIES[item.quality]?.value ?? 0));

/** Put a piece of equipment in the stash. */
export function addItem(state: GameState, kind: GearKind, g: Gear): GearItem {
  const item = makeItem(kind, g);
  state.inventory.push(item);
  return item;
}

const QUALITY_ORDER = Object.keys(QUALITIES);
const TYPE_ORDER = { weapon: Object.keys(WEAPONS), armor: Object.keys(ARMORS) };

/** The stash in display order: weapons, armor (in equipment.json order, best quality first), then junk and trophies (most valuable first). */
export function sortedInventory(state: GameState, kind?: Item['kind']): Item[] {
  return state.inventory
    .filter((i) => !kind || i.kind === kind)
    .sort((a, b) => {
      const byKind = ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind);
      if (byKind) return byKind;
      if (isGearItem(a) && isGearItem(b)) {
        return TYPE_ORDER[a.kind].indexOf(a.type) - TYPE_ORDER[b.kind].indexOf(b.type) || QUALITY_ORDER.indexOf(b.quality) - QUALITY_ORDER.indexOf(a.quality);
      }
      return itemValue(b) - itemValue(a) || itemName(a).localeCompare(itemName(b));
    });
}

/** Identical items (same kind, name and value) as one stack: the first item and how many there are. */
export function stacks(items: Item[]): { item: Item; count: number; ids: string[] }[] {
  const out = new Map<string, { item: Item; count: number; ids: string[] }>();
  for (const i of items) {
    const key = `${i.kind}|${itemName(i)}|${itemValue(i)}`;
    const s = out.get(key);
    if (s) {
      s.count += 1;
      s.ids.push(i.id);
    } else out.set(key, { item: i, count: 1, ids: [i.id] });
  }
  return [...out.values()];
}

/** Trophies in the stash, waiting to be turned in at the city gate. */
export const trophies = (state: GameState) => state.inventory.filter((i): i is LootItem => i.kind === 'trophy');

/** Turn every trophy in at the city gate. Returns the gold received. */
export function turnInTrophies(state: GameState): number {
  const list = trophies(state);
  const gold = list.reduce((sum, t) => sum + t.value, 0);
  if (!list.length) return 0;
  state.inventory = state.inventory.filter((i) => i.kind !== 'trophy');
  state.gold += gold;
  state.log.push({ day: state.day, text: `Turned in ${list.length} troph${list.length > 1 ? 'ies' : 'y'} at the city gate for ${gold} gold.` });
  state.log = state.log.slice(-60);
  return gold;
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
  if (!isGearItem(item)) return `${item.name} can't be equipped.`;
  const slot = slotOf(item.kind);
  const old = c![slot];
  state.inventory = state.inventory.filter((i) => i !== item);
  if (old) addItem(state, item.kind, old);
  c![slot] = { type: item.type, quality: item.quality, issued: true };
  return null;
}

/** Take a member's weapon or armor off and put it in the stash. Returns an error or null. */
export function unequip(state: GameState, memberId: string, kind: GearKind): string | null {
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
export function returnGear(state: GameState, c: Character, all = false): GearItem[] {
  const out: GearItem[] = [];
  for (const kind of GEAR_KINDS) {
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
export function statChanges(c: Character, item: Pick<GearItem, 'kind' | 'type' | 'quality'>): StatChange[] {
  const before = deriveStats(c);
  const after = deriveStats({ ...c, [slotOf(item.kind)]: { type: item.type, quality: item.quality } });
  return STAT_KEYS.filter((k) => before[k] !== after[k]).map((key) => ({ key, before: before[key], after: after[key] }));
}
