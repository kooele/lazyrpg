// Utility-scoring AI. For every reachable tile x every ready skill x every
// sensible aim point, score the outcome and pick the best. If nothing scores,
// advance toward the enemy and set up overwatch if the weapon has it.
import { SKILLS, STATUSES, isFree } from '../data/content';
import type { SkillDef } from '../data/types';
import type { Battle, Unit } from './battle';
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
  let score = 0;
  for (const t of battle.targetsOf(u, skill, aim, from)) {
    const friendly = t.team === u.team;
    if (skill.hits?.length) {
      const total = battle.previewHits(u, skill, t).reduce((a, b) => a + b, 0);
      const pool = t.hp + battle.shieldOf(t);
      const dealt = Math.min(total, pool);
      const hit = battle.hitChance(u, t, skill) / 100;
      if (friendly) score -= dealt * 1.5;
      else score += hit * (dealt + (total >= pool ? 400 : 0));
    }
    if (!friendly) {
      for (const a of skill.applyStatus ?? []) {
        const def = STATUSES[a.status];
        score += t.stats.health * (def.damagePctMaxHpPerStack ?? 0) * (a.stacks ?? 1) * a.turns;
        if (def.statMods) score += 15 * a.turns;
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
      if (threatened && battle.shieldOf(t) === 0) score += t.stats.health * skill.shield.maxHpPct * 0.5;
    }
    if (skill.cleanse) {
      if (!friendly) {
        if (t.statuses.some((s) => s.debuff)) score -= 50;
        continue;
      }
      for (const s of t.statuses) {
        if (!s.debuff) continue;
        score += t.stats.health * (STATUSES[s.id]?.damagePctMaxHpPerStack ?? 0) * s.stacks * s.turns + 15 * s.turns;
      }
    }
  }
  return score;
}

function bestFrom(
  battle: Battle, u: Unit, from: Point, wantFree: boolean, includeDefensive = true,
): { action: AiAction; score: number } | null {
  let best: { action: AiAction; score: number } | null = null;
  for (const id of battle.skillIds(u)) {
    const skill = SKILLS[id];
    if (!battle.isUsable(u, id) || isFree(skill) !== wantFree || skill.cone || skill.teleport) continue;
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

/** Decide where to move: the tile with the best available action, else closer to the enemy. */
/**
 * Should an engaged unit break away? Ranged fighters (bow, staff bolt users) do,
 * as long as the opponent's free opportunity attack won't drop them too low.
 */
export function shouldDisengage(battle: Battle, u: Unit): boolean {
  const opp = battle.opponentOf(u);
  if (!opp || !battle.canAct(u)) return false;
  const ranged = battle.basicAttack(u).range > 1.5 || battle.basicAttack(u).los !== undefined;
  if (!ranged) return false;
  const hit = battle.previewHits(opp, battle.basicAttack(opp), u).reduce((a, b) => a + b, 0);
  return u.hp - hit > u.stats.health * 0.3;
}

export function planTurn(battle: Battle, u: Unit): AiPlan {
  const reach = battle.canMove(u) ? battle.reachable(u) : new Map([[key(u.x, u.y), { cost: 0, prev: null }]]);
  const tiles = [...reach.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });

  let best: AiPlan | null = null;
  let bestScore = 0;
  // Choose where to go based on attacks and support only: defensive self-buffs
  // shouldn't make a unit stand still instead of advancing.
  for (const tile of tiles) {
    const found = bestFrom(battle, u, tile, false, false);
    if (!found) continue;
    const free = bestFrom(battle, u, tile, true)?.score ?? 0;
    const terrain = TERRAIN[battle.map.tiles[tile.y][tile.x]].defense * 2;
    const score = found.score + free * 0.5 + terrain - reach.get(key(tile.x, tile.y))!.cost * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = { moveTo: tile, action: found.action };
    }
  }
  if (best) return best;

  const field = distanceField(battle, u);
  let moveTo: Point = { x: u.x, y: u.y };
  let bestDist = field.get(key(u.x, u.y)) ?? Infinity;
  for (const tile of tiles) {
    const d = field.get(key(tile.x, tile.y)) ?? Infinity;
    if (d < bestDist) {
      bestDist = d;
      moveTo = tile;
    }
  }
  return { moveTo };
}

/**
 * Play one unit's whole turn (used by the tests and the simulator; the battle
 * scene runs the same steps with animations).
 */
export function runAiTurn(battle: Battle, u: Unit): void {
  if (shouldDisengage(battle, u)) battle.disengage(u);
  if (!u.alive) return;
  const plan = planTurn(battle, u);
  if (battle.canMove(u) && (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y)) battle.move(u, plan.moveTo);
  if (!battle.canAct(u)) return;
  const free = bestFreeAction(battle, u);
  if (free) battle.perform(u, free.id, free.target);
  if (!battle.canAct(u) || battle.outcome()) return;
  const action = bestAction(battle, u);
  if (action) battle.perform(u, action.id, action.target);
  else battle.wait(u);
  // Free actions also work after the main action (e.g. Kick once something is in reach).
  if (!free && u.alive && !battle.outcome()) {
    const late = bestFreeAction(battle, u);
    if (late) battle.perform(u, late.id, late.target);
  }
}
