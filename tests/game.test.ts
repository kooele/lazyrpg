import { describe, expect, it } from 'vitest';
import skillsJson from '../src/data/skills.json';
import equipmentJson from '../src/data/equipment.json';
import { ARMORS, SKILLS, STATUSES, TREE_SKILLS, WEAPONS, maxBodyRank, modeWithTag, parseContent, resolveWeaponSkill, skillEffect, skillPointsForLevel, skillStatText, skillStats, xpToNext } from '../src/data/content';
import enemiesJson from '../src/data/enemies.json';
import { ENEMIES, parseEnemies } from '../src/data/enemies';
import statsJson from '../src/data/stats.json';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import type { Character, SkillDef } from '../src/data/types';
import { HOLD_FIRM_ODDS, bestAction, caution, holdsFirm, planTurn, preferredMode, runAiTurn, shouldDisengage, shouldSurrender, sideStrength, threatAt, tribeRouted, wantsToFlee, watchesForOverwatch } from '../src/game/ai';
import { Battle, defenseMultiplier, resistChance, deploymentTiles, enemyTypesForStage, generateEnemies, makeEnemy, pickFoes, makeUnit, statEffectPct, statText, type Team } from '../src/game/battle';
import { allSkills, bodyGain, skillBarLayout, swapBarSlots, bodyPoints as bodyPointsOf, bodyStats, createCharacter, deriveStats, freePoints, grantXp, isUnlocked, makeRng, pointsUsed, sanitizeLoadout } from '../src/game/character';
import { randomAdventurer } from '../src/game/people';
import { gear, weaponType } from '../src/game/gear';
import { dist, generateMap, hasLineOfSight, passable, withinRange, type BattleMap, type Point, type Terrain } from '../src/game/grid';
import { parseSave, serializeSave } from '../src/game/save';
import { skillShape } from '../src/game/reach';
import { advanceDays, newCampaign } from '../src/game/city';
import { newDemo, resolveDemoBattle } from '../src/game/demo';
import { makeQuest, rankForStage, usualCount } from '../src/game/board';
import { GUILD } from '../src/data/guild';

function openMap(w = 10, h = 7): BattleMap {
  return { width: w, height: h, tiles: Array.from({ length: h }, () => Array<Terrain>(w).fill('grass')) };
}

/** Old weapon names used by these tests ('bow' is the Longbow). */
const W = (id: string) => (id === 'bow' ? 'longbow' : id);

/** An Adventurer with a Crude weapon and no armor (gear is pinned below: see the note on the battle tests). */
function hero(weaponId = 'sword_shield', skillIds: string[] = [], name = 'H'): Character {
  const c = createCharacter(name, '#3d7be0', W(weaponId), undefined, undefined, '');
  c.skillIds = skillIds;
  c.morale = 100; // full strength: the Morale penalty has its own tests
  return c;
}

/** A level-6 Sword & Shield user: Health 750, Defense 63 (x0.613 damage), Resist 50. */
function tank(name = 'T'): Character {
  const c = hero('sword_shield', [], name);
  c.level = 6;
  return c;
}

function setup(map: BattleMap, specs: { c: Character; team: Team; at: Point }[]) {
  const units = specs.map((s) => makeUnit(s.c, s.team, s.at));
  return { battle: new Battle(map, units, makeRng(1)), units };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// The battle tests below pin base Defense and Resist to 0 so their damage numbers don't move whenever armor is
// rebalanced in stats.json (the real values are checked in the first test). Level-1 numbers used below: base Health
// 500, P.Atk 100, M.Atk 100, Defense 0 and Resist 0 (both +10 a level), so level-1 Adventurers take full damage. Sword & Shield: P.Atk 100, M.Atk 80. Where a test needs Defense, it uses a level-6
// Sword & Shield user (tank()): Health 750, Defense 50 x 1.25 = 63 (x0.613 damage), Resist 50.

STAT_CONFIG.base.defense = 0;
STAT_CONFIG.base.resist = 0;

// Gear is pinned the same way: no base stats and no No Armor penalty, and the weapons these tests use keep the
// multipliers they were written with (Sword and Shield x1.25 Def, Staff x0.6 P.Atk / x1.2 M.Atk / x0.8 Def, Longbow
// range 5 and x0.8 Def). The real equipment numbers are checked in gear.test.ts.
for (const w of Object.values(WEAPONS)) w.base = {};
ARMORS.none.modifiers = {};
WEAPONS.sword_shield.modifiers = { mAtk: 0.8, defense: 1.25 };
WEAPONS.staff.modifiers = { pAtk: 0.6, mAtk: 1.2, defense: 0.8 };
WEAPONS.longbow.modifiers = { mAtk: 0.8, defense: 0.8 };
WEAPONS.longbow.range = 5;

describe('stats and content files', () => {
  it('loads the base stats from stats.json', () => {
    expect(parseStatConfig(statsJson).base).toMatchObject({ health: 500, pAtk: 100, mAtk: 100, defense: 20, resist: 20, movement: 16 });
    expect(STAT_CONFIG.base).toMatchObject({ health: 500, pAtk: 100, mAtk: 100, defense: 0, resist: 0, movement: 16 }); // pinned above
    expect(STAT_CONFIG.growthPerLevel).toMatchObject({ health: 50, defense: 10, resist: 10 });
  });

  it('rejects a broken stats config with a clear message', () => {
    expect(() => parseStatConfig({ base: { health: 'lots' }, growthPerLevel: {}, defenseScale: 100 })).toThrow(/base.health/);
  });

  it('weapons multiply base stats; level growth is automatic', () => {
    const c = hero('sword_shield');
    expect(deriveStats(c)).toMatchObject({ health: 500, pAtk: 100, mAtk: 80, defense: 0, movement: 16 }); // 0 x 1.25
    c.weapon = gear(W('staff'));
    expect(deriveStats(c)).toMatchObject({ pAtk: 60, mAtk: 120, defense: 0 });
    c.weapon = gear(W('bow'));
    expect(deriveStats(c)).toMatchObject({ pAtk: 100, mAtk: 80, defense: 0 });
    grantXp(c, 250);
    expect(c.level).toBe(3);
    expect(deriveStats(c).health).toBe(600);
    // Level 6: Defense and Resist 0 + 5 x 10 = 50; a shield makes Defense x1.25.
    expect(deriveStats(tank())).toMatchObject({ health: 750, defense: 63, resist: 50 });
  });

  it('defense: 100 points = double effective health', () => {
    expect(defenseMultiplier(0)).toBe(1);
    expect(defenseMultiplier(100)).toBe(0.5);
  });

  it('skills.json and equipment.json are validated with precise errors', () => {
    const bad = clone(skillsJson) as Record<string, any>;
    bad.skills.kick.tags.push('flying');
    expect(() => parseContent(bad, equipmentJson)).toThrow(/skills.kick.tags\[2\].*"flying" is not defined/);
    const bad2 = clone(skillsJson) as Record<string, any>;
    bad2.skills.fireball.applyStatus[0].status = 'toxin';
    expect(() => parseContent(bad2, equipmentJson)).toThrow(/fireball.applyStatus\[0\].status/);
    const badW = clone(equipmentJson) as Record<string, any>;
    badW.weapons.longbow.modifiers.luck = 2;
    expect(() => parseContent(skillsJson, badW)).toThrow(/weapons.longbow.modifiers.luck/);
    const badA = clone(equipmentJson) as Record<string, any>;
    badA.armors.leather.builtIn = true;
    expect(() => parseContent(skillsJson, badA)).toThrow(/armors.*exactly one "builtIn"/);
  });

  it('every weapon grants defined skills; formulas are generated from the data', () => {
    for (const w of Object.values(WEAPONS)) for (const s of w.skills) expect(SKILLS[s]).toBeDefined();
    expect(skillEffect(SKILLS.execute)).toBe("Basic attack, x1 to x2 damage by the target's missing Health (x2 at 25% Health or less)");
    expect(skillEffect(SKILLS.double_strike)).toBe('Basic attack x2 (100%, then 50% damage)');
    expect(skillEffect(SKILLS.life_risking_strike)).toBe('250% P.Atk, You: Exposed (1 turn), 100% P.Atk recoil if the target survives');
  });

  it('skill info shows Effect, Tags, AP, Mana and Cooldown, leaving out a 0 mana cost or no cooldown', () => {
    for (const [id, s] of Object.entries(SKILLS)) {
      const labels = skillStats(s).map((r) => r.label);
      const c = s.modes ? SKILLS[s.modes[0]] : s;
      const want = ['Effect', ...(s.tags.length ? ['Tags'] : []), 'AP', ...(c.mana ? ['Mana'] : []), ...(c.cooldown > 0 ? ['Cooldown'] : [])];
      expect(labels, id).toEqual(want);
    }
    expect(skillStatText(SKILLS.fireball)).toBe(
      'Effect: 120% M.Atk, a stack of Burn\nTags: Projectile, Debuff, Magical\nAP: Ends Turn\nMana: 40\nCooldown: 3 Turns');
    expect(skillStatText(SKILLS.ignite)).toBe(
      'Effect: 20% M.Atk, a stack of Burn\nTags: Debuff, Magical\nAP: 1 AP\nMana: 30\nCooldown: 2 Turns');
    expect(skillStats(SKILLS.arcane_weapon)[0].value).toBe('Toggle: Weapon attacks +50% M.Atk per hit (10 mana each)');
    expect(skillStatText(SKILLS.basic_attack)).toBe('Effect: 100% P.Atk, Engages an adjacent target\nTags: Melee, Physical\nAP: Ends Turn\nCooldown: 1 Turn');
    expect(SKILLS.bow_attack.name).toBe('Basic Attack');
    expect(skillStats(SKILLS.engage)[0].value).toBe(SKILLS.engage.description);
    expect(skillStats(SKILLS.bow_attack)[0].value).toBe("Attacks based on the bow's mode.");
    expect(skillStats(SKILLS.protection)[0].value).toBe('Defense +25% M.Atk (3 turns)');
    expect(skillStats(SKILLS.barrier)[0].value).toBe('Shield 80% M.Atk (1 turn)');
    expect(skillStatText(SKILLS.shield_slam)).toBe('Effect: 60% P.Atk + 120% Def\nTags: Melee, Engage, Physical\nAP: Ends Turn\nMana: 30\nCooldown: 2 Turns');
    expect(skillStatText(SKILLS.quick_attack)).toBe('Effect: Basic attack (80% damage)\nTags: Weapon\nAP: 1 AP\nMana: 20\nCooldown: 2 Turns');
  });
});

describe('save files', () => {
  const campaign = () => newCampaign(hero('bow', ['ignite', 'kick'], 'Main'), 'Testers', makeRng(5));

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
    if (r.ok) expect(r.state.party[0]).toMatchObject({ name: 'Old Cleric', weapon: { type: 'staff', quality: 'crude' }, armor: { type: 'leather', quality: 'crude' }, skillIds: ['heal', 'cleanse'] });
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
    expect(battle.canTarget(a, SKILLS.basic_attack, { x: 4, y: 4 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.kick, { x: 4, y: 4 })).toBe(true);
    expect(withinRange(Math.SQRT2, 1)).toBe(false);
  });

  it('attacks aimed straight at an ally hit them; a reach attack passes allies it is not aimed at', () => {
    const { battle, units: [a, ally, foe] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'player', at: { x: 4, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.targetsOf(a, SKILLS.basic_attack, { x: 5, y: 3 })).toEqual([foe]);
    expect(battle.targetsOf(a, SKILLS.basic_attack, { x: 4, y: 3 })).toEqual([ally]);
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
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

  it('Movement tag: Charge range = Movement (Chilled shrinks it); Arcane Shift is a fixed range 2', () => {
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
    expect(battle.skillRange(m, SKILLS.charge)).toBe(3); // 75% of 16 = 12, / 4 per tile
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

  it('single-target skills need a unit: empty tiles and Stealthed enemies are in range but not aimable', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['charge']), team: 'player', at: { x: 0, y: 0 } },
      { c: hero(), team: 'enemy', at: { x: 3, y: 1 } },
    ]);
    // Still part of the range box...
    expect(battle.canTarget(m, SKILLS.magic_bolt, { x: 3, y: 0 })).toBe(true);
    // ...but can't be aimed at.
    expect(battle.canAim(m, SKILLS.magic_bolt, { x: 3, y: 0 })).toBe(false);
    expect(battle.targetError(m, SKILLS.magic_bolt, { x: 3, y: 0 })).toBe('Magic Bolt needs a unit to target.');
    expect(() => battle.perform(m, 'magic_bolt', { x: 3, y: 0 })).toThrow('needs a unit');
    expect(battle.canAim(m, SKILLS.charge, { x: 2, y: 0 })).toBe(false); // no charging at empty ground
    expect(battle.canAim(m, SKILLS.magic_bolt, { x: 3, y: 1 })).toBe(true);
    e.statuses.push({ id: 'stealth', name: 'Stealthed', debuff: false, stacks: 1, amount: 0, turns: 1, tick: 'start' });
    expect(battle.canAim(m, SKILLS.magic_bolt, { x: 3, y: 1 })).toBe(false);
    expect(m.acted).toBe(false);
  });

  it('cleric skills only work on your own side', () => {
    const { battle, units: [c, ally, e] } = setup(openMap(), [
      { c: hero('staff', ['heal', 'cleanse', 'protection', 'barrier']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('sword_shield', [], 'Ally'), team: 'player', at: { x: 2, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 3, y: 1 } },
    ]);
    for (const id of ['heal', 'cleanse', 'protection', 'barrier']) {
      expect(battle.canAim(c, SKILLS[id], { x: 3, y: 1 }), id).toBe(false);
      expect(battle.canAim(c, SKILLS[id], { x: 2, y: 1 }), id).toBe(true);
      expect(battle.canAim(c, SKILLS[id], { x: 1, y: 1 }), id).toBe(true); // yourself
    }
    expect(battle.targetError(c, SKILLS.heal, { x: 3, y: 1 })).toBe('Heal only works on your own side.');
    expect(() => battle.perform(c, 'heal', { x: 3, y: 1 })).toThrow('own side');
    expect([ally.hp, e.hp]).toEqual([ally.stats.health, e.stats.health]);
  });
});

describe('skills', () => {
  it('sword slash: 100% P.Atk reduced by Defense', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: tank(), team: 'enemy', at: { x: 2, y: 2 } },
    ]);
    battle.perform(a, 'basic_attack', { x: 2, y: 2 });
    expect(e.hp).toBe(750 - 61); // 100 x 100/163
  });

  it('double strike hits with the weapon basic attack twice (second at 50%), at the weapon range', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['double_strike']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    const events = battle.perform(a, 'double_strike', { x: 2, y: 1 });
    // Sword Slash on a level-1 bow user (Def 0): 100, then half of that: 50
    expect(events.filter((ev) => ev.type === 'damage').map((ev) => ev.type === 'damage' && ev.amount)).toEqual([100, 50]);
    expect(e.hp).toBe(500 - 150);
    // With a bow it reaches as far as the bow.
    const archer = setup(openMap(), [{ c: hero('bow', ['double_strike']), team: 'player', at: { x: 1, y: 1 } }]);
    expect(archer.battle.skillRange(archer.units[0], SKILLS.double_strike)).toBe(5);
  });

  it('cooldown 1 means the skill cannot be used on the next turn', () => {
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('sword_shield'), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 8, y: 5 } },
    ]);
    a.x = 7;
    a.y = 5;
    battle.perform(a, 'shield_slam', { x: 8, y: 5 }); // cooldown 2
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(a, 'shield_slam')).toBe(false);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(a, 'shield_slam')).toBe(true);
  });

  it('shields absorb damage first', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('staff', ['barrier']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 1 } },
    ]);
    battle.perform(a, 'barrier', { x: 1, y: 1 }); // 80% of the staff's 120 M.Atk = 96
    battle.endPhase();
    battle.perform(e, 'bow_attack', { x: 1, y: 1 }); // Direct mode: 100 (Def 0)
    expect(battle.shieldOf(a)).toBe(0); // the 96-point shield takes 96...
    expect(a.hp).toBe(500 - 4); // ...and the rest gets through
  });

  it("a spear's Basic Attack reaches 2 tiles (rounded), past anyone in the way, and doesn't push", () => {
    const { battle, units: [s, near, far] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.skillRange(s, SKILLS.basic_attack)).toBe(2);
    expect(battle.rangeTiles(s, SKILLS.basic_attack)).toHaveLength(20);
    expect(battle.canTarget(s, SKILLS.basic_attack, { x: 5, y: 2 })).toBe(true); // 2-over-1
    expect(battle.canTarget(s, SKILLS.basic_attack, { x: 5, y: 1 })).toBe(false); // diagonal 2.83
    battle.perform(s, 'basic_attack', { x: 5, y: 3 }); // over the near one
    expect(far.hp).toBe(500 - 100); // 100% P.Atk, Def 0
    expect(far).toMatchObject({ x: 5, y: 3 });
    expect(near.hp).toBe(500);
  });

  it('Basic Attack engages an adjacent target, but not one 2 tiles away', () => {
    const far = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    far.battle.perform(far.units[0], 'basic_attack', { x: 3, y: 3 });
    expect(far.units[0].engagedWith).toBeNull();
    for (const at of [{ x: 2, y: 3 }, { x: 2, y: 2 }]) {
      const { battle, units: [s, e] } = setup(openMap(), [
        { c: hero('spear'), team: 'player', at: { x: 1, y: 3 } },
        { c: hero('bow'), team: 'enemy', at },
      ]);
      const events = battle.perform(s, 'basic_attack', at);
      expect(s.engagedWith).toBe(e.uid);
      expect(e.engagedWith).toBe(s.uid);
      expect(events.some((ev) => ev.type === 'engage')).toBe(true);
    }
    expect(skillEffect(SKILLS.basic_attack)).toBe('100% P.Atk, Engages an adjacent target');
  });

  it('every weapon (and Unarmed) attacks with the one Basic Attack at its own range', () => {
    for (const w of Object.values(WEAPONS)) {
      const id = w.skills[0];
      expect(SKILLS[id].name, w.id).toBe('Basic Attack');
      const { battle, units: [u] } = setup(openMap(), [{ c: hero(w.id === 'unarmed' ? 'sword_shield' : w.id), team: 'player', at: { x: 3, y: 3 } }]);
      if (w.id === 'unarmed') u.character.weapon = null;
      expect(battle.skillRange(u, SKILLS[allSkills(u.character)[0]]), w.id).toBe(w.range);
    }
  });

  it('circle swing on a bow shows the melee reach in the skill diagram', () => {
    const bow = WEAPONS.longbow;
    const raw = SKILLS[bow.skills[0]];
    const ctx = { movement: 16, basic: resolveWeaponSkill(raw, bow), basicMode: (tag: string) => { const m = modeWithTag(raw, tag); return m && resolveWeaponSkill(m, bow); } };
    const shape = skillShape(SKILLS.circle_swing, ctx);
    expect(shape.kind).toBe('area');
    expect(shape.tiles).toHaveLength(8); // the 8 tiles around you, not the bow's long range
  });

  it('arcane pulse knocks back 2 tiles', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['arcane_pulse']), team: 'player', at: { x: 2, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    expect(battle.canTarget(m, SKILLS.arcane_pulse, { x: 4, y: 3 })).toBe(false); // range 1.5
    battle.perform(m, 'arcane_pulse', { x: 3, y: 3 });
    expect(e).toMatchObject({ x: 5, y: 3 });
    expect(e.hp).toBe(500 - 120); // 100% of the staff's 120 M.Atk, Def 0
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
    expect(foe.hp).toBe(500 - 100); // the Basic Attack's 100% P.Atk on Def 0
    expect(foe).toMatchObject({ x: 2, y: 3 });
    expect(far.hp).toBe(500); // 3 tiles away: Circle Swing reaches 1.5, whatever the weapon
  });

  it('Overwatch (basic ability): 60° arc to weapon range, fires the basic attack without stopping; ends the turn', () => {
    const { battle: b2, units: [archer, runner] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 8, y: 3 } },
    ]);
    expect(WEAPONS.longbow.skills).not.toContain('overwatch');
    expect(b2.skillIds(archer)).toContain('overwatch');
    b2.perform(archer, 'overwatch', { x: 5, y: 3 });
    expect(archer).toMatchObject({ acted: true, ap: 0 });
    expect(archer.overwatch!.tiles.has('6,3')).toBe(true); // Direct Shot range 5
    expect(archer.overwatch!.tiles.has('7,3')).toBe(false);
    b2.endPhase();
    const r2 = b2.move(runner, { x: 5, y: 3 });
    expect(r2.interrupted).toBe(false);
    expect(r2.triggers).toHaveLength(1);
    expect(runner).toMatchObject({ x: 5, y: 3, hp: 500 - 100 }); // Direct Shot: 100 P.Atk, Def 0

    // A spear's watch reaches as far as its Basic Attack (2).
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
    battle.perform(k, 'basic_attack', { x: 2, y: 1 });
    expect(k).toMatchObject({ ap: 0, acted: true });
    expect(battle.usableFreeActions(k)).toEqual([]);
    expect(battle.commandableUnits()).toEqual([]);
  });

  it('cleric skills work on allies and yourself, never on enemies', () => {
    const { battle, units: [h, , a] } = setup(openMap(), [
      { c: hero('staff', ['heal', 'cleanse']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 4, y: 1 } },
      { c: hero('sword_shield', [], 'Ally'), team: 'player', at: { x: 1, y: 3 } },
    ]);
    for (const id of ['heal', 'cleanse', 'protection', 'barrier']) {
      expect(SKILLS[id].affects).toBe('ally');
      expect(battle.targetsOf(h, SKILLS[id], { x: 4, y: 1 })).toEqual([]);
      expect(battle.targetsOf(h, SKILLS[id], { x: 1, y: 3 })).toEqual([a]);
      expect(battle.targetsOf(h, SKILLS[id], { x: 1, y: 1 })).toEqual([h]);
    }
    a.hp = 300;
    battle.perform(h, 'heal', { x: 1, y: 3 });
    expect(a.hp).toBe(300 + 96); // 80% of 120 M.Atk
    battle.endPhase();
    battle.endPhase();
    h.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 1, amount: 0, turns: Infinity, tick: 'end' });
    battle.perform(h, 'cleanse', { x: 1, y: 1 });
    expect(h.statuses).toEqual([]);
  });

  it("Protection adds Defense from the caster's M.Atk; Barrier shields for 80% M.Atk with a 2-turn cooldown; Protection lasts 3 turns", () => {
    const { battle, units: [c, ally] } = setup(openMap(), [
      { c: hero('staff', ['protection', 'barrier']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('sword_shield', [], 'Ally'), team: 'player', at: { x: 3, y: 1 } },
    ]);
    const def = battle.stat(ally, 'defense');
    battle.perform(c, 'protection', { x: 3, y: 1 });
    expect(battle.stat(ally, 'defense')).toBe(def + 30); // 25% of 120 M.Atk
    expect(battle.isReady(c, 'protection')).toBe(false); // cooldown 1: not again this turn
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(c, 'protection')).toBe(true);
    battle.perform(c, 'barrier', { x: 3, y: 1 });
    expect(battle.shieldOf(ally)).toBe(96); // 80% of 120 M.Atk
    expect(battle.isReady(c, 'barrier')).toBe(false);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(c, 'barrier')).toBe(false); // cooldown 2: skips the next turn
    // Protected lasts 3 of the ally's turns: still on after 2...
    expect(battle.stat(ally, 'defense')).toBe(def + 30);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(c, 'barrier')).toBe(true);
    expect(battle.stat(ally, 'defense')).toBe(def); // ...gone after the 3rd
    expect(SKILLS.heal.cooldown).toBe(1);
  });

  it('Burn: 5% of max health (whatever the stacks) at the end of the burning unit\'s turn, reduced by Defense and shields, then a stack drops off', () => {
    const { battle, units: [m, e, cleric] } = setup(openMap(), [
      { c: hero('staff', ['ignite']), team: 'player', at: { x: 1, y: 1 } },
      { c: tank(), team: 'enemy', at: { x: 4, y: 1 } },
      { c: hero('staff', ['cleanse']), team: 'enemy', at: { x: 6, y: 1 } },
    ]);
    battle.perform(m, 'ignite', { x: 4, y: 1 });
    e.statuses.find((st) => st.id === 'burn')!.stacks = 2;
    const hp = e.hp;
    battle.endPhase(); // the enemy's turn starts: no damage yet, it gets to act first
    expect(e.hp).toBe(hp);
    const events = battle.endPhase(); // ...and burns as it ends
    // 2 stacks burn as hard as 1: 5% of 750 = 37.5, x 100/163 for Def 63 = 23.
    expect(events[0]).toMatchObject({ type: 'damage', cause: 'status', amount: 23, target: e.uid });
    expect(e.hp).toBe(hp - 23);
    expect(e.statuses.find((st) => st.id === 'burn')?.stacks).toBe(1);
    // A shield soaks the next tick (1 stack: 37.5 x 100/163 = 23), then Burn is gone.
    e.statuses.push({ id: 'shield', name: 'Shield', debuff: false, stacks: 0, amount: 100, turns: 2, tick: 'start' });
    battle.endPhase();
    const tick = battle.endPhase();
    expect(tick[0]).toMatchObject({ type: 'damage', cause: 'status', amount: 0, absorbed: 23 });
    expect(e.statuses.some((st) => st.id === 'burn')).toBe(false);
    // On its own turn, the burning team can Cleanse it before it ever ticks.
    battle.perform(m, 'ignite', { x: 4, y: 1 });
    battle.endPhase();
    battle.perform(cleric, 'cleanse', { x: 4, y: 1 });
    expect(e.statuses.some((st) => st.id === 'burn')).toBe(false);
    expect(battle.endPhase().some((ev) => ev.type === 'damage' && ev.cause === 'status')).toBe(false);
  });

  it('freeze puts a stack of Chilled on the target, which drops off at the end of its next turn', () => {
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
    expect(moveOnEnemyTurns).toEqual([12, 16, 16]);
  });

  it('charge dashes next to an enemy within Movement and strikes for 60% P.Atk, 30 mana', () => {
    const { battle, units: [v, e] } = setup(openMap(), [
      { c: hero('sword_shield', ['charge']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    battle.perform(v, 'charge', { x: 5, y: 3 });
    expect(Math.hypot(v.x - 5, v.y - 3)).toBeLessThanOrEqual(1.5);
    expect(e.hp).toBe(500 - 60); // 60% P.Atk on Def 0
    expect(v.mp).toBe(v.stats.mana - 30);
    expect(v.acted).toBe(false); // 1 AP: the action AP is still there
  });

  it('charges run their path like a walk: enemy overwatch fires on the way; teleports slip past', () => {
    // A watching archer at (1,3) covers (4,3); the charger starts outside the arc and lands there.
    const watched = (charger: Character, skillId: string, startX = 7) => {
      const { battle, units: [archer, target, u] } = setup(openMap(12, 7), [
        { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
        { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
        { c: charger, team: 'enemy', at: { x: startX, y: 3 } },
      ]);
      battle.perform(archer, 'overwatch', { x: 5, y: 3 });
      expect(archer.overwatch!.tiles.has('4,3')).toBe(true);
      battle.endPhase();
      const hp = u.hp;
      const targetHp = target.hp;
      const events = battle.perform(u, skillId, { x: 3, y: 3 });
      return { battle, archer, target, u, events, shot: hp - u.hp, struck: targetHp - target.hp };
    };

    // Monster Pounce from outside the arc (7,3): shot on the way in, still lands next to its prey and strikes.
    const pounce = watched(makeEnemy('wolf', 1, makeRng(3)), 'pounce');
    expect(pounce.shot).toBeGreaterThan(0);
    expect(pounce.archer.overwatch).toBeNull(); // the watch is spent
    expect(pounce.u).toMatchObject({ x: 4, y: 3 });
    expect(pounce.struck).toBeGreaterThan(0);
    // One move event per tile, with the overwatch shot right after the first step into the arc (6,3).
    const kinds = pounce.events.map((e) => (e.type === 'damage' ? `damage:${e.cause}` : e.type));
    expect(kinds.slice(0, 4)).toEqual(['move', 'damage:overwatch', 'move', 'move']);
    expect(pounce.events[0]).toMatchObject({ type: 'move', to: { x: 6, y: 3 } });

    // The player's Charge works the same way.
    const charge = watched(hero('sword_shield', ['charge']), 'charge');
    expect(charge.shot).toBe(100); // Direct Shot: 100 P.Atk on Def 0
    expect(charge.struck).toBeGreaterThan(0);

    // Teleport strikes don't cross the ground in between: no overwatch.
    const flicker = watched(hero('sword_shield', ['flicker_strike']), 'flicker_strike', 6); // range 3
    expect(flicker.u).toMatchObject({ x: 4, y: 3 }); // appeared inside the arc
    expect(flicker.shot).toBe(0);
    expect(flicker.archer.overwatch).not.toBeNull();

    // An interrupting watch stops the charge short: no strike if it no longer reaches.
    const { battle, units: [archer, target, u] } = setup(openMap(12, 7), [
      { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'player', at: { x: 2, y: 3 } },
      { c: hero('sword_shield', ['charge']), team: 'enemy', at: { x: 6, y: 3 } },
    ]);
    battle.perform(archer, 'overwatch', { x: 5, y: 3 });
    archer.overwatch!.interrupt = true; // no watch interrupts yet; the rules support it
    battle.endPhase();
    battle.perform(u, 'charge', { x: 2, y: 3 });
    expect(u).toMatchObject({ x: 5, y: 3 }); // stopped at its first step, short of (3,3)
    expect(target.hp).toBe(500);
    expect(u.cooldowns.charge).toBeGreaterThan(0); // the charge is still spent
  });

  it('kick is free: the unit can still act afterwards', () => {
    const { battle, units: [k] } = setup(openMap(), [
      { c: hero('sword_shield', ['kick']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
    ]);
    battle.perform(k, 'kick', { x: 2, y: 1 });
    expect(k.acted).toBe(false);
    battle.perform(k, 'basic_attack', { x: 2, y: 1 });
    expect(k.acted).toBe(true);
  });

  it('execute: the basic attack x1 at full Health, growing smoothly to x2 at 25% Health (from Health before the hit)', () => {
    const duelAt = (weapon: string, hp: number) => {
      const { battle, units: [a, e] } = setup(openMap(), [
        { c: hero(weapon, ['execute']), team: 'player', at: { x: 1, y: 1 } },
        { c: hero('bow'), team: 'enemy', at: { x: 2, y: 1 } },
      ]);
      e.hp = hp;
      return { battle, a, e };
    };
    // Sword Slash is 100 P.Atk on a Def 0, 500-Health target.
    for (const [hp, dmg] of [[500, 100], [350, 140], [200, 180], [125, 200], [100, 200]]) {
      const { battle, a, e } = duelAt('sword_shield', hp);
      expect(battle.missingHpMultiplier(SKILLS.execute, e)).toBeCloseTo(dmg / 100);
      expect(battle.previewHits(a, SKILLS.execute, e), `${hp} HP`).toEqual([dmg]);
      battle.perform(a, 'execute', { x: 2, y: 1 });
      expect(e.hp).toBe(Math.max(0, hp - dmg));
    }
    // It follows the weapon: an Indirect bow shot is 70%, so at most 140%.
    const bow = duelAt('bow', 100);
    bow.battle.perform(bow.a, 'switch_mode', { x: 1, y: 1 });
    expect(bow.battle.previewHits(bow.a, SKILLS.execute, bow.e)).toEqual([Math.round(0.7 * bow.battle.stat(bow.a, 'pAtk') * 2)]);
    // Staff: both parts of Empowered Strike are doubled.
    const staff = duelAt('staff', 100);
    const base = staff.battle.previewHits(staff.a, staff.battle.basicAttack(staff.a), staff.e).reduce((x, y) => x + y, 0);
    const exec = staff.battle.previewHits(staff.a, SKILLS.execute, staff.e).reduce((x, y) => x + y, 0);
    expect(Math.abs(exec - 2 * base)).toBeLessThanOrEqual(1); // rounding per damage type
  });

  it("execute doesn't multiply Arcane Weapon's extra hit", () => {
    const c = hero('sword_shield', ['execute', 'arcane_weapon']);
    c.level = 3;
    const a = makeUnit(c, 'player', { x: 1, y: 1 });
    const e = makeUnit(hero('bow'), 'enemy', { x: 2, y: 1 });
    const battle = new Battle(openMap(), [a, e], () => 0.99);
    battle.perform(a, 'arcane_weapon', a);
    const plain = battle.previewHits(a, SKILLS.basic_attack, e);
    e.hp = 100; // 20% Health: x2
    const exec = battle.previewHits(a, SKILLS.execute, e);
    expect(exec).toEqual([plain[0] * 2, plain[1]]);
  });
});

describe('engagement', () => {
  it('an engaged beast attacks its opponent even when another foe is closer', () => {
    const bear = makeEnemy('bear', 9, makeRng(1));
    const { battle, units: [b, opp, near] } = setup(openMap(), [
      { c: bear, team: 'enemy', at: { x: 4, y: 3 } },
      { c: tank('Opp'), team: 'player', at: { x: 5, y: 4 } }, // diagonal: 1.41 away
      { c: tank('Near'), team: 'player', at: { x: 3, y: 3 } }, // orthogonal: 1 away, nearer
    ]);
    b.engagedWith = opp.uid;
    opp.engagedWith = b.uid;
    battle.endPhase(); // enemy turn
    const action = bestAction(battle, b);
    expect(action).not.toBeNull();
    expect(action!.target).toEqual({ x: opp.x, y: opp.y });
    expect(near.hp).toBe(near.stats.health);
  });

  function duel() {
    return setup(openMap(), [
      { c: tank('A'), team: 'player', at: { x: 3, y: 3 } }, // Defense 63
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 3, y: 5 } },
      { c: hero('sword_shield'), team: 'player', at: { x: 2, y: 5 } },
    ]);
  }

  it('an Engage hit locks both units together', () => {
    const { battle, units: [a, e] } = duel();
    const events = battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    expect(events).toContainEqual({ type: 'engage', source: a.uid, target: e.uid });
    expect(a.engagedWith).toBe(e.uid);
    expect(e.engagedWith).toBe(a.uid);
  });

  it('Engage is a free action, and does nothing once either side is engaged', () => {
    const { battle, units: [a, e] } = duel();
    a.character.skillIds = ['engage'];
    expect(battle.usableFreeActions(a)).toContain('engage');
    battle.perform(a, 'engage', { x: 4, y: 3 });
    expect(a.engagedWith).toBe(e.uid);
    expect(a.ap).toBe(2); // 0 AP
    expect(a.moved).toBe(false);
    expect(battle.usableFreeActions(a)).not.toContain('engage'); // already engaged
    expect(battle.targetsOf(a, SKILLS.engage, { x: 4, y: 3 })).toEqual([]);
  });

  it('engagement does not change Defense or damage', () => {
    const { battle, units: [a, e] } = duel();
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    expect(battle.stat(a, 'defense')).toBe(63);
    battle.endPhase();
    const before = a.hp;
    battle.perform(e, 'basic_attack', { x: 3, y: 3 });
    expect(before - a.hp).toBe(61); // 100 x 100/163, same as unengaged
  });

  it("engaged units can't move or attack anyone else; others can't steal the engagement", () => {
    const { battle, units: [a, e, archer, b] } = duel();
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    expect(battle.canMove(a)).toBe(false);
    expect(battle.canTarget(a, SKILLS.basic_attack, { x: 4, y: 3 })).toBe(true);
    expect(battle.engagementBlock(a, SKILLS.basic_attack, { x: 3, y: 5 })).toMatch(/can't target anyone else/);
    // b attacks the already-engaged enemy: no new engagement.
    battle.move(b, { x: 4, y: 4 });
    battle.perform(b, 'basic_attack', { x: 4, y: 3 });
    expect(e.engagedWith).toBe(a.uid);
    expect(b.engagedWith).toBeNull();
    expect(archer.engagedWith).toBeNull();
  });

  it('disengaging gives the opponent a free basic attack, then the unit can move', () => {
    const { battle, units: [a, e] } = duel();
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    const before = a.hp;
    const events = battle.disengage(a);
    expect(events[0]).toMatchObject({ type: 'disengage', reason: 'disengage' });
    expect(events[1]).toMatchObject({ type: 'damage', cause: 'opportunity', source: e.uid, amount: 61 });
    expect(a.hp).toBe(before - 61);
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
    expect(battle.canMove(a)).toBe(true);
  });

  it('a successful push breaks the engagement, even if the units stay adjacent', () => {
    const { units: [a, e] } = duel();
    const spear = makeUnit(hero('sword_shield', ['circle_swing'], 'S'), 'player', { x: 5, y: 4 });
    const b2 = new Battle(openMap(), [a, e, spear], makeRng(2));
    b2.perform(a, 'basic_attack', { x: 4, y: 3 });
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
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
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
    // 1 AP: the turn goes on, so the escapee can still act.
    expect(a).toMatchObject({ ap: 1, acted: false });
  });

  it('engaged spears can Basic Attack and Circle Swing their opponent, incl. diagonally', () => {
    for (const opp of [{ x: 4, y: 3 }, { x: 4, y: 4 }]) {
      const { battle, units: [a, e] } = setup(openMap(), [
        { c: hero('spear', ['circle_swing']), team: 'player', at: { x: 3, y: 3 } },
        { c: hero(), team: 'enemy', at: opp },
        { c: hero(), team: 'enemy', at: { x: 2, y: 3 } },
      ]);
      a.engagedWith = e.uid;
      e.engagedWith = a.uid;
      expect(battle.canTarget(a, SKILLS.basic_attack, opp)).toBe(true);
      expect(battle.canTarget(a, SKILLS.basic_attack, { x: 2, y: 3 })).toBe(false);
      expect(battle.canTarget(a, SKILLS.circle_swing, { x: 3, y: 3 })).toBe(true); // also hits the other enemy
    }
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('spear'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.basic_attack, { x: 4, y: 3 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.basic_attack, { x: 5, y: 3 })).toBe(false); // in range 2, but not the opponent
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
    a.character.weapon = gear(W('staff'));
    a.character.skillIds = ['heal', 'cleanse'];
    battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    battle.endPhase();
    battle.endPhase();
    battle.endPhase();
    battle.endPhase();
    expect(a.engagedWith).toBe(e.uid);
    expect(battle.canTarget(a, SKILLS.heal, { x: ally.x, y: ally.y })).toBe(false);
    expect(battle.engagementBlock(a, SKILLS.heal, { x: ally.x, y: ally.y })).toMatch(/can't target anyone else/);
    expect(battle.canTarget(a, SKILLS.heal, { x: 3, y: 3 })).toBe(true);
    expect(battle.canTarget(a, SKILLS.cleanse, { x: ally.x, y: ally.y })).toBe(false);
    expect(battle.engagementBlock(a, SKILLS.cleanse, { x: ally.x, y: ally.y })).toMatch(/can't target anyone else/);
    expect(battle.canTarget(a, SKILLS.cleanse, { x: 3, y: 3 })).toBe(true);
  });

  it('a blocked push keeps the engagement', () => {
    const { units: [a, e] } = duel();
    const mage = makeUnit(hero('staff', ['arcane_pulse'], 'M'), 'player', { x: 5, y: 3 });
    const b2 = new Battle(openMap(), [a, e, mage], makeRng(2));
    b2.perform(a, 'basic_attack', { x: 4, y: 3 });
    b2.perform(mage, 'arcane_pulse', { x: 4, y: 3 }); // pushed toward (3,3), where `a` stands
    expect(e).toMatchObject({ x: 4, y: 3 });
    expect(e.engagedWith).toBe(a.uid);
  });

  it('the AI breaks away with ranged units but holds the line with melee', () => {
    const { battle, units: [a, e, archer] } = duel();
    archer.x = 3; archer.y = 4;
    battle.perform(a, 'basic_attack', { x: 3, y: 4 });
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
    expect(at(3)).toEqual(['goblin:3', 'slime:3', 'wolf:3']);
    expect(at(4)).toEqual(['bandit:4', 'goblin:4', 'wolf:4']);
    expect(at(20)).toEqual(['demon:20', 'renegade:20', 'troll:20', 'wyvern:20']);
    expect(at(30)).toEqual(['demon:25', 'renegade:25']); // past the last range: the toughest types, capped level
  });

  it('every level from 1 to 25 has enemies, and every category shows up in every quest rank', () => {
    for (let level = 1; level <= 25; level++) expect(enemyTypesForStage(level).length).toBeGreaterThan(0);
    const ranks: [number, number][] = [[3, 7], [6, 10], [11, 15], [16, 20]];
    for (const [lo, hi] of ranks) {
      const ais = new Set<string>();
      for (let l = lo; l <= hi; l++) for (const t of enemyTypesForStage(l)) ais.add(ENEMIES[t.type].ai);
      expect([...ais].sort()).toEqual(['beast', 'evil', 'human', 'tribal']);
    }
  });

  it('an encounter has one main foe, joined only by types that fight the same way', () => {
    for (let seed = 0; seed < 40; seed++) {
      const foes = pickFoes(10, makeRng(seed));
      const ai = ENEMIES[foes[0]].ai;
      expect(foes.every((f) => ENEMIES[f].ai === ai)).toBe(true);
      const enemies = generateEnemies(10, makeRng(seed), 4, foes);
      expect(enemies.every((e) => foes.includes(e.enemyType!))).toBe(true);
    }
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
    // Separate debuffs: Slow (-25% Movement) for 1 turn, Corrode for 2.
    expect(a.statuses.find((s) => s.id === 'slow')).toMatchObject({ stacks: 1, turns: 1 });
    expect(a.statuses.find((s) => s.id === 'corrode')?.turns).toBe(2);
    expect(SKILLS.sticky_spit.cooldown).toBe(3);
    battle.endPhase();
    battle.endPhase();
    battle.perform(slime, 'slam', { x: 4, y: 4 });
    expect(slime.engagedWith).toBe(b.uid);
    expect(allSkills(makeEnemy('wolf', 4, makeRng(1)))).toEqual(['bite', 'pounce', 'howl']);
  });

  it('bandits carry a weapon: its skills come first and it names them', () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = makeEnemy('bandit', 5, makeRng(seed));
      const w = WEAPONS[weaponType(b)];
      expect(w && !w.builtIn).toBe(true);
      expect(b.weapon?.quality).toMatch(/^(crude|common)$/);
      expect(allSkills(b)[0]).toBe(w.skills[0]);
      expect(allSkills(b)).toContain('kick'); // unlocked at level 5
      expect(b.name).toMatch(/^Bandit /);
      // Only the weapon's basic attack: no Slash and Smash, Circle Swing, Intercept, Overwatch...
      const others = w.skills.slice(1);
      for (const s of others) if (!b.skillIds.includes(s) && s !== 'switch_mode') expect(allSkills(b)).not.toContain(s);
      // Thugs carry a shield: they Shield Slam.
      if (w.id === 'sword_shield') expect(allSkills(b)).toContain('shield_slam');
    }
  });

  it('weak types come in bigger packs (threat budget)', () => {
    const rats = generateEnemies(1, makeRng(3), 4);
    expect(rats).toHaveLength(8); // 0.5 threat each, budget 4
    expect(rats.every((e) => e.enemyType === 'rat' && e.level === 1)).toBe(true);
    const wolves = generateEnemies(4, makeRng(3), 4, ['wolf']);
    expect(wolves).toHaveLength(4);
    expect(generateEnemies(4, makeRng(3), 4, ['goblin'])).toHaveLength(7); // 0.6 threat each
  });

  it("the encounter comes from the quest's difficulty, not the party: an easy bandit quest still brings a gang", () => {
    // A party-sized budget used to mean a single bandit for a solo adventurer. Now the quest's group size decides.
    const small = makeQuest('D', 1, makeRng(1));
    const bandits = generateEnemies(5, makeRng(3), small.count, ['bandit']);
    expect(bandits.length).toBe(Math.ceil(small.count)); // threat 1 each
    expect(bandits.length).toBeGreaterThanOrEqual(GUILD.quests.D.count[0]);
    // Rats (0.5 threat each) come twice as many for the same group size.
    expect(generateEnemies(1, makeRng(3), 3)).toHaveLength(6);
    // Harder ranks bring bigger groups.
    expect(usualCount('A')).toBeGreaterThan(usualCount('B'));
    expect(usualCount('B')).toBeGreaterThan(usualCount('C'));
    expect(usualCount('C')).toBeGreaterThan(usualCount('D'));
    // Quick Battle stages use the rank they fall in.
    expect(rankForStage(1)).toBe('D');
    expect(rankForStage(5)).toBe('D');
    expect(rankForStage(6)).toBe('C');
    expect(rankForStage(21)).toBe('S');
    expect(rankForStage(30)).toBe('S');
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
  it('each level needs 25 more XP than the last: 100, 125, 150 ...', () => {
    expect([1, 2, 3, 10, 25].map(xpToNext)).toEqual([80, 110, 150, 710, 3560]);
    const c = hero();
    expect(grantXp(c, 80 + 110 + 10)).toBe(2); // two levels, and the rest carries over
    expect([c.level, c.xp]).toEqual([3, 10]);
  });

  it('Quick Battle: each victory is worth exactly a level, so a winning party is level 3 at stage 3', () => {
    const d = newDemo();
    d.party.push(hero(), hero());
    d.party[1].xp = 60; // part-way through a level: still exactly one level per win
    resolveDemoBattle(d, 'victory');
    resolveDemoBattle(d, 'victory');
    expect(d.party.map((c) => [c.level, c.xp])).toEqual([[3, 0], [3, 60]]);
  });

  it('badly hurt enemies retreat instead of trading blows; healthy ones attack', () => {
    const map = openMap(16, 7);
    const make = () => {
      const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 9, y: 3 });
      archer.character.weapon = gear(W('bow'));
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

  it('human: a badly hurt enemy that can\'t escape death surrenders', () => {
    const map = openMap(30, 21);
    const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 15, y: 10 });
    archer.character.weapon = gear(W('bow'));
    const knights = [9, 10, 11].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 12, y }));
    const battle = new Battle(map, [archer, ...knights], makeRng(1));
    battle.endPhase();
    archer.hp = Math.round(archer.stats.health * 0.2);
    expect(shouldSurrender(battle, archer)).toBe(true);
    runAiTurn(battle, archer);
    expect(archer.surrendered).toBe(true);
    expect(archer.alive).toBe(false);
    expect(battle.outcome()).toBe('victory');
  });

  it('human: holds firm while its friends fight on and the odds are fair; gives up once the fight is lost', () => {
    const map = openMap(30, 21);
    const make = (friendsHp: number) => {
      const archer = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 15, y: 10 });
      archer.character.weapon = gear(W('bow'));
      const friends = [8, 12, 14].map((y, i) => makeUnit(makeEnemy('bandit', 4, makeRng(10 + i)), 'enemy', { x: 25, y }));
      const knights = [9, 10, 11].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 12, y }));
      const battle = new Battle(map, [archer, ...friends, ...knights], makeRng(1));
      battle.endPhase();
      archer.hp = Math.round(archer.stats.health * 0.2);
      for (const f of friends) f.hp = Math.max(1, Math.round(f.stats.health * friendsHp));
      return { battle, archer };
    };
    // Three healthy friends: an even fight, so the cornered archer fights on (falling back to them) instead of surrendering.
    const even = make(1);
    expect(holdsFirm(even.battle, even.archer)).toBe(true);
    expect(wantsToFlee(even.battle, even.archer)).toBe(false);
    expect(shouldSurrender(even.battle, even.archer)).toBe(false);
    runAiTurn(even.battle, even.archer);
    expect(even.archer.surrendered).toBeFalsy();
    // Friends nearly dead: the fight is lost, and the cornered archer gives up.
    const lost = make(0.05);
    expect(sideStrength(lost.battle, 'enemy')).toBeLessThan(HOLD_FIRM_ODDS * sideStrength(lost.battle, 'player'));
    expect(holdsFirm(lost.battle, lost.archer)).toBe(false);
    expect(shouldSurrender(lost.battle, lost.archer)).toBe(true);
  });

  it('human: a hurt enemy that isn\'t in mortal danger runs for the edge instead of surrendering', () => {
    const map = openMap(30, 21);
    const bandit = makeUnit(makeEnemy('bandit', 4, makeRng(5)), 'enemy', { x: 15, y: 10 });
    const far = makeUnit(hero('sword_shield', [], 'Far'), 'player', { x: 3, y: 10 });
    const battle = new Battle(map, [bandit, far], makeRng(1));
    battle.endPhase();
    bandit.hp = Math.round(bandit.stats.health * 0.2);
    expect(shouldSurrender(battle, bandit)).toBe(false);
    const before = Math.min(bandit.x, bandit.y, map.width - 1 - bandit.x, map.height - 1 - bandit.y);
    runAiTurn(battle, bandit);
    const after = Math.min(bandit.x, bandit.y, map.width - 1 - bandit.x, map.height - 1 - bandit.y);
    expect(after).toBeLessThan(before);
    expect(far.hp).toBe(far.stats.health);
  });

  it('only humans surrender; beasts and evil never do', () => {
    const map = openMap(30, 21);
    for (const type of ['wolf', 'skeleton', 'goblin']) {
      const foe = makeUnit(makeEnemy(type, 6, makeRng(5)), 'enemy', { x: 15, y: 10 });
      const knights = [9, 10, 11].map((y) => makeUnit(hero('sword_shield', ['charge'], `K${y}`), 'player', { x: 12, y }));
      const battle = new Battle(map, [foe, ...knights], makeRng(1));
      battle.endPhase();
      foe.hp = Math.round(foe.stats.health * 0.1);
      expect(shouldSurrender(battle, foe)).toBe(false);
    }
  });

  it('beast: goes for the nearest target, even when a weaker one is in reach', () => {
    const wolf = makeUnit(makeEnemy('wolf', 3, makeRng(1)), 'enemy', { x: 5, y: 3 });
    const near = makeUnit(hero('sword_shield', [], 'Near'), 'player', { x: 6, y: 3 });
    const weak = makeUnit(hero('staff', [], 'Weak'), 'player', { x: 4, y: 4 });
    const battle = new Battle(openMap(), [wolf, near, weak], makeRng(1));
    battle.endPhase();
    weak.hp = 40; // a human or evil foe would finish this one off
    runAiTurn(battle, wolf);
    expect(near.hp).toBeLessThan(near.stats.health);
    expect(weak.hp).toBe(40);
    // A bandit in the same spot takes the kill.
    const bandit = makeUnit(makeEnemy('bandit', 5, makeRng(3)), 'enemy', { x: 5, y: 3 });
    bandit.character.weapon = gear(W('sword_shield'));
    const n2 = makeUnit(hero('sword_shield', [], 'Near'), 'player', { x: 6, y: 3 });
    const w2 = makeUnit(hero('staff', [], 'Weak'), 'player', { x: 4, y: 4 });
    const b2 = new Battle(openMap(), [bandit, n2, w2], makeRng(1));
    b2.endPhase();
    w2.hp = 40;
    runAiTurn(b2, bandit);
    expect(w2.alive).toBe(false);
  });

  it('humans and tribal fighters weigh overwatch before charging through it; beasts and evil charge anyway', () => {
    // A deadly watch (boosted archer at (1,3)) covers the route to the target at (3,3); the charger starts at (7,3).
    const choice = (make: () => Character, watched: boolean) => {
      const { battle, units: [archer, , u] } = setup(openMap(12, 7), [
        { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
        { c: hero('sword_shield'), team: 'player', at: { x: 3, y: 3 } },
        { c: make(), team: 'enemy', at: { x: 7, y: 3 } },
      ]);
      if (watched) {
        battle.perform(archer, 'overwatch', { x: 5, y: 3 });
        archer.stats.pAtk = 5000;
      }
      battle.endPhase();
      return bestAction(battle, u)?.id;
    };
    const withCharge = (type: string) => () => {
      const c = makeEnemy(type, 3, makeRng(1));
      c.weapon = gear('spear'); // the Sellsword Lancer's kit; no tribal kit has a charge yet, so lend the orc one
      c.skillIds = ['charge'];
      return c;
    };
    for (const type of ['sellsword', 'orc']) { // human, tribal
      expect(choice(withCharge(type), false)).toBe('charge');
      expect(choice(withCharge(type), true)).not.toBe('charge');
    }
    expect(choice(() => makeEnemy('wolf', 3, makeRng(1)), true)).toBe('pounce'); // beast
    expect(choice(() => makeEnemy('demon', 8, makeRng(1)), true)).toBe(choice(() => makeEnemy('demon', 8, makeRng(1)), false)); // evil: the watch changes nothing
  });

  it('humans and tribal fighters walk around an overwatch arc when they can; beasts walk straight through', () => {
    // The straight way west to the knight at (2,0) runs through the watched arc; there's a way around through row 0.
    const route = (make: () => Character) => {
      const map = openMap(12, 7);
      const { battle, units: [archer, , u] } = setup(map, [
        { c: hero('bow'), team: 'player', at: { x: 1, y: 3 } },
        { c: hero('sword_shield'), team: 'player', at: { x: 2, y: 0 } },
        { c: make(), team: 'enemy', at: { x: 7, y: 3 } },
      ]);
      battle.perform(archer, 'overwatch', { x: 5, y: 3 });
      archer.stats.pAtk = 5000;
      battle.endPhase();
      const plan = planTurn(battle, u);
      const path = battle.routeTo(u, plan.moveTo, watchesForOverwatch(u)); // the route move() will take
      battle.move(u, plan.moveTo, watchesForOverwatch(u));
      return { shot: archer.overwatch ? 0 : 1, risk: battle.overwatchDanger(u, path), advanced: 7 - plan.moveTo.x };
    };
    for (const type of ['bandit', 'orc']) { // human, tribal: still advance, but around the arc
      const r = route(() => makeEnemy(type, 3, makeRng(1)));
      expect(r).toMatchObject({ shot: 0, risk: 0 });
      expect(r.advanced).toBeGreaterThan(0);
    }
    expect(route(() => makeEnemy('wolf', 3, makeRng(1))).shot).toBe(1); // beast: straight through, shot
  });

  it('beast: runs once hurt (below 40%), a human of the same health doesn\'t', () => {
    const map = openMap(20, 13);
    const wolf = makeUnit(makeEnemy('wolf', 3, makeRng(1)), 'enemy', { x: 10, y: 6 });
    const hero1 = makeUnit(hero('sword_shield'), 'player', { x: 3, y: 6 });
    const battle = new Battle(map, [wolf, hero1], makeRng(1));
    battle.endPhase();
    wolf.hp = Math.round(wolf.stats.health * 0.38);
    expect(wantsToFlee(battle, wolf)).toBe(true);
    const bandit = makeUnit(makeEnemy('bandit', 4, makeRng(1)), 'enemy', { x: 10, y: 6 });
    const b2 = new Battle(map, [bandit, makeUnit(hero('sword_shield'), 'player', { x: 3, y: 6 })], makeRng(1));
    b2.endPhase();
    bandit.hp = Math.round(bandit.stats.health * 0.38);
    expect(wantsToFlee(b2, bandit)).toBe(false);
  });

  it('evil: never flees, ignores danger, and goes for the most hurt target', () => {
    const map = openMap(20, 13);
    const skel = makeUnit(makeEnemy('skeleton', 6, makeRng(1)), 'enemy', { x: 0, y: 6 }); // on the edge
    skel.character.weapon = gear(W('sword_shield'));
    const a = makeUnit(hero('sword_shield', [], 'Healthy'), 'player', { x: 1, y: 6 });
    const b = makeUnit(hero('sword_shield', [], 'Hurt'), 'player', { x: 1, y: 7 });
    const battle = new Battle(map, [skel, a, b], makeRng(1));
    battle.endPhase();
    skel.hp = Math.round(skel.stats.health * 0.05);
    b.hp = Math.round(b.stats.health * 0.45); // can't be killed in one blow, but hurt
    expect(wantsToFlee(battle, skel)).toBe(false);
    expect(caution(battle, skel)).toBe(0);
    runAiTurn(battle, skel);
    expect(skel.escaped).toBeFalsy();
    expect(skel.surrendered).toBeFalsy();
    expect(a.hp).toBe(a.stats.health);
    expect(b.hp).toBeLessThan(Math.round(b.stats.health * 0.45));
  });

  it('tribal: the whole group breaks and runs once half of it is gone', () => {
    const map = openMap(20, 13);
    const goblins = [4, 5, 6, 7].map((y) => makeUnit(makeEnemy('goblin', 4, makeRng(y)), 'enemy', { x: 14, y }));
    const heroes = [5, 6, 7].map((y) => makeUnit(hero('sword_shield', [], `H${y}`), 'player', { x: 3, y }));
    const battle = new Battle(map, [...goblins, ...heroes], makeRng(1));
    battle.endPhase();
    expect(tribeRouted(battle, 'enemy')).toBe(false);
    expect(wantsToFlee(battle, goblins[2])).toBe(false);
    goblins[0].alive = false;
    goblins[1].alive = false;
    expect(tribeRouted(battle, 'enemy')).toBe(true);
    // Even an unhurt goblin runs now.
    expect(goblins[2].hp).toBe(goblins[2].stats.health);
    expect(wantsToFlee(battle, goblins[2])).toBe(true);
    const plan = planTurn(battle, goblins[2]);
    expect(plan.moveTo.x).toBeGreaterThan(goblins[2].x - 1); // away from the heroes on the left, toward the edge
  });

  it('tribal: a fighter out ahead of its group waits for the others instead of charging alone', () => {
    const map = openMap(30, 13);
    const lead = makeUnit(makeEnemy('goblin', 4, makeRng(1)), 'enemy', { x: 20, y: 6 });
    const rear = makeUnit(makeEnemy('goblin', 4, makeRng(2)), 'enemy', { x: 27, y: 6 });
    const foe = makeUnit(hero('sword_shield'), 'player', { x: 2, y: 6 });
    lead.character.weapon = gear(W('spear'));
    const battle = new Battle(map, [lead, rear, foe], makeRng(1));
    battle.endPhase();
    const plan = planTurn(battle, lead);
    expect(dist(plan.moveTo, rear)).toBeLessThanOrEqual(dist(lead, rear));
    // A lone beast just goes.
    const wolf = makeUnit(makeEnemy('wolf', 4, makeRng(1)), 'enemy', { x: 20, y: 6 });
    const wolf2 = makeUnit(makeEnemy('wolf', 4, makeRng(2)), 'enemy', { x: 27, y: 6 });
    const b2 = new Battle(map, [wolf, wolf2, makeUnit(hero('sword_shield'), 'player', { x: 2, y: 6 })], makeRng(1));
    b2.endPhase();
    expect(planTurn(b2, wolf).moveTo.x).toBeLessThan(20);
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
    battle.perform(a, 'basic_attack', { x: 5, y: 3 });
    battle.endPhase();
    expect(shouldDisengage(battle, wolf)).toBe(false); // healthy: holds on
    wolf.hp = Math.round(wolf.stats.health * 0.3);
    expect(shouldDisengage(battle, wolf)).toBe(true);
  });

  it("doesn't break away when it can't get away (Frozen or boxed in): that only gives a free attack, then it re-engages", () => {
    const slime = makeUnit(makeEnemy('slime', 3, makeRng(2)), 'enemy', { x: 5, y: 3 });
    const a = makeUnit(hero(), 'player', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [a, slime], makeRng(1));
    battle.perform(a, 'basic_attack', { x: 5, y: 3 });
    battle.endPhase();
    slime.hp = Math.round(slime.stats.health * 0.3);
    expect(wantsToFlee(battle, slime)).toBe(true);
    expect(shouldDisengage(battle, slime)).toBe(true);
    // Frozen: it can't move, so it stays and fights.
    slime.statuses.push({ id: 'frozen', name: 'Frozen', debuff: true, stacks: 1, turns: 2 } as never);
    expect(shouldDisengage(battle, slime)).toBe(false);
    const hp = slime.hp;
    runAiTurn(battle, slime);
    expect(slime.hp).toBe(hp); // no opportunity attack taken
    expect(battle.opponentOf(slime)).toBe(a);
  });

  it("doesn't break away when its best turn would stay next to its opponent anyway", () => {
    // A healthy bandit archer would rather shoot point-blank (then Kick, re-engaging) than walk off:
    // breaking away first would only hand the hero a free attack.
    for (let seed = 1; seed < 60; seed++) {
      const b = makeUnit(makeEnemy('bandit', 6, makeRng(seed)), 'enemy', { x: 5, y: 3 });
      if (!['shortbow', 'longbow', 'spear'].includes(weaponType(b.character))) continue;
      const a = makeUnit(hero(), 'player', { x: 4, y: 3 });
      const battle = new Battle(openMap(), [a, b], makeRng(1));
      battle.perform(a, 'basic_attack', { x: 5, y: 3 });
      battle.endPhase();
      const hp = b.hp;
      const wants = shouldDisengage(battle, b);
      runAiTurn(battle, b);
      // Either it never broke away (no free hit taken), or it really got away.
      if (wants) expect(dist(a, b)).toBeGreaterThan(1.5);
      else expect(b.hp).toBe(hp);
      expect(battle.opponentOf(b) === a).toBe(!wants);
    }
  });

  it("doesn't break away when every tile it could reach is still next to its opponent", () => {
    // Heroes on every side: the slime can't walk anywhere.
    const slime = makeUnit(makeEnemy('slime', 3, makeRng(2)), 'enemy', { x: 5, y: 3 });
    const a = makeUnit(hero(), 'player', { x: 4, y: 3 });
    const walls = [{ x: 6, y: 3 }, { x: 5, y: 2 }, { x: 5, y: 4 }].map((at, i) => makeUnit(hero('sword_shield', [], `W${i}`), 'player', at));
    const battle = new Battle(openMap(), [a, ...walls, slime], makeRng(1));
    battle.perform(a, 'basic_attack', { x: 5, y: 3 });
    battle.endPhase();
    slime.hp = Math.round(slime.stats.health * 0.3);
    expect(wantsToFlee(battle, slime)).toBe(true);
    expect(shouldDisengage(battle, slime)).toBe(false);
  });
});

describe('buffs (War Cry, Howl)', () => {
  const goblin = (weapon: string, at: Point) => {
    for (let seed = 1; seed < 300; seed++) {
      const g = makeEnemy('goblin', 6, makeRng(seed));
      if (weaponType(g).endsWith(weapon)) return makeUnit(g, 'enemy', at); // goblins carry a Shortbow
    }
    throw new Error(`no goblin with a ${weapon}`);
  };
  const map = () => openMap(12, 8);

  it('a goblin archer shoots rather than War Cry when the cry would only rouse itself and one far-off ally', () => {
    // War Cry ends its turn, so its own Frenzy only covers its next turn: worth less than a shot now.
    const a = makeUnit(hero(), 'player', { x: 4, y: 3 });
    const archer = goblin('bow', { x: 8, y: 3 });
    const bandit = makeUnit(makeEnemy('bandit', 6, makeRng(8)), 'enemy', { x: 9, y: 0 });
    const battle = new Battle(map(), [a, archer, bandit], makeRng(1));
    battle.endPhase();
    expect(bestAction(battle, archer)?.id).toBe('bow_attack');
  });

  it('War Cry is worth it when a pack is about to charge', () => {
    const heroes = [3, 4, 5].map((y) => makeUnit(hero(), 'player', { x: 2, y }));
    const archer = goblin('bow', { x: 8, y: 4 });
    const pack = [3, 4, 5, 6].map((y, i) => goblin(i % 2 ? 'spear' : 'staff', { x: 7, y }));
    const battle = new Battle(map(), [...heroes, archer, ...pack], makeRng(1));
    battle.endPhase();
    expect(bestAction(battle, archer)?.id).toBe('war_cry');
  });
});

describe('battles', () => {
  it('a move can only be undone until a teammate does something', () => {
    const make = () => setup(openMap(), [
      { c: hero(), team: 'player', at: { x: 1, y: 1 } },
      { c: hero('staff', ['arcane_pulse']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    // An ally moving locks it in (no stepping aside to let it through, then stepping back).
    const moved = make();
    const [a, b] = moved.units;
    moved.battle.move(a, { x: 3, y: 1 });
    expect(moved.battle.canUndoMove(a)).toBe(true);
    moved.battle.move(b, { x: 1, y: 2 });
    expect(moved.battle.canUndoMove(a)).toBe(false);
    expect(() => moved.battle.undoMove(a)).toThrow();
    expect(moved.battle.canUndoMove(b)).toBe(true); // the last one to act can still take its own move back
    // So does an ally's skill (no stepping out of its area attack, then back).
    const cast = make();
    cast.battle.move(cast.units[0], { x: 3, y: 1 });
    cast.battle.perform(cast.units[1], 'magic_bolt', { x: 3, y: 1 });
    expect(cast.battle.canUndoMove(cast.units[0])).toBe(false);
    // Next turn starts fresh.
    cast.battle.endPhase();
    cast.battle.endPhase();
    cast.battle.move(cast.units[0], { x: 4, y: 1 });
    expect(cast.battle.canUndoMove(cast.units[0])).toBe(true);
  });

  it('teams alternate turns; every unit moves and acts once per turn', () => {
    const { battle, units: [a, b, e] } = setup(openMap(), [
      { c: hero(), team: 'player', at: { x: 0, y: 0 } },
      { c: hero('bow'), team: 'player', at: { x: 0, y: 2 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ]);
    expect(battle.canAct(e)).toBe(false);
    battle.move(b, { x: 2, y: 2 });
    battle.undoMove(b);
    battle.move(a, { x: 1, y: 0 });
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
      const foes = generateEnemies(1 + (seed % 3), rng, 4);
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
    expect(STAT_CONFIG.base.resist).toBe(0);
    expect(STAT_CONFIG.growthPerLevel.resist).toBe(10);
    expect(resistChance(50)).toBeCloseTo(1 / 3);
    expect(resistChance(100)).toBe(0.5);
    expect(resistChance(0)).toBe(0);
    expect(resistChance(-20)).toBe(0);
    expect(deriveStats(hero()).resist).toBe(0); // level 1: never resists
    expect(deriveStats(tank()).resist).toBe(50); // level 6: 33%
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
      const e = makeUnit(tank(), 'enemy', { x: 4, y: 3 }); // Resist 50: 33%
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
    const c = createCharacter('B', '#3d7be0', 'sword_shield', undefined, { health: 'S', defense: 'F' }, '');
    c.body = { health: 2, defense: 1 };
    expect(bodyGain('health')).toBe(100);
    expect(bodyGain('defense')).toBe(20);
    expect(bodyGain('resist')).toBe(20);
    expect(bodyGain('movement')).toBe(0);
    expect(bodyStats()).not.toContain('movement');
    // Level 1: 500 + 2 x 100; Defense (0 + 20) x 1.25 for the shield.
    expect(deriveStats(c)).toMatchObject({ health: 700, defense: 25 });
    expect(pointsUsed(c)).toBe(3);
    expect(freePoints(c)).toBe(-1); // level 1 has 2 points
    sanitizeLoadout(c);
    expect(freePoints(c)).toBe(0);
    expect(bodyPointsOf(c)).toBe(2);
  });

  it('saves keep Body points and reject over-spending', () => {
    const c = createCharacter('Main', '#3d7be0', 'longbow');
    c.level = 4;
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

  it('Body ranks per stat are capped at level / 3, rounded up', () => {
    expect([1, 2, 3, 4, 6, 7, 10].map(maxBodyRank)).toEqual([1, 1, 1, 2, 2, 3, 4]);
    const c = createCharacter('B', '#3d7be0', 'sword_shield');
    c.level = 4;
    c.body = { health: 4 };
    sanitizeLoadout(c);
    expect(c.body).toEqual({ health: 2 });
    // Saves with ranks over the cap get the extra points back.
    const state = newCampaign(c, 'Testers', makeRng(2));
    const file = JSON.parse(serializeSave(state));
    file.party[0].body = { health: 4 };
    const r = parseSave(JSON.stringify(file));
    expect(r.ok && r.state.party[0].body).toEqual({ health: 2 });
    for (let s = 1; s < 30; s++) {
      const a = randomAdventurer(1 + (s % 9), makeRng(s));
      for (const n of Object.values(a.body ?? {})) expect(n).toBeLessThanOrEqual(maxBodyRank(a.level));
    }
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
      Object.assign(SKILLS.bow_attack, skill('bow_attack', { ap: 1, cooldown: 0 }));
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
    expect(SKILLS.arcane_pulse.mana).toBe(60);
    expect(SKILLS.kick).toMatchObject({ mana: 10, ap: 0 });
    const { battle, units: [a] } = setup(openMap(), [
      { c: hero('staff', ['arcane_bolt']), team: 'player', at: { x: 1, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 1 } },
    ]);
    expect(a.mp).toBe(200);
    battle.perform(a, 'arcane_bolt', { x: 4, y: 1 });
    expect(a.mp).toBe(170);
    battle.endPhase();
    battle.endPhase();
    a.mp = 29;
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
    const c = createCharacter('Main', '#3d7be0', 'longbow');
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
    const state = newCampaign(hero('staff', ['ignite', 'fireball', 'arcane_pulse'], 'Main'), 'Testers', makeRng(5));
    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.party[0].skillIds).toEqual(['ignite']); // Fireball and Arcane Pulse need level 3
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
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('staff', ['arcane_shift']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.arcane_shift, { x: 2, y: 2 })).toBe(true);
    const hp = a.hp;
    const events = battle.perform(a, 'arcane_shift', { x: 2, y: 2 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'disengage', reason: 'escaped' }));
    expect(events.some((ev) => ev.type === 'damage' && ev.cause === 'opportunity')).toBe(false);
    expect(a.hp).toBe(hp);
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
  });

  it("Arcane Pulse that can't push its opponent (rock or unit behind it) keeps the engagement, with no free hit", () => {
    const pulse = (behind: 'rock' | 'unit' | 'one tile') => {
      const map = openMap();
      if (behind === 'rock') map.tiles[3][5] = 'rock';
      if (behind === 'one tile') map.tiles[3][6] = 'rock';
      const a = makeUnit(hero('staff', ['arcane_pulse']), 'player', { x: 3, y: 3 });
      const e = makeUnit(hero('sword_shield'), 'enemy', { x: 4, y: 3 });
      const units = [a, e];
      if (behind === 'unit') units.push(makeUnit(hero('bow', [], 'B'), 'enemy', { x: 5, y: 3 }));
      const battle = new Battle(map, units, makeRng(1));
      a.engagedWith = e.uid;
      e.engagedWith = a.uid;
      const events = battle.perform(a, 'arcane_pulse', { x: 4, y: 3 });
      return { a, e, events };
    };
    for (const behind of ['rock', 'unit'] as const) {
      const { a, e, events } = pulse(behind);
      expect(e, behind).toMatchObject({ x: 4, y: 3 });
      expect(a.engagedWith, behind).toBe(e.uid);
      expect(e.engagedWith, behind).toBe(a.uid);
      expect(events.some((ev) => ev.type === 'disengage'), behind).toBe(false);
      expect(events.some((ev) => ev.type === 'damage' && ev.cause === 'opportunity'), behind).toBe(false);
    }
    // Pushed only 1 of its 2 tiles: it still moved, so the engagement breaks (with the free hit).
    const { a, e, events } = pulse('one tile');
    expect(e).toMatchObject({ x: 5, y: 3 });
    expect(a.engagedWith).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', cause: 'opportunity', source: a.uid, target: e.uid }));
  });

  it('Arcane Pulse is not a disengage: engaged, it only hits the opponent, and the push gives the caster a free hit', () => {
    const { battle, units: [a, e, f] } = setup(openMap(), [
      { c: hero('staff', ['arcane_pulse']), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 2, y: 3 } },
    ]);
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    expect(battle.canTarget(a, SKILLS.arcane_pulse, { x: 2, y: 3 })).toBe(false); // not the opponent
    expect(battle.canTarget(a, SKILLS.arcane_pulse, { x: 4, y: 3 })).toBe(true);
    const hp = a.hp;
    const events = battle.perform(a, 'arcane_pulse', { x: 4, y: 3 });
    expect(events.some((ev) => ev.type === 'disengage' && ev.reason === 'escaped')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'disengage', reason: 'displaced', source: e.uid, target: a.uid }));
    // The pushed opponent takes the caster's free basic attack; the caster takes none.
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', cause: 'opportunity', source: a.uid, target: e.uid }));
    expect(a.hp).toBe(hp);
    expect(e).toMatchObject({ x: 6, y: 3 });
    expect(a.engagedWith).toBeNull();
    expect(e.engagedWith).toBeNull();
    expect(f).toMatchObject({ x: 2, y: 3 });
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
    battle.perform(a, 'basic_attack', { x: 5, y: 3 });
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
    expect(e.hp).toBe(500 - 100);
    expect(a.engagedWith).toBe(e.uid);
  });

  it('Life-Risking Strike: 250% P.Atk with no Defense until your next turn; costs you if the target survives', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: (() => { const c = tank('A'); c.skillIds = ['life_risking_strike']; return c; })(), team: 'player', at: { x: 3, y: 3 } },
      { c: tank('E'), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(a, 'life_risking_strike', { x: 4, y: 3 });
    expect(e.hp).toBe(750 - 230); // 250% of 150 P.Atk x 100/163
    expect(battle.stat(a, 'defense')).toBe(0);
    expect(a.hp).toBe(750 - 150); // 100% of own P.Atk, no Defense
    battle.endPhase();
    battle.endPhase();
    expect(battle.stat(a, 'defense')).toBe(63);

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
    expect(e.hp).toBe(500 - 70); // 70% of 100 P.Atk, Def 0
    battle.endPhase();
    battle.endPhase();
    battle.perform(a, 'switch_mode', { x: 1, y: 3 });
    expect(battle.modeName(a)).toBe('Melee');
    expect(battle.skillRange(a, SKILLS.bow_attack)).toBe(1.5);
    expect(battle.previewHits(a, SKILLS.bow_attack, e)).toEqual([80]); // 80% of 100, Def 0
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
    expect(events.filter((ev) => ev.type === 'damage')).toEqual([expect.objectContaining({ target: foe.uid, amount: 80, damageType: 'physical' })]);
    expect(battle.modeName(a)).toBe('Indirect'); // the selected mode is kept
  });

  it('hits are split into Physical (P.Atk, Def, missing HP) and Magical (M.Atk) damage', () => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', ['fireball']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    const bolt = battle.perform(m, 'magic_bolt', { x: 3, y: 3 }).filter((ev) => ev.type === 'damage');
    // 50% of 60 P.Atk and 50% of 120 M.Atk (Def 0)
    expect(bolt).toEqual([
      expect.objectContaining({ damageType: 'physical', amount: 30 }),
      expect.objectContaining({ damageType: 'magical', amount: 60 }),
    ]);
    expect(battle.previewHits(m, SKILLS.magic_bolt, e)).toEqual([90]);
    battle.endPhase();
    battle.endPhase();
    const fire = battle.perform(m, 'fireball', { x: 3, y: 3 }).filter((ev) => ev.type === 'damage');
    expect(fire.every((ev) => ev.type === 'damage' && ev.damageType === 'magical')).toBe(true);
  });

  it('skills are tagged Physical / Magical to match the damage their hits deal', () => {
    for (const s of Object.values(SKILLS)) {
      const onHit = s.toggleStatus ? STATUSES[s.toggleStatus].weaponOnHit : undefined;
      const hits = [...(s.hits ?? []), ...(s.recoilIfSurvives ? [s.recoilIfSurvives] : []), ...(s.zone ? [s.zone.hit] : []), ...(onHit ? [onHit] : [])];
      const physical = hits.some((h) => h.pAtk || h.def || h.missingHp);
      const magical = hits.some((h) => h.mAtk);
      expect([s.id, s.tags.includes('physical')]).toEqual([s.id, physical]);
      expect([s.id, s.tags.includes('magical')]).toEqual([s.id, magical]);
    }
  });
});

describe('zones (Firestorm, Blizzard), Chilled stacks and Frozen', () => {
  const zoned = (skill: string) => {
    const { battle, units: [m, e] } = setup(openMap(), [
      { c: hero('staff', [skill]), team: 'player', at: { x: 2, y: 3 } },
      { c: hero('bow', [], 'Foe'), team: 'enemy', at: { x: 6, y: 0 } },
    ]);
    e.stats.resist = 0; // no lucky resists
    return { battle, m, e };
  };

  it('Blizzard: each tile walked through hits and chills; the 3rd Chilled stack Freezes and stops the walk', () => {
    const { battle, m, e } = zoned('blizzard');
    battle.perform(m, 'blizzard', { x: 6, y: 3 });
    expect(battle.zonesAt({ x: 7, y: 4 })).toHaveLength(1);
    expect(battle.zonesAt({ x: 8, y: 3 })).toHaveLength(0);
    battle.endPhase();
    const result = battle.move(e, { x: 6, y: 4 });
    const zoneHits = result.triggers.flatMap((t) => t.events).filter((ev) => ev.type === 'zoneHit');
    expect(zoneHits).toHaveLength(3);
    expect(battle.isFrozen(e)).toBe(true);
    expect(e.statuses.find((st) => st.id === 'chilled')).toBeUndefined(); // the stacks became Frozen
    expect(result.interrupted).toBe(true);
    expect(battle.canMove(e)).toBe(false);
    // Frozen lasts one turn: this one. Ending the turn inside: 2 more hits (2 new Chilled stacks) that carry over.
    const end = battle.endPhase();
    expect(end.filter((ev) => ev.type === 'zoneHit')).toHaveLength(2);
    expect(battle.isFrozen(e)).toBe(false);
    expect(e.statuses.find((st) => st.id === 'chilled')?.stacks).toBe(2);
    // Next own turn: free to move again, at -25% (2 stacks slow no more than 1; one drops off as it ends).
    battle.endPhase();
    expect(e.ap).toBe(2);
    expect(battle.canMove(e)).toBe(true);
    expect(battle.stat(e, 'movement')).toBe(12);
  });

  it('a 3rd Chilled stack from a skill Freezes the target for exactly its next turn', () => {
    const m = makeUnit(hero('staff', ['freeze']), 'player', { x: 1, y: 3 });
    const e = makeUnit(hero('bow'), 'enemy', { x: 4, y: 3 });
    const battle = new Battle(openMap(), [m, e], () => 0.99); // never resisted
    e.statuses.push({ id: 'chilled', name: 'Chilled', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    battle.perform(m, 'freeze', { x: 4, y: 3 });
    expect(e.statuses.map((st) => [st.id, st.turns])).toEqual([['frozen', 1]]);
    battle.endPhase(); // the enemy's turn: Frozen, movement AP gone
    expect(battle.isFrozen(e)).toBe(true);
    expect(e.ap).toBe(1);
    expect(battle.canMove(e)).toBe(false);
    battle.endPhase(); // it wears off as that turn ends
    expect(battle.isFrozen(e)).toBe(false);
    battle.endPhase(); // the enemy's next turn: back to normal
    expect(e.ap).toBe(2);
    expect(battle.canMove(e)).toBe(true);
  });

  it("Firestorm: ending a turn inside hits twice (2 Burn stacks); it lasts 2 of the caster's turns", () => {
    const { battle, m, e } = zoned('firestorm');
    e.x = 6;
    e.y = 3;
    battle.perform(m, 'firestorm', { x: 6, y: 3 });
    battle.endPhase();
    const hp = e.hp;
    const end = battle.endPhase(); // the enemy ends its turn standing in the fire
    const dmg = end.filter((ev) => ev.type === 'damage' && ev.cause === 'zone');
    expect(dmg).toHaveLength(2);
    expect(e.statuses.find((st) => st.id === 'burn')?.stacks).toBe(2);
    expect(hp - e.hp).toBe(dmg.reduce((a, ev) => a + (ev.type === 'damage' ? ev.amount : 0), 0));
    expect(battle.zones).toHaveLength(1);
    battle.endPhase();
    battle.endPhase();
    expect(battle.zones).toHaveLength(0);
  });

  it('paths go around zones when that costs no extra movement', () => {
    const { battle, m } = zoned('firestorm');
    battle.perform(m, 'firestorm', { x: 5, y: 3 }); // covers x 4-6, y 2-4
    const u = makeUnit(hero('bow'), 'player', { x: 4, y: 1 });
    battle.units.push(u);
    expect(battle.pathTo(battle.reachable(u), { x: 5, y: 2 })).toEqual([{ x: 5, y: 1 }, { x: 5, y: 2 }]);
  });

  it('Chilled is -25% Movement however many stacks; 2 stacks just last a turn longer', () => {
    const { battle, m, e } = zoned('freeze');
    const base = battle.stat(e, 'movement');
    e.x = 6;
    e.y = 3;
    battle.perform(m, 'freeze', { x: 6, y: 3 });
    expect(battle.stat(e, 'movement')).toBe(base * 0.75);
    e.statuses.find((st) => st.id === 'chilled')!.stacks = 2;
    expect(battle.stat(e, 'movement')).toBe(base * 0.75);
    battle.endPhase(); // enemy turn: still chilled
    battle.endPhase(); // it ends: down to 1 stack, not gone
    expect(e.statuses.find((st) => st.id === 'chilled')?.stacks).toBe(1);
    expect(battle.stat(e, 'movement')).toBe(base * 0.75);
    expect(skillEffect(SKILLS.firestorm)).toBe('3x3 zone for 2 turns. Each tile entered: 50% M.Atk, a stack of Burn. Ending a turn inside: 2 hits');
  });

  it('Slow (Web, Sticky Spit) is -25% Movement for 1 turn, renews instead of stacking, and never Freezes', () => {
    expect(SKILLS.web.applyStatus).toEqual([{ status: 'slow', turns: 1 }]);
    for (const id of ['freeze', 'iceblast', 'chill_touch']) expect(SKILLS[id].applyStatus?.[0].status, id).toBe('chilled');
    expect(SKILLS.blizzard.zone?.applyStatus?.[0].status).toBe('chilled');
    const spider = makeUnit(makeEnemy('spider', 6, makeRng(1)), 'enemy', { x: 4, y: 3 });
    const h = makeUnit(hero('bow'), 'player', { x: 1, y: 3 });
    const battle = new Battle(openMap(), [h, spider], () => 0.99); // never resisted
    battle.endPhase();
    for (let i = 0; i < 3; i++) {
      battle.perform(spider, 'web', { x: 1, y: 3 });
      spider.cooldowns = {};
      spider.ap = 2;
      spider.acted = false;
      spider.locked = false;
    }
    expect(h.statuses.map((st) => [st.id, st.stacks, st.turns])).toEqual([['slow', 1, 1]]);
    expect(battle.isFrozen(h)).toBe(false);
    battle.endPhase(); // the player's turn: slowed
    expect(battle.stat(h, 'movement')).toBe(12);
    battle.endPhase(); // worn off as it ended
    expect(h.statuses).toEqual([]);
  });

  it('Slow and Chilled are separate and multiply: 75% x 75% of Movement', () => {
    const { battle, e } = zoned('freeze');
    e.statuses.push({ id: 'slow', name: 'Slow', debuff: true, stacks: 1, amount: 0, turns: 1, tick: 'end' });
    e.statuses.push({ id: 'chilled', name: 'Chilled', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    expect(battle.stat(e, 'movement')).toBe(Math.round(16 * 0.75 * 0.75)); // 9
  });

  it('Poison still hits harder per stack', () => {
    const { battle, e } = zoned('freeze');
    e.statuses.push({ id: 'poison', name: 'Poison', debuff: true, stacks: 2, amount: 0, turns: 3, tick: 'start' });
    battle.endPhase(); // the enemy's turn starts: Poison ticks, ignoring Defense
    expect(e.stats.health - e.hp).toBe(Math.round(e.stats.health * 0.06));
  });
});

describe('bow mode memory, engagement and enemy archers', () => {
  it('the bow keeps its selected mode between battles (and in saves)', () => {
    const c = hero('bow');
    const first = setup(openMap(), [{ c, team: 'player', at: { x: 1, y: 1 } }]);
    first.battle.perform(first.units[0], 'switch_mode', { x: 1, y: 1 });
    expect(c.weaponMode).toBe('indirect_shot');
    const second = setup(openMap(), [{ c, team: 'player', at: { x: 1, y: 1 } }]);
    expect(second.battle.modeName(second.units[0])).toBe('Indirect');
    const state = newCampaign(c, 'Testers', makeRng(5));
    const parsed = parseSave(serializeSave(state));
    expect(parsed.ok && parsed.state.party[0].weaponMode).toBe('indirect_shot');
  });

  it('an engaged bow user fights in Melee mode, keeping its selection for later; Bow Strike engages', () => {
    const { battle, units: [a, e] } = setup(openMap(), [
      { c: hero('bow'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('sword_shield'), team: 'enemy', at: { x: 7, y: 3 } },
    ]);
    // Melee mode, not engaged: Bow Strike engages.
    battle.setWeaponMode(a, 2);
    battle.perform(a, 'bow_attack', { x: 4, y: 3 });
    expect(a.engagedWith).toBe(e.uid);
    battle.endPhase();
    battle.endPhase();
    battle.setWeaponMode(a, 0); // select Direct...
    expect(battle.modeName(a)).toBe('Direct');
    expect(battle.skillFor(a, SKILLS.bow_attack).name).toBe('Bow Strike'); // ...but engaged: Melee
    expect(battle.skillRange(a, SKILLS.bow_attack)).toBe(1.5);
    expect(battle.canTarget(a, SKILLS.bow_attack, { x: 7, y: 3 })).toBe(false);
    battle.disengage(a);
    expect(battle.skillFor(a, SKILLS.bow_attack).name).toBe('Direct Shot');
  });

  it('enemy archers play at range: Indirect behind cover, Direct in the open, never Melee by choice', () => {
    const walled = openMap(12, 7);
    for (let y = 0; y < 7; y++) walled.tiles[y][4] = 'rock';
    const covered = setup(walled, [
      { c: hero('sword_shield'), team: 'player', at: { x: 7, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 1, y: 3 } },
    ]);
    covered.battle.endPhase();
    expect(preferredMode(covered.battle, covered.units[1])).toBe(1); // Indirect: arcs over the wall

    const open = setup(openMap(12, 7), [
      { c: hero('sword_shield'), team: 'player', at: { x: 6, y: 3 } },
      { c: hero('bow'), team: 'enemy', at: { x: 1, y: 3 } },
    ]);
    open.battle.endPhase();
    const archer = open.units[1];
    archer.weaponMode = 2; // left in Melee mode
    expect(preferredMode(open.battle, archer)).toBe(0); // back to Direct (100% beats 70%)
    archer.weaponMode = 0;
    expect(preferredMode(open.battle, archer)).toBeNull();
    // Engaged: no choice to make; it fights in Melee.
    archer.engagedWith = open.units[0].uid;
    open.units[0].engagedWith = archer.uid;
    expect(preferredMode(open.battle, archer)).toBeNull();
    expect(open.battle.skillFor(archer, SKILLS.bow_attack).name).toBe('Bow Strike');
  });
});

describe('quick battle difficulty', () => {
  it('the enemy count multiplier scales the encounter, and big ones deploy further in', () => {
    const base = generateEnemies(1, makeRng(3), 4);
    const five = generateEnemies(1, makeRng(3), 4 * 5, undefined, 8 * 5);
    expect(five.length).toBeGreaterThanOrEqual(base.length * 4);
    expect(five.length).toBeLessThanOrEqual(Math.round(8 * 5));
    const map = generateMap(makeRng(3));
    const spots = deploymentTiles(map, 'enemy', five.length);
    expect(spots).toHaveLength(five.length);
    expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(spots.length);
    expect(spots.every((p) => p.x >= Math.floor(map.width / 2) && passable(map, p.x, p.y))).toBe(true);
    // Normal encounters still use only the three edge columns.
    expect(deploymentTiles(map, 'enemy', 4).every((p) => p.x >= map.width - 3)).toBe(true);
  });
});

describe('Elementalist rework: Ignite, Freeze, Fireball, Iceblast and Burn explosions', () => {
  /** A caster and a target; `() => 0.99` never rolls a Resist. */
  const duelOf = (skills: string[]) => {
    const m = makeUnit(hero('staff', skills), 'player', { x: 1, y: 3 });
    const e = makeUnit(tank(), 'enemy', { x: 4, y: 3 }); // Health 750, Defense 63
    return { battle: new Battle(openMap(), [m, e], () => 0.99), m, e };
  };

  it('Ignite: 1 AP, 30 mana, 2-turn cooldown, 20% M.Atk and one Burn stack; Freeze does the same with Chilled', () => {
    expect(SKILLS.ignite).toMatchObject({ ap: 1, mana: 30, cooldown: 2, level: 1, hits: [{ mAtk: 0.2 }] });
    expect(SKILLS.freeze).toMatchObject({ ap: 1, mana: 30, cooldown: 2, level: 1, hits: [{ mAtk: 0.2 }] });
    const { battle, m, e } = duelOf(['ignite', 'freeze']);
    battle.perform(m, 'ignite', { x: 4, y: 3 });
    expect(e.hp).toBe(750 - 15); // 24 M.Atk x 100/163
    expect(e.statuses.find((s) => s.id === 'burn')?.stacks).toBe(1);
    expect(m).toMatchObject({ acted: false, mp: m.stats.mana - 30 }); // 1 AP: the turn goes on
    battle.perform(m, 'freeze', { x: 4, y: 3 });
    expect(e.statuses.find((s) => s.id === 'chilled')?.stacks).toBe(1);
    expect(m.ap).toBe(0); // both AP spent
  });

  it('Fireball and Iceblast are level 3 and hit for 120% M.Atk', () => {
    expect(SKILLS.fireball).toMatchObject({ level: 3, hits: [{ mAtk: 1.2 }] });
    expect(SKILLS.iceblast).toMatchObject({ level: 3, los: 'sight', hits: [{ mAtk: 1.2 }], applyStatus: [{ status: 'chilled', stacks: 1 }] });
    const { battle, m, e } = duelOf(['iceblast']);
    battle.perform(m, 'iceblast', { x: 4, y: 3 });
    expect(e.hp).toBe(750 - 88); // 144 M.Atk x 100/163
    expect(e.statuses.find((s) => s.id === 'chilled')?.stacks).toBe(1);
  });

  it('Burn stacks to 2; a 3rd stack Explodes: Burn is gone and the unit takes 15% of max Health, reduced by Defense', () => {
    const { battle, m, e } = duelOf(['ignite']);
    e.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    const events = battle.perform(m, 'ignite', { x: 4, y: 3 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', name: 'Explosion' }));
    // 15% of 750 = 112.5, x 100/163 for Def 63 = 69; plus Ignite's own 15.
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', cause: 'status', amount: 69 }));
    expect(e.hp).toBe(750 - 15 - 69);
    expect(e.statuses.some((s) => s.id === 'burn' || s.id === 'explosion')).toBe(false);
    // Shields absorb it too.
    const b = duelOf(['ignite']);
    b.e.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    b.e.statuses.push({ id: 'shield', name: 'Shield', debuff: false, stacks: 0, amount: 999, turns: 2, tick: 'start' });
    b.battle.perform(b.m, 'ignite', { x: 4, y: 3 });
    expect(b.e.hp).toBe(750);
  });

  it('Wraiths attack with Spectral Touch; Chill Touch (Chilled) has a 2-turn cooldown', () => {
    expect(SKILLS.chill_touch.cooldown).toBe(2);
    const w = makeUnit(makeEnemy('wraith', 12, makeRng(1)), 'enemy', { x: 4, y: 3 });
    const h = makeUnit(hero(), 'player', { x: 3, y: 3 });
    const battle = new Battle(openMap(), [h, w], () => 0.99);
    expect(battle.basicAttack(w).id).toBe('spectral_touch');
    battle.endPhase();
    battle.perform(w, 'chill_touch', { x: 3, y: 3 });
    expect(h.statuses.find((s) => s.id === 'chilled')?.stacks).toBe(1);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isReady(w, 'chill_touch')).toBe(false); // next turn: Spectral Touch only
    expect(battle.canUseSkill(w, 'spectral_touch')).toBe(true);
  });
});

describe('Arcane Weapon (toggle)', () => {
  const setupAw = (weapon = 'sword_shield', skills: string[] = ['arcane_weapon']) => {
    const c = hero(weapon, skills);
    c.level = 3; // Arcane Weapon is a level-3 skill (and 3 skills need 3 points)
    const a = makeUnit(c, 'player', { x: 3, y: 3 });
    const e = makeUnit(hero('bow'), 'enemy', { x: 4, y: 3 });
    return { battle: new Battle(openMap(), [a, e], () => 0.99), a, e };
  };

  it('switches on for 10 mana as a free action, adds 50% M.Atk to each weapon attack for 10 mana a hit, and off again for free', () => {
    expect(SKILLS.arcane_weapon).toMatchObject({ ap: 0, mana: 10, level: 3, toggleStatus: 'arcane_weapon' });
    const { battle, a, e } = setupAw();
    const mp = a.mp;
    const on = battle.perform(a, 'arcane_weapon', { x: 3, y: 3 });
    expect(on).toContainEqual({ type: 'toggle', target: a.uid, name: 'Arcane Weapon', on: true });
    expect(a).toMatchObject({ mp: mp - 10, ap: 2, acted: false });
    expect(battle.usableFreeActions(a)).not.toContain('arcane_weapon'); // never keeps the turn open
    // Level 3: Sword Slash 120 P.Atk (Physical), then 50% of 96 M.Atk = 48 (Magical), on a level-1 bow user (Def 0).
    expect(battle.previewHits(a, SKILLS.basic_attack, e)).toEqual([120, 48]);
    const hit = battle.perform(a, 'basic_attack', { x: 4, y: 3 }).filter((ev) => ev.type === 'damage');
    expect(hit).toEqual([
      expect.objectContaining({ amount: 120, damageType: 'physical' }),
      expect.objectContaining({ amount: 48, damageType: 'magical' }),
    ]);
    expect(a.mp).toBe(mp - 20);
    // Next turn: no upkeep for keeping it on; switching off is free.
    battle.endPhase();
    battle.endPhase();
    expect(a.mp).toBe(mp - 20);
    expect(battle.isToggledOn(a, 'arcane_weapon')).toBe(true);
    const off = battle.perform(a, 'arcane_weapon', { x: 3, y: 3 });
    expect(off).toContainEqual({ type: 'toggle', target: a.uid, name: 'Arcane Weapon', on: false });
    expect(a.mp).toBe(mp - 20);
    expect(battle.isToggledOn(a, 'arcane_weapon')).toBe(false);
  });

  it('procs once per swing (Double Strike twice), on opportunity attacks, and not on spells', () => {
    const { battle, a, e } = setupAw('sword_shield', ['arcane_weapon', 'double_strike', 'arcane_bolt']);
    battle.perform(a, 'arcane_weapon', { x: 3, y: 3 });
    const ds = battle.perform(a, 'double_strike', { x: 4, y: 3 }).filter((ev) => ev.type === 'damage' && ev.damageType === 'magical');
    expect(ds).toHaveLength(2);
    battle.endPhase();
    battle.endPhase();
    const mp = a.mp;
    battle.perform(a, 'arcane_bolt', { x: 4, y: 3 });
    expect(a.mp).toBe(mp - SKILLS.arcane_bolt.mana); // a spell: no proc
    // Engaged foe breaks away: the opportunity attack procs too.
    battle.endPhase();
    a.engagedWith = e.uid;
    e.engagedWith = a.uid;
    const opp = battle.disengage(e).filter((ev) => ev.type === 'damage');
    expect(opp.map((ev) => ev.type === 'damage' && ev.damageType)).toEqual(['physical', 'magical']);
  });

  it('costs 10 mana per hit: Double Strike pays twice, Circle Swing once per target hit', () => {
    const ds = setupAw('sword_shield', ['arcane_weapon', 'double_strike']);
    ds.battle.perform(ds.a, 'arcane_weapon', { x: 3, y: 3 });
    let mp = ds.a.mp;
    ds.battle.perform(ds.a, 'double_strike', { x: 4, y: 3 });
    expect(ds.a.mp).toBe(mp - SKILLS.double_strike.mana - 2 * 10);
    const c = hero('sword_shield', ['arcane_weapon', 'circle_swing']);
    c.level = 5;
    const a = makeUnit(c, 'player', { x: 3, y: 3 });
    const foes = [{ x: 4, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 4 }].map((p) => makeUnit(hero('bow'), 'enemy', p));
    const battle = new Battle(openMap(), [a, ...foes], () => 0.99);
    battle.perform(a, 'arcane_weapon', { x: 3, y: 3 });
    mp = a.mp;
    const hits = battle.perform(a, 'circle_swing', { x: 3, y: 3 }).filter((ev) => ev.type === 'damage' && ev.damageType === 'magical');
    expect(hits).toHaveLength(3);
    expect(a.mp).toBe(mp - SKILLS.circle_swing.mana - 3 * 10);
    // Not enough for every target: it pays for what it can, never goes below 0, then switches off.
    const b2 = new Battle(openMap(), [makeUnit(c, 'player', { x: 3, y: 3 }), ...[{ x: 4, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 4 }].map((p) => makeUnit(hero('bow'), 'enemy', p))], () => 0.99);
    const a2 = b2.units[0];
    b2.perform(a2, 'arcane_weapon', { x: 3, y: 3 });
    a2.mp = SKILLS.circle_swing.mana + 15;
    const ev = b2.perform(a2, 'circle_swing', { x: 3, y: 3 });
    expect(ev.filter((x) => x.type === 'damage' && x.damageType === 'magical')).toHaveLength(1);
    expect(a2.mp).toBe(5);
    expect(b2.isToggledOn(a2, 'arcane_weapon')).toBe(false);
  });

  it('switches off when it runs out of mana for a hit, and has no upkeep', () => {
    const { battle, a } = setupAw();
    battle.perform(a, 'arcane_weapon', { x: 3, y: 3 });
    a.mp = 5;
    const events = battle.perform(a, 'basic_attack', { x: 4, y: 3 });
    expect(events).toContainEqual({ type: 'toggle', target: a.uid, name: 'Arcane Weapon', on: false, reason: 'mana' });
    expect(events.filter((ev) => ev.type === 'damage')).toHaveLength(1); // no extra hit
    expect(a.mp).toBe(5);
    // No upkeep: it stays on through turns even with no mana, until a hit needs paying for.
    const b = setupAw();
    b.battle.perform(b.a, 'arcane_weapon', { x: 3, y: 3 });
    b.a.mp = 0;
    b.battle.endPhase();
    const start = b.battle.endPhase();
    expect(start).not.toContainEqual(expect.objectContaining({ type: 'toggle' }));
    expect(b.a.mp).toBe(0);
    expect(b.battle.isToggledOn(b.a, 'arcane_weapon')).toBe(true);
  });
});

describe('stat display', () => {
  it('shows Defense and Resist as amount and effective percent, other stats as the amount', () => {
    const scale = STAT_CONFIG.defenseScale;
    expect(statText('defense', scale)).toBe(`${scale} (50%)`); // half the damage
    expect(statText('resist', scale)).toBe(`${scale} (50%)`); // half the debuffs shrugged off
    expect(statText('defense', 0)).toBe('0 (0%)');
    expect(statEffectPct('defense', -scale)).toBe(-50); // takes 50% more damage
    expect(statText('pAtk', 95)).toBe('95');
    expect(statEffectPct('movement', 16)).toBeNull();
  });
});
