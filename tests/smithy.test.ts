// The Smithy: Common gear on the spot, Fine and Masterwork to order, three orders worked at a time.
import { describe, expect, it } from 'vitest';
import { SMITHY } from '../src/data/content';
import type { GameState } from '../src/data/types';
import { createCharacter, makeRng } from '../src/game/character';
import { advanceDays, newCampaign } from '../src/game/city';
import { itemName } from '../src/game/inventory';
import { buyGear, buyPrice, cancelOrder, inProgress, orderEtas, orderGear, orderOptions, smithyDay } from '../src/game/smithy';
import { parseSave, serializeSave } from '../src/game/save';

const start = (gold = 10000): GameState => {
  const s = newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(1));
  s.gold = gold;
  return s;
};

describe('the Smithy', () => {
  it('sells Common gear for 100 and takes Fine (500, 5 days) and Masterwork (2500, 25 days) orders, 3 at a time', () => {
    expect(buyPrice()).toBe(100);
    expect(orderOptions()).toEqual([{ quality: 'fine', price: 500, days: 5 }, { quality: 'masterwork', price: 2500, days: 25 }]);
    expect(SMITHY.workers).toBe(3);
  });

  it('buying puts a Common piece in the stash at once', () => {
    const s = start(150);
    expect(buyGear(s, 'weapon', 'greatsword')).toBeNull();
    expect(buyGear(s, 'armor', 'plate')).toMatch(/Not enough gold/);
    expect(s.gold).toBe(50);
    expect(s.inventory.map(itemName)).toEqual(['Common Greatsword']);
    expect(buyGear(s, 'weapon', 'unarmed')).toMatch(/doesn't make/);
  });

  it('orders are paid up front and arrive in the stash after their days of work', () => {
    const s = start();
    expect(orderGear(s, 'weapon', 'longbow', 'fine')).toBeNull();
    expect(orderGear(s, 'weapon', 'longbow', 'common')).toMatch(/doesn't take orders/);
    expect(s.gold).toBe(9500);
    expect(orderEtas(s)[s.smithyOrders[0].id]).toBe(5);
    const msgs = advanceDays(s, 4, makeRng(2));
    expect(s.inventory).toEqual([]);
    expect(msgs.join(' ')).not.toMatch(/Smithy finished/);
    expect(advanceDays(s, 1, makeRng(3)).join(' ')).toContain('The Smithy finished your Fine Longbow');
    expect(s.inventory.map(itemName)).toEqual(['Fine Longbow']);
    expect(s.smithyOrders).toEqual([]);
  });

  it('works on 3 orders at a time; the 4th waits for a free place', () => {
    const s = start();
    for (const t of ['staff', 'spear', 'dagger', 'crystal']) orderGear(s, 'weapon', t, 'fine');
    orderGear(s, 'armor', 'plate', 'masterwork');
    expect(s.smithyOrders.map((o) => inProgress(s, o))).toEqual([true, true, true, false, false]);
    const etas = orderEtas(s);
    expect(s.smithyOrders.map((o) => etas[o.id])).toEqual([5, 5, 5, 10, 30]);
    for (let d = 0; d < 5; d++) smithyDay(s);
    expect(s.inventory.map(itemName)).toEqual(['Fine Staff', 'Fine Spear', 'Fine Dagger and Hand Crossbow']);
    expect(s.smithyOrders.map((o) => o.worked)).toEqual([0, 0]);
    smithyDay(s);
    expect(s.smithyOrders.map((o) => o.worked)).toEqual([1, 1]);
  });

  it('an order not yet started can be cancelled for a full refund', () => {
    const s = start();
    for (const t of ['staff', 'spear', 'dagger', 'crystal']) orderGear(s, 'weapon', t, 'fine');
    smithyDay(s);
    const [first, , , queued] = s.smithyOrders;
    expect(cancelOrder(s, first.id)).toMatch(/already started/);
    const gold = s.gold;
    expect(cancelOrder(s, queued.id)).toBeNull();
    expect(s.gold).toBe(gold + 500);
    expect(s.smithyOrders).toHaveLength(3);
  });

  it('orders survive a save and load; older saves have none', () => {
    const s = start();
    orderGear(s, 'armor', 'mail', 'masterwork');
    smithyDay(s);
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.smithyOrders).toEqual(s.smithyOrders);
    const file = JSON.parse(serializeSave(s));
    delete file.smithyOrders;
    const old = parseSave(JSON.stringify(file));
    expect(old.ok && old.state.smithyOrders).toEqual([]);
  });
});
