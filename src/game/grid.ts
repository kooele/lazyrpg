import { STAT_CONFIG } from '../data/stats';
import type { Rng } from './character';

export type Terrain = 'grass' | 'forest' | 'river' | 'rock' | 'water';

const COSTS = STAT_CONFIG.movementCosts;

/**
 * moveCost = Movement points to enter the tile (null = impassable). Costs come from stats.json.
 * projectileCover = damage reduction (0-1) from projectiles for a unit standing there (forest).
 */
export const TERRAIN: Record<Terrain, { name: string; moveCost: number | null; projectileCover: number; blocksSight: boolean; color: number }> = {
  grass: { name: 'Grass', moveCost: COSTS.grass, projectileCover: 0, blocksSight: false, color: 0x4f7a3a },
  forest: { name: 'Forest', moveCost: COSTS.forest, projectileCover: STAT_CONFIG.forestProjectileReduction, blocksSight: false, color: 0x2f5a2c },
  river: { name: 'River', moveCost: COSTS.river, projectileCover: 0, blocksSight: false, color: 0x3f7fb8 },
  rock: { name: 'Rock', moveCost: null, projectileCover: 0, blocksSight: true, color: 0x6b6b72 },
  water: { name: 'Deep Water', moveCost: null, projectileCover: 0, blocksSight: false, color: 0x24508a },
};

/** Movement points that make one "tile" of reach (the grass cost). */
export const MOVEMENT_PER_TILE = COSTS.grass;

export interface Point {
  x: number;
  y: number;
}

export interface BattleMap {
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: Terrain[][];
}

export const key = (x: number, y: number) => `${x},${y}`;
/** Euclidean distance; all skill ranges use this (1.5 reaches diagonal neighbours). */
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const EPS = 1e-6;

/**
 * Is a tile at distance `d` within `range`? Ranges of `rangeRounding.fromRange` (2) and up
 * round the distance to the nearest whole tile, giving rounder, roomier shapes; smaller
 * ranges (1, 1.5) compare exactly so melee reach stays precise.
 */
export function withinRange(d: number, range: number): boolean {
  if (range >= STAT_CONFIG.rangeRounding.fromRange) return Math.round(d) <= range;
  return d <= range + EPS;
}
export const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
export const DIRS8: Point[] = [...DIRS, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }];

/** Tiles strictly between two tiles along the straight line joining their centers. */
export function tilesBetween(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const seen = new Set<string>();
  const n = Math.ceil(dist(a, b) * 8);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y) || seen.has(key(x, y))) continue;
    seen.add(key(x, y));
    out.push({ x, y });
  }
  return out;
}

/**
 * Line of sight: nothing that blocks sight (rock) lies strictly between the two tiles.
 * Pass `blocker` to also treat other tiles as blocking (used for line of fire).
 */
export function hasLineOfSight(map: BattleMap, a: Point, b: Point, blocker?: (p: Point) => boolean): boolean {
  for (const p of tilesBetween(a, b)) {
    if (!inBounds(map, p.x, p.y)) continue;
    if (TERRAIN[map.tiles[p.y][p.x]].blocksSight || blocker?.(p)) return false;
  }
  return true;
}

/** Tiles inside a cone of `angleDeg` width pointing from `from` toward `toward`. */
export function coneTiles(map: BattleMap, from: Point, toward: Point, angleDeg: number, radius: number): Point[] {
  const dir = Math.atan2(toward.y - from.y, toward.x - from.x);
  const half = (angleDeg / 2) * (Math.PI / 180) + EPS;
  const out: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (x === from.x && y === from.y) continue;
      if (!withinRange(dist(from, { x, y }), radius)) continue;
      let diff = Math.atan2(y - from.y, x - from.x) - dir;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) <= half) out.push({ x, y });
    }
  }
  return out;
}

export function inBounds(map: BattleMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function passable(map: BattleMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && TERRAIN[map.tiles[y][x]].moveCost !== null;
}

/** Number of passable tiles reachable from (sx, sy), ignoring units. */
function floodCount(map: BattleMap, sx: number, sy: number): number {
  const seen = new Set([key(sx, sy)]);
  const queue: Point[] = [{ x: sx, y: sy }];
  while (queue.length) {
    const p = queue.shift()!;
    for (const d of DIRS) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (passable(map, nx, ny) && !seen.has(key(nx, ny))) {
        seen.add(key(nx, ny));
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen.size;
}

/**
 * Random battlefield. The 3 leftmost and rightmost columns never contain
 * impassable terrain so both teams always have room to deploy, and every
 * passable tile is guaranteed to be connected.
 */
export function generateMap(rng: Rng, width = STAT_CONFIG.map.width, height = STAT_CONFIG.map.height): BattleMap {
  // Terrain density was tuned on a 12x9 map; scale the number of clusters with the area.
  const density = (width * height) / (12 * 9);
  const n = (base: number) => Math.max(1, Math.round(base * density));
  for (let attempt = 0; attempt < 200; attempt++) {
    const tiles: Terrain[][] = Array.from({ length: height }, () => Array<Terrain>(width).fill('grass'));
    const place = (terrain: Terrain, clusters: number, size: number, allowEdges: boolean) => {
      for (let c = 0; c < clusters; c++) {
        let x = Math.floor(rng() * width);
        let y = Math.floor(rng() * height);
        for (let i = 0; i < size; i++) {
          const edge = x < 3 || x >= width - 3;
          if (inBounds({ width, height, tiles }, x, y) && (allowEdges || !edge)) tiles[y][x] = terrain;
          const d = DIRS[Math.floor(rng() * 4)];
          x += d.x;
          y += d.y;
        }
      }
    };
    place('forest', n(4), 5, true);
    // A river winding from top to bottom through the middle of the map (most of the time).
    if (rng() < 0.75) {
      let x = Math.floor(width * 0.35 + rng() * width * 0.3);
      for (let y = 0; y < height; y++) {
        tiles[y][x] = 'river';
        const r = rng();
        const nx = r < 0.25 ? x - 1 : r > 0.75 ? x + 1 : x;
        if (nx !== x && nx >= 4 && nx < width - 4) {
          x = nx;
          tiles[y][x] = 'river'; // keep the river connected when it bends
        }
      }
    }
    place('rock', n(3), 3, false);
    if (rng() < 0.4) place('water', n(1), 5, false);

    const map: BattleMap = { width, height, tiles };
    let total = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (passable(map, x, y)) total++;
    if (floodCount(map, 0, 0) === total) return map;
  }
  // Fallback: open field.
  return { width, height, tiles: Array.from({ length: height }, () => Array<Terrain>(width).fill('grass')) };
}
