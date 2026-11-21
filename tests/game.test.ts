import { describe, expect, it } from 'vitest';
import { SKILLS, WEAPONS } from '../src/data/content';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import type { Character } from '../src/data/types';
import { runAiTurn } from '../src/game/ai';
import { Battle, defenseMultiplier, deploymentTiles, generateEnemies, makeUnit, type Team } from '../src/game/battle';
import { createCharacter, deriveStats, grantXp, makeRng } from '../src/game/character';
import { generateMap, hasLineOfSight, passable, type BattleMap, type Point, type Terrain } from '../src/game/grid';
import { newGameState, parseSave, serializeSave } from '../src/game/save';

function openMap(w = 10, h = 7): BattleMap {
  return { width: w, height: h, tiles: Array.from({ length: h }, () => Array<Terrain>(w).fill('grass')) };
}

function hero(weaponId = 'sword_shield', skillIds: string[] = [], name = 'H'): Character {
  const c = createCharacter(name, '#3d7be0', weaponId);
  c.skillIds = skillIds;
  return c;
}

function setup(map: BattleMap, specs: { c: Character; team: Team; at: Point }[]) {
  const units = specs.map((s) => makeUnit(s.c, s.team, s.at));
  return { battle: new Battle(map, units, makeRng(1)), units };
}

describe('stats config', () => {
  it('loads the base stats from stats.json', () => {
    expect(STAT_CONFIG.base).toMatchObject({ health: 600, pAtk: 100, mAtk: 100, defense: 0, movement: 4 });
    expect(STAT_CONFIG.growthPerLevel.health).toBe(60);
  });

  it('rejects a broken config with a clear message', () => {
    expect(() => parseStatConfig({ base: { health: 'lots' }, growthPerLevel: {}, defenseScale: 100 })).toThrow(/base.health/);
  });

  it('adds weapon bonuses and automatic level growth', () => {
    const c = hero('sword_shield');
    expect(deriveStats(c)).toMatchObject({ health: 600, pAtk: 140, mAtk: 100, defense: 20, movement: 4 });
    c.weaponId = 'staff';
    expect(deriveStats(c)).toMatchObject({ pAtk: 110, mAtk: 150, defense: 0 });
    grantXp(c, 250);
    const g = STAT_CONFIG.growthPerLevel;
    expect(c.level).toBe(3);
    expect(deriveStats(c).health).toBe(600 + 2 * g.health);
  });

  it('defense: 100 points = double effective health', () => {
    expect(defenseMultiplier(0)).toBe(1);
    expect(defenseMultiplier(100)).toBe(0.5);
    expect(defenseMultiplier(200)).toBeCloseTo(1 / 3);
  });
});

describe('save files', () => {
  it('round-trips through human-readable JSON', () => {
    const state = newGameState();
    state.party.push(hero('bow', ['fireball', 'kick']));
    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(state);
  });

  it('reports precise errors for bad hand edits', () => {
    const state = newGameState();
    state.party.push(hero('staff', ['heal']));
    const file = JSON.parse(serializeSave(state));
    file.party[0].skillIds = ['direct_shot'];
    const r = parseSave(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('weapon skill');
  });

  it('upgrades version-1 saves (old classes) automatically', () => {
    const v1 = {
      format: 'lazyrpg-save', version: 1, savedAt: '', progress: { stage: 2, victories: 1, defeats: 0 },
      party: [{
        id: 'c_1', name: 'Old Cleric', classId: 'cleric', level: 2, xp: 10,
        attributes: { str: 4, dex: 3, int: 11, vit: 8, spd: 3 }, unspentPoints: 3, weaponId: 'mace',
        skillIds: ['heal', 'smite'], appearance: { color: '#3d7be0', emblem: 'circle' },
      }],
    };
    const r = parseSave(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.party[0]).toMatchObject({ name: 'Old Cleric', level: 2, weaponId: 'staff', skillIds: ['heal', 'cleanse'] });
  });
});

describe('ranges and targeting', () => {
  it('uses Euclidean range: 1.5 reaches diagonals, 1 does not', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canTarget(a, SKILLS.sword_slash, { x: 4, y: 4 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.slash_and_smash, { x: 4, y: 4 })).toBe(false);
    expect(battle.canTarget(a, SKILLS.slash_and_smash, { x: 4, y: 3 })).toBe(true);
  });

  it('direct shot needs line of sight, indirect does not', () => {
    const map = openMap();
    map.tiles[3][4] = 'rock';
    const { battle, units: [archer] } = setup(map, [
      { c: hero('bow'), team: 'player', at: { x: 2, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 6, y: 3 } },
    ]);
    expect(hasLineOfSight(map, { x: 2, y: 3 }, { x: 6, y: 3 })).toBe(false);
    expect(battle.canTarget(archer, SKILLS.direct_shot, { x: 6, y: 3 })).toBe(false);
    expect(battle.canTarget(archer, SKILLS.indirect_shot, { x: 6, y: 3 })).toBe(true);
    expect(battle.canTarget(archer, SKILLS.direct_shot, { x: 6, y: 1 })).toBe(true);
  });

  it('direct shot needs line of FIRE: units in between block it', () => {
    const { battle, units: [archer] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.canTarget(archer, SKILLS.direct_shot, { x: 5, y: 3 })).toBe(false);
    expect(battle.blockedTiles(archer, SKILLS.direct_shot)).toContainEqual({ x: 5, y: 3 });
    expect(battle.canTarget(archer, SKILLS.indirect_shot, { x: 5, y: 3 })).toBe(true);
    // Spells only need line of sight: units don't block them.
    const { battle: b2, units: [mage] } = setup(openMap(), [
      { c: hero('staff', ['arcane_bolt']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(b2.canTarget(mage, SKILLS.arcane_bolt, { x: 5, y: 3 })).toBe(true);
  });

  it('projectile spells need line of sight; heal, cleanse and arcane shift do not', () => {
    const map = openMap();
    map.tiles[3][3] = 'rock';
    const { battle, units: [m] } = setup(map, [
      { c: hero('staff', ['fireball', 'heal']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'player', at: { x: 5, y: 3 } },
    ]);
    for (const id of ['magic_bolt', 'arcane_bolt', 'fireball']) expect(battle.canTarget(m, SKILLS[id], { x: 5, y: 3 })).toBe(false);
    for (const id of ['heal', 'cleanse']) expect(battle.canTarget(m, SKILLS[id], { x: 5, y: 3 })).toBe(true);
  });

  it('empty tiles can be targeted; the action is still spent', () => {
    const { battle, units: [m] } = setup(openMap(), [
      { c: hero('staff'), team: 'player', at: { x: 0, y: 0 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.perform(m, 'magic_bolt', { x: 3, y: 0 })).toEqual([]);
    expect(m.acted).toBe(true);
  });
});

describe('skills', () => {
  it('sword slash deals 100% P.Atk reduced by Defense', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 2, y: 2 } },
    ]);
    battle.perform(a, 'sword_slash', { x: 2, y: 2 });
    // 140 P.Atk vs 20 Defense: 140 * 100/120 = 117
    expect(e.hp).toBe(600 - 117);
  });

  it('slash and smash hits twice, the second hit scaling with Defense', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    const events = battle.perform(a, 'slash_and_smash', { x: 2, y: 1 });
    // 80% of 140 = 112; 40% of 140 + 100% of 20 = 76
    expect(events.filter((e) => e.type === 'damage').map((e) => e.type === 'damage' && e.amount)).toEqual([112, 76]);
  });

  it('shield up absorbs damage until the next turn', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    battle.perform(a, 'shield_up', { x: 1, y: 1 });
    expect(battle.shieldOf(a)).toBe(60); // 10% of 600
    battle.endPhase();
    battle.perform(e, 'direct_shot', { x: 1, y: 1 }); // 140 * 100/120 = 117
    expect(battle.shieldOf(a)).toBe(0);
    expect(a.hp).toBe(600 - 57);
  });

  it('cooldown 1 means the skill cannot be used on the next turn', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 8, y: 5 } },
    ]);
    battle.perform(a, 'shield_up', { x: 1, y: 1 });
    battle.endPhase();
    battle.endPhase(); // next player turn
    expect(battle.isReady(a, 'shield_up')).toBe(false);
    battle.endPhase();
    battle.endPhase(); // the turn after
    expect(battle.isReady(a, 'shield_up')).toBe(true);
  });

  it('cooldown 2 skips the next two turns', () => {
    const { battle, units: [h] } = setup(openMap(), [
      { c: hero('staff', ['heal']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 8, y: 5 } },
    ]);
    battle.perform(h, 'heal', { x: 1, y: 1 });
    const readyByTurn: boolean[] = [];
    for (let t = 0; t < 3; t++) {
      battle.endPhase();
      battle.endPhase();
      readyByTurn.push(battle.isReady(h, 'heal'));
    }
    expect(readyByTurn).toEqual([false, false, true]);
  });

  it('spear thrust hits the first enemy in a line and knocks it back', () => {
    const { battle, units: [s, e] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    battle.perform(s, 'spear_thrust', { x: 2, y: 3 });
    expect(e.hp).toBe(600 - 150);
    expect(e).toMatchObject({ x: 4, y: 3 });
  });

  it('circle swing hits all 8 neighbours, allies included', () => {
    const { battle, units: [s, ally, foe] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'player', at: { x: 5, y: 4 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    battle.perform(s, 'circle_swing', { x: 4, y: 3 });
    expect(ally.hp).toBeLessThan(600);
    expect(foe.hp).toBeLessThan(600);
    expect(ally).toMatchObject({ x: 6, y: 5 });
    expect(foe).toMatchObject({ x: 2, y: 3 });
  });

  it('intercept stops a moving enemy; bow overwatch shoots without stopping', () => {
    const map = openMap();
    const { battle, units: [spear, mover] } = setup(map, [
      { c: hero('spear'), team: 'player', at: { x: 5, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    battle.perform(spear, 'intercept', { x: 7, y: 3 });
    battle.endPhase();
    // Walking left along row 3 enters the cone at (7,3) and is stopped there.
    const res = battle.move(mover, { x: 6, y: 3 });
    expect(res.interrupted).toBe(true);
    expect(mover).toMatchObject({ x: 7, y: 3 });
    expect(mover.hp).toBeLessThan(600);
    expect(spear.overwatch).toBeNull();

    const { battle: b2, units: [archer, runner] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    b2.perform(archer, 'overwatch', { x: 5, y: 3 });
    b2.endPhase();
    const r2 = b2.move(runner, { x: 5, y: 3 });
    expect(r2.interrupted).toBe(false);
    expect(r2.triggers).toHaveLength(1);
    expect(runner).toMatchObject({ x: 5, y: 3 });
  });

  it('fireball burns for 1% max health per stack per turn; cleanse removes it', () => {
    const { battle, units: [m, e, cleric] } = setup(openMap(), [
      { c: hero('staff', ['fireball']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 1 } },
      { c: hero('staff', ['cleanse']), team: 'enemy', at: { x: 6, y: 1 } },
    ]);
    battle.perform(m, 'fireball', { x: 4, y: 1 });
    const afterHit = e.hp;
    const events = battle.endPhase();
    expect(events[0]).toMatchObject({ type: 'damage', cause: 'burn', amount: 6 }); // 1% of 600
    expect(e.hp).toBe(afterHit - 6);
    battle.perform(cleric, 'cleanse', { x: 4, y: 1 });
    expect(e.statuses).toEqual([]);
  });

  it('charge dashes next to a distant enemy and strikes', () => {
    const { battle, units: [v, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['charge']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    battle.perform(v, 'charge', { x: 5, y: 3 });
    expect(Math.hypot(v.x - 5, v.y - 3)).toBeLessThanOrEqual(1.5);
    expect(e.hp).toBe(600 - 112);
  });

  it('kick is free: the unit can still act afterwards', () => {
    const { battle, units: [k] } = setup(openMap(), [
      { c: hero('sword_shield', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    battle.perform(k, 'kick', { x: 2, y: 1 });
    expect(k.acted).toBe(false);
    expect(battle.isReady(k, 'kick')).toBe(false);
    battle.perform(k, 'sword_slash', { x: 2, y: 1 });
    expect(k.acted).toBe(true);
  });

  it('execute adds 10% of missing health', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('bow', ['execute']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    e.hp = 200;
    battle.perform(a, 'execute', { x: 2, y: 1 });
    // 50% of 140 + 10% of 400 missing = 110
    expect(e.hp).toBe(90);
  });

  it('arcane shift teleports to an empty tile within 2.8', () => {
    const { battle, units: [m] } = setup(openMap(), [
      { c: hero('staff', ['arcane_shift']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canTarget(m, SKILLS.arcane_shift, { x: 3, y: 3 })).toBe(false); // 2.83 > 2.8
    battle.perform(m, 'arcane_shift', { x: 3, y: 2 });
    expect(m).toMatchObject({ x: 3, y: 2 });
  });
});

describe('frameworks (switched off in stats.json)', () => {
  const withRules = (patch: Partial<typeof STAT_CONFIG>) => ({ ...STAT_CONFIG, ...patch });

  it('hit chance: disabled = always 100%; enabled = base + accuracy - evasion, clamped', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 1 } },
    ]);
    expect(battle.hitChance(a, e, SKILLS.direct_shot)).toBe(100);
    const rules = withRules({ hitChance: { enabled: true, base: 70, min: 5, max: 95, reactionModifier: -10 } });
    const b2 = new Battle(openMap(), [a, e], makeRng(3), rules);
    a.stats.accuracy = 10;
    e.stats.evasion = 30;
    expect(b2.hitChance(a, e, SKILLS.direct_shot)).toBe(50);
    expect(b2.hitChance(a, e, SKILLS.direct_shot, true)).toBe(40);
    expect(b2.hitChance(a, e, SKILLS.heal)).toBe(100);
    e.stats.evasion = 500;
    expect(b2.hitChance(a, e, SKILLS.direct_shot)).toBe(5);
  });

  it('misses produce a miss event and deal no damage', () => {
    const rules = withRules({ hitChance: { enabled: true, base: 0, min: 0, max: 0, reactionModifier: 0 } });
    const a = makeUnit(hero('bow'), 'player', { x: 1, y: 1 });
    const e = makeUnit(hero(), 'enemy', { x: 4, y: 1 });
    const battle = new Battle(openMap(), [a, e], makeRng(3), rules);
    expect(battle.perform(a, 'direct_shot', { x: 4, y: 1 })).toEqual([expect.objectContaining({ type: 'miss' })]);
    expect(e.hp).toBe(600);
  });

  it('vision: disabled = see everything; enabled = vision range + line of sight', () => {
    const map = openMap(12, 3);
    map.tiles[1][6] = 'rock';
    const a = makeUnit(hero(), 'player', { x: 0, y: 1 });
    const near = makeUnit(hero(), 'enemy', { x: 4, y: 1 });
    const behindRock = makeUnit(hero(), 'enemy', { x: 7, y: 1 });
    const far = makeUnit(hero(), 'enemy', { x: 11, y: 0 });
    const off = new Battle(map, [a, near, behindRock, far], makeRng(1));
    expect([near, behindRock, far].every((u) => off.canSee('player', u))).toBe(true);
    const on = new Battle(map, [a, near, behindRock, far], makeRng(1), withRules({ vision: { enabled: true } }));
    expect(on.canSee('player', near)).toBe(true);
    expect(on.canSee('player', behindRock)).toBe(false);
    expect(on.canSee('player', far)).toBe(false);
  });
});

describe('battles', () => {
  it('teams alternate turns; every unit moves and acts once per turn', () => {
    const { battle, units: [a, b, e] } = setup(openMap(), [
      { c: hero(), team: 'player', at: { x: 0, y: 0 } },
      { c: hero('bow'), team: 'player', at: { x: 0, y: 2 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canAct(e)).toBe(false);
    battle.move(b, { x: 2, y: 2 });
    battle.move(a, { x: 1, y: 0 });
    battle.undoMove(b);
    battle.wait(a);
    battle.wait(b);
    expect(battle.readyUnits()).toEqual([]);
    battle.endPhase();
    expect(battle.canAct(e)).toBe(true);
    battle.endPhase();
    expect(battle.round).toBe(2);
  });

  it('every weapon has its skills defined', () => {
    for (const w of Object.values(WEAPONS)) for (const s of w.skills) expect(SKILLS[s]).toBeDefined();
  });

  it('AI vs AI battles always finish', () => {
    for (let seed = 0; seed < 16; seed++) {
      const rng = makeRng(seed);
      const map = generateMap(rng);
      const party = generateEnemies(1 + (seed % 3), 4, rng).slice(0, 4);
      const foes = generateEnemies(1 + (seed % 3), 4, rng);
      const pd = deploymentTiles(map, 'player', party.length);
      const ed = deploymentTiles(map, 'enemy', foes.length);
      const battle = new Battle(map, [
        ...party.map((c, i) => makeUnit(c, 'player', pd[i])),
        ...foes.map((c, i) => makeUnit(c, 'enemy', ed[i])),
      ], rng);
      while (!battle.outcome() && battle.round < 150) {
        for (const u of battle.readyUnits()) {
          if (u.alive && !battle.outcome()) runAiTurn(battle, u);
        }
        if (!battle.outcome()) battle.endPhase();
      }
      expect(battle.outcome()).not.toBeNull();
    }
  });

  it('generated maps keep deployment zones open', () => {
    for (let seed = 0; seed < 30; seed++) {
      const map = generateMap(makeRng(seed));
      for (const p of deploymentTiles(map, 'enemy', 6)) expect(passable(map, p.x, p.y)).toBe(true);
    }
  });
});
