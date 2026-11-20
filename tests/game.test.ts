import { describe, expect, it } from 'vitest';
import { createCharacter, deriveStats, grantXp, makeRng } from '../src/game/character';
import { parseSave, serializeSave, newGameState } from '../src/game/save';
import { Battle, deploymentTiles, generateEnemies, makeUnit, ATTACK_ID, getAction } from '../src/game/battle';
import { generateMap, passable, type BattleMap } from '../src/game/grid';
import { planTurn } from '../src/game/ai';
import type { Terrain } from '../src/game/grid';

function openMap(w = 8, h = 6): BattleMap {
  return { width: w, height: h, tiles: Array.from({ length: h }, () => Array<Terrain>(w).fill('grass')) };
}

describe('characters', () => {
  it('weapon bonuses change derived stats', () => {
    const c = createCharacter('Ada', 'knight');
    const sword = deriveStats(c);
    c.weaponId = 'greataxe';
    const axe = deriveStats(c);
    expect(axe.physPower).toBeGreaterThan(sword.physPower);
    expect(axe.speed).toBe(sword.speed - 2);
  });

  it('levels up and grants attribute points', () => {
    const c = createCharacter('Ada', 'mage');
    c.unspentPoints = 0;
    expect(grantXp(c, 250)).toBe(2);
    expect(c.level).toBe(3);
    expect(c.xp).toBe(50);
    expect(c.unspentPoints).toBe(6);
  });
});

describe('save files', () => {
  it('round-trips through human-readable JSON', () => {
    const state = newGameState();
    state.party.push(createCharacter('Ada', 'cleric', '#36b37e'));
    state.progress.stage = 3;
    const text = serializeSave(state);
    expect(text).toContain('\n  "party": [');
    const parsed = parseSave(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(state);
  });

  it('reports precise errors for bad hand edits', () => {
    const state = newGameState();
    state.party.push(createCharacter('Ada', 'mage'));
    const file = JSON.parse(serializeSave(state));
    file.party[0].weaponId = 'longsword';
    const r1 = parseSave(JSON.stringify(file));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('party[0].weaponId');

    file.party[0].weaponId = 'wand';
    file.party[0].skillIds = ['fireball', 'lightning', 'frost_nova'];
    const r2 = parseSave(JSON.stringify(file));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('level 1 allows 2');

    expect(parseSave('{oops').ok).toBe(false);
  });
});

describe('battle rules', () => {
  it('cannot walk through enemies', () => {
    const map = openMap(5, 1);
    const a = makeUnit(createCharacter('A', 'ranger'), 'player', { x: 0, y: 0 });
    const b = makeUnit(createCharacter('B', 'knight'), 'enemy', { x: 1, y: 0 });
    const battle = new Battle(map, [a, b], makeRng(1));
    const reach = battle.reachable(a);
    expect([...reach.keys()]).toEqual(['0,0']);
  });

  it('heals never exceed max HP and cooldowns tick down', () => {
    const map = openMap();
    const healer = createCharacter('H', 'cleric');
    healer.skillIds = ['heal', 'smite'];
    const h = makeUnit(healer, 'player', { x: 0, y: 0 });
    const e = makeUnit(createCharacter('E', 'knight'), 'enemy', { x: 7, y: 5 });
    const battle = new Battle(map, [h, e], makeRng(2));
    while (battle.active !== h) battle.endTurn();
    h.hp -= 3;
    const events = battle.perform(h, 'heal', { x: 0, y: 0 });
    expect(events[0]).toMatchObject({ type: 'heal', amount: 3 });
    expect(h.hp).toBe(h.base.maxHp);
    expect(battle.isReady(h, 'heal')).toBe(false);
    battle.endTurn();
    while (battle.active !== h) battle.endTurn();
    expect(battle.isReady(h, 'heal')).toBe(true);
  });

  it('area skills hit every foe in the radius', () => {
    const map = openMap();
    const mage = createCharacter('M', 'mage');
    mage.skillIds = ['fireball'];
    const m = makeUnit(mage, 'player', { x: 0, y: 0 });
    const e1 = makeUnit(createCharacter('E1', 'knight'), 'enemy', { x: 3, y: 0 });
    const e2 = makeUnit(createCharacter('E2', 'knight'), 'enemy', { x: 3, y: 1 });
    const e3 = makeUnit(createCharacter('E3', 'knight'), 'enemy', { x: 6, y: 5 });
    const battle = new Battle(map, [m, e1, e2, e3], makeRng(3));
    const hit = battle.affected(m, getAction(m, 'fireball'), { x: 3, y: 0 });
    expect(hit.map((u) => u.character.name).sort()).toEqual(['E1', 'E2']);
    expect(battle.affected(m, getAction(m, ATTACK_ID), { x: 6, y: 5 })).toEqual([]);
  });

  it('generated maps keep deployment zones open', () => {
    for (let seed = 0; seed < 30; seed++) {
      const map = generateMap(makeRng(seed));
      expect(deploymentTiles(map, 'player', 4)).toHaveLength(4);
      expect(deploymentTiles(map, 'enemy', 6)).toHaveLength(6);
      for (const p of deploymentTiles(map, 'enemy', 6)) expect(passable(map, p.x, p.y)).toBe(true);
    }
  });

  it('AI vs AI battles always finish', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = makeRng(seed);
      const map = generateMap(rng);
      const party = (['knight', 'ranger', 'mage', 'cleric'] as const).map((cls, i) => {
        const c = createCharacter(`P${i}`, cls);
        c.attributes.vit += 4;
        c.attributes[cls === 'mage' || cls === 'cleric' ? 'int' : 'str'] += 4;
        return c;
      });
      const foes = generateEnemies(1 + (seed % 4), party.length, rng);
      const units = [
        ...party.map((c, i) => makeUnit(c, 'player', deploymentTiles(map, 'player', 4)[i])),
        ...foes.map((c, i) => makeUnit(c, 'enemy', deploymentTiles(map, 'enemy', foes.length)[i])),
      ];
      const battle = new Battle(map, units, rng);
      let turns = 0;
      while (!battle.outcome() && turns < 500) {
        const u = battle.active;
        const plan = planTurn(battle, u);
        if (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y) battle.move(u, plan.moveTo);
        if (plan.action) battle.perform(u, plan.action.id, plan.action.target);
        battle.endTurn();
        turns++;
      }
      expect(battle.outcome()).not.toBeNull();
    }
  });
});
