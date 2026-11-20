// Pure battle rules (no rendering). BattleScene drives this and animates the events it returns.
import { CLASSES, SKILLS, WEAPONS } from '../data/content';
import type { Character, ClassId, DamageType, StatusEffectDef, StatusStat } from '../data/types';
import { deriveStats, newId, skillSlots, type DerivedStats, type Rng } from './character';
import { DIRS, TERRAIN, key, manhattan, passable, type BattleMap, type Point } from './grid';

export type Team = 'player' | 'enemy';

export interface Status extends StatusEffectDef {}

export interface Unit {
  uid: string;
  team: Team;
  character: Character;
  base: DerivedStats;
  hp: number;
  x: number;
  y: number;
  alive: boolean;
  cooldowns: Record<string, number>;
  statuses: Status[];
  /** Has this unit moved during its team's current phase? */
  moved: boolean;
  /** Has this unit used its action (or waited) this phase? Acting ends the unit's turn. */
  acted: boolean;
  /** Where the unit stood when the phase began (for undoing a move). */
  startPos: Point;
}

/** A usable action: the basic weapon attack or one of the unit's skills. */
export interface ActionSpec {
  id: string;
  name: string;
  description: string;
  kind: 'damage' | 'heal' | 'status';
  target: 'enemy' | 'ally';
  damageType: DamageType;
  power: number;
  minRange: number;
  maxRange: number;
  radius: number;
  cooldown: number;
  status?: StatusEffectDef;
}

export type BattleEvent =
  | { type: 'damage'; source: string; target: string; amount: number; crit: boolean; killed: boolean }
  | { type: 'miss'; source: string; target: string }
  | { type: 'heal'; source: string; target: string; amount: number }
  | { type: 'status'; source: string; target: string; status: Status };

export interface ReachInfo {
  cost: number;
  prev: string | null;
}

export const ATTACK_ID = 'attack';

export function victoryXp(stage: number): number {
  return 60 + stage * 20;
}

export function makeUnit(character: Character, team: Team, pos: Point): Unit {
  const base = deriveStats(character);
  return {
    uid: newId('u'),
    team,
    character,
    base,
    hp: base.maxHp,
    x: pos.x,
    y: pos.y,
    alive: true,
    cooldowns: {},
    statuses: [],
    moved: false,
    acted: false,
    startPos: { x: pos.x, y: pos.y },
  };
}

export function getAction(unit: Unit, id: string): ActionSpec {
  if (id === ATTACK_ID) {
    const w = WEAPONS[unit.character.weaponId];
    return {
      id: ATTACK_ID,
      name: 'Attack',
      description: `${w.name}: ${w.damageType} damage, range ${w.minRange}-${w.maxRange}.`,
      kind: 'damage',
      target: 'enemy',
      damageType: w.damageType,
      power: 1,
      minRange: w.minRange,
      maxRange: w.maxRange,
      radius: 0,
      cooldown: 0,
    };
  }
  const s = SKILLS[id];
  if (!s) throw new Error(`Unknown skill ${id}`);
  return { ...s };
}

/**
 * Battle rules with XCOM-style alternating phases: every player unit may move
 * once and act once, in any order, then every enemy unit does the same.
 */
export class Battle {
  readonly units: Unit[];
  /** Whose phase it is. */
  phase: Team = 'player';
  round = 1;

  constructor(readonly map: BattleMap, units: Unit[], readonly rng: Rng) {
    this.units = units;
    this.beginPhase('player');
  }

  // ---- queries --------------------------------------------------------------

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

  stat(u: Unit, stat: StatusStat | 'accuracy' | 'crit' | 'maxHp'): number {
    let value = u.base[stat];
    for (const s of u.statuses) if (s.stat === stat) value += s.amount;
    if (stat === 'defense' || stat === 'resistance') value += TERRAIN[this.map.tiles[u.y][u.x]].defense;
    if (stat === 'move') value = Math.max(1, value);
    return Math.max(0, value);
  }

  outcome(): 'victory' | 'defeat' | null {
    if (this.living('enemy').length === 0) return 'victory';
    if (this.living('player').length === 0) return 'defeat';
    return null;
  }

  actionIds(u: Unit): string[] {
    return [ATTACK_ID, ...u.character.skillIds.slice(0, skillSlots(u.character))];
  }

  isReady(u: Unit, actionId: string): boolean {
    return (u.cooldowns[actionId] ?? 0) <= 0;
  }

  // ---- movement -------------------------------------------------------------

  /** Tiles the unit can end its move on (including where it stands). */
  reachable(u: Unit): Map<string, ReachInfo> {
    const budget = this.stat(u, 'move');
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

  /** Path of tiles from the unit to the destination (excluding the start). */
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

  canMove(u: Unit): boolean {
    return u.alive && u.team === this.phase && !u.moved && !u.acted;
  }

  canAct(u: Unit): boolean {
    return u.alive && u.team === this.phase && !u.acted;
  }

  /** Units of the current team that still have an action this phase. */
  readyUnits(): Unit[] {
    return this.living(this.phase).filter((u) => !u.acted);
  }

  move(u: Unit, dest: Point): Point[] {
    if (!this.canMove(u)) throw new Error(`${u.character.name} can't move now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y))) throw new Error('Destination not reachable');
    const path = this.pathTo(reach, dest);
    u.x = dest.x;
    u.y = dest.y;
    u.moved = true;
    return path;
  }

  /** A move can be undone until the unit acts, if nobody has taken its old tile. */
  canUndoMove(u: Unit): boolean {
    const occupant = this.unitAt(u.startPos.x, u.startPos.y);
    return u.moved && !u.acted && (!occupant || occupant === u);
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

  // ---- actions --------------------------------------------------------------

  /** Tiles within the action's range from `from`. */
  rangeTiles(action: ActionSpec, from: Point): Point[] {
    const out: Point[] = [];
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const d = manhattan(from, { x, y });
        if (d >= action.minRange && d <= action.maxRange) out.push({ x, y });
      }
    }
    return out;
  }

  /** Units that would be affected if `caster` (standing at `from`) used `action` on `target`. */
  affected(caster: Unit, action: ActionSpec, target: Point, from: Point = caster): Unit[] {
    const d = manhattan(from, target);
    if (d < action.minRange || d > action.maxRange) return [];
    const wantTeam: Team = action.target === 'ally' ? caster.team : caster.team === 'player' ? 'enemy' : 'player';
    const isValid = (u: Unit) => u.team === wantTeam;
    if (action.radius === 0) {
      const u = this.occupantFrom(caster, from, target);
      return u && isValid(u) ? [u] : [];
    }
    return this.living().filter((u) => {
      const pos = u === caster ? from : u;
      return isValid(u) && manhattan(pos, target) <= action.radius;
    });
  }

  /** Who stands on `p` if `caster` were standing on `from` instead of its real tile. */
  private occupantFrom(caster: Unit, from: Point, p: Point): Unit | undefined {
    if (p.x === from.x && p.y === from.y) return caster;
    const u = this.unitAt(p.x, p.y);
    return u === caster ? undefined : u;
  }

  inRange(action: ActionSpec, from: Point, target: Point): boolean {
    const d = manhattan(from, target);
    return d >= action.minRange && d <= action.maxRange;
  }

  /** Tiles where the action would affect at least one unit (used by the AI). */
  validTargets(caster: Unit, action: ActionSpec, from: Point = caster): Point[] {
    return this.rangeTiles(action, from).filter((t) => this.affected(caster, action, t, from).length > 0);
  }

  hitChance(attacker: Unit, defender: Unit, action: ActionSpec): number {
    const chance = 70 + this.stat(attacker, 'accuracy') - this.stat(defender, 'speed') * 2 + (action.damageType === 'magical' ? 10 : 0);
    return Math.max(30, Math.min(99, chance));
  }

  /** Damage before the hit/crit roll. */
  damage(attacker: Unit, defender: Unit, action: ActionSpec): number {
    const power = this.stat(attacker, action.damageType === 'physical' ? 'physPower' : 'magPower');
    const mitigation = this.stat(defender, action.damageType === 'physical' ? 'defense' : 'resistance');
    return Math.max(1, Math.round(power * action.power - mitigation));
  }

  healAmount(caster: Unit, action: ActionSpec): number {
    const power = this.stat(caster, action.damageType === 'physical' ? 'physPower' : 'magPower');
    return Math.max(1, Math.round(power * action.power));
  }

  perform(u: Unit, actionId: string, target: Point): BattleEvent[] {
    if (!this.canAct(u)) throw new Error(`${u.character.name} has already acted`);
    if (!this.actionIds(u).includes(actionId)) throw new Error(`${u.character.name} can't use ${actionId}`);
    if (!this.isReady(u, actionId)) throw new Error(`${actionId} is on cooldown`);
    const action = getAction(u, actionId);
    if (!this.inRange(action, u, target)) throw new Error('Target out of range');
    // Any tile in range may be targeted, even an empty one (the action is still spent).
    const targets = this.affected(u, action, target);
    u.acted = true;
    const events: BattleEvent[] = [];
    for (const t of targets) {
      if (action.kind === 'damage') {
        if (this.rng() * 100 >= this.hitChance(u, t, action)) {
          events.push({ type: 'miss', source: u.uid, target: t.uid });
          continue;
        }
        let amount = this.damage(u, t, action);
        const crit = this.rng() * 100 < this.stat(u, 'crit');
        if (crit) amount = Math.round(amount * 1.5);
        t.hp = Math.max(0, t.hp - amount);
        const killed = t.hp === 0;
        if (killed) t.alive = false;
        events.push({ type: 'damage', source: u.uid, target: t.uid, amount, crit, killed });
        if (!killed && action.status) events.push(this.applyStatus(u, t, action.status));
      } else if (action.kind === 'heal') {
        const amount = Math.min(this.healAmount(u, action), t.base.maxHp - t.hp);
        t.hp += amount;
        events.push({ type: 'heal', source: u.uid, target: t.uid, amount });
      } else if (action.status) {
        events.push(this.applyStatus(u, t, action.status));
      }
    }
    if (action.cooldown > 0) u.cooldowns[actionId] = action.cooldown;
    return events;
  }

  private applyStatus(source: Unit, target: Unit, def: StatusEffectDef): BattleEvent {
    const status: Status = { ...def };
    target.statuses = target.statuses.filter((s) => s.name !== def.name);
    target.statuses.push(status);
    return { type: 'status', source: source.uid, target: target.uid, status };
  }

  // ---- turn flow --------------------------------------------------------------

  private beginPhase(team: Team): void {
    this.phase = team;
    for (const u of this.living(team)) {
      u.moved = false;
      u.acted = false;
      u.startPos = { x: u.x, y: u.y };
      for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
    }
  }

  /**
   * End the current team's phase and start the other team's. Status effects on
   * the ending team tick down, so "2 turns" means two of that unit's own phases.
   */
  endPhase(): Team {
    for (const u of this.living(this.phase)) {
      for (const s of u.statuses) s.turns -= 1;
      u.statuses = u.statuses.filter((s) => s.turns > 0);
    }
    const next: Team = this.phase === 'player' ? 'enemy' : 'player';
    if (next === 'player') this.round += 1;
    this.beginPhase(next);
    return next;
  }
}

// ---- encounter setup ----------------------------------------------------------

const ENEMY_NAMES: Record<ClassId, string[]> = {
  knight: ['Brigand', 'Marauder', 'Thug'],
  ranger: ['Poacher', 'Sniper', 'Scout'],
  mage: ['Hexer', 'Warlock', 'Pyromancer'],
  cleric: ['Zealot', 'Cultist', 'Acolyte'],
};

/** Enemy priorities for spending level-up points. */
const ENEMY_FOCUS: Record<ClassId, ('str' | 'dex' | 'int' | 'vit' | 'spd')[]> = {
  knight: ['str', 'vit', 'str', 'dex'],
  ranger: ['dex', 'str', 'spd', 'vit'],
  mage: ['int', 'int', 'vit', 'spd'],
  cleric: ['int', 'vit', 'int', 'spd'],
};

export function generateEnemies(stage: number, partySize: number, rng: Rng): Character[] {
  const count = Math.min(6, Math.max(1, partySize + Math.floor((stage - 1) / 3)));
  const classes: ClassId[] = ['knight', 'ranger', 'mage', 'cleric'];
  const enemies: Character[] = [];
  for (let i = 0; i < count; i++) {
    const classId = i === 0 ? 'knight' : classes[Math.floor(rng() * classes.length)];
    const cls = CLASSES[classId];
    const names = ENEMY_NAMES[classId];
    const level = stage;
    const attributes = { ...cls.baseAttributes };
    const points = (stage - 1) * 3 + 2;
    for (let p = 0; p < points; p++) attributes[ENEMY_FOCUS[classId][p % 4]] += 1;
    const c: Character = {
      id: newId('e'),
      name: names[Math.floor(rng() * names.length)],
      classId,
      level,
      xp: 0,
      attributes,
      unspentPoints: 0,
      weaponId: cls.weapons[Math.floor(rng() * cls.weapons.length)],
      skillIds: [],
      appearance: { color: '#c0392b', emblem: 'triangle' },
    };
    c.skillIds = cls.skills.slice(0, skillSlots(c));
    enemies.push(c);
  }
  return enemies;
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
