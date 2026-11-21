import { describe, expect, it } from 'vitest';
import skillsJson from '../src/data/skills.json';
import weaponsJson from '../src/data/weapons.json';
import { SKILLS, TREE_SKILLS, WEAPONS, parseContent, skillFormula } from '../src/data/content';
import enemiesJson from '../src/data/enemies.json';
import { parseEnemies } from '../src/data/enemies';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import type { Character } from '../src/data/types';
import { planTurn, runAiTurn, shouldDisengage, threatAt } from '../src/game/ai';
import { Battle, defenseMultiplier, deploymentTiles, enemyTypesForStage, generateEnemies, makeEnemy, makeUnit, victoryXp, type Team } from '../src/game/battle';
import { allSkills, createCharacter, deriveStats, grantXp, makeRng } from '../src/game/character';
import { generateMap, hasLineOfSight, passable, withinRange, type BattleMap, type Point, type Terrain } from '../src/game/grid';
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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Level-1 numbers used below: base Health 500, P.Atk 100, M.Atk 100, Defense 50.
// Sword & Shield: P.Atk 100, M.Atk 80, Def 75 (x0.571 damage). Others: Def 50 (x0.667 damage).

describe('stats and content files', () => {
  it('loads the base stats from stats.json', () => {
    expect(STAT_CONFIG.base).toMatchObject({ health: 500, pAtk: 100, mAtk: 100, defense: 50, movement: 16 });
    expect(STAT_CONFIG.growthPerLevel).toMatchObject({ health: 50, defense: 5 });
  });

  it('rejects a broken stats config with a clear message', () => {
    expect(() => parseStatConfig({ base: { health: 'lots' }, growthPerLevel: {}, defenseScale: 100 })).toThrow(/base.health/);
  });

  it('weapons multiply base stats; level growth is automatic', () => {
    const c = hero('sword_shield');
    expect(deriveStats(c)).toMatchObject({ health: 500, pAtk: 100, mAtk: 80, defense: 75, movement: 16 });
    c.weaponId = 'staff';
    expect(deriveStats(c)).toMatchObject({ pAtk: 50, mAtk: 120, defense: 50 });
    c.weaponId = 'bow';
    expect(deriveStats(c)).toMatchObject({ pAtk: 80, mAtk: 80 });
    grantXp(c, 250);
    expect(c.level).toBe(3);
    expect(deriveStats(c).health).toBe(600);
  });

  it('defense: 100 points = double effective health', () => {
    expect(defenseMultiplier(0)).toBe(1);
    expect(defenseMultiplier(100)).toBe(0.5);
  });

  it('skills.json and weapons.json are validated with precise errors', () => {
    const bad = clone(skillsJson) as Record<string, any>;
    bad.skills.kick.tags.push('flying');
    expect(() => parseContent(bad, weaponsJson)).toThrow(/skills.kick.tags\[3\].*"flying" is not defined/);
    const bad2 = clone(skillsJson) as Record<string, any>;
    bad2.skills.fireball.applyStatus[0].status = 'poison';
    expect(() => parseContent(bad2, weaponsJson)).toThrow(/fireball.applyStatus\[0\].status/);
    const badW = clone(weaponsJson) as Record<string, any>;
    badW.weapons.bow.statMultipliers.luck = 2;
    expect(() => parseContent(skillsJson, badW)).toThrow(/weapons.bow.statMultipliers.luck/);
  });

  it('every weapon grants defined skills; formulas are generated from the data', () => {
    for (const w of Object.values(WEAPONS)) for (const s of w.skills) expect(SKILLS[s]).toBeDefined();
    expect(skillFormula(SKILLS.slash_and_smash)).toBe('80% P.Atk, then 40% P.Atk + 100% Def');
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

  it('assigns a body model to saves made before unit art existed', () => {
    const state = newGameState();
    state.party.push(hero('bow'));
    const file = JSON.parse(serializeSave(state));
    delete file.party[0].appearance.model;
    const r = parseSave(JSON.stringify(file));
    expect(r.ok && r.state.party[0].appearance.model).toMatch(/^[mf][1-4]$/);
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
    if (r.ok) expect(r.state.party[0]).toMatchObject({ name: 'Old Cleric', weaponId: 'staff', skillIds: ['heal', 'cleanse'] });
  });
});

describe('ranges, lines and tags', () => {
  it('uses Euclidean range: 1.5 reaches diagonals, 1 does not', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canTarget(a, SKILLS.sword_slash, { x: 4, y: 4 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.slash_and_smash, { x: 4, y: 4 })).toBe(false);
  });

  it('ranges of 2+ use rounded distance; 1 and 1.5 stay exact', () => {
    const count = (r: number) => {
      let n = 0;
      for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) if ((x || y) && withinRange(Math.hypot(x, y), r)) n++;
      return n;
    };
    expect([count(1), count(1.5), count(2), count(5)]).toEqual([4, 8, 20, 96]);
  });

  it('direct shot needs line of sight; the line-of-fire rule (units block) is still available', () => {
    const map = openMap();
    const { battle, units: [archer] } = setup(map, [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(SKILLS.direct_shot.los).toBe('sight');
    expect(battle.canTarget(archer, SKILLS.direct_shot, { x: 5, y: 3 })).toBe(true); // units don't block sight
    const lineOfFire = { ...SKILLS.direct_shot, los: 'fire' as const };
    expect(battle.canTarget(archer, lineOfFire, { x: 5, y: 3 })).toBe(false);
    expect(battle.blockedTiles(archer, lineOfFire)).toContainEqual({ x: 5, y: 3 });
    map.tiles[3][3] = 'grass';
    map.tiles[2][3] = 'rock';
    expect(battle.canTarget(archer, SKILLS.direct_shot, { x: 5, y: 1 })).toBe(false); // rock blocks sight
  });

  it('projectile spells need line of sight; Freeze, heal and cleanse do not', () => {
    const map = openMap();
    map.tiles[3][3] = 'rock';
    const { battle, units: [m] } = setup(map, [
      { c: hero('staff', ['fireball', 'freeze']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    for (const id of ['magic_bolt', 'arcane_bolt', 'arcane_pulse', 'fireball']) expect(battle.canTarget(m, SKILLS[id], { x: 5, y: 3 })).toBe(false);
    for (const id of ['freeze', 'heal', 'cleanse']) expect(battle.canTarget(m, SKILLS[id], { x: 5, y: 3 })).toBe(true);
    expect(hasLineOfSight(map, { x: 1, y: 3 }, { x: 5, y: 3 })).toBe(false);
  });

  it('Movement tag: Charge range = Movement (Slow shrinks it); Arcane Shift is a fixed range 2', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['arcane_shift', 'charge']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('staff', ['freeze']), team: 'enemy', at: { x: 6, y: 1 } },
    ]);
    expect(battle.skillRange(m, SKILLS.charge)).toBe(4);
    expect(battle.skillRange(m, SKILLS.arcane_shift)).toBe(2);
    expect(battle.canTarget(m, SKILLS.arcane_shift, { x: 3, y: 2 })).toBe(true); // 2.24 rounds to 2
    expect(battle.canTarget(m, SKILLS.arcane_shift, { x: 3, y: 3 })).toBe(false); // 2.83 rounds to 3
    battle.wait(m);
    battle.endPhase();
    battle.perform(e, 'freeze', { x: 1, y: 1 });
    battle.endPhase();
    expect(battle.stat(m, 'movement')).toBe(12);
    expect(battle.skillRange(m, SKILLS.charge)).toBe(3); // 12 / 4 per tile
    expect(battle.skillRange(m, SKILLS.arcane_shift)).toBe(2);
  });

  it('Weapon tag: Execute uses the weapon range and needs a usable weapon', () => {
    const { battle, units: [archer, fighter] } = setup(openMap(), [
      { c: hero('bow', ['execute']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('sword_shield', ['execute']), team: 'player', at: { x: 1, y: 4 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    expect(battle.canTarget(archer, SKILLS.execute, { x: 5, y: 1 })).toBe(true); // bow range 5
    expect(battle.skillRange(fighter, SKILLS.execute)).toBe(1.5);
    archer.weaponDisabled = true;
    expect(battle.isUsable(archer, 'execute')).toBe(false);
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
  it('sword slash: 100% P.Atk reduced by Defense', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 2, y: 2 } },
    ]);
    battle.perform(a, 'sword_slash', { x: 2, y: 2 });
    expect(e.hp).toBe(500 - 57); // 100 x 100/175
  });

  it('slash and smash hits twice, the second hit scaling with Defense', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    const events = battle.perform(a, 'slash_and_smash', { x: 2, y: 1 });
    // 80 x 2/3 = 53; (40 + 75) x 2/3 = 77
    expect(events.filter((e) => e.type === 'damage').map((e) => e.type === 'damage' && e.amount)).toEqual([53, 77]);
  });

  it('cooldown 1 means the skill cannot be used on the next turn', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 8, y: 5 } },
    ]);
    battle.perform(a, 'shield_up', { x: 1, y: 1 });
    expect(battle.shieldOf(a)).toBe(50);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(a, 'shield_up')).toBe(false);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(a, 'shield_up')).toBe(true);
  });

  it('shields absorb damage first', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    battle.perform(a, 'shield_up', { x: 1, y: 1 });
    battle.endPhase();
    battle.perform(e, 'direct_shot', { x: 1, y: 1 }); // 80 x 100/175 = 46
    expect(battle.shieldOf(a)).toBe(4);
    expect(a.hp).toBe(500);
  });

  it('spear thrust uses normal range 2 and hits the first enemy on the way', () => {
    const { battle, units: [s, near, far] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.rangeTiles(s, SKILLS.spear_thrust)).toHaveLength(20);
    expect(battle.canTarget(s, SKILLS.spear_thrust, { x: 5, y: 2 })).toBe(true); // 2-over-1
    expect(battle.canTarget(s, SKILLS.spear_thrust, { x: 5, y: 1 })).toBe(false); // diagonal 2.83
    battle.perform(s, 'spear_thrust', { x: 5, y: 3 }); // aimed at the far one; the near one is in the way
    expect(near.hp).toBe(500 - 67);
    expect(near).toMatchObject({ x: 4, y: 3 }); // knockback blocked by the far one
    expect(far.hp).toBe(500);
  });

  it('spear thrust does not push the target', () => {
    const { battle, units: [s, e] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    battle.perform(s, 'spear_thrust', { x: 3, y: 3 });
    expect(e.hp).toBe(500 - 67);
    expect(e).toMatchObject({ x: 3, y: 3 });
  });

  it('arcane pulse knocks back 2 tiles', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['arcane_pulse']), team: 'player', at: { x: 2, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    expect(battle.canTarget(m, SKILLS.arcane_pulse, { x: 4, y: 3 })).toBe(false); // range 1.5
    battle.perform(m, 'arcane_pulse', { x: 3, y: 3 });
    expect(e).toMatchObject({ x: 5, y: 3 });
    expect(e.hp).toBe(500 - 80); // 120 x 2/3
  });

  it('circle swing hits all 8 neighbours, allies included', () => {
    const { battle, units: [s, ally, foe] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'player', at: { x: 5, y: 4 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    battle.perform(s, 'circle_swing', { x: 4, y: 3 });
    expect(ally.hp).toBeLessThan(500);
    expect(foe.hp).toBeLessThan(500);
    expect(ally).toMatchObject({ x: 6, y: 5 });
    expect(foe).toMatchObject({ x: 2, y: 3 });
  });

  it('intercept stops a moving enemy; bow overwatch shoots without stopping', () => {
    const { battle, units: [spear, mover] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 5, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    battle.perform(spear, 'intercept', { x: 7, y: 3 });
    battle.endPhase();
    const res = battle.move(mover, { x: 6, y: 3 });
    expect(res.interrupted).toBe(true);
    expect(mover).toMatchObject({ x: 7, y: 3, hp: 500 - 57 });

    const { battle: b2, units: [archer, runner] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    b2.perform(archer, 'overwatch', { x: 5, y: 3 });
    b2.endPhase();
    const r2 = b2.move(runner, { x: 5, y: 3 });
    expect(r2.interrupted).toBe(false);
    expect(r2.triggers).toHaveLength(1);
  });

  it('heal and cleanse work on enemies (and on yourself)', () => {
    const { battle, units: [h, e] } = setup(openMap(), [
      { c: hero('staff', ['heal', 'cleanse']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 1 } },
    ]);
    e.hp = 300;
    battle.perform(h, 'heal', { x: 4, y: 1 });
    expect(e.hp).toBe(300 + 96); // 80% of 120 M.Atk
    battle.endPhase();
    battle.endPhase();
    h.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 1, amount: 0, turns: 2, tick: 'start' });
    battle.perform(h, 'cleanse', { x: 1, y: 1 });
    expect(h.statuses).toEqual([]);
  });

  it('fireball burns 1% max health per stack per turn; cleanse removes it', () => {
    const { battle, units: [m, e, cleric] } = setup(openMap(), [
      { c: hero('staff', ['fireball']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 1 } },
      { c: hero('staff', ['cleanse']), team: 'enemy', at: { x: 6, y: 1 } },
    ]);
    battle.perform(m, 'fireball', { x: 4, y: 1 });
    const afterHit = e.hp;
    const events = battle.endPhase();
    expect(events[0]).toMatchObject({ type: 'damage', cause: 'status', amount: 5 });
    expect(e.hp).toBe(afterHit - 5);
    battle.perform(cleric, 'cleanse', { x: 4, y: 1 });
    expect(e.statuses).toEqual([]);
  });

  it('freeze slows the target for its next 2 turns', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['freeze']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    battle.perform(m, 'freeze', { x: 5, y: 1 });
    const moveOnEnemyTurns: number[] = [];
    for (let i = 0; i < 3; i++) {
      battle.endPhase(); // enemy turn
      moveOnEnemyTurns.push(battle.stat(e, 'movement'));
      battle.endPhase(); // player turn
    }
    expect(moveOnEnemyTurns).toEqual([12, 12, 16]);
  });

  it('charge dashes next to an enemy within Movement and strikes', () => {
    const { battle, units: [v, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['charge']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    battle.perform(v, 'charge', { x: 5, y: 3 });
    expect(Math.hypot(v.x - 5, v.y - 3)).toBeLessThanOrEqual(1.5);
    expect(e.hp).toBe(500 - 53);
  });

  it('kick is free: the unit can still act afterwards', () => {
    const { battle, units: [k] } = setup(openMap(), [
      { c: hero('sword_shield', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    battle.perform(k, 'kick', { x: 2, y: 1 });
    expect(k.acted).toBe(false);
    battle.perform(k, 'sword_slash', { x: 2, y: 1 });
    expect(k.acted).toBe(true);
  });

  it('free actions can be used after the main action, and keep the unit commandable', () => {
    const { battle, units: [k] } = setup(openMap(), [
      { c: hero('sword_shield', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    battle.perform(k, 'sword_slash', { x: 2, y: 1 });
    expect(k.acted).toBe(true);
    expect(battle.usableFreeActions(k)).toEqual(['kick']);
    expect(battle.commandableUnits()).toContain(k);
    battle.perform(k, 'kick', { x: 2, y: 1 });
    expect(battle.commandableUnits()).toEqual([]);
  });

  it("execute: 100% P.Atk + 15% of the target's missing health", () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['execute']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    e.hp = 200;
    battle.perform(a, 'execute', { x: 2, y: 1 });
    expect(e.hp).toBe(200 - 97); // (100 + 45) x 2/3
  });
});

describe('engagement', () => {
  function duel() {
    return setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 5 } },
      { c: hero('sword_shield'), team: 'player', at: { x: 2, y: 5 } },
    ]);
  }

  it('an Engage hit locks both units together', () => {
    const { battle, units: [a, e] } = duel();
    const events = battle.perform(a, 'sword_slash', { x: 4, y: 3 });
    expect(events).toContainEqual({ type: 'engage', source: a.uid, target: e.uid });
    expect(a.engagedWith).toBe(e.uid);
    expect(e.engagedWith).toBe(a.uid);
  });

  it('engagement does not change Defense or damage', () => {
    const { battle, units: [a, e] } = duel();
    battle.perform(a, 'sword_slash', { x: 4, y: 3 });
    expect(battle.stat(a, 'defense')).toBe(75);
    battle.endPhase();
    const before = a.hp;
    battle.perform(e, 'sword_slash', { x: 3, y: 3 });
    expect(before - a.hp).toBe(57); // 100 x 100/175, same as unengaged
  });

  it("engaged units can't move or attack anyone else; others can't steal the engagement", () => {
    const { battle, units: [a, e, archer, b] } = duel();
    battle.perform(a, 'sword_slash', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    expect(battle.canMove(a)).toBe(false);
    expect(battle.canTarget(a, SKILLS.sword_slash, { x: 4, y: 3 })).toBe(true);
    expect(battle.engagementBlock(a, SKILLS.sword_slash, { x: 3, y: 5 })).toMatch(/can't target anyone else/);
    // b attacks the already-engaged enemy: no new engagement.
    battle.move(b, { x: 4, y: 4 });
    battle.perform(b, 'sword_slash', { x: 4, y: 3 });
    expect(e.engagedWith).toBe(a.uid);
    expect(b.engagedWith).toBeNull();
    expect(archer.engagedWith).toBeNull();
  });

  it('disengaging gives the opponent a free basic attack, then the unit can move', () => {
    const { battle, units: [a, e] } = duel();
    battle.perform(a, 'sword_slash', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    const before = a.hp;
    const events = battle.disengage(a);
    expect(events[0]).toMatchObject({ type: 'disengage', reason: 'disengage' });
    expect(events[1]).toMatchObject({ type: 'damage', cause: 'opportunity', source: e.uid, amount: 57 });
    expect(a.hp).toBe(before - 57);
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
    expect(battle.canMove(a)).toBe(true);
  });

  it('a successful push breaks the engagement, even if the units stay adjacent', () => {
    const { units: [a, e] } = duel();
    const spear = makeUnit(hero('spear', [], 'S'), 'player', { x: 5, y: 4 });
    const b2 = new Battle(openMap(), [a, e, spear], makeRng(2));
    b2.perform(a, 'sword_slash', { x: 4, y: 3 });
    const events = b2.perform(spear, 'circle_swing', { x: 5, y: 4 }); // pushes the enemy to (3,2)
    expect(e).toMatchObject({ x: 3, y: 2 });
    expect(Math.hypot(e.x - a.x, e.y - a.y)).toBeLessThanOrEqual(1.5); // still next to each other
    expect(events).toContainEqual(expect.objectContaining({ type: 'disengage', reason: 'displaced' }));
    // Being pushed out counts as breaking away: the old opponent gets a free basic attack.
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', cause: 'opportunity', source: a.uid, target: e.uid }));
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
  });

  it('Arcane Shift escapes an engagement with no opportunity attack', () => {
    const { battle, units: [a, e] } = duel();
    a.character.skillIds = ['arcane_shift'];
    battle.perform(a, 'sword_slash', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    const hp = a.hp;
    const events = battle.perform(a, 'arcane_shift', { x: 1, y: 3 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'disengage', reason: 'escaped' }));
    expect(events.some((ev) => ev.type === 'damage')).toBe(false);
    expect(a.hp).toBe(hp);
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
    expect(a).toMatchObject({ x: 1, y: 3 });
  });

  it('engaged units can heal and cleanse themselves but no one else', () => {
    const { battle, units: [a, e, , ally] } = duel();
    a.character.weaponId = 'staff';
    a.character.skillIds = ['heal', 'cleanse'];
    battle.perform(a, 'empowered_strike', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    battle.endPhase();
    battle.endPhase();
    expect(a.engagedWith).toBe(e.uid);
    expect(battle.canTarget(a, SKILLS.heal, { x: ally.x, y: ally.y })).toBe(false);
    expect(battle.engagementBlock(a, SKILLS.heal, { x: 4, y: 3 })).toMatch(/can't target anyone else/);
    expect(battle.canTarget(a, SKILLS.heal, { x: 3, y: 3 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.cleanse, { x: ally.x, y: ally.y })).toBe(false);
    expect(battle.engagementBlock(a, SKILLS.cleanse, { x: 4, y: 3 })).toMatch(/can't target anyone else/);
    expect(battle.canTarget(a, SKILLS.cleanse, { x: 3, y: 3 })).toBe(true);
  });

  it('a blocked push keeps the engagement', () => {
    const { units: [a, e] } = duel();
    const mage = makeUnit(hero('staff', ['arcane_pulse'], 'M'), 'player', { x: 5, y: 3 });
    const b2 = new Battle(openMap(), [a, e, mage], makeRng(2));
    b2.perform(a, 'sword_slash', { x: 4, y: 3 });
    b2.perform(mage, 'arcane_pulse', { x: 4, y: 3 }); // pushed toward (3,3), where `a` stands
    expect(e).toMatchObject({ x: 4, y: 3 });
    expect(e.engagedWith).toBe(a.uid);
  });

  it('the AI breaks away with ranged units but holds the line with melee', () => {
    const { battle, units: [a, e, archer] } = duel();
    archer.x = 3; archer.y = 4;
    battle.perform(a, 'sword_slash', { x: 3, y: 4 });
    battle.endPhase();
    expect(shouldDisengage(battle, archer)).toBe(true);
    expect(shouldDisengage(battle, e)).toBe(false);
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
    const b2 = new Battle(openMap(), [a, e], makeRng(3), withRules({ hitChance: { enabled: true, base: 70, min: 5, max: 95, reactionModifier: -10 } }));
    a.stats.accuracy = 10;
    e.stats.evasion = 30;
    expect(b2.hitChance(a, e, SKILLS.direct_shot)).toBe(50);
    expect(b2.hitChance(a, e, SKILLS.direct_shot, true)).toBe(40);
    expect(b2.hitChance(a, e, SKILLS.heal)).toBe(100);
  });

  it('misses produce a miss event and deal no damage', () => {
    const rules = withRules({ hitChance: { enabled: true, base: 0, min: 0, max: 0, reactionModifier: 0 } });
    const a = makeUnit(hero('bow'), 'player', { x: 1, y: 1 });
    const e = makeUnit(hero(), 'enemy', { x: 4, y: 1 });
    const battle = new Battle(openMap(), [a, e], makeRng(3), rules);
    expect(battle.perform(a, 'direct_shot', { x: 4, y: 1 })).toEqual([expect.objectContaining({ type: 'miss' })]);
    expect(e.hp).toBe(500);
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

function randomParty(size: number, level: number, rng: () => number): Character[] {
  const weapons = Object.keys(WEAPONS);
  return Array.from({ length: size }, (_, i) => {
    const c = hero(weapons[Math.floor(rng() * weapons.length)], [], `P${i}`);
    c.level = level;
    const pool = [...TREE_SKILLS];
    while (c.skillIds.length < 2) c.skillIds.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return c;
  });
}

describe('enemies', () => {
  it('each stage uses the enemy types whose level range contains it', () => {
    const at = (stage: number) => enemyTypesForStage(stage).map((t) => `${t.type}:${t.level}`).sort();
    expect(at(1)).toEqual(['rat:1']);
    expect(at(2)).toEqual(['rat:2', 'slime:2']);
    expect(at(3)).toEqual(['slime:3', 'wolf:3']);
    expect(at(4)).toEqual(['bandit:4', 'wolf:4']);
    expect(at(5)).toEqual(['bandit:5']);
    expect(at(9)).toEqual(['bandit:5']); // past the last range: toughest type, capped level
  });

  it('enemy stats and skills come from enemies.json, growing within the level range', () => {
    const rat1 = makeEnemy('rat', 1, makeRng(1));
    const rat2 = makeEnemy('rat', 2, makeRng(1));
    expect(deriveStats(rat1)).toMatchObject({ health: 220, pAtk: 70, movement: 20 });
    expect(deriveStats(rat2)).toMatchObject({ health: 250, pAtk: 78 });
    expect(allSkills(rat1)).toEqual(['gnaw']);
    expect(allSkills(makeEnemy('slime', 2, makeRng(1)))).toEqual(['slam']);
    expect(allSkills(makeEnemy('slime', 3, makeRng(1)))).toEqual(['slam', 'sticky_spit']);
    expect(allSkills(makeEnemy('wolf', 4, makeRng(1)))).toEqual(['bite', 'pounce', 'howl']);
  });

  it('bandits carry a weapon: its skills come first and it names them', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = makeEnemy('bandit', 5, makeRng(seed));
      expect(WEAPONS[b.weaponId]).toBeDefined();
      expect(allSkills(b)[0]).toBe(WEAPONS[b.weaponId].skills[0]);
      expect(allSkills(b)).toContain('kick'); // unlocked at level 5
      expect(b.name).toMatch(/^Bandit /);
      // Only the weapon's basic attack: no Slash and Smash, Circle Swing, Intercept, Overwatch...
      const others = WEAPONS[b.weaponId].skills.slice(1);
      for (const s of others) if (s !== 'shield_up') expect(allSkills(b)).not.toContain(s);
    }
  });

  it('weak types come in bigger packs (threat budget)', () => {
    const rats = generateEnemies(1, 4, makeRng(3));
    expect(rats).toHaveLength(8); // 0.5 threat each, budget 4
    expect(rats.every((e) => e.enemyType === 'rat' && e.level === 1)).toBe(true);
    const wolvesOrBandits = generateEnemies(4, 4, makeRng(3));
    expect(wolvesOrBandits).toHaveLength(4);
    expect(generateEnemies(1, 1, makeRng(3))).toHaveLength(2);
  });

  it('enemies.json is validated with precise errors', () => {
    const bad = JSON.parse(JSON.stringify(enemiesJson));
    bad.enemies.rat.skills = ['laser_eyes'];
    expect(() => parseEnemies(bad)).toThrow(/enemies.rat.skills\[0\].*laser_eyes/);
  });

  it('monsters fight with their own basic attack and use their skills in battle', () => {
    const wolf = makeUnit(makeEnemy('wolf', 4, makeRng(1)), 'enemy', { x: 6, y: 3 });
    const a = makeUnit(hero(), 'player', { x: 1, y: 3 });
    const battle = new Battle(openMap(), [a, wolf], makeRng(1));
    expect(battle.basicAttack(wolf).id).toBe('bite');
    battle.endPhase();
    battle.perform(wolf, 'pounce', { x: 1, y: 3 }); // leaps 4 tiles (Movement 24 / 4 = 6 max)
    expect(a.hp).toBeLessThan(500);
    expect(a.engagedWith).toBe(wolf.uid);
  });
});

describe('progression and enemy behaviour', () => {
  it('each victory is worth a level, so a winning party is level 3 at stage 3', () => {
    const c = hero();
    for (let stage = 1; stage <= 2; stage++) grantXp(c, victoryXp(stage));
    expect(c.level).toBe(3);
  });

  it('badly hurt enemies retreat instead of trading blows; healthy ones attack', () => {
    const map = openMap(16, 7);
    const make = () => {
      const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 9, y: 3 });
      archer.character.weaponId = 'bow';
      const friend = makeUnit(makeEnemy('bandit', 4, makeRng(6)), 'enemy', { x: 15, y: 3 }); // a healthy ally to fall back on
      const knights = [2, 3, 4].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 2, y }));
      const battle = new Battle(map, [archer, friend, ...knights], makeRng(1));
      battle.endPhase(); // enemy turn
      return { battle, archer };
    };
    const healthy = make();
    const plan = planTurn(healthy.battle, healthy.archer);
    expect(plan.action).toBeDefined(); // shoots
    const hurt = make();
    hurt.archer.hp = Math.round(hurt.archer.stats.health * 0.2);
    const before = threatAt(hurt.battle, hurt.archer, hurt.archer);
    const flee = planTurn(hurt.battle, hurt.archer);
    expect(threatAt(hurt.battle, hurt.archer, flee.moveTo)).toBeLessThan(before);
    expect(flee.moveTo.x).toBeGreaterThan(9); // backs away toward its friend
  });

  it('a hurt unit with no healthy allies makes a last stand instead of running', () => {
    const map = openMap(16, 7);
    const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 9, y: 3 });
    archer.character.weaponId = 'bow';
    const knights = [2, 3, 4].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 6, y }));
    const battle = new Battle(map, [archer, ...knights], makeRng(1));
    battle.endPhase();
    archer.hp = Math.round(archer.stats.health * 0.2);
    expect(planTurn(battle, archer).action).toBeDefined();
    runAiTurn(battle, archer);
    expect(knights.some((k) => k.hp < k.stats.health)).toBe(true); // it fought
  });

  it('a badly hurt melee unit breaks out of an engagement to flee', () => {
    const wolf = makeUnit(makeEnemy('wolf', 3, makeRng(2)), 'enemy', { x: 5, y: 3 });
    const packMate = makeUnit(makeEnemy('wolf', 3, makeRng(3)), 'enemy', { x: 9, y: 6 });
    const a = makeUnit(hero(), 'player', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [a, wolf, packMate], makeRng(1));
    battle.perform(a, 'sword_slash', { x: 5, y: 3 });
    battle.endPhase();
    expect(shouldDisengage(battle, wolf)).toBe(false); // healthy: holds on
    wolf.hp = Math.round(wolf.stats.health * 0.3);
    expect(shouldDisengage(battle, wolf)).toBe(true);
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

  it('AI vs AI battles always finish', () => {
    for (let seed = 0; seed < 16; seed++) {
      const rng = makeRng(seed);
      const map = generateMap(rng);
      const party = randomParty(4, 1 + (seed % 3), rng);
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

  it('movement costs: grass 4, forest 6, river 8 points (Movement 16)', () => {
    const map = openMap(12, 3);
    map.tiles[1][2] = 'forest';
    map.tiles[1][3] = 'river';
    const { battle, units: [u] } = setup(map, [
      { c: hero(), team: 'player', at: { x: 0, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 11, y: 0 } },
    ]);
    const reach = battle.reachable(u);
    expect(reach.get('1,1')?.cost).toBe(4);
    expect(reach.get('2,1')?.cost).toBe(10); // + forest 6
    expect(reach.get('3,0')?.cost).toBe(16); // four grass tiles
    expect(reach.has('3,1')).toBe(false); // river: 4 + 6 + 8 = 18 > 16
  });

  it('generated maps use the configured size and keep deployment zones open', () => {
    for (let seed = 0; seed < 30; seed++) {
      const map = generateMap(makeRng(seed));
      expect([map.width, map.height]).toEqual([STAT_CONFIG.map.width, STAT_CONFIG.map.height]);
      for (const p of deploymentTiles(map, 'enemy', 6)) expect(passable(map, p.x, p.y)).toBe(true);
    }
  });
});
