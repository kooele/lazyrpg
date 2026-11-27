// Battle tile art: terrain (drawn once per battle and baked into a texture) and tile effects (Firestorm, Blizzard,
// Rain, Burning Ground, a Brutal Strike wind-up). Everything is drawn with Phaser Graphics from simple shapes, with a
// per-tile seeded jitter so neighbouring tiles of the same terrain don't look stamped.
import type Phaser from 'phaser';
import type { Terrain } from '../game/grid';

type G = Phaser.GameObjects.Graphics;

/** Deterministic per-tile random numbers in [0, 1): the same tile always looks the same. */
function tileRng(x: number, y: number, salt = 0): () => number {
  let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 2246822519)) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix two 0xRRGGBB colours (t = 0: a, 1: b). */
function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}
const shade = (c: number, t: number) => (t < 0 ? mix(c, 0x000000, -t) : mix(c, 0xffffff, t));

/** Which neighbours share a look with this tile (for river banks and shorelines). */
export interface TileNeighbours {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

/** One tile of terrain at (px, py), `size` pixels square. `x`, `y`: its map coordinates (for the seed). */
export function drawTerrainTile(g: G, terrain: Terrain, px: number, py: number, size: number, x: number, y: number, wet: TileNeighbours): void {
  const r = tileRng(x, y);
  const k = size / 56;
  const at = (u: number, v: number) => [px + u * k, py + v * k] as const;
  switch (terrain) {
    case 'grass':
      grass(g, px, py, size, k, r, at);
      break;
    case 'forest':
      grass(g, px, py, size, k, r, at, 0x3e6b30);
      forest(g, k, r, at);
      break;
    case 'river':
      river(g, px, py, size, k, r, at, wet);
      break;
    case 'water':
      deepWater(g, px, py, size, k, r, at, wet);
      break;
    case 'rock':
      grass(g, px, py, size, k, r, at, 0x5d6a4a);
      rock(g, k, r, at);
      break;
  }
}

type At = (u: number, v: number) => readonly [number, number];

/** Grass: a mottled base, darker patches, tufts of blades, now and then a flower or a pebble. */
function grass(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, base = 0x4f7a3a): void {
  g.fillStyle(shade(base, (r() - 0.5) * 0.08)).fillRect(px, py, size, size);
  // Soft patches of lighter and darker ground.
  // (Kept inside the tile, so neighbours don't paint over each other.)
  for (let i = 0; i < 5; i++) {
    const w = 10 + r() * 16;
    const h = 6 + r() * 10;
    const [cx, cy] = at(w / 2 + r() * (56 - w), h / 2 + r() * (56 - h));
    g.fillStyle(shade(base, r() < 0.5 ? -0.12 : 0.08), 0.5).fillEllipse(cx, cy, w * k, h * k);
  }
  // Tufts: a few blades fanning up from a point.
  for (let i = 0; i < 9; i++) {
    const [bx, by] = at(4 + r() * 48, 8 + r() * 46);
    const c = shade(base, r() < 0.5 ? 0.22 : -0.2);
    g.lineStyle(Math.max(1, 1.2 * k), c, 0.9);
    for (let b = -1; b <= 1; b++) {
      const h = (4 + r() * 4) * k;
      g.lineBetween(bx, by, bx + b * (1.5 + r() * 1.5) * k, by - h);
    }
  }
  if (r() < 0.22) {
    // A small flower.
    const [fx, fy] = at(8 + r() * 40, 8 + r() * 40);
    const petal = [0xf2e46b, 0xffffff, 0xd98ad9, 0xf0a04b][Math.floor(r() * 4)];
    g.fillStyle(petal, 0.95);
    for (let a = 0; a < 5; a++) g.fillCircle(fx + Math.cos((a / 5) * Math.PI * 2) * 1.6 * k, fy + Math.sin((a / 5) * Math.PI * 2) * 1.6 * k, 1.2 * k);
    g.fillStyle(0xc98a1e).fillCircle(fx, fy, 0.9 * k);
  }
  if (r() < 0.3) {
    const [sx, sy] = at(6 + r() * 44, 6 + r() * 44);
    g.fillStyle(0x7d7a6a, 0.9).fillEllipse(sx, sy, 3.2 * k, 2.2 * k);
    g.fillStyle(0xb5b1a0, 0.8).fillEllipse(sx - 0.5 * k, sy - 0.5 * k, 1.4 * k, 0.9 * k);
  }
}

/** Forest: two or three layered pines with a lit side, trunks, shadows and undergrowth. */
function forest(g: G, k: number, r: () => number, at: At): void {
  // Undergrowth: dark bushes along the bottom.
  for (let i = 0; i < 4; i++) {
    const [bx, by] = at(7 + r() * 42, 44 + r() * 5);
    g.fillStyle(0x284d23, 0.95).fillCircle(bx, by, (3 + r() * 2.5) * k);
    g.fillStyle(0x3c6a31, 0.9).fillCircle(bx - 1 * k, by - 1 * k, (1.5 + r() * 1.5) * k);
  }
  const trees = r() < 0.5 ? [[18, 43, 0.85], [37, 47, 0.95]] : [[15, 41, 0.72], [40, 42, 0.76], [27, 49, 0.9]];
  for (const [tx, ty, s] of trees) {
    const sx = tx + (r() - 0.5) * 4;
    const sc = s * 1.15 * (0.92 + r() * 0.16);
    const [bx, by] = at(sx, ty);
    // Shadow on the ground.
    g.fillStyle(0x0f2410, 0.4).fillEllipse(bx + 2 * k, by, 15 * sc * k, 4 * sc * k);
    // Trunk.
    g.fillStyle(0x4a3220).fillRect(bx - 1.6 * sc * k, by - 7 * sc * k, 3.2 * sc * k, 7 * sc * k);
    // Three tiers of needles, each a dark triangle with a lighter left half.
    for (let tier = 0; tier < 3; tier++) {
      const w = (13 - tier * 3) * sc * k;
      const bottom = by - (5 + tier * 8) * sc * k;
      const top = bottom - (13 - tier * 1.5) * sc * k;
      g.fillStyle(0x1c3d1b).fillTriangle(bx - w, bottom, bx, top, bx + w, bottom);
      g.fillStyle(0x2f5f2a).fillTriangle(bx - w, bottom, bx, top, bx, bottom);
      g.fillStyle(0x4d8a3e, 0.8).fillTriangle(bx - w * 0.6, bottom - 1.5 * k, bx - 0.5 * k, top + 3 * k, bx - 0.5 * k, bottom - 1.5 * k);
    }
    // A highlight on the tip.
    g.fillStyle(0x7fb865, 0.7).fillCircle(bx - 0.6 * k, by - (5 + 2 * 8 + 10) * sc * k, 1 * k);
  }
}

/** Shallow river: light moving water, sandy banks where it meets dry land, ripples and the odd stone. */
function river(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, wet: TileNeighbours): void {
  g.fillStyle(0x3f7fb8).fillRect(px, py, size, size);
  // Lighter current down the middle, darker toward the banks.
  g.fillStyle(0x5a98cc, 0.7).fillRect(px + size * 0.2, py, size * 0.6, size);
  g.fillStyle(0x76b0de, 0.45).fillRect(px + size * 0.36, py, size * 0.28, size);
  banks(g, px, py, size, k, r, wet, 0xc7b27a, 0x9c8656);
  // Ripples: short wavy strokes.
  g.lineStyle(Math.max(1, 1.4 * k), 0xcfe8fb, 0.75);
  for (let i = 0; i < 4; i++) {
    const [wx, wy] = at(10 + r() * 30, 8 + i * 12 + r() * 4);
    g.beginPath();
    g.moveTo(wx, wy);
    for (let s = 1; s <= 4; s++) g.lineTo(wx + s * 3 * k, wy + (s % 2 ? -1.6 : 0) * k);
    g.strokePath();
  }
  // A stepping stone or two (it's fordable).
  if (r() < 0.45) {
    const [sx, sy] = at(14 + r() * 28, 14 + r() * 28);
    g.fillStyle(0x6c7278).fillEllipse(sx, sy, 6 * k, 4 * k);
    g.fillStyle(0x9aa2a8).fillEllipse(sx - 0.8 * k, sy - 0.8 * k, 3.5 * k, 2 * k);
    g.lineStyle(Math.max(1, k), 0xe6f4ff, 0.6).strokeEllipse(sx, sy + 0.5 * k, 8 * k, 5.5 * k);
  }
}

/** Deep water: dark and still, lighter toward the shore, with white wave crests. */
function deepWater(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, wet: TileNeighbours): void {
  g.fillStyle(0x24508a).fillRect(px, py, size, size);
  g.fillStyle(0x1a3d6e, 0.8).fillRect(px + size * 0.15, py + size * 0.15, size * 0.7, size * 0.7);
  g.fillStyle(0x14315a, 0.7).fillEllipse(px + size / 2, py + size / 2, size * 0.5, size * 0.45);
  banks(g, px, py, size, k, r, wet, 0xb9a46c, 0x8c7748, 0x3d6fa8);
  // Wave crests: little arcs with foam.
  for (let i = 0; i < 3; i++) {
    const [wx, wy] = at(8 + r() * 34, 10 + i * 15 + r() * 5);
    g.lineStyle(Math.max(1, 1.6 * k), 0x7fa9dd, 0.85);
    g.beginPath();
    g.arc(wx, wy, 4.5 * k, Math.PI * 1.1, Math.PI * 1.9);
    g.strokePath();
    g.lineStyle(Math.max(1, 1.2 * k), 0xe6f1ff, 0.7);
    g.beginPath();
    g.arc(wx + 7 * k, wy + 1 * k, 3 * k, Math.PI * 1.15, Math.PI * 1.85);
    g.strokePath();
  }
}

/** Sand (and a wet edge) along the sides of a water tile that face dry land. */
function banks(g: G, px: number, py: number, size: number, k: number, r: () => number, wet: TileNeighbours, sand: number, dark: number, edge = 0x8fc3e8): void {
  const depth = 6 * k;
  const sides: [boolean, number, number, number, number][] = [
    [wet.n, px, py, size, depth],
    [wet.s, px, py + size - depth, size, depth],
    [wet.w, px, py, depth, size],
    [wet.e, px + size - depth, py, depth, size],
  ];
  for (const [isWet, x, y, w, h] of sides) {
    if (isWet) continue;
    g.fillStyle(sand).fillRect(x, y, w, h);
    // Pebbly grains.
    for (let i = 0; i < 6; i++) g.fillStyle(r() < 0.5 ? dark : shade(sand, 0.25), 0.9).fillCircle(x + r() * w, y + r() * h, (0.6 + r() * 0.7) * k);
  }
  // A pale wet line just inside each bank.
  g.lineStyle(Math.max(1, 1.2 * k), edge, 0.7);
  if (!wet.n) g.lineBetween(px, py + depth + 0.5 * k, px + size, py + depth + 0.5 * k);
  if (!wet.s) g.lineBetween(px, py + size - depth - 0.5 * k, px + size, py + size - depth - 0.5 * k);
  if (!wet.w) g.lineBetween(px + depth + 0.5 * k, py, px + depth + 0.5 * k, py + size);
  if (!wet.e) g.lineBetween(px + size - depth - 0.5 * k, py, px + size - depth - 0.5 * k, py + size);
}

/** Rock: a cluster of faceted boulders (lit top-left, shadowed bottom-right), with cracks and moss. */
function rock(g: G, k: number, r: () => number, at: At): void {
  const stones: [number, number, number][] = [[21 + r() * 3, 31, 16], [37 + r() * 2, 24, 12], [32, 43, 10]];
  for (const [cx, cy, rad] of stones) {
    const [x, y] = at(cx, cy);
    const R = rad * k * (0.9 + r() * 0.2);
    // Ground shadow, the dark body, then lit facets.
    g.fillStyle(0x1f2420, 0.45).fillEllipse(x + R * 0.2, y + R * 0.7, R * 1.9, R * 0.7);
    const pts = (scale: number, dx = 0, dy = 0) => Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const rr = R * scale * (0.82 + r() * 0.25);
      return { x: x + dx + Math.cos(a) * rr, y: y + dy + Math.sin(a) * rr * 0.85 };
    });
    g.fillStyle(0x4c4c53);
    polygon(g, pts(1));
    g.fillStyle(0x76767f);
    polygon(g, pts(0.78, -R * 0.12, -R * 0.14));
    g.fillStyle(0x9d9da6);
    polygon(g, pts(0.45, -R * 0.3, -R * 0.34));
    // A crack.
    g.lineStyle(Math.max(1, 1.1 * k), 0x34343a, 0.9);
    g.lineBetween(x - R * 0.1, y - R * 0.2, x + R * 0.25, y + R * 0.2);
    g.lineBetween(x + R * 0.25, y + R * 0.2, x + R * 0.15, y + R * 0.5);
    // Moss on the top.
    if (r() < 0.6) g.fillStyle(0x5f8a3e, 0.85).fillEllipse(x - R * 0.2, y - R * 0.62, R * 0.7, R * 0.22);
  }
}

/** Fill a closed polygon with the current fill style. */
function polygon(g: G, pts: { x: number; y: number }[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.closePath();
  g.fillPath();
}

// ---- tile effects ----------------------------------------------------------------------------------------

/** What a tile effect looks like: fire, ice, water (Rain), a delayed strike's warning, or anything else (arcane). */
export type EffectLook = 'fire' | 'ice' | 'water' | 'delayed' | 'arcane';

/**
 * One tile of a tile effect. `phase` (0-1) animates it a little (flames flicker, rain falls) when redrawn; `edge`
 * says which sides border tiles outside the effect, to draw its rim there.
 */
export function drawEffectTile(g: G, look: EffectLook, px: number, py: number, size: number, x: number, y: number, edge: TileNeighbours, phase = 0): void {
  const r = tileRng(x, y, 7);
  const k = size / 56;
  const at = (u: number, v: number) => [px + u * k, py + v * k] as const;
  switch (look) {
    case 'fire':
      fire(g, px, py, size, k, r, at, phase);
      break;
    case 'ice':
      ice(g, px, py, size, k, r, at);
      break;
    case 'water':
      rain(g, px, py, size, k, r, at, phase);
      break;
    case 'delayed':
      warning(g, px, py, size, k, phase);
      break;
    default:
      arcane(g, px, py, size, k, r, at, phase);
  }
  const rim = { fire: 0xffa040, ice: 0xd8f1ff, water: 0x7fa8ff, delayed: 0xff4040, arcane: 0xd0a8ff }[look];
  g.lineStyle(Math.max(2, 2.5 * k), rim, 0.85);
  if (!edge.n) g.lineBetween(px + 1, py + 1, px + size - 1, py + 1);
  if (!edge.s) g.lineBetween(px + 1, py + size - 1, px + size - 1, py + size - 1);
  if (!edge.w) g.lineBetween(px + 1, py + 1, px + 1, py + size - 1);
  if (!edge.e) g.lineBetween(px + size - 1, py + 1, px + size - 1, py + size - 1);
}

/** Fire: scorched, glowing ground under tongues of flame, with embers. */
function fire(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, phase: number): void {
  g.fillStyle(0x3a1408, 0.45).fillRect(px, py, size, size);
  g.fillStyle(0xff5a1a, 0.22).fillRect(px, py, size, size);
  // Glowing cracks in the ground.
  g.lineStyle(Math.max(1, 1.3 * k), 0xffb347, 0.7);
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = at(6 + r() * 44, 8 + r() * 40);
    const [bx, by] = at(6 + r() * 44, 8 + r() * 40);
    g.lineBetween(ax, ay, (ax + bx) / 2 + (r() - 0.5) * 6 * k, (ay + by) / 2);
    g.lineBetween((ax + bx) / 2 + (r() - 0.5) * 6 * k, (ay + by) / 2, bx, by);
  }
  // Flames: layered teardrops (red, orange, yellow), each flickering with the phase.
  for (let i = 0; i < 4; i++) {
    const [fx, fy] = at(9 + i * 12 + (r() - 0.5) * 5, 44 + r() * 8);
    const flick = 0.85 + 0.25 * Math.sin((phase + r()) * Math.PI * 2);
    const h = (16 + r() * 10) * k * flick;
    const w = (5 + r() * 2.5) * k;
    for (const [c, s, a] of [[0xd8321a, 1, 0.85], [0xff8a1e, 0.7, 0.9], [0xffe066, 0.38, 0.95]] as const) {
      g.fillStyle(c, a);
      g.fillTriangle(fx - w * s, fy, fx, fy - h * s, fx + w * s, fy);
      g.fillCircle(fx, fy - w * s * 0.2, w * s);
    }
  }
  // Embers drifting up.
  for (let i = 0; i < 5; i++) {
    const [ex, ey] = at(4 + r() * 48, 4 + ((r() * 40 + 40 - phase * 40) % 40));
    g.fillStyle(r() < 0.5 ? 0xffd166 : 0xff7a2e, 0.9).fillCircle(ex, ey, (0.8 + r() * 0.8) * k);
  }
}

/** Ice: a pale frost sheet with crystal shards and snowflakes. */
function ice(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At): void {
  g.fillStyle(0xdff3ff, 0.42).fillRect(px, py, size, size);
  // Frost cracks.
  g.lineStyle(Math.max(1, k), 0xffffff, 0.65);
  for (let i = 0; i < 4; i++) {
    // Kept inside the tile, so the frost ends where the effect does.
    const [ax, ay] = at(14 + r() * 28, 14 + r() * 28);
    const a = r() * Math.PI * 2;
    g.lineBetween(ax, ay, ax + Math.cos(a) * 12 * k, ay + Math.sin(a) * 12 * k);
  }
  // Crystal shards: thin upright diamonds with a lit face.
  for (let i = 0; i < 3; i++) {
    const [cx, cy] = at(10 + r() * 36, 26 + r() * 22);
    const h = (8 + r() * 8) * k;
    const w = (2.5 + r() * 1.5) * k;
    g.fillStyle(0x8fd0ff, 0.9).fillTriangle(cx - w, cy, cx, cy - h, cx + w, cy);
    g.fillStyle(0xe9f8ff, 0.95).fillTriangle(cx - w, cy, cx, cy - h, cx, cy);
    g.fillStyle(0x5aa8e0, 0.8).fillTriangle(cx - w, cy, cx + w, cy, cx, cy + h * 0.25);
  }
  // Snowflakes: six-armed stars.
  g.lineStyle(Math.max(1, 1.1 * k), 0xffffff, 0.95);
  for (let i = 0; i < 3; i++) {
    const [sx, sy] = at(6 + r() * 44, 6 + r() * 20);
    const s = (2.5 + r() * 1.5) * k;
    for (let a = 0; a < 3; a++) {
      const ang = (a / 3) * Math.PI + 0.3;
      g.lineBetween(sx - Math.cos(ang) * s, sy - Math.sin(ang) * s, sx + Math.cos(ang) * s, sy + Math.sin(ang) * s);
    }
  }
}

/** Rain: a wet sheen with puddles, ripple rings and falling streaks. */
function rain(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, phase: number): void {
  g.fillStyle(0x1d3f8a, 0.3).fillRect(px, py, size, size);
  for (let i = 0; i < 2; i++) {
    const [cx, cy] = at(12 + r() * 32, 18 + r() * 28);
    const w = (12 + r() * 10) * k;
    g.fillStyle(0x4f7fd8, 0.45).fillEllipse(cx, cy, w, w * 0.45);
    g.lineStyle(Math.max(1, k), 0xbcd4ff, 0.75).strokeEllipse(cx, cy, w * 0.5, w * 0.22);
  }
  g.lineStyle(Math.max(1, 1.1 * k), 0xcfe0ff, 0.7);
  for (let i = 0; i < 7; i++) {
    const [dx, dy] = at(2 + r() * 50, (r() * 56 + phase * 56) % 50);
    g.lineBetween(dx, dy, dx - 2 * k, dy + 7 * k);
  }
}

/** A delayed strike's warning (Brutal Strike wind-up): a red target mark, pulsing with the phase. */
function warning(g: G, px: number, py: number, size: number, k: number, phase: number): void {
  const cx = px + size / 2;
  const cy = py + size / 2;
  const pulse = 0.75 + 0.25 * Math.sin(phase * Math.PI * 2);
  g.fillStyle(0xff2a2a, 0.18 * pulse + 0.1).fillRect(px, py, size, size);
  g.lineStyle(Math.max(2, 2.5 * k), 0xff4d4d, 0.9);
  g.strokeCircle(cx, cy, 17 * k);
  g.lineStyle(Math.max(1, 1.5 * k), 0xffb0b0, 0.8);
  g.strokeCircle(cx, cy, 9 * k * pulse);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.lineBetween(cx + dx * 12 * k, cy + dy * 12 * k, cx + dx * 23 * k, cy + dy * 23 * k);
  // Cracks spreading from the middle.
  g.lineStyle(Math.max(1, k), 0x5a0a0a, 0.8);
  g.lineBetween(cx, cy, cx + 8 * k, cy + 5 * k);
  g.lineBetween(cx, cy, cx - 6 * k, cy + 7 * k);
  g.lineBetween(cx, cy, cx - 3 * k, cy - 8 * k);
}

/** Anything else: a violet arcane circle with motes. */
function arcane(g: G, px: number, py: number, size: number, k: number, r: () => number, at: At, phase: number): void {
  g.fillStyle(0x8a4dff, 0.22).fillRect(px, py, size, size);
  const cx = px + size / 2;
  const cy = py + size / 2;
  g.lineStyle(Math.max(1, 1.4 * k), 0xd0a8ff, 0.8).strokeCircle(cx, cy, 16 * k);
  g.lineStyle(Math.max(1, k), 0xe8d6ff, 0.6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + phase * Math.PI;
    const b = a + (Math.PI * 2) / 3;
    g.lineBetween(cx + Math.cos(a) * 16 * k, cy + Math.sin(a) * 16 * k, cx + Math.cos(b) * 16 * k, cy + Math.sin(b) * 16 * k);
  }
  for (let i = 0; i < 4; i++) {
    const [mx, my] = at(6 + r() * 44, 6 + r() * 44);
    g.fillStyle(0xf2e6ff, 0.85).fillCircle(mx, my, (0.8 + r()) * k);
  }
}
