import { describe, expect, it } from 'vitest';
import skillsJson from '../src/data/skills.json';
import weaponsJson from '../src/data/weapons.json';
import { SKILLS, TREE_SKILLS, WEAPONS, parseContent, skillFormula, skillPointsForLevel } from '../src/data/content';
import enemiesJson from '../src/data/enemies.json';
import { parseEnemies } from '../src/data/enemies';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import type { Character, SkillDef } from '../src/data/types';
import { planTurn, runAiTurn, shouldDisengage, threatAt } from '../src/game/ai';
import { Battle, defenseMultiplier, resistChance, deploymentTiles, enemyTypesForStage, generateEnemies, makeEnemy, makeUnit, victoryXp, type Team } from '../src/game/battle';
import { allSkills, bodyGain, skillBarLayout, swapBarSlots, bodyPoints as bodyPointsOf, bodyStats, createCharacter, deriveStats, freePoints, grantXp, isUnlocked, makeRng, pointsUsed, sanitizeLoadout } from '../src/game/character';
import { randomAdventurer } from '../src/game/people';
import { generateMap, hasLineOfSight, passable, withinRange, type BattleMap, type Point, type Terrain } from '../src/game/grid';
import { parseSave, serializeSave } from '../src/game/save';
import { advanceDays, newCampaign } from '../src/game/city';

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
    expect(() => parseContent(bad, weaponsJson)).toThrow(/skills.kick.tags\[2\].*"flying" is not defined/);
    const bad2 = clone(skillsJson) as Record<string, any>;
    bad2.skills.fireball.applyStatus[0].status = 'poison';
    expect(() => parseContent(bad2, weaponsJson)).toThrow(/fireball.applyStatus\[0\].status/);
    const badW = clone(weaponsJson) as Record<string, any>;
    badW.weapons.bow.statMultipliers.luck = 2;
    expect(() => parseContent(skillsJson, badW)).toThrow(/weapons.bow.statMultipliers.luck/);
  });

  it('every weapon grants defined skills; formulas are generated from the data', () => {
    for (const w of Object.values(WEAPONS)) for (const s of w.skills) expect(SKILLS[s]).toBeDefined();
    expect(skillFormula(SKILLS.execute)).toBe("100% P.Atk + 15% target's missing HP");
    expect(skillFormula(SKILLS.double_strike)).toBe('basic attack x2');
    expect(skillFormula(SKILLS.life_risking_strike)).toBe('250% P.Atk · you: Exposed (1 turn) · if it survives, you take 100% P.Atk');
  });
});

describe('save files', () => {
  const campaign = () => newCampaign(hero('bow', ['fireball', 'kick'], 'Main'), 'Testers', makeRng(5));

  it('round-trips through human-readable JSON', () => {
    const state = campaign();
    advanceDays(state, 10, makeRng(2));
    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(state);
  });

  it('points at the exact field when a hand edit is wrong', () => {
    const file = JSON.parse(serializeSave(campaign()));
    file.party[0].appearance.look.hair = 'mohawk';
    const r = parseSave(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/party\[0\]\.appearance\.look\.hair must be one of: /);
    const file2 = JSON.parse(serializeSave(campaign()));
    file2.mainId = 'nobody';
    const r2 = parseSave(JSON.stringify(file2));
    expect(!r2.ok && r2.error).toMatch(/mainId "nobody" is not in the party/);
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

  it('moves version-2 parties to Arch City: first member is the main character, the rest companions', () => {
    const v2 = {
      format: 'lazyrpg-save', version: 2, savedAt: '', progress: { stage: 3, victories: 2, defeats: 1 },
      party: [
        { id: 'c_a', name: 'Ada', level: 3, xp: 0, weaponId: 'bow', skillIds: ['kick'], appearance: { color: '#3d7be0', model: 'f2' } },
        { id: 'c_b', name: 'Bo', level: 3, xp: 0, weaponId: 'spear', skillIds: [], appearance: { color: '#36b37e', model: 'm3' } },
      ],
    };
    const r = parseSave(JSON.stringify(v2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.mainId).toBe('c_a');
    expect(r.state.party[0].contract).toEqual({ type: 'main' });
    expect(r.state.party[0].appearance.look).toMatchObject({ sex: 'female', hair: 'ponytail' });
    expect(r.state.party[1].contract?.type).toBe('companion');
    expect(r.state.lineup).toEqual(['c_a', 'c_b']);
    expect(r.state.progress).toEqual({ victories: 2, defeats: 1 });
  });
});

describe('ranges, lines and tags', () => {
  it('uses Euclidean range: 1.5 reaches diagonals, 1 does not', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canTarget(a, SKILLS.sword_slash, { x: 4, y: 4 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.kick, { x: 4, y: 4 })).toBe(true);
    expect(withinRange(Math.SQRT2, 1)).toBe(false);
  });

  it('attacks aimed straight at an ally hit them; lines pass allies they are not aimed at', () => {
    const { battle, units: [a, ally, foe] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'player', at: { x: 4, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.targetsOf(a, SKILLS.spear_thrust, { x: 5, y: 3 })).toEqual([foe]);
    expect(battle.targetsOf(a, SKILLS.spear_thrust, { x: 4, y: 3 })).toEqual([ally]);
    battle.perform(a, 'spear_thrust', { x: 4, y: 3 });
    expect(ally.hp).toBeLessThan(ally.stats.health);
    expect(ally.engagedWith).toBeNull();
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

  it('double strike hits with the weapon basic attack twice, at the weapon range', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['double_strike']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    const events = battle.perform(a, 'double_strike', { x: 2, y: 1 });
    // Sword Slash: 100 x 2/3 = 67, twice
    expect(events.filter((ev) => ev.type === 'damage').map((ev) => ev.type === 'damage' && ev.amount)).toEqual([67, 67]);
    expect(e.hp).toBe(500 - 134);
    // With a bow it reaches as far as the bow.
    const archer = setup(openMap(), [{ c: hero('bow', ['double_strike']), team: 'player', at: { x: 1, y: 1 } }]);
    expect(archer.battle.skillRange(archer.units[0], SKILLS.double_strike)).toBe(5);
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
    battle.perform(e, 'bow_attack', { x: 1, y: 1 }); // Direct mode: 80 x 100/175 = 46
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

  it('circle swing hits every unit within weapon range (allies too) with the basic attack and pushes them', () => {
    const { battle, units: [s, ally, foe, far] } = setup(openMap(), [
      { c: hero('spear', ['circle_swing']), team: 'player', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'player', at: { x: 5, y: 4 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 7, y: 3 } },
    ]);
    battle.perform(s, 'circle_swing', { x: 4, y: 3 });
    expect(ally.hp).toBeLessThan(500); // allies included
    expect(ally).toMatchObject({ x: 6, y: 5 });
    expect(foe.hp).toBe(500 - 67); // Spear Thrust's 100% P.Atk
    expect(foe).toMatchObject({ x: 2, y: 3 });
    expect(far.hp).toBe(500); // 3 tiles away: outside the spear's range 2
  });

  it('Overwatch (basic ability): 60° arc to weapon range, fires the basic attack without stopping; ends the turn', () => {
    const { battle: b2, units: [archer, runner] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    expect(WEAPONS.bow.skills).not.toContain('overwatch');
    expect(b2.skillIds(archer)).toContain('overwatch');
    b2.perform(archer, 'overwatch', { x: 5, y: 3 });
    expect(archer).toMatchObject({ acted: true, ap: 0 });
    expect(archer.overwatch!.tiles.has('6,3')).toBe(true); // Direct Shot range 5
    expect(archer.overwatch!.tiles.has('7,3')).toBe(false);
    b2.endPhase();
    const r2 = b2.move(runner, { x: 5, y: 3 });
    expect(r2.interrupted).toBe(false);
    expect(r2.triggers).toHaveLength(1);
    expect(runner).toMatchObject({ x: 5, y: 3, hp: 500 - 46 }); // Direct Shot: 80 P.Atk x 0.571

    // A spear's watch reaches as far as Spear Thrust (2).
    const { battle, units: [spear] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 5, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 9, y: 3 } },
    ]);
    battle.perform(spear, 'overwatch', { x: 7, y: 3 });
    expect([...spear.overwatch!.tiles].sort()).toEqual(['6,3', '7,2', '7,3', '7,4']); // range 2 rounds: 2-over-1-up is inside the arc
  });

  it('a turn-ending skill ends the turn: no free actions afterwards', () => {
    const { battle, units: [k] } = setup(openMap(), [
      { c: hero('sword_shield', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    battle.perform(k, 'kick', { x: 2, y: 1 }); // free: before the attack
    expect(k).toMatchObject({ ap: 2, acted: false });
    battle.perform(k, 'sword_slash', { x: 2, y: 1 });
    expect(k).toMatchObject({ ap: 0, acted: true });
    expect(battle.usableFreeActions(k)).toEqual([]);
    expect(battle.commandableUnits()).toEqual([]);
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
    expect(e.hp).toBe(500 - 67); // 100% P.Atk
    expect(v.acted).toBe(false); // 1 AP: the action AP is still there
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
    const spear = makeUnit(hero('sword_shield', ['circle_swing'], 'S'), 'player', { x: 5, y: 4 });
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

  it('engaged spears can Spear Thrust and Circle Swing their opponent, incl. diagonally', () => {
    for (const opp of [{ x: 4, y: 3 }, { x: 4, y: 4 }]) {
      const { battle, units: [a, e] } = setup(openMap(), [
        { c: hero('spear', ['circle_swing']), team: 'player', at: { x: 3, y: 3 } },
        { c: hero(), team: 'enemy', at: opp },
        { c: hero(), team: 'enemy', at: { x: 2, y: 3 } },
      ]);
      a.engagedWith = e.uid;
      e.engagedWith = a.uid;
      expect(battle.canTarget(a, SKILLS.spear_thrust, opp)).toBe(true);
      expect(battle.canTarget(a, SKILLS.spear_thrust, { x: 2, y: 3 })).toBe(false);
      expect(battle.canTarget(a, SKILLS.circle_swing, { x: 3, y: 3 })).toBe(true); // also hits the other enemy
    }
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.spear_thrust, { x: 5, y: 3 })).toBe(true); // range 2, through the opponent
  });

  it('an engaged unit can Charge its opponent but nobody else', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['charge']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 4 } },
      { c: hero(), team: 'enemy', at: { x: 6, y: 3 } },
    ]);
    a.character.level = 5;
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.charge, { x: 4, y: 4 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.charge, { x: 6, y: 3 })).toBe(false);
    expect(battle.canTarget(a, SKILLS.charge, { x: 3, y: 5 })).toBe(false);
    const hp = e.hp;
    battle.perform(a, 'charge', { x: 4, y: 4 });
    expect(e.hp).toBeLessThan(hp);
    expect(a).toMatchObject({ x: 3, y: 3 });
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
  });

  it('bandits use their own body models; monsters have monster art', () => {
    for (let i = 0; i < 20; i++) expect(['b1', 'b2', 'b3', 'b4']).toContain(makeEnemy('bandit', 4, makeRng(i)).appearance.model);
    expect(parseEnemies(enemiesJson).enemies.wolf.art).toMatchObject({ kind: 'wolf' });
    const bad = clone(enemiesJson);
    bad.enemies.bandit.art.models = ['zz'];
    expect(() => parseEnemies(bad)).toThrow(/enemies\.bandit\.art\.models\[0\]/);
  });

  it('Slime: Slam engages; Sticky Spit slows and cuts Defense by 25%', () => {
    const slime = makeUnit(makeEnemy('slime', 3, makeRng(1)), 'enemy', { x: 5, y: 3 });
    const a = makeUnit(hero('spear'), 'player', { x: 3, y: 3 });
    const b = makeUnit(hero('spear'), 'player', { x: 4, y: 4 });
    const battle = new Battle(openMap(), [a, b, slime], makeRng(1));
    battle.endPhase();
    a.stats.resist = 0; // no chance to shrug it off
    const def = battle.stat(a, 'defense');
    battle.perform(slime, 'sticky_spit', { x: 3, y: 3 });
    expect(battle.stat(a, 'defense')).toBe(Math.round(def * 0.75));
    expect(a.statuses.map((s) => s.id).sort()).toEqual(['corrode', 'slow']);
    expect(SKILLS.sticky_spit.cooldown).toBe(2);
    battle.endPhase();
    battle.endPhase();
    battle.perform(slime, 'slam', { x: 4, y: 4 });
    expect(slime.engagedWith).toBe(b.uid);
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

  it('a hurt unit with no healthy allies and no way out makes a last stand instead of running', () => {
    const map = openMap(30, 21);
    const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 15, y: 10 });
    archer.character.weaponId = 'bow';
    const knights = [9, 10, 11].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 12, y }));
    const battle = new Battle(map, [archer, ...knights], makeRng(1));
    battle.endPhase();
    archer.hp = Math.round(archer.stats.health * 0.2);
    expect(planTurn(battle, archer).action).toBeDefined();
    runAiTurn(battle, archer);
    expect(knights.some((k) => k.hp < k.stats.health)).toBe(true); // it fought
  });

  it('a badly hurt enemy that can reach the map edge flees the battle', () => {
    const rat = makeUnit(makeEnemy('rat', 1, makeRng(2)), 'enemy', { x: 2, y: 3 });
    const a = makeUnit(hero(), 'player', { x: 5, y: 3 });
    const battle = new Battle(openMap(), [rat, a], makeRng(1));
    battle.endPhase();
    rat.hp = Math.round(rat.stats.health * 0.2);
    runAiTurn(battle, rat);
    expect(rat.alive).toBe(false);
    expect(rat.escaped).toBe(true);
    expect(battle.outcome()).toBe('victory');
  });

  it('healthy weak enemies keep advancing even into a crowd', () => {
    const map = openMap(20, 7);
    const rat = makeUnit(makeEnemy('rat', 1, makeRng(2)), 'enemy', { x: 17, y: 3 });
    const heroes = [2, 3, 4].map((y) => makeUnit(hero('bow', [], `B${y}`), 'player', { x: 6, y }));
    const battle = new Battle(map, [rat, ...heroes], makeRng(1));
    battle.endPhase();
    runAiTurn(battle, rat);
    expect(rat.x).toBeLessThan(17);
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

describe('resist', () => {
  it('uses the Defense curve: 50 = 33%, 100 = 50%, 0 or less = never', () => {
    expect(STAT_CONFIG.base.resist).toBe(50);
    expect(STAT_CONFIG.growthPerLevel.resist).toBe(5);
    expect(resistChance(50)).toBeCloseTo(1 / 3);
    expect(resistChance(100)).toBe(0.5);
    expect(resistChance(0)).toBe(0);
    expect(resistChance(-20)).toBe(0);
    expect(deriveStats(hero()).resist).toBe(50);
  });

  it('debuffs are sometimes shrugged off (a resist event, no status); buffs and damage are not', () => {
    const a = makeUnit(hero('staff', ['fireball']), 'player', { x: 1, y: 3 });
    const e = makeUnit(hero(), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [a, e], makeRng(5));
    e.stats.resist = 100000; // ~100%
    const events = battle.perform(a, 'fireball', { x: 4, y: 3 });
    expect(events.some((ev) => ev.type === 'damage')).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'resist', name: 'Burn', chance: 100 }));
    expect(e.statuses).toHaveLength(0);
    expect(battle.resistChance(e)).toBe(100);
  });

  it('resists about as often as the chance says', () => {
    let resisted = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const a = makeUnit(hero('staff', ['fireball']), 'player', { x: 1, y: 3 });
      const e = makeUnit(hero(), 'enemy', { x: 4, y: 3 });
      e.hp = 1e9;
      const battle = new Battle(openMap(), [a, e], makeRng(i + 1));
      if (battle.perform(a, 'fireball', { x: 4, y: 3 }).some((ev) => ev.type === 'resist')) resisted += 1;
    }
    expect(resisted / n).toBeCloseTo(1 / 3, 1);
  });
});

describe('enemy threat (click an enemy in battle)', () => {
  it("shows a rat's move tiles and where its bite reaches from them", () => {
    const rat = makeUnit(makeEnemy('rat', 1, makeRng(1)), 'enemy', { x: 9, y: 6 });
    const hero1 = makeUnit(hero('bow'), 'player', { x: 1, y: 1 });
    const battle = new Battle(openMap(18, 13), [hero1, rat], makeRng(1));
    const t = battle.threat(rat);
    const has = (list: Point[], x: number, y: number) => list.some((p) => p.x === x && p.y === y);
    // Movement 20 on grass (cost 4) = 5 tiles; Gnaw reaches 1.5 (diagonals included).
    expect(t.skill?.id).toBe('gnaw');
    expect(has(t.move, 14, 6)).toBe(true);
    expect(has(t.move, 15, 6)).toBe(false);
    expect(has(t.attack, 15, 6)).toBe(true);
    expect(has(t.attack, 15, 7)).toBe(true);
    expect(has(t.attack, 16, 6)).toBe(false);
  });

  it('uses the longest-ranged hostile skill that is ready next turn', () => {
    const wolf = makeUnit(makeEnemy('wolf', 3, makeRng(1)), 'enemy', { x: 9, y: 6 });
    const battle = new Battle(openMap(18, 13), [makeUnit(hero(), 'player', { x: 1, y: 1 }), wolf], makeRng(1));
    expect(battle.threat(wolf).skill?.id).toBe('pounce');
    // Pounce used last enemy turn (cooldown 2 + 1): still 2 turns away on the player's turn -> not ready.
    wolf.cooldowns.pounce = 3;
    expect(battle.threat(wolf).skill?.id).toBe('bite');
    // One turn left: it ticks down at the start of the wolf's turn, so it's ready.
    wolf.cooldowns.pounce = 1;
    expect(battle.threat(wolf).skill?.id).toBe('pounce');
  });

  it("an engaged enemy can't move: only its own tile", () => {
    const rat = makeUnit(makeEnemy('rat', 1, makeRng(1)), 'enemy', { x: 5, y: 3 });
    const h = makeUnit(hero(), 'player', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [h, rat], makeRng(1));
    rat.engagedWith = h.uid;
    h.engagedWith = rat.uid;
    expect(battle.threat(rat).move).toEqual([{ x: 5, y: 3 }]);
  });
});

describe('skill points and the Body tab', () => {
  it('a skill point every level: 2 at level 1, +1 per level', () => {
    expect([1, 2, 3, 6, 10].map(skillPointsForLevel)).toEqual([2, 3, 4, 7, 11]);
  });

  it('each Body point adds 2x the base growth, before weapon multipliers and regardless of talent', () => {
    const c = createCharacter('B', '#3d7be0', 'sword_shield', undefined, { health: 'S', defense: 'F' });
    c.body = { health: 2, defense: 1 };
    expect(bodyGain('health')).toBe(100);
    expect(bodyGain('movement')).toBe(0);
    expect(bodyStats()).not.toContain('movement');
    // Level 1: 500 + 2 x 100; Defense (50 + 10) x 1.5 for the shield.
    expect(deriveStats(c)).toMatchObject({ health: 700, defense: 90 });
    expect(pointsUsed(c)).toBe(3);
    expect(freePoints(c)).toBe(-1); // level 1 has 2 points
    sanitizeLoadout(c);
    expect(freePoints(c)).toBe(0);
    expect(bodyPointsOf(c)).toBe(2);
  });

  it('saves keep Body points and reject over-spending', () => {
    const c = createCharacter('Main', '#3d7be0', 'bow');
    c.level = 3;
    c.skillIds = ['fireball'];
    c.body = { pAtk: 2, resist: 1 };
    const state = newCampaign(c, 'Testers', makeRng(2));
    const r = parseSave(serializeSave(state));
    expect(r.ok && r.state.party[0].body).toEqual({ pAtk: 2, resist: 1 });
    const file = JSON.parse(serializeSave(state));
    file.party[0].body.pAtk = 5;
    const bad = parseSave(JSON.stringify(file));
    expect(!bad.ok && bad.error).toMatch(/skill points/);
    file.party[0].body = { movement: 1 };
    const bad2 = parseSave(JSON.stringify(file));
    expect(!bad2.ok && bad2.error).toMatch(/body.movement/);
  });

  it('random adventurers spend all their points', () => {
    for (let s = 1; s < 20; s++) {
      const a = randomAdventurer(6, makeRng(s));
      expect(pointsUsed(a)).toBe(7);
    }
  });
});

describe('action points, mana and Dash', () => {
  const skill = (id: string, patch: Partial<SkillDef>) => ({ ...SKILLS[id], ...patch });

  it('2 AP a turn: moving uses the movement AP; a turn-ending skill uses the rest', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    expect(a).toMatchObject({ ap: 2, moved: false });
    battle.move(a, { x: 2, y: 1 });
    expect(a).toMatchObject({ ap: 1, moved: true, acted: false });
    expect(battle.canMove(a)).toBe(false);
    battle.perform(a, 'bow_attack', { x: 5, y: 1 });
    expect(a).toMatchObject({ ap: 0, acted: true });
    battle.endPhase();
    battle.endPhase();
    expect(a).toMatchObject({ ap: 2, moved: false, acted: false });
  });

  it('1 AP uses the movement AP first and keeps the turn going; 2 AP uses both but allows free actions', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('bow', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    const original = { ...SKILLS.bow_attack };
    try {
      Object.assign(SKILLS.bow_attack, skill('bow_attack', { ap: 1 }));
      battle.perform(a, 'bow_attack', { x: 2, y: 1 });
      expect(a).toMatchObject({ ap: 1, moved: true, acted: false }); // the movement AP went first
      expect(battle.canMove(a)).toBe(false);
      battle.perform(a, 'bow_attack', { x: 2, y: 1 });
      expect(a).toMatchObject({ ap: 0, acted: false });
      expect(battle.canUseSkill(a, 'bow_attack')).toBe(false);
      expect(battle.canUseSkill(a, 'kick')).toBe(true); // still a free action
      battle.endPhase();
      battle.endPhase();
      Object.assign(SKILLS.bow_attack, skill('bow_attack', { ap: 2 }));
      battle.move(a, { x: 1, y: 2 });
      expect(battle.canUseSkill(a, 'bow_attack')).toBe(false); // needs both AP
      battle.undoMove(a);
      expect(a.ap).toBe(2);
      battle.perform(a, 'bow_attack', { x: 2, y: 1 });
      expect(a).toMatchObject({ ap: 0, acted: false });
      expect(battle.canUseSkill(a, 'kick')).toBe(true);
    } finally {
      Object.assign(SKILLS.bow_attack, original);
    }
  });

  it('skills cost mana; without enough mana they are unusable', () => {
    expect(SKILLS.arcane_pulse.mana).toBe(40);
    expect(SKILLS.kick).toMatchObject({ mana: 10, ap: 0 });
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('staff', ['arcane_bolt']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 1 } },
    ]);
    expect(a.mp).toBe(200);
    battle.perform(a, 'arcane_bolt', { x: 4, y: 1 });
    expect(a.mp).toBe(180);
    battle.endPhase();
    battle.endPhase();
    a.mp = 19;
    expect(battle.canUseSkill(a, 'arcane_bolt')).toBe(false);
    expect(() => battle.perform(a, 'arcane_bolt', { x: 4, y: 1 })).toThrow(/mana/);
  });

  it('Dash: only after the regular move; uses the action AP, 20 mana and a 1-turn cooldown', () => {
    const { battle, units: [a] } = setup(openMap(18, 13), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 16, y: 11 } },
    ]);
    expect(battle.skillIds(a)).toContain('dash');
    expect(battle.canUseSkill(a, 'dash')).toBe(false); // regular move first
    battle.move(a, { x: 5, y: 1 });
    expect(battle.canUseSkill(a, 'dash')).toBe(true);
    expect(battle.canTarget(a, SKILLS.dash, { x: 9, y: 1 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.dash, { x: 10, y: 1 })).toBe(false); // Movement 16 = 4 tiles
    battle.dash(a, { x: 9, y: 1 });
    expect(a).toMatchObject({ x: 9, y: 1, ap: 0, mp: 180, acted: false });
    expect(battle.canUndoMove(a)).toBe(false);
    battle.endPhase();
    battle.endPhase();
    battle.move(a, { x: 9, y: 2 });
    expect(battle.canUseSkill(a, 'dash')).toBe(false); // cooldown: not the very next turn
    battle.endPhase();
    battle.endPhase();
    battle.move(a, { x: 9, y: 3 });
    expect(battle.canUseSkill(a, 'dash')).toBe(true);
  });
});

describe('skill bar', () => {
  it('defaults to basic attack, Overwatch, Dash, then the rest; padded to pages of 10', () => {
    const c = hero('bow', ['kick', 'execute']);
    expect(skillBarLayout(c).slice(0, 6)).toEqual(['bow_attack', 'overwatch', 'dash', 'switch_mode', 'kick', 'execute']);
    expect(skillBarLayout(c)).toHaveLength(10);
  });

  it('keeps the player layout; lost skills leave a gap and new ones go after the last used slot', () => {
    const c = hero('bow', ['kick']);
    swapBarSlots(c, 0, 7); // basic attack to slot 8
    expect(skillBarLayout(c)[7]).toBe('bow_attack');
    expect(skillBarLayout(c)[0]).toBeNull();
    c.level = 3;
    c.skillIds = ['execute']; // Kick unlearned, Execute learned
    const bar = skillBarLayout(c);
    expect(bar.indexOf('kick')).toBe(-1);
    expect(bar.indexOf('execute')).toBe(8); // after the last used slot (8)
    expect(bar.filter(Boolean)).toHaveLength(5);
  });

  it('more than 10 skills (or a drop past page 1) adds pages', () => {
    const c = hero('staff', ['arcane_bolt', 'arcane_pulse', 'arcane_shift', 'fireball', 'freeze', 'heal', 'cleanse']);
    c.level = 7;
    expect(skillBarLayout(c)).toHaveLength(20); // 2 weapon + 7 tree + 2 basic = 11
    const d = hero('bow');
    swapBarSlots(d, 1, 23);
    expect(skillBarLayout(d)).toHaveLength(30);
    expect(skillBarLayout(d)[23]).toBe('overwatch');
  });

  it('the layout is saved; unknown skills in a save become empty slots', () => {
    const c = createCharacter('Main', '#3d7be0', 'bow');
    swapBarSlots(c, 0, 4);
    const file = JSON.parse(serializeSave(newCampaign(c, 'Testers', makeRng(2))));
    expect(file.party[0].skillBar[4]).toBe('bow_attack');
    file.party[0].skillBar[1] = 'old_skill';
    const r = parseSave(JSON.stringify(file));
    expect(r.ok && r.state.party[0].skillBar![1]).toBeNull();
    expect(r.ok && skillBarLayout(r.state.party[0])[4]).toBe('bow_attack');
  });
});

describe('skill-sheet systems: level locks, Disengage and the new skills', () => {
  it('tree skills can need a minimum level: locked picks are dropped, NPCs only pick unlocked ones', () => {
    const c = hero('sword_shield', ['kick', 'charge']);
    expect(isUnlocked(c, 'kick')).toBe(true);
    expect(isUnlocked(c, 'charge')).toBe(false); // level 3
    sanitizeLoadout(c);
    expect(c.skillIds).toEqual(['kick']);
    const c3 = hero('sword_shield', ['kick', 'charge']);
    c3.level = 3;
    sanitizeLoadout(c3);
    expect(c3.skillIds).toEqual(['kick', 'charge']);
    for (let seed = 0; seed < 30; seed++) {
      for (const s of randomAdventurer(1, makeRng(seed)).skillIds) expect(SKILLS[s].level).toBe(1);
    }
  });

  it('saves with a skill above the character level load with that skill unlearned', () => {
    const state = newCampaign(hero('staff', ['fireball', 'arcane_pulse'], 'Main'), 'Testers', makeRng(5));
    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.party[0].skillIds).toEqual(['fireball']);
  });

  it('Engage locks onto an enemy without hitting it, for 1 AP', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['engage']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 4 } },
    ]);
    const events = battle.perform(a, 'engage', { x: 4, y: 4 });
    expect(events.some((ev) => ev.type === 'damage')).toBe(false);
    expect(a.engagedWith).toBe(e.uid);
    expect(e.engagedWith).toBe(a.uid);
    expect(a.acted).toBe(false);
    expect(a.mp).toBe(a.stats.mana - 10);
  });

  it('Disengage skills work while engaged, on anyone, and end the engagement with no free attack', () => {
    const { battle, units: [a, e, f] } = setup(openMap(), [
      { c: hero('staff', ['arcane_pulse']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.empowered_strike, { x: 2, y: 3 })).toBe(false); // not the opponent
    expect(battle.canTarget(a, SKILLS.arcane_pulse, { x: 2, y: 3 })).toBe(true);
    const hp = a.hp;
    const events = battle.perform(a, 'arcane_pulse', { x: 2, y: 3 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'disengage', reason: 'escaped' }));
    expect(events.some((ev) => ev.type === 'damage' && ev.cause === 'opportunity')).toBe(false);
    expect(a.hp).toBe(hp);
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
    expect(f).toMatchObject({ x: 0, y: 3 });
  });

  it('Pocket Sand blinds: -30% P.Atk and M.Atk through the enemy turn', () => {
    const map = openMap();
    const a = makeUnit(hero('sword_shield', ['pocket_sand']), 'player', { x: 1, y: 3 });
    const e = makeUnit(hero('bow'), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(map, [a, e], () => 0.99); // never resisted
    const before = battle.stat(e, 'pAtk');
    battle.perform(a, 'pocket_sand', { x: 4, y: 3 });
    expect(battle.stat(e, 'pAtk')).toBe(Math.round(before * 0.7));
    expect(a.acted).toBe(false); // 1 AP
    battle.endPhase(); // enemy turn: still blinded
    expect(battle.stat(e, 'pAtk')).toBe(Math.round(before * 0.7));
    battle.endPhase(); // the enemy's turn ended: gone
    expect(battle.stat(e, 'pAtk')).toBe(before);
  });

  it('Shadow Step slips out of an engagement and Stealths you until your next turn', () => {
    const { battle, units: [a, e, archer] } = setup(openMap(), [
      { c: hero('sword_shield', ['shadow_step']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.shadow_step, { x: 1, y: 3 })).toBe(false); // 2 tiles: too far
    const events = battle.perform(a, 'shadow_step', { x: 2, y: 2 });
    expect(events.some((ev) => ev.type === 'damage')).toBe(false);
    expect(a).toMatchObject({ x: 2, y: 2, engagedWith: null, acted: false });
    expect(battle.isStealthed(a)).toBe(true);
    battle.endPhase();
    expect(battle.targetsOf(archer, SKILLS.bow_attack, { x: 2, y: 2 })).toEqual([]);
    battle.endPhase();
    expect(battle.isStealthed(a)).toBe(false);
  });

  it('attacking ends Stealth early', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield', ['shadow_step']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    battle.perform(a, 'shadow_step', { x: 4, y: 3 });
    expect(battle.isStealthed(a)).toBe(true);
    battle.perform(a, 'sword_slash', { x: 5, y: 3 });
    expect(battle.isStealthed(a)).toBe(false);
  });

  it('Flicker Strike teleports next to an enemy up to 3 tiles away and engages it', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['flicker_strike']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    expect(battle.canTarget(a, SKILLS.flicker_strike, { x: 5, y: 1 })).toBe(false); // 4.5 tiles
    expect(battle.canTarget(a, SKILLS.flicker_strike, { x: 3, y: 1 })).toBe(false); // nobody there
    const events = battle.perform(a, 'flicker_strike', { x: 4, y: 3 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'move', kind: 'teleport' }));
    expect(a).toMatchObject({ x: 3, y: 3 });
    expect(e.hp).toBe(500 - 67);
    expect(a.engagedWith).toBe(e.uid);
  });

  it('Life-Risking Strike: 250% P.Atk with no Defense until your next turn; costs you if the target survives', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['life_risking_strike']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(a, 'life_risking_strike', { x: 4, y: 3 });
    expect(e.hp).toBe(500 - 143); // 250 x 100/175
    expect(battle.stat(a, 'defense')).toBe(0);
    expect(a.hp).toBe(500 - 100); // 100% of own P.Atk, no Defense
    battle.endPhase();
    battle.endPhase();
    expect(battle.stat(a, 'defense')).toBe(75);

    const kill = setup(openMap(), [
      { c: hero('sword_shield', ['life_risking_strike']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    kill.units[1].hp = 50;
    kill.battle.perform(kill.units[0], 'life_risking_strike', { x: 4, y: 3 });
    expect(kill.units[1].alive).toBe(false);
    expect(kill.units[0].hp).toBe(500);
  });
});

describe('bow modes and damage types', () => {
  it('Switch Mode cycles the bow Direct -> Indirect -> Melee for free; the basic attack follows', () => {
    const map = openMap(14, 7);
    const { battle, units: [a, e] } = setup(map, [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 7, y: 3 } },
    ]);
    expect(battle.modeName(a)).toBe('Direct');
    expect(battle.skillRange(a, SKILLS.bow_attack)).toBe(5);
    expect(battle.canTarget(a, SKILLS.bow_attack, { x: 7, y: 3 })).toBe(false); // 6 tiles
    const ev = battle.perform(a, 'switch_mode', { x: 1, y: 3 });
    expect(ev).toContainEqual({ type: 'mode', target: a.uid, name: 'Indirect' });
    expect(a).toMatchObject({ ap: 2, acted: false }); // free
    expect(battle.skillRange(a, SKILLS.bow_attack)).toBe(7.5); // weapon range 5 x 1.5
    expect(battle.skillLos(a, SKILLS.bow_attack)).toBeUndefined(); // arcs over cover
    battle.perform(a, 'bow_attack', { x: 7, y: 3 });
    expect(e.hp).toBe(500 - 32); // 70% of 80 P.Atk x 100/175
    battle.endPhase();
    battle.endPhase();
    battle.perform(a, 'switch_mode', { x: 1, y: 3 });
    expect(battle.modeName(a)).toBe('Melee');
    expect(battle.skillRange(a, SKILLS.bow_attack)).toBe(1.5);
    expect(battle.previewHits(a, SKILLS.bow_attack, e)).toEqual([37]); // 80% of 80 x 100/175
    battle.perform(a, 'switch_mode', { x: 1, y: 3 });
    expect(battle.modeName(a)).toBe('Direct');
    // Switch Mode never keeps a turn open on its own.
    expect(battle.usableFreeActions(a)).toEqual([]);
  });

  it('Overwatch and Weapon skills use the current bow mode; Circle Swing always swings in Melee mode', () => {
    const { battle, units: [a, foe] } = setup(openMap(14, 7), [
      { c: hero('bow', ['execute', 'circle_swing']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 4 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 6, y: 3 } },
    ]);
    expect(battle.coneRadius(a, SKILLS.overwatch)).toBe(5);
    expect(battle.skillRange(a, SKILLS.execute)).toBe(5);
    battle.perform(a, 'switch_mode', { x: 3, y: 3 }); // Indirect
    expect(battle.coneRadius(a, SKILLS.overwatch)).toBe(7.5);
    expect(battle.skillRange(a, SKILLS.execute)).toBe(7.5);
    // Circle Swing in Indirect mode still uses Melee: 1.5 tiles, 80% P.Atk.
    expect(battle.areaTiles(a, SKILLS.circle_swing, a)).toHaveLength(8);
    const events = battle.perform(a, 'circle_swing', { x: 3, y: 3 });
    expect(events.filter((ev) => ev.type === 'damage')).toEqual([expect.objectContaining({ target: foe.uid, amount: 37, damageType: 'physical' })]);
  });

  it('hits are split into Physical (P.Atk, Def, missing HP) and Magical (M.Atk) damage', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['fireball']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    const bolt = battle.perform(m, 'magic_bolt', { x: 3, y: 3 }).filter((ev) => ev.type === 'damage');
    // 50% of 50 P.Atk and 50% of 120 M.Atk, each x 100/175
    expect(bolt).toEqual([
      expect.objectContaining({ damageType: 'physical', amount: 14 }),
      expect.objectContaining({ damageType: 'magical', amount: 34 }),
    ]);
    expect(battle.previewHits(m, SKILLS.magic_bolt, e)).toEqual([48]);
    battle.endPhase();
    battle.endPhase();
    const fire = battle.perform(m, 'fireball', { x: 3, y: 3 }).filter((ev) => ev.type === 'damage');
    expect(fire.every((ev) => ev.type === 'damage' && ev.damageType === 'magical')).toBe(true);
  });

  it('skills are tagged Physical / Magical to match the damage their hits deal', () => {
    for (const s of Object.values(SKILLS)) {
      const hits = [...(s.hits ?? []), ...(s.recoilIfSurvives ? [s.recoilIfSurvives] : [])];
      const physical = hits.some((h) => h.pAtk || h.def || h.missingHp);
      const magical = hits.some((h) => h.mAtk);
      expect([s.id, s.tags.includes('physical')]).toEqual([s.id, physical]);
      expect([s.id, s.tags.includes('magical')]).toEqual([s.id, magical]);
    }
  });
});
