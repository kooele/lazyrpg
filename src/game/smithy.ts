// The Smithy (Outer City): Common gear on the spot, better gear to order. Orders are paid up front and worked on a
// few at a time (equipment.json smithy.workers); each takes its quality's days of work, then goes to the stash.
import { ARMORS, QUALITIES, SMITHY, WEAPONS } from '../data/content';
import type { GameState, GearKind, SmithyOrder } from '../data/types';
import { newId } from './character';
import { gear, gearName } from './gear';
import { addItem } from './inventory';

/** Qualities the Smithy takes orders for, cheapest first, with their price and days of work. */
export function orderOptions(): { quality: string; price: number; days: number }[] {
  return Object.entries(SMITHY.orderDays)
    .map(([quality, days]) => ({ quality, price: QUALITIES[quality].value, days }))
    .sort((a, b) => a.price - b.price);
}

/** What the Smithy sells on the spot: its buy quality's price. */
export const buyPrice = () => QUALITIES[SMITHY.buyQuality].value;

const known = (kind: GearKind, type: string) => {
  const def = kind === 'weapon' ? WEAPONS[type] : ARMORS[type];
  return !!def && !def.builtIn;
};

/** Buy a piece at the Smithy's buy quality (Common): it goes straight to the stash. Returns an error or null. */
export function buyGear(state: GameState, kind: GearKind, type: string): string | null {
  if (!known(kind, type)) return 'The Smithy doesn\'t make that.';
  const price = buyPrice();
  if (state.gold < price) return `Not enough gold (${price} needed).`;
  state.gold -= price;
  const item = addItem(state, kind, gear(type, SMITHY.buyQuality));
  state.log.push({ day: state.day, text: `Bought a ${gearName(item, kind)} at the Smithy for ${price} gold.` });
  state.log = state.log.slice(-60);
  return null;
}

/** Order a piece at a better quality (paid now). Returns an error or null. */
export function orderGear(state: GameState, kind: GearKind, type: string, quality: string): string | null {
  if (!known(kind, type)) return 'The Smithy doesn\'t make that.';
  const opt = orderOptions().find((o) => o.quality === quality);
  if (!opt) return `The Smithy doesn't take orders for ${QUALITIES[quality]?.name ?? quality} gear.`;
  if (state.gold < opt.price) return `Not enough gold (${opt.price} needed).`;
  state.gold -= opt.price;
  const order: SmithyOrder = { id: newId('o'), kind, type, quality, worked: 0, paid: opt.price, day: state.day };
  state.smithyOrders.push(order);
  return null;
}

/** Days of work an order needs in all. */
export const orderDays = (o: Pick<SmithyOrder, 'quality'>) => SMITHY.orderDays[o.quality] ?? 1;

/** Is the Smithy working on this order (it's among the first `workers` in the queue)? */
export const inProgress = (state: GameState, o: SmithyOrder) => state.smithyOrders.indexOf(o) < SMITHY.workers;

/** Cancel an order the Smithy hasn't started (full refund). Returns an error or null. */
export function cancelOrder(state: GameState, id: string): string | null {
  const o = state.smithyOrders.find((x) => x.id === id);
  if (!o) return 'No such order.';
  if (o.worked > 0) return 'The Smithy has already started on it.';
  state.smithyOrders = state.smithyOrders.filter((x) => x !== o);
  state.gold += o.paid;
  return null;
}

/**
 * Days until each order is ready (by id), counting the queue: the first `workers` orders are worked on every day,
 * and each one that's done frees a place for the next.
 */
export function orderEtas(state: GameState): Record<string, number> {
  const left = state.smithyOrders.map((o) => ({ id: o.id, days: orderDays(o) - o.worked }));
  const out: Record<string, number> = {};
  for (let day = 1; left.length && day < 10000; day++) {
    for (const o of left.slice(0, SMITHY.workers)) o.days -= 1;
    for (const o of left.filter((x) => x.days <= 0)) {
      out[o.id] = day;
      left.splice(left.indexOf(o), 1);
    }
  }
  return out;
}

/** A day of work at the Smithy (run at the start of each day): finished orders go to the stash. Returns messages. */
export function smithyDay(state: GameState): string[] {
  const out: string[] = [];
  for (const o of state.smithyOrders.slice(0, SMITHY.workers)) o.worked += 1;
  for (const o of state.smithyOrders.filter((x) => x.worked >= orderDays(x))) {
    state.smithyOrders = state.smithyOrders.filter((x) => x !== o);
    addItem(state, o.kind, gear(o.type, o.quality));
    out.push(`The Smithy finished your ${gearName(o, o.kind)} (now in the stash).`);
  }
  return out;
}
