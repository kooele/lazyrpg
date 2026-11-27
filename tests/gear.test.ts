// Equipment with the real numbers from equipment.json (game.test.ts pins gear for its own damage numbers).
import { describe, expect, it } from 'vitest';
import { ARMORS, QUALITIES, SKILLS, SKILL_TREES, WEAPONS } from '../src/data/content';
import { ENEMIES } from '../src/data/enemies';
import type { Character, Gear } from '../src/data/types';
import { Battle, isProjectile, makeEnemy, makeUnit, penLine, penetrate } from '../src/game/battle';
import { createCharacter, deriveStats, makeRng, sanitizeLoadout } from '../src/game/character';
import { newCampaign } from '../src/game/city';
import { armorName, enemyGearQuality, gear, gearName, weaponName } from '../src/game/gear';
import type { BattleMap, Terrain } from '../src/game/grid';
import { randomAdventurer } from '../src/game/people';
import { parseSave, serializeSave } from '../src/game/save';

const openMap = (w = 10, h = 7): BattleMap => ({ width: w, height: h, tiles: Array.from({ length: h }, () => Array<Terrain>(w).fill('grass')) });

/** A level-1 Adventurer with this weapon and armor ('' = none). */
function kit(weapon: string, armor = 'leather', quality = 'crude'): Character {
  const c = createCharacter('G', '#3d7be0', weapon, undefined, undefined, armor);
  if (c.weapon) c.weapon.quality = quality;
  if (c.armor) c.armor.quality = quality;
  c.morale = 100;
  return c;
}

describe('equipment data (Equipment Stats sheet)', () => {
  it('has every weapon with its range, base stats, modifiers and skills', () => {
    const row = (id: string) => ({ range: WEAPONS[id].range, base: WEAPONS[id].base, modifiers: WEAPONS[id].modifiers, skills: WEAPONS[id].skills });
    expect(row('staff')).toEqual({ range: 2, base: { pAtk: 10, mAtk: 20 }, modifiers: { pAtk: 0.8, mAtk: 1.2 }, skills: ['basic_attack', 'magic_bolt'] });
    expect(row('crystal')).toEqual({ range: 1.5, base: { pAtk: 5, mAtk: 20, mPen: 5 }, modifiers: { pAtk: 0.6, mPenPct: 50 }, skills: ['basic_attack', 'magic_bolt'] });
    expect(row('greatsword')).toEqual({ range: 1.5, base: { pAtk: 20, mAtk: 10 }, modifiers: { pAtk: 1.2, mAtk: 0.8 }, skills: ['basic_attack', 'circle_swing'] });
    expect(row('spear')).toEqual({ range: 2, base: { pAtk: 20, mAtk: 10 }, modifiers: { mAtk: 0.8 }, skills: ['basic_attack', 'circle_swing_spear'] });
    expect(row('sword_shield')).toEqual({ range: 1.5, base: { pAtk: 15, mAtk: 10, defense: 10 }, modifiers: { mAtk: 0.8 }, skills: ['basic_attack', 'shield_slam'] });
    expect(row('mace_shield')).toEqual({ range: 1.5, base: { pAtk: 15, mAtk: 10, defense: 10 }, modifiers: { pAtk: 0.8, mAtk: 0.8, pPenPct: 50 }, skills: ['basic_attack', 'shield_slam'] });
    expect(row('longbow')).toEqual({ range: 6, base: { pAtk: 20, mAtk: 10 }, modifiers: { mAtk: 0.8, movement: 0.8, pPenPct: 25 }, skills: ['bow_attack', 'switch_mode'] });
    expect(row('shortbow')).toEqual({ range: 5, base: { pAtk: 15, mAtk: 10, pPen: 5 }, modifiers: { mAtk: 0.8 }, skills: ['bow_attack', 'switch_mode'] });
    expect(row('dagger')).toEqual({ range: 1.5, base: { pAtk: 15, mAtk: 10, pPen: 5 }, modifiers: { mAtk: 0.8 }, skills: ['basic_attack', 'swap_crossbow'] });
    expect(row('twin_daggers')).toEqual({ range: 1.5, base: { pAtk: 15, mAtk: 10, pPen: 5 }, modifiers: { mAtk: 0.8 }, skills: ['basic_attack', 'quick_attack'] });
    expect(row('unarmed')).toEqual({ range: 1.5, base: {}, modifiers: { pAtk: 0.6 }, skills: ['basic_attack'] });
  });

  it('has the body armors and No Armor', () => {
    const row = (id: string) => ({ base: ARMORS[id].base, modifiers: ARMORS[id].modifiers });
    expect(row('leather')).toEqual({ base: { defense: 15, health: 75 }, modifiers: { mana: 0.9 } });
    expect(row('mail')).toEqual({ base: { defense: 15, health: 75 }, modifiers: { mana: 0.7, defense: 1.2, health: 1.2 } });
    expect(row('plate')).toEqual({ base: { defense: 15, health: 75 }, modifiers: { mana: 0.5, defense: 1.4, health: 1.4 } });
    expect(row('none')).toEqual({ base: {}, modifiers: { defense: 0.8, health: 0.8 } });
  });

  it('quality multiplies base stats 1 / 2 / 4 / 7 and sets the value', () => {
    expect(['crude', 'common', 'fine', 'masterwork'].map((q) => [QUALITIES[q].baseMultiplier, QUALITIES[q].value])).toEqual([[1, 20], [2, 100], [4, 500], [7, 2500]]);
    expect(QUALITIES.goblin).toMatchObject({ name: 'Goblin-Made', enemyOnly: true });
    expect(gearName(gear('mace_shield', 'masterwork'), 'weapon')).toBe('Masterwork Mace and Shield');
    expect(gearName(gear('plate', 'fine'), 'armor')).toBe('Fine Plate');
  });
});

describe('stats from gear', () => {
  it('adds base stats (x quality) first, then applies the modifiers', () => {
    // Staff: (100 + 10) x 0.8 P.Atk, (100 + 20) x 1.2 M.Atk. Leather: 500 + 75 Health, 20 + 15 Defense.
    expect(deriveStats(kit('staff'))).toMatchObject({ pAtk: 88, mAtk: 144, health: 575, defense: 35, movement: 16 });
    // Masterwork: base x7. Sword and Shield 15 x 7 = 105 P.Atk; Plate (20 + 70 shield + 105) x 1.4 Defense, (500 + 525) x 1.4 Health; armor costs mana, not Movement.
    expect(deriveStats(kit('sword_shield', 'plate', 'masterwork'))).toMatchObject({ pAtk: 205, defense: 273, health: 1435, movement: 16 });
    const mana = deriveStats(kit('staff', '')).mana;
    expect(['leather', 'mail', 'plate'].map((a) => deriveStats(kit('staff', a)).mana)).toEqual([0.9, 0.7, 0.5].map((m) => Math.round(mana * m)));
    // Shortbow: no Movement bonus any more; Longbow: x0.8 Movement and 25% P.Pen.
    expect(deriveStats(kit('shortbow', 'mail')).movement).toBe(16);
    expect(deriveStats(kit('longbow'))).toMatchObject({ movement: 13, pPenPct: 25 });
  });

  it('Unarmed: x0.6 P.Atk, no Movement bonus; No Armor: x0.8 Defense and Health, no mana penalty', () => {
    expect(deriveStats(kit('', ''))).toMatchObject({ pAtk: 60, mAtk: 100, defense: 16, health: 400, movement: 16 });
    expect(weaponName(kit('', ''))).toBe('Unarmed');
    expect(armorName(kit('', ''))).toBe('No Armor');
  });

  it('penetration: flat from base stats (x quality), percent from modifiers', () => {
    expect(deriveStats(kit('mace_shield'))).toMatchObject({ pPenPct: 50, pPen: 0, mPen: 0, mPenPct: 0 });
    expect(deriveStats(kit('dagger', 'leather', 'fine'))).toMatchObject({ pPen: 20, pPenPct: 0 });
    expect(deriveStats(kit('crystal', 'leather', 'masterwork'))).toMatchObject({ mPen: 35, mPenPct: 50 });
    expect(penLine(deriveStats(kit('mace_shield')))).toBe('P.Pen: 50% | 0');
    expect(penLine(deriveStats(kit('crystal')))).toBe('M.Pen: 50% | 5');
    expect(penLine(deriveStats(kit('spear')))).toBe('');
  });

  it("monsters have no gear and none of gear's penalties", () => {
    const wolf = makeEnemy('wolf', 3, makeRng(1));
    expect(wolf.weapon).toBeUndefined();
    expect(deriveStats(wolf).pAtk).toBe(ENEMIES.wolf.stats.pAtk);
    expect(weaponName(wolf)).toBe('');
  });
});

describe('penetration and forest', () => {
  it('percent applies before flat, and never takes Defense below 0', () => {
    expect(penetrate(100, 50, 10)).toBe(40);
    expect(penetrate(100, 0, 0)).toBe(100);
    expect(penetrate(5, 0, 10)).toBe(0);
    expect(penetrate(-10, 50, 10)).toBe(-10); // no effect below 0
    expect(penetrate(100, 150, 0)).toBe(0);
  });

  it('a mace hits through half the Defense; magic damage uses magic penetration', () => {
    const mace = makeUnit(kit('mace_shield'), 'player', { x: 3, y: 3 });
    const crystal = makeUnit(kit('crystal'), 'player', { x: 3, y: 4 });
    const target = makeUnit(kit('spear'), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [mace, crystal, target], makeRng(1));
    target.stats.defense = 100;
    expect(battle.effectiveDefense(mace, target, 'physical')).toBe(50);
    expect(battle.effectiveDefense(mace, target, 'magical')).toBe(100);
    expect(battle.effectiveDefense(crystal, target, 'magical')).toBe(45); // 100 x 50% - 5
    expect(battle.effectiveDefense(crystal, target, 'physical')).toBe(100);
    // 100 Defense = x0.5 damage; 50 Defense = x0.667.
    const pAtk = battle.stat(mace, 'pAtk');
    expect(battle.hitDamage(mace, target, { pAtk: 1 })).toBe(Math.round(pAtk * 100 / 150));
  });

  it('forest takes 20% off projectiles only', () => {
    const map = openMap();
    map.tiles[3][6] = 'forest';
    const archer = makeUnit(kit('longbow'), 'player', { x: 1, y: 3 });
    const mage = makeUnit(kit('staff'), 'player', { x: 2, y: 4 });
    const fighter = makeUnit(kit('spear'), 'player', { x: 5, y: 3 });
    const target = makeUnit(kit('spear', ''), 'enemy', { x: 6, y: 3 });
    const battle = new Battle(map, [archer, mage, fighter, target], makeRng(1));
    expect(battle.stat(target, 'defense')).toBe(16); // forest no longer adds Defense
    const shot = SKILLS.direct_shot;
    expect(isProjectile(shot)).toBe(true);
    expect(isProjectile(SKILLS.indirect_shot)).toBe(true);
    expect(isProjectile(SKILLS.magic_bolt)).toBe(true);
    expect(isProjectile(SKILLS.basic_attack)).toBe(false);
    const open = battle.hitDamage(archer, target, { pAtk: 1 });
    const sheltered = battle.hitDamage(archer, target, { pAtk: 1 }, true);
    // Crude Longbow: 120 P.Atk, 25% P.Pen; 16 Defense - 25% = 12 = x100/112; forest x0.8 (rounded once, at the end).
    expect(open).toBe(Math.round((120 * 100) / 112));
    expect(sheltered).toBe(Math.round(((120 * 100) / 112) * 0.8));
    expect(battle.previewHits(archer, SKILLS.bow_attack, target)).toEqual([sheltered]);
    expect(battle.previewHits(fighter, SKILLS.basic_attack, target)).toEqual([battle.hitDamage(fighter, target, { pAtk: 1 })]);
    const hp = target.hp;
    battle.perform(archer, 'bow_attack', { x: 6, y: 3 });
    expect(hp - target.hp).toBe(sheltered);
  });
});

describe('weapon skills', () => {
  it('Shield Slam: 60% P.Atk + 120% Def, ends the turn, 30 mana, 2-turn cooldown', () => {
    const u = makeUnit(kit('sword_shield'), 'player', { x: 3, y: 3 });
    const e = makeUnit(kit('spear', ''), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [u, e], makeRng(1));
    const want = battle.hitDamage(u, e, { pAtk: 0.6, def: 1.2 });
    // Crude Sword and Shield + Leather: P.Atk 115, Defense 20 + 10 + 15 = 45; the target (No Armor) has 16 Defense.
    expect(want).toBe(Math.round((0.6 * 115 + 1.2 * 45) * 100 / 116));
    const hp = e.hp;
    battle.perform(u, 'shield_slam', { x: 4, y: 3 });
    expect(hp - e.hp).toBe(want);
    expect(u).toMatchObject({ acted: true, ap: 0 });
    expect(u.mp).toBe(u.stats.mana - 30);
    expect(SKILLS.shield_slam.cooldown).toBe(2);
    expect(e.engagedWith).toBe(u.uid);
  });

  it('Quick Attack: 80% of the Basic Attack for 1 AP, so the turn goes on', () => {
    const u = makeUnit(kit('twin_daggers'), 'player', { x: 3, y: 3 });
    const e = makeUnit(kit('spear', ''), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [u, e], makeRng(1));
    const full = battle.previewHits(u, SKILLS.basic_attack, e)[0];
    const quick = battle.previewHits(u, SKILLS.quick_attack, e)[0];
    expect(quick).toBe(battle.hitDamage(u, e, { pAtk: 0.8 }));
    expect(quick).toBeLessThan(full);
    battle.perform(u, 'quick_attack', { x: 4, y: 3 });
    expect(u).toMatchObject({ ap: 1, acted: false });
    expect(u.mp).toBe(u.stats.mana - 20);
    battle.perform(u, 'basic_attack', { x: 4, y: 3 }); // turn-ending: uses whatever AP is left
    expect(u).toMatchObject({ ap: 0, acted: true });
  });

  it('Circle Swing belongs to the 2-handed weapons: weapon range for the greatsword, range - 0.5 at 125% for the spear', () => {
    expect(SKILL_TREES.find((t) => t.id === 'weapon_master')!.skills).toEqual(['double_strike', 'execute', 'power_strike', 'in_the_zone']);
    const u = makeUnit(kit('spear'), 'player', { x: 4, y: 3 });
    const near = makeUnit(kit('spear', ''), 'enemy', { x: 5, y: 4 });
    const far = makeUnit(kit('spear', ''), 'enemy', { x: 6, y: 3 });
    const battle = new Battle(openMap(), [u, near, far], makeRng(1));
    expect(battle.skillIds(u)).toContain('circle_swing_spear');
    expect(battle.skillFor(u, SKILLS.circle_swing_spear).aoeRadius).toBe(1.5);
    const dmg = battle.previewHits(u, SKILLS.circle_swing_spear, near)[0];
    expect(dmg).toBeCloseTo(battle.previewHits(u, battle.basicAttack(u), near)[0] * 1.25, -0.5);
    battle.perform(u, 'circle_swing_spear', { x: 4, y: 3 });
    expect(near.hp).toBeLessThan(near.stats.health);
    expect(far.hp).toBe(far.stats.health); // 2 tiles: in the spear's reach, outside Circle Swing's
    const gs = makeUnit(kit('greatsword'), 'player', { x: 4, y: 3 });
    expect(new Battle(openMap(), [gs], makeRng(1)).skillFor(gs, SKILLS.circle_swing).aoeRadius).toBe(WEAPONS.greatsword.range);
  });

  it('Swap to Crossbow (Dagger and Hand Crossbow): free; the next weapon attack shoots 4 tiles with +50% P.Pen, then the 3-turn cooldown starts', () => {
    expect(WEAPONS.dagger.name).toBe('Dagger and Hand Crossbow');
    expect(SKILLS.swap_crossbow).toMatchObject({ ap: 0, cooldown: 3, mana: 0, toggleStatus: 'hand_crossbow' });
    const map = openMap();
    const u = makeUnit(kit('dagger'), 'player', { x: 1, y: 3 });
    const e = makeUnit(kit('spear', ''), 'enemy', { x: 5, y: 3 });
    const hidden = makeUnit(kit('spear', ''), 'enemy', { x: 1, y: 6 });
    map.tiles[5][1] = 'rock'; // blocks the shot at (1,6)
    const battle = new Battle(map, [u, e, hidden], makeRng(1));
    expect(battle.canAim(u, SKILLS.basic_attack, e)).toBe(false);
    // Switching it on and off by hand costs nothing and starts no cooldown.
    battle.perform(u, 'swap_crossbow', u);
    battle.perform(u, 'swap_crossbow', u);
    expect(u.cooldowns.swap_crossbow ?? 0).toBe(0);
    expect(u.ap).toBe(2);
    battle.perform(u, 'swap_crossbow', u);
    expect(battle.skillRange(u, SKILLS.basic_attack)).toBe(4);
    expect(battle.canAim(u, SKILLS.basic_attack, e)).toBe(true);
    expect(battle.canAim(u, SKILLS.basic_attack, hidden)).toBe(false); // needs line of sight
    // 50% P.Pen on top of the dagger's own: 16 Defense - 50% - 5 flat = 3.
    const want = battle.hitDamage(u, e, { pAtk: 1 }, true, 50);
    expect(battle.previewHits(u, SKILLS.basic_attack, e)).toEqual([want]);
    const hp = e.hp;
    battle.perform(u, 'basic_attack', e);
    expect(hp - e.hp).toBe(want);
    expect(e.engagedWith).toBeFalsy();
    expect(battle.isToggledOn(u, 'hand_crossbow')).toBe(false);
    expect(u.cooldowns.swap_crossbow).toBe(3);
    expect(battle.skillRange(u, SKILLS.basic_attack)).toBe(1.5);
  });

  it('every weapon class has its skill', () => {
    const second = (id: string) => WEAPONS[id].skills[1];
    expect(['staff', 'crystal'].map(second)).toEqual(['magic_bolt', 'magic_bolt']);
    expect(['greatsword', 'spear'].map(second)).toEqual(['circle_swing', 'circle_swing_spear']);
    expect(['sword_shield', 'mace_shield'].map(second)).toEqual(['shield_slam', 'shield_slam']);
    expect(['longbow', 'shortbow'].map(second)).toEqual(['switch_mode', 'switch_mode']);
    expect(['dagger', 'twin_daggers'].map(second)).toEqual(['swap_crossbow', 'quick_attack']);
    for (const removed of ['shield_up', 'empowered_strike', 'sword_slash', 'spear_thrust']) expect(SKILLS[removed]).toBeUndefined();
  });
});

describe('who gets what gear', () => {
  it('new Adventurers start with a Crude weapon and Crude Leather; slaves and prisoners with nothing', () => {
    const c = createCharacter('New', '#3d7be0', 'greatsword');
    expect([c.weapon, c.armor]).toEqual([gear('greatsword'), gear('leather')]);
    const free = randomAdventurer(5, makeRng(2));
    expect(free.weapon?.quality).toBe('crude');
    expect(free.armor).toEqual(gear('leather'));
    const slave = randomAdventurer(5, makeRng(2), { unarmed: true });
    expect([slave.weapon, slave.armor]).toEqual([null, null]);
    const state = newCampaign(c, 'Testers', makeRng(4));
    expect(state.market.slaves.length).toBeGreaterThan(0);
    for (const o of state.market.slaves) expect([o.character.weapon, o.character.armor]).toEqual([null, null]);
  });

  it('human enemies wear Crude gear, Common with 3% per level; goblins, orcs and skeletons their own make', () => {
    const always = () => 0;
    const never = () => 0.999;
    expect(enemyGearQuality('crude', 10, always)).toBe('common');
    expect(enemyGearQuality('crude', 10, never)).toBe('crude');
    expect(enemyGearQuality('crude', 10, () => 0.29)).toBe('common'); // 30% at level 10
    expect(enemyGearQuality('crude', 10, () => 0.31)).toBe('crude');
    expect(enemyGearQuality('goblin', 30, always)).toBe('goblin');
    expect(makeEnemy('goblin', 5, makeRng(1)).weapon?.quality).toBe('goblin');
    expect(makeEnemy('orc', 9, makeRng(1)).weapon?.quality).toBe('orc');
    expect(makeEnemy('skeleton', 8, makeRng(1)).weapon?.quality).toBe('rusted');
    const knight = Array.from({ length: 40 }, (_, i) => makeEnemy('renegade', 20, makeRng(i))).find((e) => e.weapon?.type === 'mace_shield')!;
    expect(knight).toMatchObject({ name: 'Renegade Knight', armor: { type: 'plate' } });
  });

  it("party gear can't be an enemy-only quality or a built-in", () => {
    const c = kit('spear');
    c.weapon = { type: 'spear', quality: 'goblin' };
    c.armor = { type: 'none', quality: 'crude' };
    sanitizeLoadout(c);
    expect([c.weapon, c.armor]).toEqual([null, null]);
  });
});

describe('saves', () => {
  it('keep gear; older saves get a Crude weapon of their type and Crude Leather (slaves: none; slaves for sale: nothing)', () => {
    const main = createCharacter('Main', '#3d7be0', 'crystal', undefined, undefined, 'mail');
    main.weapon!.quality = 'fine';
    const state = newCampaign(main, 'Testers', makeRng(3));
    const r = parseSave(serializeSave(state));
    expect(r.ok && r.state.party[0]).toMatchObject({ weapon: { type: 'crystal', quality: 'fine' }, armor: { type: 'mail', quality: 'crude' } });

    const file = JSON.parse(serializeSave(state));
    const old = (c: Record<string, unknown>, weaponId: string) => {
      delete c.weapon;
      delete c.armor;
      c.weaponId = weaponId;
    };
    old(file.party[0], 'bow');
    file.party.push({ ...JSON.parse(JSON.stringify(file.party[0])), id: 'c_slave', name: 'Slave', contract: { type: 'slave', price: 500, origin: 'market', relationship: 50, obedience: 50 } });
    old(file.market.slaves[0].character, 'spear');
    file.version = 3;
    const r2 = parseSave(JSON.stringify(file));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const expectGear = (c: Character, weapon: Gear | null, armor: Gear | null) => expect([c.weapon, c.armor]).toEqual([weapon, armor]);
    expectGear(r2.state.party[0], gear('longbow'), gear('leather'));
    expectGear(r2.state.party.find((c) => c.id === 'c_slave')!, gear('longbow'), null);
    expectGear(r2.state.market.slaves[0].character, null, null);

    const bad = JSON.parse(serializeSave(state));
    bad.party[0].weapon.quality = 'goblin';
    const r3 = parseSave(JSON.stringify(bad));
    expect(!r3.ok && r3.error).toMatch(/party\[0\].weapon.quality/);
  });
});
