// The party's stash and equipping (Manage Party > Equipment).
import { describe, expect, it } from 'vitest';
import type { Character, GameState } from '../src/data/types';
import { createCharacter, deriveStats, makeRng } from '../src/game/character';
import { newCampaign, sellSlave } from '../src/game/city';
import { leaveParty } from '../src/game/contracts';
import { gear } from '../src/game/gear';
import { addItem, equipBlock, equipItem, equipOwn, itemName, itemValue, returnGear, sortedInventory, statChanges, unequip } from '../src/game/inventory';
import { randomAdventurer } from '../src/game/people';
import { parseSave, serializeSave } from '../src/game/save';

const start = (): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(1));

function join(state: GameState, contract: Character['contract'], unarmed = false): Character {
  const c = randomAdventurer(3, makeRng(state.party.length + 7), { unarmed });
  c.contract = contract;
  state.party.push(c);
  return c;
}
const companion = (state: GameState) => join(state, { type: 'companion', basePay: 100, lootPct: 10, foodLodging: true, termWeeks: 4, startDay: 1, endDay: 29, relationship: 50, greed: 1 });
const slave = (state: GameState) => join(state, { type: 'slave', price: 800, origin: 'market', relationship: 50, obedience: 60 }, true);

describe('the stash', () => {
  it('starts empty; items are named, valued and sorted (weapons, then armor, best first)', () => {
    const s = start();
    expect(s.inventory).toEqual([]);
    addItem(s, 'armor', gear('plate', 'common'));
    addItem(s, 'weapon', gear('spear', 'crude'));
    addItem(s, 'weapon', gear('staff', 'fine'));
    addItem(s, 'weapon', gear('staff', 'masterwork'));
    expect(sortedInventory(s).map(itemName)).toEqual(['Crude Spear', 'Masterwork Staff', 'Fine Staff', 'Common Plate']); // equipment.json order: Spear before Staff
    expect(sortedInventory(s, 'armor').map(itemName)).toEqual(['Common Plate']);
    expect(itemValue(s.inventory[0])).toBe(100);
    expect(new Set(s.inventory.map((i) => i.id)).size).toBe(4);
  });

  it('equipping swaps: the item leaves the stash and the old piece goes in', () => {
    const s = start();
    const main = s.party[0];
    const fine = addItem(s, 'weapon', gear('greatsword', 'fine'));
    const before = deriveStats(main).pAtk;
    expect(statChanges(main, fine).find((x) => x.key === 'pAtk')).toEqual({ key: 'pAtk', before, after: Math.round((100 + 80) * 1.2) });
    expect(equipItem(s, main.id, fine.id)).toBeNull();
    expect(main.weapon).toEqual({ type: 'greatsword', quality: 'fine', issued: true });
    expect(s.inventory.map(itemName)).toEqual(['Crude Sword and Shield']);
    expect(equipItem(s, main.id, fine.id)).toMatch(/no longer in the stash/);
  });

  it('unequipping puts the piece in the stash and leaves Unarmed / No Armor', () => {
    const s = start();
    const main = s.party[0];
    expect(unequip(s, main.id, 'armor')).toBeNull();
    expect(main.armor).toBeNull();
    expect(s.inventory.map(itemName)).toEqual(['Crude Leather']);
    expect(unequip(s, main.id, 'armor')).toMatch(/no armor/);
    expect(deriveStats(main).health).toBe(450); // No Armor: 500 x 0.9
  });

  it("mercenaries keep their own gear", () => {
    const s = start();
    const merc = join(s, { type: 'mercenary', fee: 50, cutPct: 0 });
    const item = addItem(s, 'armor', gear('plate'));
    expect(equipBlock(merc)).toMatch(/own gear/);
    expect(equipItem(s, merc.id, item.id)).toMatch(/own gear/);
    expect(unequip(s, merc.id, 'weapon')).toMatch(/own gear/);
    expect(s.inventory).toHaveLength(1);
  });

  it("a companion who leaves hands back the party's gear and puts their own back on", () => {
    const s = start();
    const c = companion(s);
    const own = c.weapon;
    const ownArmor = { ...c.armor! };
    const plate = addItem(s, 'armor', gear('plate', 'fine'));
    equipItem(s, c.id, plate.id); // their own Leather goes into their pack, not the stash
    expect(s.inventory).toEqual([]);
    expect(c.ownGear).toEqual({ armor: ownArmor });
    leaveParty(s, c);
    expect(s.inventory.map(itemName)).toEqual(['Fine Plate']);
    const back = s.guild.pool.find((a) => a.character.id === c.id)!.character;
    expect([back.weapon, back.armor]).toEqual([own, ownArmor]);
    expect(back.ownGear).toBeUndefined();
    expect(s.log.at(-1)!.text).toMatch(/handed back the party's Fine Plate/);
  });

  it("a companion's own gear can't be taken: unequipped, it goes into their pack, and they can wear it again", () => {
    const s = start();
    const c = companion(s);
    const own = { ...c.weapon! };
    expect(unequip(s, c.id, 'weapon')).toBeNull();
    expect(s.inventory).toEqual([]);
    expect(c.weapon).toBeNull();
    expect(c.ownGear).toEqual({ weapon: own });
    const bow = addItem(s, 'weapon', gear('longbow', 'fine'));
    equipItem(s, c.id, bow.id);
    expect(equipOwn(s, c.id, 'weapon')).toBeNull();
    expect(c.weapon).toEqual(own);
    expect(c.ownGear).toBeUndefined();
    expect(s.inventory.map(itemName)).toEqual(['Fine Longbow']);
    // Their pack survives a save and load.
    unequip(s, c.id, 'weapon');
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.party.find((m) => m.id === c.id)!.ownGear).toEqual({ weapon: own });
  });

  it('a slave is sold without their gear', () => {
    const s = start();
    const sv = slave(s);
    const bow = addItem(s, 'weapon', gear('longbow', 'common'));
    equipItem(s, sv.id, bow.id);
    sellSlave(s, sv.id);
    expect(s.inventory.map(itemName)).toEqual(['Common Longbow']);
    const offer = s.market.slaves.find((o) => o.character.id === sv.id)!;
    expect(offer.character.weapon).toBeNull();
  });

  it('returnGear(all) takes everything, issued or not', () => {
    const s = start();
    const main = s.party[0];
    expect(returnGear(s, main)).toEqual([]); // nothing was issued
    expect(returnGear(s, main, true).map(itemName)).toEqual(['Crude Sword and Shield', 'Crude Leather']);
    expect([main.weapon, main.armor]).toEqual([null, null]);
  });

  it('survives a save and load; bad items are rejected; older saves have an empty stash', () => {
    const s = start();
    addItem(s, 'weapon', gear('dagger', 'masterwork'));
    const plate = addItem(s, 'armor', gear('plate'));
    equipItem(s, s.party[0].id, plate.id);
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.inventory).toEqual(s.inventory);
    expect(r.ok && r.state.party[0].armor).toEqual({ type: 'plate', quality: 'crude', issued: true });
    const file = JSON.parse(serializeSave(s));
    file.inventory[0].quality = 'goblin';
    const bad = parseSave(JSON.stringify(file));
    expect(!bad.ok && bad.error).toMatch(/inventory\[0\].quality/);
    delete file.inventory;
    const old = parseSave(JSON.stringify(file));
    expect(old.ok && old.state.inventory).toEqual([]);
  });
});
