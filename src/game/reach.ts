// Pure helpers for what a skill can reach, independent of a battle. Used by the
// battle rules and by the UI's tile diagrams.
import { hasTag } from '../data/content';
import type { LosRule, SkillDef } from '../data/types';
import { EPS, MOVEMENT_PER_TILE, dist, withinRange, type Point } from './grid';

export interface ReachContext {
  /** The user's current Movement (for 'movement' skills). */
  movement: number;
  /** The user's weapon basic attack (for 'weapon' skills). */
  basic: SkillDef;
  /** The weapon mode with a tag (Circle Swing always swings a bow in its 'melee' mode). */
  basicMode?: (tag: string) => SkillDef | undefined;
}

/** The basic attack a 'weapon' skill uses: its forced mode ('basicMode') if it has one, else the current one. */
function basicFor(s: SkillDef, ctx: ReachContext): SkillDef {
  return (s.basicMode && ctx.basicMode?.(s.basicMode)) || ctx.basic;
}

export function rangeFor(s: SkillDef, ctx: ReachContext): number {
  // Movement is in points (grass = 4 per tile); convert to tiles.
  if (hasTag(s, 'movement') || hasTag(s, 'leap')) return Math.floor(((s.rangeScale ?? 1) * ctx.movement) / MOVEMENT_PER_TILE);
  if (hasTag(s, 'weapon')) return basicFor(s, ctx).range;
  return s.range;
}

export function minRangeFor(s: SkillDef, ctx: ReachContext): number {
  return hasTag(s, 'weapon') ? basicFor(s, ctx).minRange : s.minRange;
}

export function losFor(s: SkillDef, ctx: ReachContext): LosRule | undefined {
  return hasTag(s, 'weapon') ? basicFor(s, ctx).los : s.los;
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
    case 'passive':
      return { kind: 'self', tiles };
    case 'self': {
      // A 'weapon' area without its own radius (Circle Swing) reaches as far as the weapon.
      const r = s.aoeRadius ?? (hasTag(s, 'weapon') ? basicFor(s, ctx).range + (s.weaponRangeBonus ?? 0) : 0);
      if (!r) return { kind: 'self', tiles };
      scan(r, (_p, d) => withinRange(d, r));
      return { kind: 'area', tiles };
    }
    case 'move': {
      // Dash: tiles within the unit's Movement on open grass.
      const r = Math.floor(ctx.movement / MOVEMENT_PER_TILE);
      scan(r, (p) => Math.abs(p.x) + Math.abs(p.y) <= r);
      return { kind: 'targets', tiles };
    }
    case 'cone': {
      const half = ((s.cone?.angle ?? 60) / 2) * (Math.PI / 180) + EPS;
      const r = s.cone?.radius ?? rangeFor(s, ctx);
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
