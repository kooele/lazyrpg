// Pure battle rules (no rendering). BattleScene drives this and animates the events it returns.
import { DEFAULT_WEAPON, ENEMY_COLOR, SKILLS, STATUSES, WEAPONS, hasTag, isFree } from '../data/content';
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { STAT_CONFIG, type StatConfig } from '../data/stats';
import type { Character, DamagePart, LosRule, SkillDef, StatKey, Stats } from '../data/types';
import { allSkills, deriveStats, modelFor, newId, type Rng } from './character';
import { losFor, minRangeFor, rangeFor, type ReachContext } from './reach';
import {
  DIRS, DIRS8, EPS, TERRAIN, coneTiles, dist, hasLineOfSight, inBounds, key, passable, tilesBetween, withinRange,
  type BattleMap, type Point,
} from './grid';

export type Team = 'player' | 'enemy';

export interface Status {
  /** 'shield', or a status id from skills.json ("burn", "slow"...). */
  id: string;
  name: string;
  /** Debuffs can be removed by Cleanse. */
  debuff: boolean;
  stacks: number;
  /** Remaining shield points. */
  amount: number;
  /** Turns left; counts down at the start or end of the unit's own turn (see `tick`). */
  turns: number;
  tick: 'start' | 'end';
}

export interface Overwatch {
  skillId: string;
  tiles: Set<string>;
  interrupt: boolean;
  los?: LosRule;
}

export interface Unit {
  uid: string;
  team: Team;
  character: Character;
  /** Maximum stats (level + weapon). */
  stats: Stats;
  hp: number;
  x: number;
  y: number;
  alive: boolean;
  cooldowns: Record<string, number>;
  statuses: Status[];
  /** Has this unit moved during its team's current turn? */
  moved: boolean;
  /** Has this unit used its action (or waited)? That ends its turn. */
  acted: boolean;
  /** Something happened that can't be undone (free action, triggered overwatch): no undo move. */
  locked: boolean;
  /** Where the unit stood when its turn began (for undoing a move). */
  startPos: Point;
  /** Active overwatch / intercept, cleared at the start of the unit's next turn. */
  overwatch: Overwatch | null;
  /** uid of the unit this one is engaged with (see the Engage tag). */
  engagedWith: string | null;
  /** 'weapon'-tagged skills are unusable while true (nothing sets it yet). */
  weaponDisabled: boolean;
  /** Fled off the edge of the map (counts as gone, not dead). */
  escaped?: boolean;
}

/** Why damage happened: a skill, a status tick (e.g. Burn), overwatch, or an opportunity attack on disengage. */
export type DamageCause = 'skill' | 'status' | 'overwatch' | 'opportunity';

export type BattleEvent =
  | { type: 'damage'; source?: string; target: string; amount: number; absorbed: number; killed: boolean; cause: DamageCause }
  | { type: 'miss'; source: string; target: string; chance: number; cause: DamageCause }
  | { type: 'engage'; source: string; target: string }
  | { type: 'disengage'; source: string; target: string; reason: 'disengage' | 'separated' | 'displaced' | 'escaped' }
  | { type: 'heal'; source: string; target: string; amount: number }
  | { type: 'shield'; source: string; target: string; amount: number }
  | { type: 'status'; source: string; target: string; name: string }
  | { type: 'cleanse'; source: string; target: string; removed: string[] }
  | { type: 'move'; target: string; from: Point; to: Point; kind: 'knockback' | 'teleport' | 'charge' }
  | { type: 'overwatch'; source: string; skillId: string }
  | { type: 'escape'; target: string };

export interface MoveResult {
  /** Tiles actually walked (may stop early if intercepted or killed). */
  path: Point[];
  /** Overwatch shots, keyed by the index in `path` where they happened. */
  triggers: { index: number; events: BattleEvent[] }[];
  interrupted: boolean;
}

export interface ReachInfo {
  cost: number;
  prev: string | null;
}

/** XP for winning a battle (stats.json xpPerVictory; the same at every stage). */
export function victoryXp(_stage: number): number {
  return STAT_CONFIG.xpPerVictory;
}

export function makeUnit(character: Character, team: Team, pos: Point): Unit {
  const stats = deriveStats(character);
  return {
    uid: newId('u'),
    team,
    character,
    stats,
    hp: stats.health,
    x: pos.x,
    y: pos.y,
    alive: true,
    cooldowns: {},
    statuses: [],
    moved: false,
    acted: false,
    locked: false,
    startPos: { x: pos.x, y: pos.y },
    overwatch: null,
    engagedWith: null,
    weaponDisabled: false,
  };
}

/** Damage multiplier from Defense: each `defenseScale` points = +100% effective health. */
export function defenseMultiplier(defense: number): number {
  const k = STAT_CONFIG.defenseScale;
  return defense >= 0 ? k / (k + defense) : 2 - k / (k - defense);
}

/**
 * Battle rules with XCOM-style alternating turns: every player unit may move
 * once and act once, in any order, then every enemy unit does the same.
 */
export class Battle {
  readonly units: Unit[];
  phase: Team = 'player';
  round = 1;

  constructor(readonly map: BattleMap, units: Unit[], readonly rng: Rng, readonly rules: StatConfig = STAT_CONFIG) {
    this.units = units;
    this.beginPhase('player');
  }

  // ---- queries ----------------------------------------------------------------

  unit(uid: string): Unit {
    const u = this.units.find((x) => x.uid === uid);
    if (!u) throw new Error(`No unit ${uid}`);
    return u;
  }

  living(team?: Team): Unit[] {
    return this.units.filter((u) => u.alive && (!team || u.team === team));
  }

  unitAt(x: number, y: number): Unit | undefined {
    return this.units.find((u) => u.alive && u.x === x && u.y === y);
  }

  /** Current stat including status effects and terrain (forest adds Defense). */
  stat(u: Unit, stat: StatKey): number {
    let value = u.stats[stat];
    for (const s of u.statuses) {
      const mod = STATUSES[s.id]?.statMods?.[stat];
      if (mod) value += mod * Math.max(1, s.stacks);
    }
    if (stat === 'defense') {
      value += TERRAIN[this.map.tiles[u.y][u.x]].defense;
    }
    let pct = 0;
    for (const s of u.statuses) pct += (STATUSES[s.id]?.statPct?.[stat] ?? 0) * Math.max(1, s.stacks);
    if (pct) value *= Math.max(0, 1 + pct);
    if (stat === 'movement') value = Math.max(0, value);
    return Math.round(value);
  }

  // ---- skill properties that depend on the user (tags) ----------------------------

  /** The weapon's basic attack (first weapon skill). */
  basicAttack(u: Unit): SkillDef {
    return SKILLS[allSkills(u.character)[0] ?? WEAPONS[DEFAULT_WEAPON].skills[0]];
  }

  /** What the unit's tag-dependent skills scale from (Movement, weapon). */
  reachContext(u: Unit): ReachContext {
    return { movement: this.stat(u, 'movement'), basic: this.basicAttack(u) };
  }

  /** Effective range: 'movement' skills scale with Movement, 'weapon' skills use the weapon's range. */
  skillRange(u: Unit, s: SkillDef): number {
    return rangeFor(s, this.reachContext(u));
  }

  skillMinRange(u: Unit, s: SkillDef): number {
    return minRangeFor(s, this.reachContext(u));
  }

  skillLos(u: Unit, s: SkillDef): LosRule | undefined {
    return losFor(s, this.reachContext(u));
  }

  /** Off cooldown and not blocked by a disabled weapon. */
  isUsable(u: Unit, skillId: string): boolean {
    return this.isReady(u, skillId) && !(u.weaponDisabled && hasTag(SKILLS[skillId], 'weapon'));
  }

  // ---- engagement ------------------------------------------------------------------

  opponentOf(u: Unit): Unit | null {
    return u.engagedWith ? this.unit(u.engagedWith) : null;
  }

  private engage(a: Unit, b: Unit): void {
    a.engagedWith = b.uid;
    b.engagedWith = a.uid;
    // Engaged units can't attack anyone else, so standing watches end.
    a.overwatch = null;
    b.overwatch = null;
  }

  private breakEngagement(u: Unit): Unit | null {
    const o = this.opponentOf(u);
    u.engagedWith = null;
    if (o && o.engagedWith === u.uid) o.engagedWith = null;
    return o;
  }

  /** Engagements end when the two units are pushed or teleported apart. */
  private separationEvents(): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const u of this.living()) {
      const o = this.opponentOf(u);
      if (o && (!o.alive || dist(u, o) > 1.5 + EPS)) {
        this.breakEngagement(u);
        events.push({ type: 'disengage', source: u.uid, target: o.uid, reason: 'separated' });
      }
    }
    return events;
  }

  /** Is this skill an attack on enemies (as opposed to healing/buffing)? */
  private isAttack(s: SkillDef): boolean {
    return s.affects !== 'ally' && (!!s.hits?.length || !!s.cone || !!s.applyStatus?.length);
  }

  /**
   * Why an engaged unit can't use `skill` on `tile` (null if it can): engaged units
   * can't move (incl. Movement skills), attack anyone but their opponent, or heal/cleanse anyone but themselves.
   */
  engagementBlock(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): string | null {
    const opp = this.opponentOf(caster);
    if (!opp) return null;
    // Teleports (Arcane Shift) are the exception: they slip out of the engagement for free.
    const busy = `Engaged with ${opp.character.name}: you can't target anyone else until you disengage.`;
    const targets = this.targetsOf(caster, skill, tile, from);
    // Charge still works on the opponent itself (you're already next to them, so there's no dash).
    if (skill.charge) {
      if (targets.length === 1 && targets[0] === opp) return null;
      return targets.length ? busy : `Engaged with ${opp.character.name}: disengage before moving.`;
    }
    if (hasTag(skill, 'movement')) return `Engaged with ${opp.character.name}: disengage before moving.`;
    // Heal and Cleanse only on yourself while engaged.
    if ((skill.heal || skill.cleanse) && targets.some((t) => t !== caster)) return busy;
    if (!this.isAttack(skill)) return null;
    if (skill.cone) return `Engaged with ${opp.character.name}: can't watch other enemies.`;
    // Area attacks around you (Circle Swing) are fine as long as they hit the opponent;
    // aimed attacks (incl. Spear Thrust's line) must hit exactly the opponent.
    const ok = skill.target === 'self' ? targets.includes(opp) : targets.length === 1 && targets[0] === opp;
    return ok ? null : busy;
  }

  /** The opponent's free basic attack when someone breaks away from an engagement (ignores range). */
  private opportunityAttack(attacker: Unit, victim: Unit): BattleEvent[] {
    if (!attacker.alive || !victim.alive) return [];
    const basic = this.basicAttack(attacker);
    const chance = this.hitChance(attacker, victim, basic, true);
    if (!this.rollHit(chance)) return [{ type: 'miss', source: attacker.uid, target: victim.uid, chance, cause: 'opportunity' }];
    const events: BattleEvent[] = [];
    for (const part of basic.hits ?? []) {
      if (!victim.alive) break;
      events.push(this.dealDamage(victim, this.hitDamage(attacker, victim, part), attacker.uid, 'opportunity'));
    }
    return events;
  }

  /**
   * Break off an engagement. The opponent gets a free basic attack (opportunity attack).
   * Doesn't use the unit's action; it can then move and act normally.
   */
  disengage(u: Unit): BattleEvent[] {
    const opp = this.opponentOf(u);
    if (!opp) throw new Error(`${u.character.name} is not engaged`);
    if (!this.canAct(u)) throw new Error(`${u.character.name} has already acted`);
    const events: BattleEvent[] = [];
    this.breakEngagement(u);
    events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'disengage' });
    events.push(...this.opportunityAttack(opp, u));
    u.locked = true;
    u.startPos = { x: u.x, y: u.y };
    if (!u.alive) u.acted = true;
    return events;
  }

  /** Is the tile on the outer edge of the map? */
  onEdge(p: Point): boolean {
    return p.x === 0 || p.y === 0 || p.x === this.map.width - 1 || p.y === this.map.height - 1;
  }

  /** An enemy standing on the map edge flees the battle and is removed. Ends its turn. */
  escape(u: Unit): BattleEvent[] {
    if (u.team !== 'enemy' || !u.alive || !this.onEdge(u)) throw new Error(`${u.character.name} can't escape from here`);
    const events: BattleEvent[] = [];
    const opp = this.breakEngagement(u);
    if (opp) events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'separated' });
    u.alive = false;
    u.escaped = true;
    u.overwatch = null;
    u.acted = true;
    events.push({ type: 'escape', target: u.uid });
    return events;
  }

  shieldOf(u: Unit): number {
    return u.statuses.filter((s) => s.id === 'shield').reduce((sum, s) => sum + s.amount, 0);
  }

  outcome(): 'victory' | 'defeat' | null {
    if (this.living('enemy').length === 0) return 'victory';
    if (this.living('player').length === 0) return 'defeat';
    return null;
  }

  /** Weapon skills followed by skill-tree skills. */
  skillIds(u: Unit): string[] {
    return allSkills(u.character);
  }

  isReady(u: Unit, skillId: string): boolean {
    return (u.cooldowns[skillId] ?? 0) <= 0;
  }

  canMove(u: Unit): boolean {
    return u.alive && u.team === this.phase && !u.moved && !u.acted && !u.engagedWith;
  }

  canAct(u: Unit): boolean {
    return u.alive && u.team === this.phase && !u.acted;
  }

  /** Units of the current team that still have an action this turn. */
  readyUnits(): Unit[] {
    return this.living(this.phase).filter((u) => !u.acted);
  }

  /** Can `u` use this skill right now (ignoring targets)? Free skills work even after the unit's main action. */
  canUseSkill(u: Unit, skillId: string): boolean {
    const skill = SKILLS[skillId];
    const inTurn = isFree(skill) ? u.alive && u.team === this.phase : this.canAct(u);
    return inTurn && this.skillIds(u).includes(skillId) && this.isUsable(u, skillId);
  }

  /** Free skills (e.g. Kick) the unit could use right now on at least one unit. */
  usableFreeActions(u: Unit): string[] {
    return this.skillIds(u).filter((id) => {
      const s = SKILLS[id];
      if (!isFree(s) || !this.canUseSkill(u, id)) return false;
      return this.rangeTiles(u, s).some((t) => this.targetsOf(u, s, t).length > 0);
    });
  }

  /** Units the player can still do something with this turn (an action, or a usable free action). */
  commandableUnits(): Unit[] {
    return this.living(this.phase).filter((u) => this.canAct(u) || this.usableFreeActions(u).length > 0);
  }

  // ---- movement -----------------------------------------------------------------

  /** Tiles the unit can end its move on (including where it stands). Orthogonal steps only. */
  reachable(u: Unit): Map<string, ReachInfo> {
    const budget = this.stat(u, 'movement');
    const result = new Map<string, ReachInfo>([[key(u.x, u.y), { cost: 0, prev: null }]]);
    const frontier: { x: number; y: number; cost: number }[] = [{ x: u.x, y: u.y, cost: 0 }];
    while (frontier.length) {
      frontier.sort((a, b) => a.cost - b.cost);
      const cur = frontier.shift()!;
      for (const d of DIRS) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (!passable(this.map, nx, ny)) continue;
        const occupant = this.unitAt(nx, ny);
        if (occupant && occupant.team !== u.team) continue; // can't pass through enemies
        const cost = cur.cost + (TERRAIN[this.map.tiles[ny][nx]].moveCost ?? 99);
        if (cost > budget) continue;
        const k = key(nx, ny);
        const known = result.get(k);
        if (known && known.cost <= cost) continue;
        result.set(k, { cost, prev: key(cur.x, cur.y) });
        frontier.push({ x: nx, y: ny, cost });
      }
    }
    // Can pass through allies but not stop on them.
    for (const k of [...result.keys()]) {
      const [x, y] = k.split(',').map(Number);
      const occupant = this.unitAt(x, y);
      if (occupant && occupant !== u) result.delete(k);
    }
    return result;
  }

  pathTo(reach: Map<string, ReachInfo>, dest: Point): Point[] {
    const path: Point[] = [];
    let k: string | null = key(dest.x, dest.y);
    while (k && reach.get(k)?.prev !== null) {
      const [x, y] = k.split(',').map(Number);
      path.unshift({ x, y });
      k = reach.get(k)?.prev ?? null;
    }
    return path;
  }

  /** Walk to `dest`. Enemy overwatch can shoot (and Intercept can stop) the unit on the way. */
  move(u: Unit, dest: Point): MoveResult {
    if (!this.canMove(u)) throw new Error(`${u.character.name} can't move now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y))) throw new Error('Destination not reachable');
    const full = this.pathTo(reach, dest);
    const result: MoveResult = { path: [], triggers: [], interrupted: false };
    u.moved = true;
    for (const step of full) {
      u.x = step.x;
      u.y = step.y;
      result.path.push(step);
      // Overwatch only fires on tiles the unit could stop on (not while passing through allies).
      if (this.units.some((o) => o !== u && o.alive && o.x === step.x && o.y === step.y)) continue;
      const { events, interrupted } = this.triggerOverwatch(u);
      if (events.length) {
        result.triggers.push({ index: result.path.length - 1, events });
        u.locked = true;
      }
      if (!u.alive) {
        u.acted = true;
        break;
      }
      if (interrupted) {
        result.interrupted = true;
        break;
      }
    }
    return result;
  }

  private triggerOverwatch(mover: Unit): { events: BattleEvent[]; interrupted: boolean } {
    const events: BattleEvent[] = [];
    let interrupted = false;
    for (const w of this.living()) {
      if (w.team === mover.team || !w.overwatch || !mover.alive) continue;
      if (!w.overwatch.tiles.has(key(mover.x, mover.y))) continue;
      if (w.overwatch.los && !this.clearLine(w, mover, w.overwatch.los, w)) continue;
      const skill = SKILLS[w.overwatch.skillId];
      const ow = w.overwatch;
      w.overwatch = null;
      const chance = this.hitChance(w, mover, skill, true);
      if (!this.rollHit(chance)) {
        events.push({ type: 'miss', source: w.uid, target: mover.uid, chance, cause: 'overwatch' });
        continue;
      }
      for (const part of skill.hits ?? []) {
        if (!mover.alive) break;
        events.push(this.dealDamage(mover, this.hitDamage(w, mover, part), w.uid, 'overwatch'));
      }
      if (ow.interrupt) interrupted = true;
    }
    return { events, interrupted };
  }

  canUndoMove(u: Unit): boolean {
    const occupant = this.unitAt(u.startPos.x, u.startPos.y);
    return u.alive && u.moved && !u.acted && !u.locked && (!occupant || occupant === u);
  }

  undoMove(u: Unit): void {
    if (!this.canUndoMove(u)) throw new Error("Can't undo that move");
    u.x = u.startPos.x;
    u.y = u.startPos.y;
    u.moved = false;
  }

  /** End this unit's turn without acting. */
  wait(u: Unit): void {
    if (!this.canAct(u)) throw new Error(`${u.character.name} has already acted`);
    u.acted = true;
  }

  // ---- targeting ------------------------------------------------------------------

  private inMap(p: Point): boolean {
    return inBounds(this.map, p.x, p.y);
  }

  /** Can `caster`, standing on `from`, aim `skill` at `tile`? */
  canTarget(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): boolean {
    return this.inReach(caster, skill, tile, from) && !this.engagementBlock(caster, skill, tile, from);
  }

  /** Range / line / landing checks only (ignores engagement). */
  private inReach(caster: Unit, skill: SkillDef, tile: Point, from: Point): boolean {
    if (!this.inMap(tile)) return false;
    const d = dist(from, tile);
    const range = this.skillRange(caster, skill);
    const minRange = this.skillMinRange(caster, skill);
    switch (skill.target) {
      case 'self':
        return withinRange(d, skill.aoeRadius ?? 0);
      case 'line':
        // Aim at any tile in normal range; the attack travels in a straight line toward it.
        return d >= minRange - EPS && withinRange(d, range);
      case 'cone':
        return d >= 1 - EPS && withinRange(d, skill.cone?.radius ?? range);
      case 'emptyTile': {
        if (d < minRange - EPS || !withinRange(d, range)) return false;
        const occupant = this.occupantFrom(caster, from, tile);
        return passable(this.map, tile.x, tile.y) && !occupant;
      }
      case 'unit': {
        if (d < minRange - EPS || !withinRange(d, range)) return false;
        const los = this.skillLos(caster, skill);
        if (los && !this.clearLine(from, tile, los, caster)) return false;
        if (skill.charge) return this.chargeDestination(caster, tile, from, skill) !== null;
        return true;
      }
    }
  }

  /**
   * Is the line from `a` to `b` clear under `rule`? Line of sight: no rock in between.
   * Line of fire: additionally no unit in between (`ignore` = the shooter itself).
   */
  clearLine(a: Point, b: Point, rule: LosRule, ignore?: Unit): boolean {
    if (rule === 'sight') return hasLineOfSight(this.map, a, b);
    return hasLineOfSight(this.map, a, b, (p) => {
      const u = this.unitAt(p.x, p.y);
      return !!u && u !== ignore;
    });
  }

  /** Tiles within the skill's distance that are ruled out only by a blocked line (shown greyed out). */
  blockedTiles(caster: Unit, skill: SkillDef, from: Point = caster): Point[] {
    const los = this.skillLos(caster, skill);
    if (!los || skill.target !== 'unit') return [];
    const range = this.skillRange(caster, skill);
    const minRange = this.skillMinRange(caster, skill);
    const out: Point[] = [];
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const d = dist(from, { x, y });
        if (d < minRange - EPS || !withinRange(d, range)) continue;
        if (!this.clearLine(from, { x, y }, los, caster)) out.push({ x, y });
      }
    }
    return out;
  }

  /** Every tile the skill could be aimed at — the "attack box" shown in the UI. */
  rangeTiles(caster: Unit, skill: SkillDef, from: Point = caster): Point[] {
    const out: Point[] = [];
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.canTarget(caster, skill, { x, y }, from)) out.push({ x, y });
      }
    }
    return out;
  }

  /** Tiles the skill would cover if aimed at `tile` (for previews). */
  areaTiles(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): Point[] {
    switch (skill.target) {
      case 'self': {
        const r = skill.aoeRadius ?? 0;
        if (r <= 0) return [{ x: from.x, y: from.y }];
        const out: Point[] = [];
        for (let y = 0; y < this.map.height; y++) {
          for (let x = 0; x < this.map.width; x++) {
            const d = dist(from, { x, y });
            if (d > 0 && withinRange(d, r)) out.push({ x, y });
          }
        }
        return out;
      }
      case 'line':
        // The straight path from the user to the aimed tile, nearest first.
        return [...tilesBetween(from, tile), tile].filter((p) => this.inMap(p));
      case 'cone':
        return coneTiles(this.map, from, tile, skill.cone!.angle, skill.cone!.radius);
      default:
        return [tile];
    }
  }

  /** Who stands on `p` if `caster` were standing on `from` instead of its real tile. */
  private occupantFrom(caster: Unit, from: Point, p: Point): Unit | undefined {
    if (p.x === from.x && p.y === from.y) return caster;
    const u = this.unitAt(p.x, p.y);
    return u === caster ? undefined : u;
  }

  private matches(caster: Unit, skill: SkillDef, t: Unit): boolean {
    // 'any' = friend or foe. Single-target skills may also be used on yourself; area skills never hit you.
    if (skill.affects === 'any') return t !== caster || skill.target === 'unit';
    return skill.affects === 'enemy' ? t.team !== caster.team : t.team === caster.team;
  }

  /** An attack aimed straight at a unit hits it, even an ally (the player confirms first). */
  private aimedHit(caster: Unit, skill: SkillDef, t: Unit): boolean {
    return t !== caster && skill.affects === 'enemy' && this.isAttack(skill);
  }

  /** Units the skill would affect if aimed at `tile`. */
  targetsOf(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): Unit[] {
    switch (skill.target) {
      case 'cone':
      case 'emptyTile':
        return [];
      case 'self': {
        if (!skill.aoeRadius) return [caster];
        return this.living().filter((t) => {
          const pos = t === caster ? from : t;
          return this.matches(caster, skill, t) && withinRange(dist(from, pos), skill.aoeRadius!);
        });
      }
      case 'line': {
        for (const p of this.areaTiles(caster, skill, tile, from)) {
          if (TERRAIN[this.map.tiles[p.y][p.x]].blocksSight) break;
          const t = this.occupantFrom(caster, from, p);
          // Passes allies in the way; hits one only if it's the unit aimed at.
          const aimed = p.x === tile.x && p.y === tile.y;
          if (t && (this.matches(caster, skill, t) || (aimed && this.aimedHit(caster, skill, t)))) return [t];
        }
        return [];
      }
      case 'unit': {
        const t = this.occupantFrom(caster, from, tile);
        return t && (this.matches(caster, skill, t) || this.aimedHit(caster, skill, t)) ? [t] : [];
      }
    }
  }

  /**
   * Where a Charge aimed at `tile` ends: next to the target (or on the tile itself
   * if it is empty), reachable in at most `range` steps (diagonals allowed). Null if impossible.
   */
  chargeDestination(caster: Unit, tile: Point, from: Point = caster, skill?: SkillDef): Point | null {
    const chargeSkill = skill ?? Object.values(SKILLS).find((x) => x.charge);
    if (!chargeSkill) return null;
    const target = this.occupantFrom(caster, from, tile);
    if (target === caster) return null;
    const free = (p: Point) => passable(this.map, p.x, p.y) && (!this.occupantFrom(caster, from, p) || (p.x === from.x && p.y === from.y));
    let goals: Point[];
    if (target) {
      if (dist(from, tile) <= 1.5 + EPS) return { x: from.x, y: from.y };
      goals = DIRS8.map((d) => ({ x: tile.x + d.x, y: tile.y + d.y })).filter((p) => this.inMap(p) && free(p));
    } else {
      goals = free(tile) ? [tile] : [];
    }
    if (goals.length === 0) return null;
    const goalKeys = new Set(goals.map((p) => key(p.x, p.y)));
    const maxSteps = Math.floor(this.skillRange(caster, chargeSkill));
    const seen = new Map<string, number>([[key(from.x, from.y), 0]]);
    const queue: Point[] = [{ x: from.x, y: from.y }];
    let best: Point | null = null;
    while (queue.length) {
      const p = queue.shift()!;
      const steps = seen.get(key(p.x, p.y))!;
      if (goalKeys.has(key(p.x, p.y)) && (p.x !== from.x || p.y !== from.y || target)) {
        best = p;
        break;
      }
      if (steps >= maxSteps) continue;
      for (const d of DIRS8) {
        const n = { x: p.x + d.x, y: p.y + d.y };
        if (!passable(this.map, n.x, n.y) || seen.has(key(n.x, n.y))) continue;
        const occ = this.occupantFrom(caster, from, n);
        if (occ && occ.team !== caster.team) continue;
        seen.set(key(n.x, n.y), steps + 1);
        queue.push(n);
      }
    }
    return best;
  }

  // ---- hit chance (framework: disabled in stats.json until hit/evasion are designed) ----

  /** Chance (0-100) that `skill` hits `target`. Always 100 while hit chance is disabled. */
  hitChance(attacker: Unit, target: Unit, skill: SkillDef, reaction = false): number {
    const r = this.rules.hitChance;
    if (!r.enabled || !skill.hits?.length || attacker.team === target.team) return 100;
    const chance = r.base + this.stat(attacker, 'accuracy') + (skill.accuracy ?? 0) - this.stat(target, 'evasion') + (reaction ? r.reactionModifier : 0);
    return Math.max(r.min, Math.min(r.max, Math.round(chance)));
  }

  private rollHit(chance: number): boolean {
    return chance >= 100 || this.rng() * 100 < chance;
  }

  // ---- vision (framework: disabled in stats.json until fog of war is designed) ----

  /** Tiles `team` can currently see. Everything while vision is disabled. */
  visibleTiles(team: Team): Set<string> {
    const seen = new Set<string>();
    const all = !this.rules.vision.enabled;
    const viewers = this.living(team);
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const p = { x, y };
        if (all || viewers.some((v) => withinRange(dist(v, p), this.stat(v, 'vision')) && hasLineOfSight(this.map, v, p))) seen.add(key(x, y));
      }
    }
    return seen;
  }

  /** Can `team` see `u`? Own units are always visible. */
  canSee(team: Team, u: Unit): boolean {
    return u.team === team || !this.rules.vision.enabled || this.visibleTiles(team).has(key(u.x, u.y));
  }

  // ---- damage -----------------------------------------------------------------------

  /** Damage of one hit after the target's Defense (before shields). */
  hitDamage(attacker: Unit, target: Unit, part: DamagePart): number {
    const raw =
      (part.pAtk ?? 0) * this.stat(attacker, 'pAtk') +
      (part.mAtk ?? 0) * this.stat(attacker, 'mAtk') +
      (part.def ?? 0) * this.stat(attacker, 'defense') +
      (part.missingHp ?? 0) * (target.stats.health - target.hp);
    return Math.max(1, Math.round(raw * defenseMultiplier(this.stat(target, 'defense'))));
  }

  /** Predicted damage of each hit of `skill` on `target` (accounts for missing health growing). */
  previewHits(attacker: Unit, skill: SkillDef, target: Unit): number[] {
    let hp = target.hp;
    let shield = this.shieldOf(target);
    const out: number[] = [];
    for (const part of skill.hits ?? []) {
      const saved = target.hp;
      target.hp = hp;
      const amount = this.hitDamage(attacker, target, part);
      target.hp = saved;
      out.push(amount);
      const absorbed = Math.min(shield, amount);
      shield -= absorbed;
      hp = Math.max(0, hp - (amount - absorbed));
    }
    return out;
  }

  healAmount(caster: Unit, skill: SkillDef): number {
    return Math.round((skill.heal?.mAtk ?? 0) * this.stat(caster, 'mAtk'));
  }

  private dealDamage(target: Unit, amount: number, source: string | undefined, cause: DamageCause, bypassShield = false): BattleEvent {
    let absorbed = 0;
    if (!bypassShield) {
      for (const s of target.statuses) {
        if (s.id !== 'shield' || absorbed >= amount) continue;
        const take = Math.min(s.amount, amount - absorbed);
        s.amount -= take;
        absorbed += take;
      }
      target.statuses = target.statuses.filter((s) => s.id !== 'shield' || s.amount > 0);
    }
    target.hp = Math.max(0, target.hp - (amount - absorbed));
    const killed = target.hp === 0;
    if (killed) {
      target.alive = false;
      target.overwatch = null;
      this.breakEngagement(target);
    }
    return { type: 'damage', source, target: target.uid, amount: amount - absorbed, absorbed, killed, cause };
  }

  // ---- actions -------------------------------------------------------------------------

  perform(u: Unit, skillId: string, tile: Point): BattleEvent[] {
    const skill = SKILLS[skillId];
    if (!skill) throw new Error(`Unknown skill ${skillId}`);
    if (!(isFree(skill) ? u.alive && u.team === this.phase : this.canAct(u))) throw new Error(`${u.character.name} has already acted`);
    if (!this.skillIds(u).includes(skillId)) throw new Error(`${u.character.name} doesn't have ${skill.name}`);
    if (!this.isReady(u, skillId)) throw new Error(`${skill.name} is on cooldown`);
    if (!this.isUsable(u, skillId)) throw new Error(`${skill.name} needs a weapon`);
    const block = this.engagementBlock(u, skill, tile);
    if (block) throw new Error(block);
    if (!this.canTarget(u, skill, tile)) throw new Error('Target out of range');

    const events: BattleEvent[] = [];
    const origin = { x: u.x, y: u.y };
    if (skill.charge) {
      const dest = this.chargeDestination(u, tile, u, skill)!;
      if (dest.x !== u.x || dest.y !== u.y) {
        u.x = dest.x;
        u.y = dest.y;
        events.push({ type: 'move', target: u.uid, from: origin, to: dest, kind: 'charge' });
      }
    }
    if (skill.teleport) {
      // Teleporting out of an engagement breaks it with no opportunity attack.
      const opp = this.opponentOf(u);
      if (opp) {
        this.breakEngagement(u);
        events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'escaped' });
      }
      u.x = tile.x;
      u.y = tile.y;
      events.push({ type: 'move', target: u.uid, from: origin, to: { ...tile }, kind: 'teleport' });
    }
    if (skill.cone) {
      u.overwatch = {
        skillId,
        tiles: new Set(coneTiles(this.map, u, tile, skill.cone.angle, skill.cone.radius).map((p) => key(p.x, p.y))),
        interrupt: skill.cone.interrupt,
        los: skill.cone.los,
      };
      events.push({ type: 'overwatch', source: u.uid, skillId });
    }

    const targets = this.targetsOf(u, skill, tile).filter((t) => {
      const chance = this.hitChance(u, t, skill);
      if (this.rollHit(chance)) return true;
      events.push({ type: 'miss', source: u.uid, target: t.uid, chance, cause: 'skill' });
      return false;
    });
    for (const t of targets) {
      for (const part of skill.hits ?? []) {
        if (!t.alive) break;
        events.push(this.dealDamage(t, this.hitDamage(u, t, part), u.uid, 'skill'));
      }
      if (!t.alive) continue;
      // Engage: a hit locks both units together, unless either is already engaged.
      if (hasTag(skill, 'engage') && t.team !== u.team && skill.hits?.length && u.alive && !u.engagedWith && !t.engagedWith) {
        this.engage(u, t);
        events.push({ type: 'engage', source: u.uid, target: t.uid });
      }
      for (const a of skill.applyStatus ?? []) events.push(this.applyStatus(u, t, a.status, a.turns, a.stacks ?? 1));
      if (skill.heal) {
        const amount = Math.min(this.healAmount(u, skill), t.stats.health - t.hp);
        t.hp += amount;
        events.push({ type: 'heal', source: u.uid, target: t.uid, amount });
      }
      if (skill.shield) {
        const amount = Math.round(t.stats.health * skill.shield.maxHpPct);
        t.statuses = t.statuses.filter((s) => s.id !== 'shield');
        t.statuses.push({ id: 'shield', name: 'Shield', debuff: false, stacks: 0, amount, turns: skill.shield.turns, tick: 'start' });
        events.push({ type: 'shield', source: u.uid, target: t.uid, amount });
      }
      if (skill.cleanse) {
        const removed = t.statuses.filter((s) => s.debuff).map((s) => s.name);
        t.statuses = t.statuses.filter((s) => !s.debuff);
        events.push({ type: 'cleanse', source: u.uid, target: t.uid, removed });
      }
    }

    // Knockback: push each surviving target away from the attacker, if there is room.
    // A unit that actually gets pushed breaks free of its engagement.
    if (skill.knockback) {
      for (const t of targets) {
        if (!t.alive) continue;
        const dir = { x: Math.sign(t.x - u.x), y: Math.sign(t.y - u.y) };
        let moved = false;
        for (let i = 0; i < skill.knockback; i++) {
          const to = { x: t.x + dir.x, y: t.y + dir.y };
          if (!passable(this.map, to.x, to.y) || this.unitAt(to.x, to.y)) break;
          events.push({ type: 'move', target: t.uid, from: { x: t.x, y: t.y }, to, kind: 'knockback' });
          t.x = to.x;
          t.y = to.y;
          moved = true;
        }
        // Being pushed out of an engagement counts as breaking away: the old opponent gets a free hit.
        const partner = moved ? this.opponentOf(t) : null;
        if (partner) {
          this.breakEngagement(t);
          events.push({ type: 'disengage', source: t.uid, target: partner.uid, reason: 'displaced' });
          events.push(...this.opportunityAttack(partner, t));
        }
      }
    }

    // Cooldown N = can't be used during the next N turns. The counter ticks at the
    // start of each of the unit's turns, so store N + 1 (it hits 0 on the turn it's usable).
    events.push(...this.separationEvents());

    if (skill.cooldown > 0) u.cooldowns[skillId] = skill.cooldown + 1;
    if (isFree(skill)) u.locked = true;
    else u.acted = true;
    return events;
  }

  private applyStatus(source: Unit, t: Unit, id: string, turns: number, stacks: number): BattleEvent {
    const def = STATUSES[id];
    const existing = t.statuses.find((s) => s.id === id);
    if (existing) {
      if (def.stacking) existing.stacks += stacks;
      existing.turns = Math.max(existing.turns, turns);
    } else {
      t.statuses.push({ id, name: def.name, debuff: def.debuff, stacks: def.stacking ? stacks : 1, amount: 0, turns, tick: def.tick });
    }
    const now = t.statuses.find((s) => s.id === id)!;
    return { type: 'status', source: source.uid, target: t.uid, name: def.stacking ? `${def.name} x${now.stacks}` : def.name };
  }

  // ---- turn flow --------------------------------------------------------------------

  /**
   * Start a team's turn: reset actions, tick cooldowns, drop old overwatch, and
   * tick status effects (Burn damages now; durations count the unit's own turns).
   */
  private beginPhase(team: Team): BattleEvent[] {
    this.phase = team;
    const events: BattleEvent[] = [];
    for (const u of this.living(team)) {
      u.moved = false;
      u.acted = false;
      u.locked = false;
      u.startPos = { x: u.x, y: u.y };
      u.overwatch = null;
      for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
      for (const s of u.statuses) {
        const dot = STATUSES[s.id]?.damagePctMaxHpPerStack;
        if (dot && u.alive) {
          const amount = Math.max(1, Math.round(u.stats.health * dot * s.stacks));
          events.push(this.dealDamage(u, amount, undefined, 'status', true));
        }
        if (s.tick === 'start') s.turns -= 1;
      }
      u.statuses = u.statuses.filter((s) => s.turns > 0);
      if (!u.alive) u.acted = true;
    }
    return events;
  }

  /** End the current team's turn; returns events from the start of the next turn (e.g. Burn). */
  endPhase(): BattleEvent[] {
    // Effects that last "through" the unit's turn (e.g. Slow) count down now.
    for (const u of this.living(this.phase)) {
      for (const s of u.statuses) if (s.tick === 'end') s.turns -= 1;
      u.statuses = u.statuses.filter((s) => s.turns > 0);
    }
    const next: Team = this.phase === 'player' ? 'enemy' : 'player';
    if (next === 'player') this.round += 1;
    return this.beginPhase(next);
  }
}

// ---- encounter setup ------------------------------------------------------------------

/** The enemy types that fight at `stage`, each at its level for that stage. */
export function enemyTypesForStage(stage: number): { type: string; level: number }[] {
  const defs = Object.values(ENEMIES);
  let fit = defs.filter((d) => d.levels[0] <= stage && stage <= d.levels[1]);
  if (fit.length === 0) {
    const top = Math.max(...defs.map((d) => d.levels[1]));
    const bottom = Math.min(...defs.map((d) => d.levels[0]));
    // Past every range: the toughest types at their top level. In a gap: the next types up.
    fit = stage > top ? defs.filter((d) => d.levels[1] === top)
      : stage < bottom ? defs.filter((d) => d.levels[0] === bottom)
        : defs.filter((d) => d.levels[0] === Math.min(...defs.filter((x) => x.levels[0] > stage).map((x) => x.levels[0])));
  }
  return fit.map((d) => ({ type: d.id, level: Math.max(d.levels[0], Math.min(d.levels[1], stage)) }));
}

/** Build one enemy of a type at a level. Human types pick a weapon. */
export function makeEnemy(type: string, level: number, rng: Rng): Character {
  const def = ENEMIES[type];
  const weaponId = def.weapons.length ? def.weapons[Math.floor(rng() * def.weapons.length)] : '';
  const id = newId('e');
  return {
    id,
    name: def.weaponNames[weaponId] ?? def.name,
    level,
    xp: 0,
    enemyType: type,
    weaponId,
    skillIds: [],
    appearance: { color: ENEMY_COLOR, model: modelFor(id) },
  };
}

/**
 * An encounter for `stage`: random picks from the types that fit the stage until the
 * threat budget (threatPerAdventurer x party size) is spent. Weak types come in bigger packs.
 * Past the last level range, the budget keeps growing by 25% of a party per stage.
 */
export function generateEnemies(stage: number, partySize: number, rng: Rng): Character[] {
  const options = enemyTypesForStage(stage);
  const top = Math.max(...Object.values(ENEMIES).map((d) => d.levels[1]));
  const party = Math.max(1, partySize);
  const budget = party * ENCOUNTER.threatPerAdventurer * (1 + Math.max(0, stage - top) * 0.25);
  const out: Character[] = [];
  let spent = 0;
  while (spent < budget - 1e-9 && out.length < ENCOUNTER.maxEnemies) {
    const pick = options[Math.floor(rng() * options.length)];
    out.push(makeEnemy(pick.type, pick.level, rng));
    spent += ENEMIES[pick.type].threat;
  }
  return out;
}

/** Deployment spots near the left (player) or right (enemy) edge. */
export function deploymentTiles(map: BattleMap, team: Team, count: number): Point[] {
  const cols = team === 'player' ? [1, 0, 2] : [map.width - 2, map.width - 1, map.width - 3];
  const mid = Math.floor(map.height / 2);
  // Spread units out: even offsets from the middle row first, then odd ones.
  const offsets = [...Array(map.height).keys()].map((r) => r - mid);
  const rows = offsets
    .sort((a, b) => (Math.abs(a) % 2) - (Math.abs(b) % 2) || Math.abs(a) - Math.abs(b))
    .map((o) => mid + o);
  const out: Point[] = [];
  for (const x of cols) {
    for (const y of rows) {
      if (out.length < count && passable(map, x, y)) out.push({ x, y });
    }
  }
  return out;
}
