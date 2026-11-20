import type { Rng } from './character';

export type Terrain = 'grass' | 'forest' | 'rock' | 'water';

export const TERRAIN: Record<Terrain, { name: string; moveCost: number | null; defense: number; color: number }> = {
  grass: { name: 'Grass', moveCost: 1, defense: 0, color: 0x4f7a3a },
  forest: { name: 'Forest', moveCost: 2, defense: 2, color: 0x2f5a2c },
  rock: { name: 'Rock', moveCost: null, defense: 0, color: 0x6b6b72 },
  water: { name: 'Water', moveCost: null, defense: 0, color: 0x2d5f9a },
};

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
export const manhattan = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

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
export function generateMap(rng: Rng, width = 12, height = 9): BattleMap {
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
    place('forest', 4, 5, true);
    place('rock', 3, 3, false);
    if (rng() < 0.6) place('water', 1, 6, false);

    const map: BattleMap = { width, height, tiles };
    let total = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (passable(map, x, y)) total++;
    if (floodCount(map, 0, 0) === total) return map;
  }
  // Fallback: open field.
  return { width, height, tiles: Array.from({ length: height }, () => Array<Terrain>(width).fill('grass')) };
}
