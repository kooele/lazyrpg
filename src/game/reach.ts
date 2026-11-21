// Pure helpers for what a skill can reach, independent of a battle. Used by the
// battle rules and by the UI's tile diagrams.
import { hasTag } from '../data/content';
import type { LosRule, SkillDef } from '../data/types';
import { EPS, dist, withinRange, type Point } from './grid';

export interface ReachContext {
  /** The user's current Movement (for 'movement' skills). */
  movement: number;
  /** The user's weapon basic attack (for 'weapon' skills). */
  basic: SkillDef;
}

export function rangeFor(s: SkillDef, ctx: ReachContext): number {
  if (hasTag(s, 'movement')) return Math.floor((s.rangeScale ?? 1) * ctx.movement);
  if (hasTag(s, 'weapon')) return ctx.basic.range;
  return s.range;
}

export function minRangeFor(s: SkillDef, ctx: ReachContext): number {
  return hasTag(s, 'weapon') ? ctx.basic.minRange : s.minRange;
}

export function losFor(s: SkillDef, ctx: ReachContext): LosRule | undefined {
  return hasTag(s, 'weapon') ? ctx.basic.los : s.los;
}

/**
 * The tiles a skill covers, as offsets from the user (who stands at 0,0).
 *  targets – tiles you can aim at (range band)
 *  area    – tiles hit around you
 *  cone    – an example cone pointing right (aim it any way)
 *  self    – only you
 */
export function skillShape(s: SkillDef, ctx: ReachContext): { kind: 'targets' | 'area' | 'cone' | 'self'; tiles: Point[] } {
  const tiles: Point[] = [];
  const scan = (r: number, keep: (p: Point, d: number) => boolean) => {
    const R = Math.ceil(r) + 1;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = dist({ x: 0, y: 0 }, { x, y });
      if ((x || y) && keep({ x, y }, d)) tiles.push({ x, y });
    }
  };
  switch (s.target) {
    case 'self':
      if (!s.aoeRadius) return { kind: 'self', tiles };
      scan(s.aoeRadius, (_p, d) => withinRange(d, s.aoeRadius!));
      return { kind: 'area', tiles };
    case 'cone': {
      const half = ((s.cone?.angle ?? 60) / 2) * (Math.PI / 180) + EPS;
      const r = s.cone?.radius ?? s.range;
      scan(r, (p, d) => withinRange(d, r) && Math.abs(Math.atan2(p.y, p.x)) <= half);
      return { kind: 'cone', tiles };
    }
    default: {
      const r = rangeFor(s, ctx);
      const min = minRangeFor(s, ctx);
      scan(r, (_p, d) => d >= min - EPS && withinRange(d, r));
      return { kind: 'targets', tiles };
    }
  }
}
