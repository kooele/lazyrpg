// Utility-scoring AI. For every reachable tile x every ready skill x every
// sensible aim point, score the outcome and pick the best. If nothing scores,
// advance toward the enemy and set up overwatch if the weapon has it.
//
// Enemy types fight one of four ways (enemies.json "ai"):
//  beast  – acts alone: only goes for the nearest target, ignores danger, flees once hurt.
//  tribal – fights as a group: keeps a loose formation, piles onto targets its allies are on,
//           and the whole group runs once it's broken.
//  human  – fights tactically (cover, danger, regrouping), flees from danger, and surrenders
//           when it can't escape death.
//  evil   – no self-preservation: never flees, ignores danger and its own allies, finishes off the weak.
import { SKILLS, STATUSES, hasTag, isFree } from '../data/content';
import { ENEMIES } from '../data/enemies';
import type { EnemyAi, SkillDef } from '../data/types';
import type { Battle, ReachInfo, Team, Unit } from './battle';
import { DIRS, MOVEMENT_PER_TILE, TERRAIN, dist, key, passable, type Point } from './grid';

export interface AiAction {
  id: string;
  target: Point;
}

export interface AiPlan {
  moveTo: Point;
  /** Best main action from the destination (re-check with bestAction after moving). */
  action?: AiAction;
}

/** How a unit fights. Adventurers (when the AI plays them) and unknown types fight like humans. */
export function aiTypeOf(u: Unit): EnemyAi {
  const t = u.character.enemyType;
  return (t && ENEMIES[t]?.ai) || 'human';
}

const ratio = (u: Unit) => u.hp / u.stats.health;
/** Beasts run once they're this hurt. */
const BEAST_FLEE_AT = 0.4;
/** Tribal fighters stay within this many tiles of the nearest other member of the group. */
const TRIBE_SPREAD = 3;

/** The foe closest to `u` (what a beast goes for). */
function nearestFoe(battle: Battle, u: Unit): Unit | null {
  const foes = battle.living().filter((f) => f.team !== u.team && !battle.hiddenFrom(u, f));
  return foes.length ? foes.reduce((a, b) => (dist(a, u) <= dist(b, u) ? a : b)) : null;
}

/** Other living tribal fighters on `u`'s side. */
function tribe(battle: Battle, u: Unit): Unit[] {
  return battle.living(u.team).filter((a) => a !== u && aiTypeOf(a) === 'tribal');
}

/** Teams whose tribal group has broken and is running (stays broken for the rest of the battle). */
const routed = new WeakMap<Battle, Set<Team>>();

/**
 * Has `team`'s tribal group broken? It breaks when half of it is gone (and the other side isn't
 * outnumbered), or when the survivors are badly hurt overall. Then every tribal fighter runs.
 */
export function tribeRouted(battle: Battle, team: Team): boolean {
  if (routed.get(battle)?.has(team)) return true;
  const all = battle.units.filter((x) => x.team === team && aiTypeOf(x) === 'tribal');
  const standing = all.filter((x) => x.alive);
  if (all.length < 2 || standing.length === 0) return false;
  const hp = standing.reduce((a, x) => a + x.hp, 0) / standing.reduce((a, x) => a + x.stats.health, 0);
  const foes = battle.living().filter((f) => f.team !== team).length;
  const broken = (standing.length <= all.length / 2 && foes >= standing.length) || hp < 0.3;
  if (broken) {
    if (!routed.has(battle)) routed.set(battle, new Set());
    routed.get(battle)!.add(team);
  }
  return broken;
}

/** Aim points worth trying for a skill used from `from`. */
function aimPoints(battle: Battle, skill: SkillDef, from: Point): Point[] {
  switch (skill.target) {
    case 'self':
      return [from];
    case 'line':
    case 'unit':
      return battle.living().map((t) => ({ x: t.x, y: t.y }));
    default:
      return [];
  }
}

function scoreSkill(battle: Battle, u: Unit, skill: SkillDef, from: Point, aim: Point): number {
  skill = battle.skillFor(u, skill);
  const kind = aiTypeOf(u);
  // A beast only goes for whoever is closest.
  const focus = kind === 'beast' ? nearestFoe(battle, u) : null;
  const pack = kind === 'tribal' ? tribe(battle, u) : [];
  let score = 0;
  for (const t of battle.targetsOf(u, skill, aim, from)) {
    const friendly = t.team === u.team;
    if (focus && !friendly && t !== focus) continue;
    if (skill.hits?.length) {
      const total = battle.previewHits(u, skill, t).reduce((a, b) => a + b, 0);
      const pool = t.hp + battle.shieldOf(t);
      const dealt = Math.min(total, pool);
      if (friendly) score -= dealt * (kind === 'evil' ? 0.5 : 1.5); // evil barely cares who else gets hurt
      else if (kind === 'evil') {
        // Evil goes for the kill: big reward for finishing someone, more for hitting the already hurt.
        score += dealt * (2 - ratio(t)) + (total >= pool ? 900 : 0);
      } else {
        score += dealt + (total >= pool ? 400 : 0);
        // Tribal fighters pile onto a target their friends are already on.
        if (pack.length) score += dealt * 0.25 * Math.min(2, pack.filter((a) => dist(a, t) <= 2).length);
      }
    }
    for (const a of skill.applyStatus ?? []) {
      const def = STATUSES[a.status];
      if (!friendly && def.debuff) {
        // Worth less against targets likely to resist it.
        const lands = 1 - battle.resistChance(t) / 100;
        // Decaying statuses (Burn, Slow) lose a stack a turn: n stacks give n + (n-1) + ... stack-turns.
        const n = a.stacks ?? 1;
        const stackTurns = def.decay ? (n * (n + 1)) / 2 : n * a.turns;
        const lasts = def.decay ? n : a.turns;
        score += lands * t.stats.health * (def.damagePctMaxHpPerStack ?? 0) * stackTurns;
        if (def.statMods || def.statPct) score += lands * 15 * lasts;
      } else if (friendly && !def.debuff && !t.statuses.some((x) => x.id === a.status)) {
        // Buffs (Howl's and War Cry's Frenzy, Protection): the damage they add or prevent while they last.
        score += buffValue(battle, u, skill, from, t, a.status, a.turns);
      }
    }
    if (skill.heal) {
      const amount = Math.min(t.stats.health - t.hp, battle.healAmount(u, skill));
      if (!friendly) score -= amount * 2; // never heal the enemy on purpose
      else if ((t.stats.health - t.hp) / t.stats.health >= 0.25) score += amount;
    }
    if (skill.shield) {
      // Only worth it if an enemy could walk up and hit us next turn.
      const threatened = battle.living().some((f) => f.team !== u.team && dist(f, from) <= f.stats.movement / MOVEMENT_PER_TILE + 1.5);
      if (threatened && battle.shieldOf(t) === 0) score += battle.shieldAmount(u, skill, t) * (friendly ? 0.5 : -1);
    }
    if (skill.cleanse) {
      if (!friendly) {
        if (t.statuses.some((s) => s.debuff)) score -= 50;
        continue;
      }
      for (const s of t.statuses) {
        if (!s.debuff) continue;
        const def = STATUSES[s.id];
        // Decaying statuses (Burn, Slow) last as many turns as they have stacks.
        const lasts = def?.decay ? s.stacks : s.turns;
        const stackTurns = def?.decay ? (s.stacks * (s.stacks + 1)) / 2 : s.stacks * s.turns;
        score += t.stats.health * (def?.damagePctMaxHpPerStack ?? 0) * stackTurns + 15 * lasts;
      }
    }
  }
  return score;
}

/**
 * What a buff on ally `t` is worth: the extra damage it lets `t` deal, plus the damage it saves `t` from,
 * over the turns it really covers, counting only foes that could be in reach on those turns.
 * A status lasting N turns covers N - 1 later turns of each side, plus the rest of this turn for a unit
 * that can still act in it (not the caster of a turn-ending skill such as War Cry).
 */
function buffValue(battle: Battle, u: Unit, skill: SkillDef, from: Point, t: Unit, status: string, turns: number): number {
  const pos = t === u ? from : { x: t.x, y: t.y };
  const actsNow = t.team === battle.phase && battle.canAct(t) && !(t === u && skill.ap === 'end');
  const later = Math.max(0, turns - 1);
  const tiles = (x: Unit) => battle.stat(x, 'movement') / MOVEMENT_PER_TILE;
  const damage = (from: Unit, to: Unit) => battle.previewHits(from, battle.basicAttack(from), to).reduce((a, b) => a + b, 0);
  const foes = battle.living().filter((f) => f.team !== t.team);
  const before = {
    dealt: new Map(foes.map((f) => [f, damage(t, f)])),
    taken: new Map(foes.map((f) => [f, damage(f, t)])),
  };
  return battle.withStatus(u, t, status, () => {
    let value = 0;
    // Offence: each covered turn of t's, its best extra hit on a foe it could reach by then.
    const ownTurns = [...(actsNow ? [1] : []), ...Array.from({ length: later }, (_, i) => (actsNow ? 2 : 1) + i)];
    for (const moves of ownTurns) {
      let best = 0;
      for (const f of foes) {
        if (dist(pos, f) > moves * tiles(t) + battle.basicAttack(t).range + 0.5) continue;
        best = Math.max(best, damage(t, f) - before.dealt.get(f)!);
      }
      value += best;
    }
    // Defence: each covered foe turn, the damage each foe that could reach t no longer deals.
    for (let i = 1; i <= later; i++) {
      for (const f of foes) {
        if (dist(pos, f) > i * tiles(f) + battle.basicAttack(f).range + 0.5) continue;
        value += Math.max(0, before.taken.get(f)! - damage(f, t));
      }
    }
    return value;
  });
}

function bestFrom(
  battle: Battle, u: Unit, from: Point, wantFree: boolean, includeDefensive = true,
): { action: AiAction; score: number } | null {
  let best: { action: AiAction; score: number } | null = null;
  for (const id of battle.skillIds(u)) {
    const skill = SKILLS[id];
    if (!battle.isUsable(u, id) || !battle.canPay(u, skill) || isFree(skill) !== wantFree || skill.cone || (skill.teleport && !skill.charge) || skill.target === 'move') continue;
    if (!includeDefensive && skill.shield) continue;
    for (const aim of aimPoints(battle, skill, from)) {
      if (!battle.canTarget(u, skill, aim, from)) continue;
      const score = scoreSkill(battle, u, skill, from, aim);
      if (score > 0 && (!best || score > best.score)) best = { action: { id, target: aim }, score };
    }
  }
  return best;
}

/** Best free action (e.g. Kick) from where the unit stands now. */
export function bestFreeAction(battle: Battle, u: Unit): AiAction | null {
  if (!battle.canAct(u)) return null; // a turn-ending skill already ended the turn
  return bestFrom(battle, u, u, true)?.action ?? null;
}

/**
 * Best main action from where the unit stands now. Falls back to overwatch
 * (aimed at the nearest enemy) or null to wait.
 */
export function bestAction(battle: Battle, u: Unit): AiAction | null {
  const best = bestFrom(battle, u, u, false);
  if (best) return best.action;
  const foes = battle.living().filter((f) => f.team !== u.team);
  if (foes.length === 0) return null;
  const nearest = foes.reduce((a, b) => (dist(a, u) <= dist(b, u) ? a : b));
  for (const id of battle.skillIds(u)) {
    const skill = SKILLS[id];
    if (!skill.cone || !battle.isReady(u, id)) continue;
    const tiles = battle.rangeTiles(u, skill);
    if (tiles.length === 0) continue;
    const aim = tiles.reduce((a, b) => (dist(a, nearest) <= dist(b, nearest) ? a : b));
    return { id, target: aim };
  }
  return null;
}

/** Walking distance (ignoring units) from every tile to the nearest living foe. */
function distanceField(battle: Battle, u: Unit): Map<string, number> {
  const d = new Map<string, number>();
  const queue: Point[] = [];
  for (const foe of battle.living().filter((f) => f.team !== u.team)) {
    d.set(key(foe.x, foe.y), 0);
    queue.push({ x: foe.x, y: foe.y });
  }
  while (queue.length) {
    const p = queue.shift()!;
    const cur = d.get(key(p.x, p.y))!;
    for (const dir of DIRS) {
      const nx = p.x + dir.x;
      const ny = p.y + dir.y;
      if (passable(battle.map, nx, ny) && !d.has(key(nx, ny))) {
        d.set(key(nx, ny), cur + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return d;
}

// ---- self-preservation ------------------------------------------------------------

/** For each foe of `u`: how far it threatens (move + longest attack) and its basic-attack damage on `u`. */
function foeThreats(battle: Battle, u: Unit): { foe: Unit; reach: number; damage: number }[] {
  return battle.living().filter((f) => f.team !== u.team).map((f) => {
    let range = battle.basicAttack(f).range;
    for (const id of battle.skillIds(f)) {
      const sk = battle.skillFor(f, SKILLS[id]);
      if (sk.hits?.length && sk.affects !== 'ally') range = Math.max(range, battle.skillRange(f, sk));
    }
    const damage = battle.previewHits(f, battle.basicAttack(f), u).reduce((a, b) => a + b, 0);
    return { foe: f, reach: f.stats.movement / MOVEMENT_PER_TILE + range + 0.5, damage };
  });
}

/** Rough damage `u` could take next turn standing on `tile`. */
export function threatAt(battle: Battle, u: Unit, tile: Point, threats = foeThreats(battle, u)): number {
  return threats.reduce((sum, t) => (dist(t.foe, tile) <= t.reach ? sum + t.damage : sum), 0);
}

const isLow = (u: Unit) => u.hp / u.stats.health < 0.35;

/** Allies in decent shape that a hurt unit can fall back on. */
function healthyAllies(battle: Battle, u: Unit): Unit[] {
  return battle.living(u.team).filter((a) => a !== u && a.hp / a.stats.health >= 0.5);
}

/**
 * Should a badly hurt unit fall back? Only if it has healthy allies to regroup with;
 * a unit that is alone (or whose friends are all hurt too) makes a last stand instead,
 * so fights never turn into an endless chase. Beasts and evil never regroup.
 */
export function wantsToRetreat(battle: Battle, u: Unit): boolean {
  const kind = aiTypeOf(u);
  if (kind === 'beast' || kind === 'evil') return false;
  return isLow(u) && healthyAllies(battle, u).length > 0;
}

/** How much a unit cares about danger: a little when healthy, a lot when it wants to retreat. Beasts and evil don't. */
export function caution(battle: Battle, u: Unit): number {
  const kind = aiTypeOf(u);
  if (kind === 'evil') return 0;
  if (kind === 'beast') return 0.05;
  if (wantsToRetreat(battle, u)) return 1.3;
  if (isLow(u)) return 0.15; // last stand: nothing left to lose
  return ratio(u) >= 0.6 ? 0.15 : 0.5;
}

/**
 * A side's fighting strength: its total HP times its total attack (the larger of P.Atk and M.Atk per unit), so
 * numbers count twice over, as they do in a real fight (two fighters deal twice the damage and take twice as long to kill).
 */
export function sideStrength(battle: Battle, team: Unit['team']): number {
  const units = battle.living(team);
  const hp = units.reduce((s, u) => s + u.hp, 0);
  const atk = units.reduce((s, u) => s + Math.max(u.stats.pAtk, u.stats.mAtk), 0);
  return hp * atk;
}

/** A human holds firm while its side's strength is at least this share of its foes'. */
export const HOLD_FIRM_ODDS = 0.5;

/**
 * Is this human's side still in the fight? It has allies standing and the odds aren't too bad (its side's
 * strength at least HOLD_FIRM_ODDS of the other side's). Then a hurt human falls back to its friends
 * (wantsToRetreat) rather than running for the edge or giving up.
 */
export function holdsFirm(battle: Battle, u: Unit): boolean {
  if (!battle.living(u.team).some((a) => a !== u)) return false;
  const foes = sideStrength(battle, u.team === 'enemy' ? 'player' : 'enemy');
  return foes <= 0 || sideStrength(battle, u.team) >= HOLD_FIRM_ODDS * foes;
}

/**
 * Does this enemy want out of the fight? Beasts once hurt; a tribal fighter when its group has broken;
 * a human when badly hurt, or hurt and in reach of a blow that could kill it, but only once its side is losing
 * or it's on its own (see holdsFirm). Evil never.
 */
export function wantsToFlee(battle: Battle, u: Unit): boolean {
  if (u.team !== 'enemy') return false;
  switch (aiTypeOf(u)) {
    case 'evil': return false;
    case 'beast': return ratio(u) < BEAST_FLEE_AT;
    case 'tribal': return tribeRouted(battle, u.team);
    default: return (isLow(u) || (ratio(u) < 0.6 && threatAt(battle, u, u) >= u.hp)) && !holdsFirm(battle, u);
  }
}

/** Has this unit made it to the edge while fleeing? Then it escapes (see Battle.escape). */
export function shouldEscape(battle: Battle, u: Unit): boolean {
  return u.alive && wantsToFlee(battle, u) && battle.onEdge(u);
}

/** Tiles from `p` to the nearest map edge. */
function edgeDistance(battle: Battle, p: Point): number {
  return Math.min(p.x, p.y, battle.map.width - 1 - p.x, battle.map.height - 1 - p.y);
}

/** Tiles a unit can end its move on this turn (just its own tile if it can't move). */
function reachableTiles(battle: Battle, u: Unit): { reach: Map<string, ReachInfo>; tiles: Point[] } {
  const reach = battle.canMove(u) ? battle.reachable(u) : new Map([[key(u.x, u.y), { cost: 0, prev: null }]]);
  const tiles = [...reach.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
  return { reach, tiles };
}

/**
 * Should a human enemy give up? When it wants to flee, can't reach the edge this turn, and
 * every tile it could get to is within reach of enough damage to kill it.
 */
export function shouldSurrender(battle: Battle, u: Unit): boolean {
  if (!u.alive || u.team !== 'enemy' || aiTypeOf(u) !== 'human' || !wantsToFlee(battle, u)) return false;
  const { reach, tiles } = reachableTiles(battle, u);
  if (battle.canMove(u) && tiles.some((t) => battle.onEdge(t))) return false;
  const threats = foeThreats(battle, u);
  const safest = Math.min(...tiles.map((t) => threatAt(battle, u, t, threats) + zoneHazard(battle, u, reach, t)));
  return safest >= u.hp;
}

/**
 * Could `u` get out of its opponent's reach this turn if it broke away? Not when it can't move
 * (Frozen, or its movement AP is spent) or every tile it could reach is still next to the opponent.
 * Breaking away then only hands the opponent a free attack, and the unit ends up fighting it again.
 */
function canGetAway(battle: Battle, u: Unit, opp: Unit): boolean {
  if (u.moved || u.ap < 1 || battle.isFrozen(u)) return false;
  for (const k of battle.reachable(u).keys()) {
    const [x, y] = k.split(',').map(Number);
    if (dist({ x, y }, opp) > 1.5) return true;
  }
  return false;
}

/**
 * Should an engaged unit break away? Ranged fighters do, and so does anyone badly
 * hurt, as long as the opponent's free opportunity attack won't finish them off
 * and they can actually get away (see canGetAway). It also has to mean it: the turn
 * it would play once free must end out of the opponent's reach (see leavesOpponent).
 */
export function shouldDisengage(battle: Battle, u: Unit): boolean {
  const opp = battle.opponentOf(u);
  if (!opp || !battle.canAct(u) || aiTypeOf(u) === 'evil') return false;
  if (!canGetAway(battle, u, opp)) return false;
  const ranged = isRanged(battle, u);
  const hit = battle.previewHits(opp, battle.basicAttack(opp), u).reduce((a, b) => a + b, 0);
  let wants: boolean;
  if (wantsToFlee(battle, u)) wants = u.hp - hit > 0;
  else if (ranged) wants = u.hp - hit > u.stats.health * 0.3;
  else wants = wantsToRetreat(battle, u) && u.hp - hit > u.stats.health * 0.1;
  return wants && leavesOpponent(battle, u, opp, hit);
}

/** Fights at range (a bow, even while engagement forces it into Melee mode; reach weapons like the spear; line-of-sight attacks). */
function isRanged(battle: Battle, u: Unit): boolean {
  const raw = SKILLS[battle.skillIds(u)[0]];
  return !!raw?.modes?.some((m) => !hasTag(SKILLS[m], 'melee')) || battle.basicAttack(u).range > 1.5 || battle.basicAttack(u).los !== undefined;
}

/**
 * What it costs a free ranged unit to end its turn on `tile`: every adjacent foe can engage it next turn,
 * and breaking away again hands that foe a free basic attack. So ranged units step back before they shoot.
 */
function pinCost(battle: Battle, u: Unit, tile: Point): number {
  if (u.engagedWith || !isRanged(battle, u)) return 0;
  let cost = 0;
  for (const f of battle.living()) {
    if (f.team === u.team || dist(f, tile) > 1.5 + 1e-9) continue;
    cost += battle.previewHits(f, battle.basicAttack(f), u).reduce((a, b) => a + b, 0);
  }
  return cost;
}

/**
 * Would `u`, once broken away from `opp` (and hurt by its opportunity attack), plan a turn that ends
 * out of the opponent's reach? If its best plan is to stay next to it (say, a point-blank shot or a
 * spear thrust from where it stands), breaking away only hands over a free attack, and the unit ends
 * up engaged again (by an Engage skill such as Kick or Spear Thrust) or right back in melee range.
 * Plans with the engagement lifted for a moment and puts everything back afterwards.
 */
function leavesOpponent(battle: Battle, u: Unit, opp: Unit, hit: number): boolean {
  const saved = { mine: u.engagedWith, theirs: opp.engagedWith, hp: u.hp, held: holdTurns.get(u) };
  u.engagedWith = null;
  if (opp.engagedWith === u.uid) opp.engagedWith = null;
  u.hp = Math.max(1, u.hp - hit);
  try {
    return dist(planTurn(battle, u).moveTo, opp) > 1.5 + 1e-9;
  } finally {
    u.engagedWith = saved.mine;
    opp.engagedWith = saved.theirs;
    u.hp = saved.hp;
    if (saved.held === undefined) holdTurns.delete(u);
    else holdTurns.set(u, saved.held);
  }
}

/**
 * Decide where to move: the tile with the best action, weighed against how dangerous
 * it is (more so when hurt). Badly hurt units with nothing worth doing retreat;
 * others advance on the enemy.
 */
export function planTurn(battle: Battle, u: Unit): AiPlan {
  const reach = battle.canMove(u) ? battle.reachable(u) : new Map([[key(u.x, u.y), { cost: 0, prev: null }]]);
  const tiles = [...reach.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });

  const threats = foeThreats(battle, u);
  const care = caution(battle, u);
  const danger = new Map(tiles.map((t) => [key(t.x, t.y), threatAt(battle, u, t, threats)]));
  const hazard = (t: Point) => zoneHazard(battle, u, reach, t);

  // Fleeing enemies run for the map edge: the safest edge tile if they can reach one this turn,
  // otherwise as close to an edge as they can get (safest first among equals).
  if (wantsToFlee(battle, u) && battle.canMove(u)) {
    const risk = (t: Point) => danger.get(key(t.x, t.y))! + hazard(t);
    const exits = tiles.filter((t) => battle.onEdge(t));
    if (exits.length) return { moveTo: exits.reduce((a, b) => (risk(b) < risk(a) ? b : a)) };
    const rank = (t: Point) => edgeDistance(battle, t) * 10000 + risk(t);
    return { moveTo: tiles.reduce((a, b) => (rank(b) < rank(a) ? b : a)) };
  }

  const best = attackPlan(battle, u, tiles, reach, danger, care);
  if (best) return best.plan;

  // Badly hurt with nothing worth the risk: regroup with healthy allies, on the safest
  // tile available (ties: closer to an ally).
  const field = distanceField(battle, u);
  if (wantsToRetreat(battle, u)) {
    const friends = healthyAllies(battle, u);
    const nearFriend = (p: Point) => Math.min(...friends.map((f) => dist(f, p)));
    let moveTo: Point = { x: u.x, y: u.y };
    let bestRisk = (danger.get(key(u.x, u.y)) ?? Infinity) + hazard(u);
    let bestNear = nearFriend(u);
    for (const tile of tiles) {
      const r = danger.get(key(tile.x, tile.y))! + hazard(tile);
      const near = nearFriend(tile);
      if (r < bestRisk - 1e-9 || (Math.abs(r - bestRisk) < 1e-9 && near < bestNear)) {
        bestRisk = r;
        bestNear = near;
        moveTo = tile;
      }
    }
    return { moveTo };
  }

  // Otherwise advance on the enemy. Wounded units won't walk into a spot that could get
  // them killed, but only hold back for a couple of turns; healthy ones always press on
  // (otherwise weak units like rats never come).
  const held = holdTurns.get(u) ?? 0;
  const wary = u.hp / u.stats.health < 0.6 && held < MAX_HOLD_TURNS;
  // Zone damage counts as extra distance (5% of max HP ~ one tile), so units walk around Firestorms when they can.
  // Tribal fighters also keep their loose formation: straying from the group counts as extra distance.
  const zoneTiles = (t: Point) => hazard(t) / (u.stats.health * 0.05) + formation(battle, u, t) / 20;
  let moveTo: Point = { x: u.x, y: u.y };
  let bestDist = (field.get(key(u.x, u.y)) ?? Infinity) + zoneTiles(u);
  for (const tile of tiles) {
    const d = (field.get(key(tile.x, tile.y)) ?? Infinity) + zoneTiles(tile);
    const r = danger.get(key(tile.x, tile.y))!;
    if (d < bestDist && (!wary || r < u.hp || r <= danger.get(key(u.x, u.y))!)) {
      bestDist = d;
      moveTo = tile;
    }
  }
  holdTurns.set(u, moveTo.x === u.x && moveTo.y === u.y ? held + 1 : 0);
  return { moveTo };
}

/**
 * The best place to move and act from (attacks and support only: defensive self-buffs
 * shouldn't make a unit stand still instead of advancing), with its score. Null if nothing scores.
 */
function attackPlan(
  battle: Battle, u: Unit, tiles: Point[], reach: Map<string, ReachInfo>, danger: Map<string, number>, care: number,
): { plan: AiPlan; score: number } | null {
  const leastDanger = Math.min(...danger.values());
  let best: { plan: AiPlan; score: number } | null = null;
  for (const tile of tiles) {
    const found = bestFrom(battle, u, tile, false, false);
    if (!found) continue;
    const free = bestFrom(battle, u, tile, true)?.score ?? 0;
    const terrain = TERRAIN[battle.map.tiles[tile.y][tile.x]].defense * 2;
    // Danger that can't be avoided anyway (even the safest reachable tile has it) costs nothing,
    // so a unit that's already in the thick of it still fights instead of freezing.
    const risk = care * (danger.get(key(tile.x, tile.y))! - leastDanger);
    // Zone damage on the way and at the end is certain, so it counts in full.
    const score = found.score + free * 0.5 + terrain - risk - zoneHazard(battle, u, reach, tile) - reach.get(key(tile.x, tile.y))!.cost * 0.1
      - formation(battle, u, tile) - pinCost(battle, u, tile);
    if (score > (best?.score ?? 0)) best = { plan: { moveTo: tile, action: found.action }, score };
  }
  return best;
}

/**
 * Which bow mode the unit should be in this turn (index), or null to leave it. Archers fight
 * at range: they pick whichever ranged mode (Direct or Indirect) gives the best turn, and
 * only fight in Melee when engaged (which happens on its own; see Battle.activeMode).
 */
export function preferredMode(battle: Battle, u: Unit): number | null {
  const modes = battle.modesOf(u);
  if (!modes || battle.opponentOf(u) || !battle.skillIds(u).some((id) => SKILLS[id].switchMode)) return null;
  const ranged = modes.map((m, i) => ({ m, i })).filter(({ m }) => !hasTag(SKILLS[m], 'melee')).map(({ i }) => i);
  if (ranged.length === 0) return null;
  const reach = battle.canMove(u) ? battle.reachable(u) : new Map([[key(u.x, u.y), { cost: 0, prev: null }]]);
  const tiles = [...reach.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
  const threats = foeThreats(battle, u);
  const danger = new Map(tiles.map((t) => [key(t.x, t.y), threatAt(battle, u, t, threats)]));
  const care = caution(battle, u);
  const current = u.weaponMode;
  // Ties keep the current mode if it's a ranged one, otherwise the first ranged mode (Direct).
  let bestMode = ranged.includes(current) ? current : ranged[0];
  let bestScore = -Infinity;
  try {
    for (const i of [bestMode, ...ranged.filter((i) => i !== bestMode)]) {
      u.weaponMode = i;
      const score = attackPlan(battle, u, tiles, reach, danger, care)?.score ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestMode = i;
      }
    }
  } finally {
    u.weaponMode = current;
  }
  return bestMode === current ? null : bestMode;
}

/**
 * Cost of standing on `tile` for a tribal fighter's loose formation: straying more than TRIBE_SPREAD tiles
 * from the nearest member of its group, or crowding right next to several of them. 0 for everyone else.
 */
function formation(battle: Battle, u: Unit, tile: Point): number {
  if (aiTypeOf(u) !== 'tribal') return 0;
  const pack = tribe(battle, u);
  if (pack.length === 0) return 0;
  const nearest = Math.min(...pack.map((a) => dist(a, tile)));
  const crowd = pack.filter((a) => dist(a, tile) <= 1.5).length;
  return Math.max(0, nearest - TRIBE_SPREAD) * 20 + Math.max(0, crowd - 1) * 10;
}

/** Damage `u` would take from zones walking to `tile` (each zone tile entered) and ending its turn there. */
function zoneHazard(battle: Battle, u: Unit, reach: Map<string, ReachInfo>, tile: Point): number {
  if (battle.zones.length === 0) return 0;
  return battle.zoneDanger(u, tile.x === u.x && tile.y === u.y ? [] : battle.pathTo(reach, tile));
}

/** Turns in a row a unit has held back instead of advancing (so it never waits forever). */
const holdTurns = new WeakMap<Unit, number>();
const MAX_HOLD_TURNS = 2;

/**
 * Play one unit's whole turn (used by the tests and the simulator; the battle
 * scene runs the same steps with animations).
 */
export function runAiTurn(battle: Battle, u: Unit): void {
  if (shouldSurrender(battle, u)) {
    battle.surrender(u);
    return;
  }
  if (shouldDisengage(battle, u)) battle.disengage(u);
  if (!u.alive) return;
  const mode = preferredMode(battle, u);
  if (mode !== null) battle.setWeaponMode(u, mode);
  const plan = planTurn(battle, u);
  if (battle.canMove(u) && (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y)) battle.move(u, plan.moveTo);
  if (shouldEscape(battle, u)) {
    battle.escape(u);
    return;
  }
  if (!battle.canAct(u)) return;
  const free = bestFreeAction(battle, u);
  if (free) battle.perform(u, free.id, free.target);
  if (!battle.canAct(u) || battle.outcome()) return;
  const action = bestAction(battle, u);
  if (action) battle.perform(u, action.id, action.target);
  else battle.wait(u);
  // Free actions still work after a move or a skill that doesn't end the turn.
  if (!free && u.alive && !battle.outcome()) {
    const late = bestFreeAction(battle, u);
    if (late) battle.perform(u, late.id, late.target);
  }
}
