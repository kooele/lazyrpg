// The skill expansion: new Arcanist, Elementalist, Cleric, Vanguard, Infighter, Assassin and Weapon Master skills,
// elemental tiles, the Stealth rules and fog of war (Vision).
import { describe, expect, it } from 'vitest';
import { ARMORS, SKILLS, STATUSES, WEAPONS, skillEffect } from '../src/data/content';
import { STAT_CONFIG } from '../src/data/stats';
import type { Character } from '../src/data/types';
import { bestAction, planTurn } from '../src/game/ai';
import { Battle, makeEnemy, makeUnit, type Team, type Unit } from '../src/game/battle';
import { createCharacter, deriveStats, makeRng, skillBarLayout } from '../src/game/character';
import { combinePenPct } from '../src/game/gear';
import type { BattleMap, Point, Terrain } from '../src/game/grid';

// As in game.test.ts: no base Defense or Resist (no random resists, round damage numbers) and no gear base stats.
STAT_CONFIG.base.defense = 0;
STAT_CONFIG.base.resist = 0;
for (const w of Object.values(WEAPONS)) w.base = {};
ARMORS.none.modifiers = {};
WEAPONS.sword_shield.modifiers = { mAtk: 0.8, defense: 1.25 };
WEAPONS.staff.modifiers = { pAtk: 0.6, mAtk: 1.2, defense: 0.8 };

const openMap = (w = 10, h = 7): BattleMap => ({ width: w, height: h, tiles: Array.from({ length: h }, () => Array<Terrain>(w).fill('grass')) });

function hero(weapon = 'sword_shield', skillIds: string[] = [], name = 'H', level = 1): Character {
  const c = createCharacter(name, '#3d7be0', weapon, undefined, undefined, '');
  c.skillIds = skillIds;
  c.level = level;
  c.morale = 100;
  return c;
}

const NO_FOG = { ...STAT_CONFIG, vision: { enabled: false } };

function setup(specs: { c: Character; team: Team; at: Point }[], map = openMap(), rules = STAT_CONFIG) {
  const units = specs.map((s) => makeUnit(s.c, s.team, s.at));
  return { battle: new Battle(map, units, makeRng(1), rules), units };
}

const damageTo = (events: ReturnType<Battle['perform']>, u: Unit) =>
  events.reduce((a, e) => a + (e.type === 'damage' && e.target === u.uid ? e.amount : 0), 0);

describe('vision and fog of war', () => {
  it('a side sees 6 tiles around its units in line of sight; units in fog can\'t be targeted, but areas hit them', () => {
    const map = openMap(12, 7);
    map.tiles[3][3] = 'rock';
    const { battle, units: [m, near, far, behind] } = setup([
      { c: hero('staff', ['ignite', 'smite'], 'M', 5), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 8, y: 1 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } }, // behind the rock
    ], map);
    expect(battle.stat(m, 'vision')).toBe(6);
    expect(battle.canSee('player', near)).toBe(true);
    expect(battle.canSee('player', far)).toBe(false);
    expect(battle.canSee('player', behind)).toBe(false);
    expect(battle.hiddenFrom(m, behind)).toBe(true);
    expect(battle.canAim(m, SKILLS.ignite, behind)).toBe(false); // in range, no line needed, but unseen
    const events = battle.perform(m, 'smite', behind);
    expect(damageTo(events, behind)).toBeGreaterThan(0);
    m.x = 3;
    m.y = 1;
    expect(battle.canSee('player', far)).toBe(true); // in view once the caster moves up
  });

  it('the enemy AI plans around what its side has seen, not where hidden units really are', () => {
    const { battle, units: [p, e] } = setup([
      { c: hero(), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 16, y: 3 } },
    ], openMap(18, 7));
    // It starts out knowing where the party was deployed...
    expect(battle.lastSeen.enemy.get(p.uid)).toEqual({ x: 1, y: 3 });
    // ...but not where the party went while out of sight.
    p.y = 6;
    battle.updateSightings();
    expect(battle.knownFoes(e)).toEqual([{ foe: p, at: { x: 1, y: 3 } }]);
    battle.endPhase();
    const plan = planTurn(battle, e);
    expect(plan.moveTo.x).toBeLessThan(16); // it advances toward where it last saw them
  });

  it('each turn the AI learns where out-of-sight units stood when their last turn began (not Stealthed ones)', () => {
    const { battle, units: [p, s, e] } = setup([
      { c: hero(), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('dagger', ['scout'], 'S', 3), team: 'player', at: { x: 1, y: 5 } },
      { c: hero(), team: 'enemy', at: { x: 16, y: 3 } },
    ], openMap(18, 7));
    battle.move(p, { x: 1, y: 0 }); // out of sight, the enemy saw it at (1,3) at the start
    battle.endPhase();
    expect(battle.lastSeen.enemy.get(p.uid)).toEqual({ x: 1, y: 3 }); // where this turn began: a turn out of date
    battle.endPhase(); // the player's next turn begins at (1,0)...
    p.x = 4; // ...and it moves on
    battle.endPhase(); // the AI learns of (1,0), where that turn began
    expect(battle.lastSeen.enemy.get(p.uid)).toEqual({ x: 1, y: 0 });
    // The Scout was never seen and never reported, not even where it deployed.
    s.x = 3;
    battle.endPhase();
    battle.endPhase();
    expect(battle.lastSeen.enemy.has(s.uid)).toBe(false);
    // Not symmetric: the player learns nothing about enemies out of sight (only where they deployed, at the start).
    e.y = 0;
    battle.endPhase();
    battle.endPhase();
    expect(battle.lastSeen.player.get(e.uid)).toEqual({ x: 16, y: 3 });
  });

  it('Revelation reveals every enemy within 15 tiles through fog and strips their Stealth for a turn', () => {
    expect(SKILLS.revelation).toMatchObject({ ap: 2, mana: 60, cooldown: 4, level: 7, aoeRadius: 15 });
    const { battle, units: [c, far, sneaky] } = setup([
      { c: hero('staff', ['revelation'], 'C', 7), team: 'player', at: { x: 0, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 12, y: 3 } },
      { c: hero('dagger', ['shadow_step']), team: 'enemy', at: { x: 3, y: 3 } },
    ], openMap(16, 7));
    sneaky.statuses.push({ id: 'stealth', name: 'Stealthed', debuff: false, stacks: 1, amount: 0, turns: 1, tick: 'start' });
    expect(battle.canSee('player', far)).toBe(false);
    expect(battle.hiddenFrom(c, sneaky)).toBe(true);
    battle.perform(c, 'revelation', c);
    expect(battle.canSee('player', far)).toBe(true);
    expect(battle.isStealthed(sneaky)).toBe(false);
    expect(c).toMatchObject({ ap: 0, acted: false }); // 2 AP: the turn goes on
    battle.endPhase(); // the enemy's turn: still revealed, and can't stealth again
    battle.perform(sneaky, 'shadow_step', { x: 3, y: 4 });
    expect(battle.isStealthed(sneaky)).toBe(false);
    battle.endPhase(); // worn off at the end of the enemy's turn
    expect(battle.canSee('player', far)).toBe(false);
  });
});

describe('fleeing', () => {
  const flee = (archerX: number) => {
    const { battle, units: [, b] } = setup([
      { c: hero('longbow', [], 'Archer'), team: 'player', at: { x: archerX, y: 9 } },
      { c: makeEnemy('bandit', 4, makeRng(5)), team: 'enemy', at: { x: 8, y: 9 } },
    ], openMap(24, 19)); // edges: west 8 tiles, top and bottom 9, east 15 (it moves 4 a turn)
    b.hp = Math.round(b.stats.health * 0.2); // badly hurt and alone: it runs
    battle.endPhase();
    expect(battle.canMove(b)).toBe(true);
    return planTurn(battle, b).moveTo;
  };

  it('a fleeing enemy runs for the edge away from its foes, not the nearest one past them', () => {
    // The west edge is nearest, but the archer stands by it: it runs another way, never toward the archer.
    const to = flee(2);
    expect(to.x).toBeGreaterThanOrEqual(8);
    expect(Math.hypot(to.x - 2, to.y - 9)).toBeGreaterThan(6);
  });

  it('with its foes on the far side, it still takes the nearest edge', () => {
    expect(flee(14).x).toBeLessThan(8);
  });
});

describe('Undo Move with fog of war', () => {
  it('a move that spots an enemy can\'t be undone', () => {
    const { battle, units: [p, e] } = setup([
      { c: hero(), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 10, y: 3 } },
    ], openMap(14, 7));
    expect(battle.canSee('player', e)).toBe(false);
    battle.move(p, { x: 4, y: 3 }); // 6 tiles away from the enemy: in sight now
    expect(battle.canSee('player', e)).toBe(true);
    expect(p.undoBlock).toBe('spotted');
    expect(battle.canUndoMove(p)).toBe(false);
    expect(battle.undoBlockReason(p)).toMatch(/spotted an enemy/);
  });

  it('a move that reveals more than 10 new tiles can\'t be undone; a small one can', () => {
    const { battle, units: [p] } = setup([
      { c: hero(), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 20, y: 3 } },
    ], openMap(22, 7));
    battle.move(p, { x: 1, y: 4 }); // one step down: barely any new ground
    expect(p.undoBlock).toBeUndefined();
    expect(battle.canUndoMove(p)).toBe(true);
    battle.undoMove(p);
    battle.move(p, { x: 5, y: 3 }); // 4 tiles forward: a whole new strip of map
    expect(p.undoBlock).toBe('scouted');
    expect(battle.canUndoMove(p)).toBe(false);
  });

  it('each side gets 3 undos per battle', () => {
    const { battle, units: [p] } = setup([
      { c: hero(), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 20, y: 3 } },
    ], openMap(22, 7));
    for (let i = 0; i < 3; i++) {
      battle.move(p, { x: 1, y: 4 });
      battle.undoMove(p);
    }
    expect(battle.undosLeft.player).toBe(0);
    battle.move(p, { x: 1, y: 4 });
    expect(battle.canUndoMove(p)).toBe(false);
    expect(battle.undoBlockReason(p)).toMatch(/No undos left/);
  });
});

describe('Stealth rules', () => {
  it('Scout: Stealthed from the start of the battle until the first attack', () => {
    const { battle, units: [a, e] } = setup([
      { c: hero('dagger', ['scout'], 'A', 3), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    expect(battle.isStealthed(a)).toBe(true);
    battle.endPhase();
    battle.endPhase();
    expect(battle.isStealthed(a)).toBe(true);
    expect(battle.hiddenFrom(e, a)).toBe(true);
    battle.perform(a, 'basic_attack', e);
    expect(battle.isStealthed(a)).toBe(false);
  });

  it('enemies path straight through units they can\'t see, and bumping into one stops them and breaks its Stealth', () => {
    const { battle, units: [a, e] } = setup([
      { c: hero('dagger', ['scout'], 'A', 3), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    battle.endPhase();
    expect(battle.reachable(e).has('2,3')).toBe(true); // through the hidden scout
    const result = battle.move(e, { x: 2, y: 3 });
    expect(e).toMatchObject({ x: 4, y: 3 }); // stopped in front of it
    expect(result.interrupted).toBe(true);
    expect(result.triggers.flatMap((t) => t.events)).toContainEqual({ type: 'bump', source: e.uid, target: a.uid });
    expect(battle.isStealthed(a)).toBe(false);
  });

  it('being knocked back breaks Stealth', () => {
    const swing = setup([
      { c: hero('greatsword', [], 'G'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    const [g, foe] = swing.units;
    foe.statuses.push({ id: 'stealth', name: 'Stealthed', debuff: false, stacks: 1, amount: 0, turns: 2, tick: 'start' });
    swing.battle.perform(g, 'circle_swing', g); // an area: hits and pushes the hidden enemy
    expect(foe.x).toBe(5);
    expect(swing.battle.isStealthed(foe)).toBe(false);
  });
});

describe('Arcanist', () => {
  it('Spellblade (passive): ignores the weapon\'s M.Atk penalty, not its bonus', () => {
    const c = hero('sword_shield', [], 'S', 5);
    const before = deriveStats(c).mAtk; // x0.8
    c.skillIds = ['spellblade'];
    expect(deriveStats(c).mAtk).toBeGreaterThan(before);
    expect(deriveStats(c).mAtk).toBe(Math.round(before / 0.8));
    const staff = hero('staff', [], 'S', 5);
    const plain = deriveStats(staff).mAtk;
    staff.skillIds = ['spellblade'];
    expect(deriveStats(staff).mAtk).toBe(plain); // x1.2 still applies
  });

  it('passives are never used and stay off the skill bar', () => {
    const c = hero('sword_shield', ['spellblade', 'arcane_bolt'], 'S', 5);
    expect(skillBarLayout(c)).not.toContain('spellblade');
    expect(skillBarLayout(c)).toContain('arcane_bolt');
    const { battle, units: [u] } = setup([{ c, team: 'player', at: { x: 1, y: 1 } }]);
    expect(battle.canUseSkill(u, 'spellblade')).toBe(false);
  });

  it('Quick Cast: the next Mage spell of 2 AP or Ends Turn this turn costs 1 AP instead', () => {
    expect(SKILLS.quick_cast).toMatchObject({ ap: 0, mana: 30, cooldown: 3, level: 5, toggleStatus: 'quick_cast' });
    const { battle, units: [m, e] } = setup([
      { c: hero('staff', ['quick_cast', 'fireball', 'arcane_bolt'], 'M', 5), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    expect(battle.apCost(m, SKILLS.fireball)).toBe('end');
    battle.perform(m, 'quick_cast', m);
    expect(battle.apCost(m, SKILLS.fireball)).toBe(1);
    expect(battle.apCost(m, SKILLS.basic_attack)).toBe('end'); // not a Mage spell
    battle.perform(m, 'fireball', e);
    expect(m).toMatchObject({ ap: 1, acted: false }); // the turn goes on
    expect(battle.apCost(m, SKILLS.arcane_bolt)).toBe('end'); // used up
    battle.perform(m, 'arcane_bolt', e);
    expect(m.acted).toBe(true);
  });

  it('Quick Cast can be cancelled for a full refund, and wears off unused (refunded) at the end of the turn', () => {
    const { battle, units: [m] } = setup([
      { c: hero('staff', ['quick_cast', 'fireball'], 'M', 5), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 3, y: 3 } },
    ]);
    const full = m.mp;
    battle.perform(m, 'quick_cast', m);
    expect(m.mp).toBe(full - 30);
    expect(battle.isCancellable(m, SKILLS.quick_cast)).toBe(true);
    expect(battle.canUseSkill(m, 'quick_cast')).toBe(true); // to cancel it, despite the cooldown
    expect(battle.perform(m, 'quick_cast', m)).toContainEqual(expect.objectContaining({ type: 'toggle', on: false }));
    expect(m.mp).toBe(full);
    expect(m.cooldowns.quick_cast ?? 0).toBe(0);
    expect(battle.apCost(m, SKILLS.fireball)).toBe('end');
    // Switched on and left unused: gone (and refunded) when the turn ends.
    battle.perform(m, 'quick_cast', m);
    const end = battle.endPhase();
    expect(end).toContainEqual({ type: 'toggle', target: m.uid, name: 'Quick Cast', on: false, reason: 'turn' });
    expect(m.mp).toBe(full);
    battle.endPhase();
    expect(battle.apCost(m, SKILLS.fireball)).toBe('end');
    expect(battle.canUseSkill(m, 'quick_cast')).toBe(true);
    // Used: no refund, and the cooldown runs.
    battle.perform(m, 'quick_cast', m);
    battle.perform(m, 'fireball', { x: 3, y: 3 });
    expect(battle.isCancellable(m, SKILLS.quick_cast)).toBe(false);
    expect(m.cooldowns.quick_cast).toBe(3);
  });
});

describe('Elementalist', () => {
  const caster = (skills: string[], level = 7) => hero('staff', skills, 'M', level);

  it('levels: Fireball and Iceblast 2 (2-turn cooldown); Sonic Boom 5; Firestorm and Blizzard 6, 2 AP and 3 turns', () => {
    expect([SKILLS.fireball.level, SKILLS.iceblast.level]).toEqual([2, 2]);
    expect([SKILLS.fireball.cooldown, SKILLS.iceblast.cooldown]).toEqual([2, 2]);
    expect(SKILLS.sonic_boom.level).toBe(5);
    for (const id of ['firestorm', 'blizzard']) expect(SKILLS[id]).toMatchObject({ level: 6, ap: 2, zone: { turns: 3 } });
  });

  it('Explosion sets the ground under its target on fire for 2 turns', () => {
    const { battle, units: [m, e] } = setup([
      { c: caster(['fireball']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    e.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    const events = battle.perform(m, 'fireball', e);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zone', name: 'Burning Ground', tiles: [{ x: 4, y: 3 }] }));
    const ground = battle.zonesAt(e)[0];
    expect(ground).toMatchObject({ element: 'fire', turnsLeft: 2 });
  });

  it('a tile holds one elemental effect: a new one replaces the old', () => {
    const { battle, units: [m] } = setup([{ c: caster(['firestorm', 'blizzard']), team: 'player', at: { x: 1, y: 3 } }]);
    battle.perform(m, 'firestorm', { x: 5, y: 3 }); // x 4-6
    battle.endPhase();
    battle.endPhase();
    battle.perform(m, 'blizzard', { x: 6, y: 3 }); // x 5-7
    expect(battle.zonesAt({ x: 5, y: 3 }).map((z) => z.name)).toEqual(['Blizzard']);
    expect(battle.zonesAt({ x: 4, y: 3 }).map((z) => z.name)).toEqual(['Firestorm']);
    expect(battle.zones.find((z) => z.name === 'Firestorm')!.tiles.size).toBe(3);
  });

  it('Draft: a 5-tile cross of wind; burning enemies burn longer and fire spreads, keeping its duration', () => {
    expect(SKILLS.draft).toMatchObject({ level: 4, mana: 40, cooldown: 2, range: 5, ap: 'end', hits: [{ mAtk: 0.5 }] });
    const { battle, units: [m, e, side] } = setup([
      { c: caster(['draft', 'firestorm']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 5 } }, // outside the cross
    ]);
    e.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 1, amount: 0, turns: Infinity, tick: 'end' });
    // A single fire tile (Burning Ground, 1 turn left) on the cross.
    (battle as unknown as { addZone: (...a: unknown[]) => unknown }).addZone('test', 'Burning Ground', m, { ...SKILLS.firestorm.zone!, radius: 0, turns: 1 }, [{ x: 6, y: 3 }]);
    const events = battle.perform(m, 'draft', { x: 5, y: 3 });
    expect(damageTo(events, e)).toBe(Math.round(0.5 * battle.stat(m, 'mAtk')));
    expect(damageTo(events, side)).toBe(0);
    expect(e.statuses.find((s) => s.id === 'burn')?.stacks).toBe(2);
    const fire = battle.zonesAt({ x: 7, y: 4 })[0]; // spread 1.5 tiles around (6,3)
    expect(fire).toMatchObject({ element: 'fire', turnsLeft: 1 });
    expect(fire.tiles.size).toBe(9);
  });

  it('Rain: anyone inside (allies too) hits 25% weaker, only while inside; walking in deepens a Chill and dampens a Burn', () => {
    expect(SKILLS.rain).toMatchObject({ level: 4, zone: { turns: 3, radius: 1.5, element: 'water' } });
    const { battle, units: [m, e, ally] } = setup([
      { c: caster(['rain']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero(), team: 'player', at: { x: 5, y: 2 } },
    ]);
    const atk = battle.stat(e, 'pAtk');
    battle.perform(m, 'rain', { x: 5, y: 3 }); // x 4-6, y 2-4
    expect(battle.stat(e, 'pAtk')).toBe(Math.round(atk * 0.75));
    expect(battle.stat(ally, 'pAtk')).toBe(Math.round(ally.stats.pAtk * 0.75)); // Rain affects everyone, like Blizzard
    battle.endPhase();
    // An attack from inside the rain is weaker...
    const wet = battle.previewHits(e, battle.basicAttack(e), ally)[0];
    e.x = 3;
    // ...and nothing carries over once out of it.
    expect(battle.stat(e, 'pAtk')).toBe(atk);
    expect(wet).toBe(Math.round(battle.previewHits(e, battle.basicAttack(e), ally)[0] * 0.75));
    const walk = battle.move(e, { x: 3, y: 2 }); // around the rain: nothing happens
    expect(walk.triggers).toHaveLength(0);
    battle.endPhase();
    battle.endPhase();
    e.statuses.push({ id: 'chilled', name: 'Chilled', debuff: true, stacks: 1, amount: 0, turns: Infinity, tick: 'end' });
    e.statuses.push({ id: 'burn', name: 'Burn', debuff: true, stacks: 1, amount: 0, turns: Infinity, tick: 'end' });
    battle.move(e, { x: 4, y: 2 }); // one rain tile
    expect(e.statuses.find((s) => s.id === 'chilled')?.stacks).toBe(2);
    expect(e.statuses.some((s) => s.id === 'burn')).toBe(false);
  });

  it('Sonic Boom pushes the target 2 tiles the way you pick: through fire, and out of an engagement', () => {
    const { battle, units: [m, e, knight] } = setup([
      { c: caster(['sonic_boom', 'firestorm']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero(), team: 'player', at: { x: 4, y: 2 } },
    ]);
    e.engagedWith = knight.uid;
    knight.engagedWith = e.uid;
    battle.perform(m, 'firestorm', { x: 4, y: 6 }); // y 5-6 (the map ends at 6)
    battle.endPhase();
    battle.endPhase();
    const events = battle.perform(m, 'sonic_boom', e, { x: 4, y: 4 }); // push down, 2 tiles: into the fire
    expect(e).toMatchObject({ x: 4, y: 5 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'zoneHit', target: e.uid, name: 'Firestorm' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', source: knight.uid, target: e.uid, cause: 'opportunity' }));
    expect(e.engagedWith).toBeNull();
  });

  it('a push sets off overwatch on the tiles it passes, like a walk', () => {
    const { battle, units: [m, e, archer] } = setup([
      { c: caster(['sonic_boom']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('longbow'), team: 'player', at: { x: 4, y: 6 } },
    ]);
    battle.perform(archer, 'overwatch', { x: 4, y: 5 }); // watches up the column toward the enemy
    expect(archer.overwatch?.tiles.has('4,4')).toBe(true);
    const events = battle.perform(m, 'sonic_boom', e, { x: 4, y: 4 }); // push down, into the arc
    expect(events).toContainEqual(expect.objectContaining({ type: 'damage', source: archer.uid, target: e.uid, cause: 'overwatch' }));
    expect(archer.overwatch).toBeNull(); // fired once
    expect(e).toMatchObject({ x: 4, y: 5 });
  });

  it('Fire Weapon: weapon attacks add 20% M.Atk and a stack of Burn; one enchantment at a time', () => {
    const { battle, units: [u, e] } = setup([
      { c: hero('sword_shield', ['fire_weapon', 'arcane_weapon', 'ice_weapon'], 'F', 3), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(u, 'fire_weapon', u);
    const events = battle.perform(u, 'basic_attack', e);
    expect(events.filter((ev) => ev.type === 'damage' && ev.damageType === 'magical')).toHaveLength(1);
    expect(e.statuses.find((s) => s.id === 'burn')?.stacks).toBe(1);
    battle.endPhase();
    battle.endPhase();
    battle.perform(u, 'ice_weapon', u);
    expect(battle.isToggledOn(u, 'fire_weapon')).toBe(false);
    expect(battle.isToggledOn(u, 'ice_weapon')).toBe(true);
    battle.perform(u, 'arcane_weapon', u);
    expect(u.statuses.filter((s) => s.id.endsWith('_weapon')).map((s) => s.id)).toEqual(['arcane_weapon']);
  });
});

describe('Cleric', () => {
  it('Smite: a 5-tile cross of 125% M.Atk, doubled against Evil', () => {
    const { battle, units: [c, evil, plain] } = setup([
      { c: hero('staff', ['smite'], 'C', 5), team: 'player', at: { x: 1, y: 3 } },
      { c: makeEnemy('skeleton', 6, makeRng(3)), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 5, y: 3 } },
    ]);
    expect(battle.unitTags(evil)).toEqual(['evil']);
    expect(skillEffect(SKILLS.smite)).toBe('5-tile cross, 125% M.Atk, x2 vs Evil');
    const base = battle.previewHits(c, { ...SKILLS.smite, bonusVsTag: undefined }, evil)[0];
    expect(battle.previewHits(c, SKILLS.smite, evil)[0]).toBeCloseTo(base * 2, -0.5);
    const events = battle.perform(c, 'smite', { x: 4, y: 3 });
    expect(damageTo(events, plain)).toBe(Math.round(1.25 * battle.stat(c, 'mAtk')));
    expect(damageTo(events, evil)).toBeGreaterThan(0);
  });
});

describe('Vanguard', () => {
  it('Tough It Out: a 10% max Health shield and immunity to debuffs until the next turn', () => {
    const { battle, units: [v, e] } = setup([
      { c: hero('sword_shield', ['tough_it_out'], 'V', 3), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('staff', ['ignite']), team: 'enemy', at: { x: 6, y: 3 } },
    ]);
    battle.perform(v, 'tough_it_out', v);
    expect(battle.shieldOf(v)).toBe(Math.round(v.stats.health * 0.1));
    expect(v.acted).toBe(true);
    battle.endPhase();
    const events = battle.perform(e, 'ignite', v);
    expect(events).toContainEqual(expect.objectContaining({ type: 'resist', immune: true }));
    expect(v.statuses.some((s) => s.id === 'burn')).toBe(false);
    battle.endPhase();
    expect(v.statuses.some((s) => s.id === 'unyielding')).toBe(false);
  });

  it('Blitz: dash in and strike, break away for free, then dash at a second enemy and strike (both engage)', () => {
    const { battle, units: [v, a, b] } = setup([
      { c: hero('sword_shield', ['blitz'], 'V'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero('sword_shield', [], 'A'), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('sword_shield', [], 'B'), team: 'enemy', at: { x: 5, y: 5 } },
    ]);
    const events = battle.perform(v, 'blitz', a, b);
    expect(a.hp).toBe(a.stats.health - 80);
    expect(b.hp).toBe(b.stats.health - 80);
    expect(events.filter((e) => e.type === 'engage').map((e) => e.type === 'engage' && e.target)).toEqual([a.uid, b.uid]);
    expect(events.filter((e) => e.type === 'damage' && e.cause === 'opportunity')).toHaveLength(0); // free break-away
    expect(v.engagedWith).toBe(b.uid);
    expect(a.engagedWith).toBeNull();
  });

  it('Blitz with nobody else in reach only strikes once', () => {
    const { battle, units: [v, a] } = setup([
      { c: hero('sword_shield', ['blitz'], 'V'), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(v, 'blitz', a);
    expect(v.engagedWith).toBeNull(); // broke away, nothing to strike next
    expect(a.hp).toBe(a.stats.health - 80);
  });

  it('Fighting Spirit: every new engagement, either way, earns a free 50% basic attack', () => {
    const { battle, units: [v, e] } = setup([
      { c: hero('sword_shield', ['fighting_spirit'], 'V'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.endPhase();
    const events = battle.perform(e, 'basic_attack', v); // the enemy engages
    expect(events).toContainEqual(expect.objectContaining({ type: 'counter', source: v.uid, name: 'Fighting Spirit' }));
    expect(damageTo(events, e)).toBe(50);
  });
});

describe('Infighter', () => {
  it('Sucker Punch: 80% P.Atk and the enemy loses its movement AP on its next turn', () => {
    expect(SKILLS.sucker_punch.description).toContain('A Sudden and Deliberate Strike');
    const { battle, units: [p, e] } = setup([
      { c: hero('sword_shield', ['sucker_punch'], 'P'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(p, 'sucker_punch', e);
    expect(e.hp).toBe(e.stats.health - 80);
    expect(p).toMatchObject({ ap: 1, acted: false }); // 1 AP
    battle.endPhase();
    expect(e).toMatchObject({ ap: 1, moved: true });
  });

  it('Tooth for Tooth: the engaged opponent\'s attack is answered with a free 50% basic attack', () => {
    const { battle, units: [p, e] } = setup([
      { c: hero('sword_shield', ['tooth_for_tooth'], 'P'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.endPhase();
    const first = battle.perform(e, 'basic_attack', p); // not engaged yet: no counter
    expect(first.some((ev) => ev.type === 'counter')).toBe(false);
    battle.endPhase();
    battle.endPhase();
    const second = battle.perform(e, 'basic_attack', p);
    expect(second).toContainEqual(expect.objectContaining({ type: 'counter', source: p.uid, name: 'Tooth for Tooth' }));
    expect(damageTo(second, e)).toBe(50);
  });
});

describe('Assassin', () => {
  it('penetration % from different sources multiplies', () => {
    expect(combinePenPct(50, 25)).toBe(62.5);
    expect(combinePenPct(0, 25)).toBe(25);
    expect(combinePenPct(100, 25)).toBe(100);
  });

  it('Backstab: only from the 3 tiles behind an enemy engaged with someone else; 150% P.Atk, +25% P.Pen', () => {
    const tank = hero('sword_shield', [], 'T', 6); // Defense 63
    const { battle, units: [a, t, k] } = setup([
      { c: hero('dagger', ['backstab'], 'A', 2), team: 'player', at: { x: 5, y: 4 } },
      { c: tank, team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero('sword_shield', [], 'K'), team: 'player', at: { x: 3, y: 3 } },
    ]);
    expect(battle.canAim(a, SKILLS.backstab, t)).toBe(false); // not engaged
    t.engagedWith = k.uid;
    k.engagedWith = t.uid;
    expect(battle.behindTiles(t)).toEqual(expect.arrayContaining([{ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 2 }]));
    expect(battle.canAim(a, SKILLS.backstab, t)).toBe(true);
    expect(battle.canAim(a, SKILLS.backstab, t, { x: 4, y: 4 })).toBe(false); // beside it, not behind
    const def = battle.stat(t, 'defense');
    const pAtk = battle.stat(a, 'pAtk');
    const events = battle.perform(a, 'backstab', t);
    expect(damageTo(events, t)).toBe(Math.round(1.5 * pAtk * 100 / (100 + def * 0.75)));
  });

  it('Flicker Strike: 1 AP, 75% P.Atk, no engagement', () => {
    expect(SKILLS.flicker_strike).toMatchObject({ ap: 1, hits: [{ pAtk: 0.75 }] });
    expect(SKILLS.flicker_strike.tags).not.toContain('engage');
  });
});

describe('Weapon Master', () => {
  it('Power Strike: 150% on the target and 100% on whoever stands behind it', () => {
    const { battle, units: [w, a, b] } = setup([
      { c: hero('sword_shield', ['power_strike'], 'W'), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
      { c: hero(), team: 'player', at: { x: 5, y: 3 } }, // an ally behind
    ]);
    expect(battle.pierceVictim(w, SKILLS.power_strike, a)).toBe(b);
    const events = battle.perform(w, 'power_strike', a);
    expect(damageTo(events, a)).toBe(150);
    expect(damageTo(events, b)).toBe(100);
  });

  it('In the Zone: next turn, two basic attacks cost no AP and ignore the cooldown', () => {
    const { battle, units: [w, e] } = setup([
      { c: hero('sword_shield', ['in_the_zone'], 'W', 6), team: 'player', at: { x: 3, y: 3 } },
      { c: hero('sword_shield', [], 'E', 6), team: 'enemy', at: { x: 4, y: 3 } },
    ]);
    battle.perform(w, 'in_the_zone', w);
    expect(w.acted).toBe(true);
    battle.endPhase();
    battle.endPhase();
    expect(battle.apCost(w, SKILLS.basic_attack)).toBe(0);
    battle.perform(w, 'basic_attack', e);
    battle.perform(w, 'basic_attack', e);
    expect(w).toMatchObject({ ap: 2, acted: false });
    expect(battle.apCost(w, SKILLS.basic_attack)).toBe('end');
    battle.perform(w, 'basic_attack', e); // the usual one still ends the turn
    expect(w.acted).toBe(true);
  });
});

describe('performance', () => {
  it('a full AI-vs-AI battle with fog of war stays fast', () => {
    const party = ['greatsword', 'longbow', 'staff', 'dagger', 'sword_shield'].map((w, i) => hero(w, [], `P${i}`, 8));
    const foes = Array.from({ length: 10 }, (_, i) => makeEnemy('bandit', 8, makeRng(10 + i)));
    const map = openMap(18, 13);
    const units = [...party.map((c, i) => makeUnit(c, 'player', { x: 1, y: 2 + i * 2 })), ...foes.map((c, i) => makeUnit(c, 'enemy', { x: 16 - (i % 2), y: 1 + i }))];
    const battle = new Battle(map, units, makeRng(7));
    const start = performance.now();
    for (let round = 0; round < 12 && !battle.outcome(); round++) {
      for (const u of battle.readyUnits()) {
        const plan = planTurn(battle, u);
        if (battle.canMove(u) && (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y)) battle.move(u, plan.moveTo);
        const act = battle.canAct(u) && bestAction(battle, u);
        if (act) battle.perform(u, act.id, act.target);
        else if (battle.canAct(u)) battle.wait(u);
      }
      battle.endPhase();
    }
    expect(performance.now() - start).toBeLessThan(15000);
  });
});

describe('fog of war off (rules switch)', () => {
  it('everything is visible with vision disabled', () => {
    const { battle, units: [, e] } = setup([
      { c: hero(), team: 'player', at: { x: 0, y: 0 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 6 } },
    ], openMap(), NO_FOG);
    expect(battle.canSee('player', e)).toBe(true);
  });
});

describe('skill changes: Lightning Strike, Shocked, Explosion!, Draft and Smite hit allies', () => {
  const mage = (skills: string[], level = 9) => hero('staff', skills, 'M', level);
  const withRng = (specs: { c: Character; team: Team; at: Point }[], rng: () => number) => {
    const units = specs.map((s) => makeUnit(s.c, s.team, s.at));
    return { battle: new Battle(openMap(), units, rng, STAT_CONFIG), units };
  };

  it('Draft and Smite hit allies on the cross too (never the caster)', () => {
    for (const id of ['draft', 'smite']) {
      const { battle, units: [m, ally, e] } = setup([
        { c: mage([id]), team: 'player', at: { x: 4, y: 3 } },
        { c: hero(), team: 'player', at: { x: 5, y: 3 } },
        { c: hero(), team: 'enemy', at: { x: 6, y: 3 } },
      ]);
      expect(SKILLS[id].affects).toBe('any');
      const events = battle.perform(m, id, { x: 5, y: 3 }); // the cross covers the caster's tile too
      expect(damageTo(events, ally), id).toBeGreaterThan(0);
      expect(damageTo(events, e), id).toBeGreaterThan(0);
      expect(damageTo(events, m), id).toBe(0);
    }
  });

  it('Sucker Punch costs 1 AP, and its Stagger can be resisted', () => {
    expect(SKILLS.sucker_punch.ap).toBe(1);
    const { battle, units: [p, e] } = withRng([
      { c: hero('sword_shield', ['sucker_punch'], 'P', 4), team: 'player', at: { x: 3, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ], () => 0);
    e.stats.resist = 1000;
    const events = battle.perform(p, 'sucker_punch', e);
    expect(events).toContainEqual(expect.objectContaining({ type: 'resist', name: 'Staggered' }));
    expect(e.statuses.some((s) => s.id === 'staggered')).toBe(false);
  });

  it('Lightning Strike: marks a tile; at the start of the next turn it hits whoever is there for 200% M.Atk and Shocks them', () => {
    expect(SKILLS.lightning_strike).toMatchObject({ level: 6, mana: 40, range: 6, cooldown: 3, ap: 'end' });
    const { battle, units: [m, e] } = withRng([
      { c: mage(['lightning_strike']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 6, y: 3 } },
    ], () => 0.99);
    battle.perform(m, 'lightning_strike', { x: 6, y: 3 });
    expect(e.hp).toBe(e.stats.health); // not yet
    battle.endPhase();
    const events = battle.endPhase();
    expect(damageTo(events, e)).toBe(Math.round(2 * battle.stat(m, 'mAtk')));
    expect(e.statuses.find((s) => s.id === 'shocked')?.stacks).toBe(1);
    expect(battle.zones).toHaveLength(0);
  });

  it('Shocked: each skill has a 25% chance to fail, still spending its AP, mana and cooldown; loses a stack a turn', () => {
    expect(STATUSES.shocked).toMatchObject({ debuff: true, stacking: true, decay: true, failChance: 0.25 });
    let roll = 0.2; // under 25%: fails
    const { battle, units: [m, e] } = withRng([
      { c: mage(['arcane_bolt']), team: 'player', at: { x: 1, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 4, y: 3 } },
    ], () => roll);
    m.statuses.push({ id: 'shocked', name: 'Shocked', debuff: true, stacks: 2, amount: 0, turns: Infinity, tick: 'end' });
    const mp = m.mp;
    const events = battle.perform(m, 'arcane_bolt', e);
    expect(events).toContainEqual({ type: 'fail', target: m.uid, name: 'Arcane Bolt', status: 'Shocked' });
    expect(e.hp).toBe(e.stats.health);
    expect(m.mp).toBe(mp - 30);
    expect(m.ap).toBe(0);
    expect(m.cooldowns.arcane_bolt).toBe(1);
    battle.endPhase();
    battle.endPhase();
    expect(m.statuses.find((s) => s.id === 'shocked')?.stacks).toBe(1);
    roll = 0.3; // 25% or more: works
    battle.perform(m, 'arcane_bolt', e);
    expect(e.hp).toBeLessThan(e.stats.health);
  });

  it('Explosion!: spends all mana (100 at least); at the start of the next turn, 300% M.Atk + 150% of the mana spent at the center, down to 1/3 at 3 tiles', () => {
    const s = SKILLS.explosion_spell;
    expect(s).toMatchObject({ name: 'Explosion!', level: 9, mana: 100, allMana: true, ap: 'end', zone: { radius: 3, delayed: true } });
    const { battle, units: [m, center, edge, ally, out] } = withRng([
      { c: mage(['explosion_spell']), team: 'player', at: { x: 0, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 6, y: 3 } },
      { c: hero(), team: 'enemy', at: { x: 9, y: 3 } },
      { c: hero(), team: 'player', at: { x: 6, y: 5 } },
      { c: hero(), team: 'enemy', at: { x: 6, y: 0 } }, // 3 tiles: the edge
    ], () => 0.99);
    m.mp = 99;
    expect(battle.canUseSkill(m, 'explosion_spell')).toBe(false);
    m.mp = 160;
    battle.perform(m, 'explosion_spell', { x: 6, y: 3 });
    expect(m.mp).toBe(0);
    battle.endPhase();
    const events = battle.endPhase();
    const atk = battle.stat(m, 'mAtk');
    const full = 3 * atk + 1.5 * 160;
    expect(damageTo(events, center)).toBe(Math.round(full));
    expect(damageTo(events, ally)).toBe(Math.round(full * (1 - (2 / 3) * (2 / 3))));
    expect(damageTo(events, out)).toBe(Math.round(full * 0.3333));
    expect(damageTo(events, edge)).toBe(Math.round(full * 0.3333));
    expect(skillEffect(s)).toContain('150% of the mana spent');
  });
});
