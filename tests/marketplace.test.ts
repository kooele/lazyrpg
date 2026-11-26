// The Marketplace: the party's stall, sold from the top by companions and slaves on Marketplace duty.
import { describe, expect, it } from 'vitest';
import type { Character, GameState } from '../src/data/types';
import { makeEnemy } from '../src/game/battle';
import { createCharacter, makeRng } from '../src/game/character';
import { advanceDays, newCampaign } from '../src/game/city';
import { activityOf, canDoActivity } from '../src/game/condition';
import { gear } from '../src/game/gear';
import { addItem, itemName, makeLoot } from '../src/game/inventory';
import { enemyLoot } from '../src/game/loot';
import { listItems, marketplaceDay, moveGroup, saleGroups, unlistItems } from '../src/game/marketplace';
import { randomAdventurer } from '../src/game/people';
import { parseSave, serializeSave } from '../src/game/save';

const start = (): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(1));
function slave(s: GameState): Character {
  const c = randomAdventurer(3, makeRng(s.party.length + 3), { unarmed: true });
  c.contract = { type: 'slave', price: 800, origin: 'market', relationship: 50, obedience: 60 };
  s.party.push(c);
  return c;
}
const junk = (s: GameState, name: string, value: number) => {
  const i = makeLoot('junk', name, value, 'test');
  s.inventory.push(i);
  return i;
};

describe('the Marketplace', () => {
  it('only companions and slaves can mind the stall', () => {
    const s = start();
    const main = s.party[0];
    const sv = slave(s);
    expect(canDoActivity(main, 'marketplace')).toBe(false);
    expect(canDoActivity(sv, 'marketplace')).toBe(true);
    s.schedule[main.id] = 'marketplace'; // e.g. a hand-edited save: falls back to the default
    expect(activityOf(s, main)).not.toBe('marketplace');
  });

  it('items move from the stash to the sale list and back; trophies stay out', () => {
    const s = start();
    const a = junk(s, 'Wolf Pelt', 18);
    const bow = addItem(s, 'weapon', gear('longbow', 'common'));
    const trophy = enemyLoot(makeEnemy('wolf', 4, makeRng(1)), () => 0.9)[0];
    s.inventory.push(trophy);
    expect(listItems(s, [trophy.id])).toMatch(/Trophies/);
    expect(listItems(s, [a.id, bow.id])).toBeNull();
    expect(s.marketplace.map(itemName)).toEqual(['Wolf Pelt', 'Common Longbow']);
    expect(s.inventory.map(itemName)).toEqual(['Wolf Fang']);
    unlistItems(s, [bow.id]);
    expect(s.marketplace.map(itemName)).toEqual(['Wolf Pelt']);
    expect(s.inventory.map(itemName)).toEqual(['Wolf Fang', 'Common Longbow']);
  });

  it('identical neighbours group up; groups move up, down and to the top', () => {
    const s = start();
    const ids = [junk(s, 'Wolf Pelt', 18), junk(s, 'Wolf Pelt', 18), junk(s, 'Goblin Spear', 23), junk(s, 'Slime Gel', 9)].map((i) => i.id);
    listItems(s, ids);
    const names = () => saleGroups(s).map((g) => `${itemName(g.item)} x${g.ids.length}`);
    expect(names()).toEqual(['Wolf Pelt x2', 'Goblin Spear x1', 'Slime Gel x1']);
    moveGroup(s, 0, 1);
    expect(names()).toEqual(['Goblin Spear x1', 'Wolf Pelt x2', 'Slime Gel x1']);
    moveGroup(s, 2, 'top');
    expect(names()).toEqual(['Slime Gel x1', 'Goblin Spear x1', 'Wolf Pelt x2']);
    moveGroup(s, 0, -1); // already at the top
    expect(names()[0]).toBe('Slime Gel x1');
  });

  it('each seller sells 2 items a day from the top, at full value', () => {
    const s = start();
    const a = slave(s);
    const b = slave(s);
    listItems(s, [junk(s, 'A', 10), junk(s, 'B', 20), junk(s, 'C', 30), junk(s, 'D', 40), junk(s, 'E', 50)].map((i) => i.id));
    const gold = s.gold;
    expect(marketplaceDay(s, [a])).toBe('Sold at the Marketplace for 30 gold: A, B.');
    expect(s.gold).toBe(gold + 30);
    expect(marketplaceDay(s, [a, b])).toBe('Sold at the Marketplace for 120 gold: C, D, E. The stall is empty now.');
    expect(marketplaceDay(s, [a])).toMatch(/minded an empty stall/);
    expect(marketplaceDay(s, [])).toBeNull();
  });

  it('runs with the day: members on Marketplace duty sell, those away on a quest don\'t', () => {
    const s = start();
    const sv = slave(s);
    s.schedule[sv.id] = 'marketplace';
    listItems(s, [junk(s, 'A', 10), junk(s, 'B', 20), junk(s, 'C', 30)].map((i) => i.id));
    const lines = advanceDays(s, 1, makeRng(2));
    expect(lines.join(' ')).toContain('Sold at the Marketplace for 30 gold: A, B.');
    expect(s.marketplace.map(itemName)).toEqual(['C']);
    // Away on a quest: no sales that day.
    s.lastQuestDay = s.day;
    s.questMembers = [sv.id];
    expect(advanceDays(s, 1, makeRng(3)).join(' ')).not.toMatch(/Sold at the Marketplace/);
    expect(s.marketplace.map(itemName)).toEqual(['C']);
  });

  it('the sale list survives a save and load', () => {
    const s = start();
    listItems(s, [junk(s, 'Wolf Pelt', 18).id]);
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.marketplace).toEqual(s.marketplace);
    const file = JSON.parse(serializeSave(s));
    delete file.marketplace;
    const old = parseSave(JSON.stringify(file));
    expect(old.ok && old.state.marketplace).toEqual([]);
  });
});
