// Simple utility-scoring enemy AI: try every reachable tile x every ready action
// x every target, pick the highest score. If nothing is in reach, advance.
import { getAction, type Battle, type Unit } from './battle';
import { DIRS, TERRAIN, key, passable, type Point } from './grid';

export interface AiPlan {
  moveTo: Point;
  action?: { id: string; target: Point };
}

function scoreAction(battle: Battle, u: Unit, actionId: string, from: Point, target: Point): number {
  const action = getAction(u, actionId);
  const hit = battle.affected(u, action, target, from);
  let score = 0;
  for (const t of hit) {
    if (action.kind === 'damage') {
      const dmg = battle.damage(u, t, action);
      const expected = (dmg * battle.hitChance(u, t, action)) / 100;
      score += Math.min(expected, t.hp) + (dmg >= t.hp ? 12 : 0);
      if (action.status) score += 2;
    } else if (action.kind === 'heal') {
      const missing = t.base.maxHp - t.hp;
      if (missing / t.base.maxHp >= 0.3) score += Math.min(missing, battle.healAmount(u, action)) * 1.2;
    } else if (action.status && !t.statuses.some((s) => s.name === action.status!.name)) {
      score += 3;
    }
  }
  return score;
}

/** Walking distance (ignoring units) from every tile to the nearest living foe. */
function distanceField(battle: Battle, u: Unit): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Point[] = [];
  for (const foe of battle.living().filter((f) => f.team !== u.team)) {
    dist.set(key(foe.x, foe.y), 0);
    queue.push({ x: foe.x, y: foe.y });
  }
  while (queue.length) {
    const p = queue.shift()!;
    const d = dist.get(key(p.x, p.y))!;
    for (const dir of DIRS) {
      const nx = p.x + dir.x;
      const ny = p.y + dir.y;
      if (passable(battle.map, nx, ny) && !dist.has(key(nx, ny))) {
        dist.set(key(nx, ny), d + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
}

export function planTurn(battle: Battle, u: Unit): AiPlan {
  const reach = battle.reachable(u);
  const tiles = [...reach.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });

  let best: AiPlan | null = null;
  let bestScore = 0;
  for (const tile of tiles) {
    const terrainBonus = TERRAIN[battle.map.tiles[tile.y][tile.x]].defense * 0.25;
    for (const id of battle.actionIds(u)) {
      if (!battle.isReady(u, id)) continue;
      const action = getAction(u, id);
      for (const target of battle.validTargets(u, action, tile)) {
        const raw = scoreAction(battle, u, id, tile, target);
        if (raw <= 0) continue; // pointless action (e.g. healing a healthy ally)
        const score = raw + terrainBonus - reach.get(key(tile.x, tile.y))!.cost * 0.01;
        if (score > bestScore) {
          bestScore = score;
          best = { moveTo: tile, action: { id, target } };
        }
      }
    }
  }
  if (best) return best;

  // Nothing to do this turn: move as close to the enemy as possible.
  const dist = distanceField(battle, u);
  let moveTo: Point = { x: u.x, y: u.y };
  let bestDist = dist.get(key(u.x, u.y)) ?? Infinity;
  for (const tile of tiles) {
    const d = dist.get(key(tile.x, tile.y)) ?? Infinity;
    if (d < bestDist) {
      bestDist = d;
      moveTo = tile;
    }
  }
  return { moveTo };
}
