// Pure battle rules (no rendering). BattleScene drives this and animates the events it returns.
import { DEFAULT_WEAPON, ENEMY_COLOR, SKILLS, STATUSES, WEAPONS, hasTag, isFree, modeWithTag, resolveWeaponSkill } from '../data/content';
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { STAT_CONFIG, type StatConfig } from '../data/stats';
import { DAMAGE_TYPES, type Character, type DamagePart, type DamageType, type LosRule, type SkillDef, type StatKey, type Stats, type ZoneDef } from '../data/types';
import { allSkills, deriveStats, modelFor, newId, type Rng } from './character';
import { combatPenalty } from './condition';
import { losFor, minRangeFor, rangeFor, type ReachContext } from './reach';
import {
  DIRS, DIRS8, EPS, TERRAIN, coneTiles, dist, hasLineOfSight, inBounds, key, passable, tilesBetween, withinRange,
  type BattleMap, type Point,
} from './grid';

export type Team = 'player' | 'enemy';

export interface Status {
  /** 'shield', or a status id from skills.json ("burn", "chilled"...). */
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
  /** What the reaction hits with (the skill's own hits, or the user's basic attack). */
  hits: DamagePart[];
  /** It fires the weapon's basic attack (so weapon on-hit effects like Arcane Weapon apply). */
  weapon?: boolean;
}

/** Action points every unit gets each turn: one movement AP and one action AP. */
export const AP_PER_TURN = 2;

export interface Unit {
  uid: string;
  team: Team;
  character: Character;
  /** Maximum stats (level + weapon). */
  stats: Stats;
  hp: number;
  /** Lowest HP the unit was taken down to this battle (Strategic Layer injuries). */
  lowestHp: number;
  x: number;
  y: number;
  alive: boolean;
  cooldowns: Record<string, number>;
  statuses: Status[];
  /** Action points left this turn (AP_PER_TURN at the start of its turn). */
  ap: number;
  /** Is the movement AP spent (by walking, or by a 1-AP skill used before moving)? */
  moved: boolean;
  /** Walked with the regular move (the only thing Undo can take back). */
  walked: boolean;
  /** The unit's turn is over (a turn-ending skill, Wait, or it fell). */
  acted: boolean;
  /** Mana left (starts at max; doesn't come back during a battle). */
  mp: number;
  /** Something happened that can't be undone (free action, triggered overwatch, or a teammate acted since): no undo move. */
  locked: boolean;
  /** Where the unit stood when its turn began (for undoing a move). */
  startPos: Point;
  /** Active overwatch / intercept, cleared at the start of the unit's next turn. */
  overwatch: Overwatch | null;
  /** uid of the unit this one is engaged with (see the Engage tag). */
  engagedWith: string | null;
  /** 'weapon'-tagged skills are unusable while true (nothing sets it yet). */
  weaponDisabled: boolean;
  /** Selected mode of a weapon with modes (the Bow): index into its basic attack's modes. Kept on the character between battles. */
  weaponMode: number;
  /** Fled off the edge of the map (counts as gone, not dead). */
  escaped?: boolean;
  /** Gave up (human enemies that can't escape): out of the fight, and taken prisoner if the party wins. */
  surrendered?: boolean;
}

/** Why damage happened: a skill, a status tick (e.g. Burn), overwatch, or an opportunity attack on disengage. */
export type DamageCause = 'skill' | 'status' | 'overwatch' | 'opportunity' | 'zone';

export type BattleEvent =
  | { type: 'damage'; source?: string; target: string; amount: number; absorbed: number; killed: boolean; cause: DamageCause; damageType?: DamageType }
  | { type: 'engage'; source: string; target: string }
  | { type: 'disengage'; source: string; target: string; reason: 'disengage' | 'separated' | 'displaced' | 'escaped' }
  | { type: 'heal'; source: string; target: string; amount: number }
  | { type: 'shield'; source: string; target: string; amount: number }
  | { type: 'status'; source: string; target: string; name: string }
  | { type: 'resist'; source: string; target: string; name: string; chance: number }
  | { type: 'cleanse'; source: string; target: string; removed: string[] }
  | { type: 'move'; target: string; from: Point; to: Point; kind: 'knockback' | 'teleport' | 'charge' }
  | { type: 'overwatch'; source: string; skillId: string }
  | { type: 'escape'; target: string }
  | { type: 'surrender'; target: string }
  | { type: 'mode'; target: string; name: string }
  /** A toggle (Arcane Weapon) switched on or off; `reason` says why it went off on its own. */
  | { type: 'toggle'; target: string; name: string; on: boolean; reason?: 'mana' }
  /** A zone (Firestorm) was placed on these tiles. */
  | { type: 'zone'; source: string; name: string; tiles: Point[] }
  /** A unit is caught by a zone (followed by its damage and status events). */
  | { type: 'zoneHit'; source: string; target: string; name: string };

/** A lasting ground effect from a 'ground' skill (Firestorm, Blizzard). */
export interface Zone {
  /** The skill that made it (its name and look). */
  skillId: string;
  name: string;
  casterUid: string;
  /** It counts down at the start of this team's turns. */
  team: Team;
  tiles: Set<string>;
  turnsLeft: number;
  def: ZoneDef;
}

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
  /** Zone tiles entered on the way here (paths avoid them when they can, at no extra cost). */
  hazards?: number;
}

export function makeUnit(character: Character, team: Team, pos: Point): Unit {
  const stats = deriveStats(character);
  // Party members fight with every stat lowered by injuries, low Morale and (slaves) low Obedience.
  const penalty = character.enemyType ? 0 : combatPenalty(character);
  if (penalty > 0) for (const k of Object.keys(stats) as StatKey[]) stats[k] = Math.round(stats[k] * (1 - penalty));
  return {
    uid: newId('u'),
    team,
    character,
    stats,
    hp: stats.health,
    lowestHp: stats.health,
    x: pos.x,
    y: pos.y,
    alive: true,
    cooldowns: {},
    statuses: [],
    ap: AP_PER_TURN,
    moved: false,
    walked: false,
    acted: false,
    mp: stats.mana,
    locked: false,
    startPos: { x: pos.x, y: pos.y },
    overwatch: null,
    engagedWith: null,
    weaponDisabled: false,
    weaponMode: initialMode(character),
  };
}

/** The character's last selected weapon mode (index), or 0 (the default mode). */
function initialMode(c: Character): number {
  const modes = SKILLS[allSkills(c)[0]]?.modes;
  return modes && c.weaponMode ? Math.max(0, modes.indexOf(c.weaponMode)) : 0;
}

/** Damage multiplier from Defense: each `defenseScale` points = +100% effective health. */
export function defenseMultiplier(defense: number): number {
  const k = STAT_CONFIG.defenseScale;
  return defense >= 0 ? k / (k + defense) : 2 - k / (k - defense);
}

/** Chance (0-1) to shrug off a debuff: Resist / (defenseScale + Resist), the same curve as Defense. */
export function resistChance(resist: number, scale = STAT_CONFIG.defenseScale): number {
  return resist > 0 ? resist / (scale + resist) : 0;
}

/**
 * What a stat amount does, as a whole percent, for the stats that work on a curve: Defense's damage reduction
 * (negative Defense: extra damage, shown as a negative %) and Resist's chance to shrug off a debuff. Null for the rest.
 */
export function statEffectPct(stat: StatKey, value: number): number | null {
  if (stat === 'defense') return Math.round((1 - defenseMultiplier(value)) * 100);
  if (stat === 'resist') return Math.round(resistChance(value) * 100);
  return null;
}

/** A stat amount for display: "50 (33%)" for Defense and Resist (amount and effective percent), else just the amount. */
export function statText(stat: StatKey, value: number): string {
  const pct = statEffectPct(stat, value);
  return pct === null ? String(value) : `${value} (${pct}%)`;
}

/**
 * Battle rules with XCOM-style alternating turns: every player unit may move
 * once and act once, in any order, then every enemy unit does the same.
 */
/** Damage parts multiplied by `m` (Double Strike's weaker second swing). */
function scaleHits(hits: DamagePart[], m: number): DamagePart[] {
  if (m === 1) return hits;
  return hits.map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, v * m])) as DamagePart);
}

/**
 * How many times a status's effect applies. Stacking statuses (Poison) hit harder per stack; decaying ones
 * (Burn, Chilled) don't: their stacks are turns left and progress toward the 3rd stack.
 */
export function statusStrength(s: { id: string; stacks: number }): number {
  return STATUSES[s.id]?.decay ? 1 : Math.max(1, s.stacks);
}

export class Battle {
  readonly units: Unit[];
  /** Ground effects in play (Firestorm, Blizzard). */
  zones: Zone[] = [];
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
      if (mod) value += mod * statusStrength(s);
      if (STATUSES[s.id]?.casterScaled?.stat === stat) value += s.amount;
    }
    if (stat === 'defense') {
      value += TERRAIN[this.map.tiles[u.y][u.x]].defense;
    }
    // Percentage changes multiply: Slow and Chilled (-25% Movement each) together leave 75% x 75% = 56%.
    for (const s of u.statuses) {
      const pct = STATUSES[s.id]?.statPct?.[stat];
      if (pct) value *= Math.max(0, 1 + pct * statusStrength(s));
    }
    if (stat === 'movement') value = Math.max(0, value);
    return Math.round(value);
  }

  // ---- skill properties that depend on the user (tags) ----------------------------

  /** The weapon's basic attack (first weapon skill). */
  basicAttack(u: Unit): SkillDef {
    return this.skillFor(u, this.rawBasic(u));
  }

  /** The basic attack as listed (a bow's is 'Bow Attack', whatever its mode). */
  private rawBasic(u: Unit): SkillDef {
    return SKILLS[allSkills(u.character)[0] ?? WEAPONS[DEFAULT_WEAPON].skills[0]];
  }

  /**
   * The mode the weapon actually attacks in: the selected one, except that an engaged
   * unit always fights in Melee mode (its selection is kept for when it breaks free).
   */
  activeMode(u: Unit): number {
    const modes = this.rawBasic(u).modes;
    if (!modes) return 0;
    if (u.engagedWith) {
      const melee = modes.findIndex((m) => hasTag(SKILLS[m], 'melee'));
      if (melee >= 0) return melee;
    }
    return u.weaponMode;
  }

  /** Select a weapon mode (a free action; Switch Mode cycles through them). Saved on the character. */
  setWeaponMode(u: Unit, index: number): BattleEvent[] {
    const modes = this.modesOf(u);
    if (!modes) throw new Error(`${u.character.name}'s weapon has no modes`);
    u.weaponMode = ((index % modes.length) + modes.length) % modes.length;
    u.character.weaponMode = modes[u.weaponMode];
    return [{ type: 'mode', target: u.uid, name: this.modeName(u)! }];
  }

  /** Does the unit's weapon have modes (Switch Mode)? */
  modesOf(u: Unit): string[] | undefined {
    return this.rawBasic(u).modes;
  }

  /** Name of the unit's current weapon mode (e.g. "Indirect"), or null for weapons without modes. */
  modeName(u: Unit, mode = u.weaponMode): string | null {
    const raw = this.rawBasic(u);
    if (!raw.modes) return null;
    const m = resolveWeaponSkill(raw, WEAPONS[u.character.weaponId], mode);
    return m.modeName ?? m.name;
  }

  /** skillFor results per skill object, then per unit and weapon mode. */
  private resolved = new WeakMap<SkillDef, Map<string, SkillDef>>();

  /**
   * The skill as `u` uses it: 'basicAttack' skills take their hits from the user's weapon,
   * and a 'weapon' self-centered area without its own radius reaches as far as the weapon.
   */
  skillFor(u: Unit, s: SkillDef): SkillDef {
    const areaFromWeapon = s.target === 'self' && hasTag(s, 'weapon') && s.aoeRadius === undefined;
    if (!s.modes && s.weaponRange === undefined && !s.basicAttack && !areaFromWeapon) return s;
    const mode = this.activeMode(u);
    const cacheKey = `${u.uid}:${mode}`;
    let perSkill = this.resolved.get(s);
    if (!perSkill) this.resolved.set(s, (perSkill = new Map()));
    let out = perSkill.get(cacheKey);
    if (!out) {
      const weapon = WEAPONS[u.character.weaponId];
      out = resolveWeaponSkill(s, weapon, mode);
      if (out.basicAttack || areaFromWeapon) {
        // Circle Swing always swings a bow in Melee mode ('basicMode').
        const forced = out.basicMode ? modeWithTag(this.rawBasic(u), out.basicMode) : undefined;
        const basic = forced ? resolveWeaponSkill(forced, weapon) : this.basicAttack(u);
        out = {
          ...out,
          hits: out.basicAttack ? Array.from({ length: out.basicAttack }, (_, i) => scaleHits(basic.hits ?? [], out!.basicAttackDamage?.[i] ?? 1)).flat() : out.hits,
          aoeRadius: areaFromWeapon ? basic.range : out.aoeRadius,
        };
      }
      perSkill.set(cacheKey, out);
    }
    return out;
  }

  /** What the unit's tag-dependent skills scale from (Movement, weapon). */
  reachContext(u: Unit): ReachContext {
    const basicMode = (tag: string) => {
      const m = modeWithTag(this.rawBasic(u), tag);
      return m && resolveWeaponSkill(m, WEAPONS[u.character.weaponId]);
    };
    return { movement: this.stat(u, 'movement'), basic: this.basicAttack(u), basicMode };
  }

  /** Effective range: 'movement' skills scale with Movement, 'weapon' skills use the weapon's range. */
  skillRange(u: Unit, s: SkillDef): number {
    return rangeFor(this.skillFor(u, s), this.reachContext(u));
  }

  skillMinRange(u: Unit, s: SkillDef): number {
    return minRangeFor(this.skillFor(u, s), this.reachContext(u));
  }

  skillLos(u: Unit, s: SkillDef): LosRule | undefined {
    return losFor(this.skillFor(u, s), this.reachContext(u));
  }

  /** Off cooldown, enough mana, and not blocked by a disabled weapon. */
  isUsable(u: Unit, skillId: string): boolean {
    const s = SKILLS[skillId];
    // Switching a toggle off is free.
    const mana = s.toggleStatus && this.isToggledOn(u, s.toggleStatus) ? 0 : s.mana;
    return this.isReady(u, skillId) && u.mp >= mana && !(u.weaponDisabled && hasTag(s, 'weapon')) && !(this.isFrozen(u) && this.movesUser(s));
  }

  /** Frozen units can't move (see the Frozen status). */
  isFrozen(u: Unit): boolean {
    return u.statuses.some((s) => STATUSES[s.id]?.frozen);
  }

  /** Skills that move the user on its own feet (Dash, Charge, Movement skills); teleports don't count. */
  private movesUser(s: SkillDef): boolean {
    return s.target === 'move' || hasTag(s, 'movement') || (!!s.charge && !s.teleport);
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
    return s.affects !== 'ally' && (!!s.hits?.length || !!s.basicAttack || !!s.cone || (s.applyStatus ?? []).some((a) => STATUSES[a.status]?.debuff) || hasTag(s, 'engage'));
  }

  /**
   * Why an engaged unit can't use `skill` on `tile` (null if it can): engaged units
   * can't move (incl. Movement skills), attack anyone but their opponent, or heal/cleanse/shield/buff anyone but themselves.
   */
  engagementBlock(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): string | null {
    const opp = this.opponentOf(caster);
    if (!opp) return null;
    // Disengage skills (Arcane Shift, Shadow Step) work anyway: they end the engagement for free.
    if (hasTag(skill, 'disengage')) return null;
    skill = this.skillFor(caster, skill);
    if (skill.teleport && !skill.charge) return `Engaged with ${opp.character.name}: disengage before moving.`;
    const busy = `Engaged with ${opp.character.name}: you can't target anyone else until you disengage.`;
    const targets = this.targetsOf(caster, skill, tile, from);
    // Charge still works on the opponent itself (you're already next to them, so there's no dash).
    if (skill.charge) {
      if (targets.length === 1 && targets[0] === opp) return null;
      return targets.length ? busy : `Engaged with ${opp.character.name}: disengage before moving.`;
    }
    if (hasTag(skill, 'movement')) return `Engaged with ${opp.character.name}: disengage before moving.`;
    // Heal, Cleanse, shields and buffs only on yourself while engaged.
    const helps = skill.heal || skill.cleanse || skill.shield || (skill.applyStatus ?? []).some((a) => !STATUSES[a.status]?.debuff);
    if (skill.target === 'unit' && helps && targets.some((t) => t !== caster)) return busy;
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
    const events: BattleEvent[] = [];
    for (const part of basic.hits ?? []) {
      if (!victim.alive) break;
      events.push(...this.dealHit(attacker, victim, part, 'opportunity'));
    }
    events.push(...this.weaponProcs(attacker, victim, 'opportunity'));
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
    this.lockTeammates(u);
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

  /** An enemy throws down its arms: it leaves the fight and is taken prisoner if the party wins. Ends its turn. */
  surrender(u: Unit): BattleEvent[] {
    if (u.team !== 'enemy' || !u.alive) throw new Error(`${u.character.name} can't surrender`);
    const events: BattleEvent[] = [];
    const opp = this.breakEngagement(u);
    if (opp) events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'separated' });
    u.alive = false;
    u.surrendered = true;
    u.overwatch = null;
    u.acted = true;
    events.push({ type: 'surrender', target: u.uid });
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

  /** Regular move: needs the movement AP (and not engaged). */
  canMove(u: Unit): boolean {
    return this.canAct(u) && !u.moved && u.ap >= 1 && !u.engagedWith && !this.isFrozen(u);
  }

  /** Is the unit's turn still going (it may have AP or free actions left)? */
  canAct(u: Unit): boolean {
    return u.alive && u.team === this.phase && !u.acted;
  }

  /** Enough AP for the skill's cost? Turn-ending skills need at least 1 AP; 2-AP skills need both. */
  canPay(u: Unit, skill: SkillDef): boolean {
    if (skill.ap === 0) return true;
    return u.ap >= (skill.ap === 'end' ? 1 : skill.ap);
  }

  /** Units of the current team that still have AP this turn. */
  readyUnits(): Unit[] {
    return this.living(this.phase).filter((u) => !u.acted && u.ap > 0);
  }

  /** Can `u` use this skill right now (ignoring targets)? AP, mana, cooldown and weapon permitting. */
  canUseSkill(u: Unit, skillId: string): boolean {
    const skill = SKILLS[skillId];
    if (!this.canAct(u) || !this.skillIds(u).includes(skillId) || !this.isUsable(u, skillId) || !this.canPay(u, skill)) return false;
    // Dash: a second move with the action AP, only once the regular move is spent.
    if (skill.target === 'move') return u.moved && !u.engagedWith;
    if (skill.switchMode) return !!this.modesOf(u);
    return true;
  }

  /** Pay a skill's AP cost (see ApCost). */
  private spendAp(u: Unit, skill: SkillDef): void {
    if (skill.ap === 0) return;
    if (skill.ap === 1) {
      u.moved = true; // uses the movement AP if it was still there
      u.ap -= 1;
      return;
    }
    u.ap = 0;
    u.moved = true;
    if (skill.ap === 'end') u.acted = true;
  }

  /** Free skills (e.g. Kick) the unit could use right now on at least one unit. */
  usableFreeActions(u: Unit): string[] {
    return this.skillIds(u).filter((id) => {
      const s = SKILLS[id];
      // Switch Mode and toggles never keep a turn open on their own.
      if (!isFree(s) || s.switchMode || s.toggleStatus || !this.canUseSkill(u, id)) return false;
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
    const result = new Map<string, ReachInfo>([[key(u.x, u.y), { cost: 0, prev: null, hazards: 0 }]]);
    const frontier: { x: number; y: number; cost: number; hazards: number }[] = [{ x: u.x, y: u.y, cost: 0, hazards: 0 }];
    while (frontier.length) {
      frontier.sort((a, b) => a.cost - b.cost || a.hazards - b.hazards);
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
        const hazards = cur.hazards + this.zonesAt({ x: nx, y: ny }).length;
        const known = result.get(k);
        if (known && (known.cost < cost || (known.cost === cost && (known.hazards ?? 0) <= hazards))) continue;
        result.set(k, { cost, prev: key(cur.x, cur.y), hazards });
        frontier.push({ x: nx, y: ny, cost, hazards });
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

  // ---- threat (what a unit could do on its next turn) -------------------------------

  /** Could `u` use this skill on its next turn? Cooldowns tick down at the start of its own turn. */
  readyNextTurn(u: Unit, skillId: string): boolean {
    const left = u.cooldowns[skillId] ?? 0;
    const ticks = u.team === this.phase ? 0 : 1;
    return left - ticks <= 0 && !(u.weaponDisabled && hasTag(SKILLS[skillId], 'weapon'));
  }

  /** How far a skill reaches from where the user stands (cones and self-centered areas included). */
  maxReach(u: Unit, s: SkillDef): number {
    s = this.skillFor(u, s);
    if (s.target === 'self') return s.aoeRadius ?? 0;
    if (s.target === 'cone') return this.coneRadius(u, s);
    return this.skillRange(u, s);
  }

  /** Skills that can hurt or hinder the other team (damage, a debuff or a push). */
  isHostile(s: SkillDef): boolean {
    return s.affects !== 'ally' && (!!s.hits?.length || !!s.basicAttack || !!s.knockback || (s.applyStatus ?? []).some((a) => STATUSES[a.status]?.debuff));
  }

  /**
   * What `u` threatens on its next turn: the tiles it can move to, and the tiles its longest-ranged
   * hostile skill (usable next turn) can reach from any of them. Engaged units can't move.
   */
  threat(u: Unit): { move: Point[]; attack: Point[]; skill: SkillDef | null; range: number } {
    const move = u.engagedWith ? [{ x: u.x, y: u.y }] : [...this.reachable(u).keys()].map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    });
    let skill: SkillDef | null = null;
    let range = 0;
    for (const id of this.skillIds(u)) {
      const s = SKILLS[id];
      if (!this.isHostile(s) || !this.readyNextTurn(u, id)) continue;
      const r = this.maxReach(u, s);
      if (!skill || r > range) {
        skill = s;
        range = r;
      }
    }
    const attack = new Map<string, Point>();
    if (skill) {
      for (const from of move) {
        for (let y = 0; y < this.map.height; y++) {
          for (let x = 0; x < this.map.width; x++) {
            const k = key(x, y);
            if (attack.has(k)) continue;
            const tile = { x, y };
            if (skill.target === 'self' ? withinRange(dist(from, tile), range) && dist(from, tile) > 0 : this.inReach(u, skill, tile, from)) attack.set(k, tile);
          }
        }
      }
    }
    return { move, attack: [...attack.values()], skill, range };
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

  /** Walk to `dest` with the movement AP. Enemy overwatch can shoot (and an interrupting watch can stop) the unit on the way. */
  move(u: Unit, dest: Point): MoveResult {
    if (!this.canMove(u)) throw new Error(`${u.character.name} can't move now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y))) throw new Error('Destination not reachable');
    u.moved = true;
    u.walked = true;
    u.ap -= 1;
    this.lockTeammates(u);
    return this.walk(u, this.pathTo(reach, dest));
  }

  /** Dash: after the regular move, spend the action AP (and its mana, cooldown) to move again. */
  dash(u: Unit, dest: Point): MoveResult {
    const id = this.skillIds(u).find((s) => SKILLS[s].target === 'move');
    if (!id || !this.canUseSkill(u, id)) throw new Error(`${u.character.name} can't dash now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y)) || (dest.x === u.x && dest.y === u.y)) throw new Error('Destination not reachable');
    this.payFor(u, id);
    return this.walk(u, this.pathTo(reach, dest));
  }

  /** Spend a skill's AP, mana and cooldown. Using a skill can't be undone. */
  private payFor(u: Unit, skillId: string, noMana = false): void {
    const skill = SKILLS[skillId];
    this.spendAp(u, skill);
    if (!noMana) u.mp -= skill.mana;
    // Cooldown N counts from the current turn: the counter ticks at the start of each of
    // the unit's turns, so 1 = not again this turn, usable next turn.
    if (skill.cooldown > 0) u.cooldowns[skillId] = skill.cooldown;
    u.locked = true;
    this.lockTeammates(u);
  }

  /**
   * `u` did something (moved, used a skill, broke away): its teammates can no longer undo their moves this turn.
   * Otherwise undoing would be free movement: step aside to let an ally through, or out of an ally's area attack, then step back.
   */
  private lockTeammates(u: Unit): void {
    // Only moves already made are locked in; a teammate that hasn't moved yet can still undo its own move later.
    for (const o of this.units) if (o !== u && o.team === u.team && o.walked) o.locked = true;
  }

  private walk(u: Unit, full: Point[]): MoveResult {
    const result: MoveResult = { path: [], triggers: [], interrupted: false };
    for (const step of full) {
      u.x = step.x;
      u.y = step.y;
      result.path.push(step);
      // Zones hit on every tile entered, even while passing through allies.
      const caught = this.zoneHits(u, step, 1);
      if (caught.length) {
        result.triggers.push({ index: result.path.length - 1, events: caught });
        u.locked = true;
        if (!u.alive) {
          u.acted = true;
          break;
        }
      }
      // Overwatch (and Frozen stopping the walk) only happen on tiles the unit could stop on (not while passing through allies).
      if (this.units.some((o) => o !== u && o.alive && o.x === step.x && o.y === step.y)) continue;
      const { events, interrupted } = this.triggerOverwatch(u);
      if (events.length) {
        const same = result.triggers.find((t) => t.index === result.path.length - 1);
        if (same) same.events.push(...events);
        else result.triggers.push({ index: result.path.length - 1, events });
        u.locked = true;
      }
      if (!u.alive) {
        u.acted = true;
        break;
      }
      if (interrupted || this.isFrozen(u)) {
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
      if (!w.overwatch.tiles.has(key(mover.x, mover.y)) || this.isStealthed(mover)) continue;
      if (w.overwatch.los && !this.clearLine(w, mover, w.overwatch.los, w)) continue;
      const ow = w.overwatch;
      w.overwatch = null;
      for (const part of ow.hits) {
        if (!mover.alive) break;
        events.push(...this.dealHit(w, mover, part, 'overwatch'));
      }
      if (ow.weapon) events.push(...this.weaponProcs(w, mover, 'overwatch'));
      if (ow.interrupt) interrupted = true;
    }
    return { events, interrupted };
  }

  /**
   * Only a regular move with nothing else done since (no skill, no overwatch shot) can be taken back, and only
   * until a teammate does something (see lockTeammates).
   */
  canUndoMove(u: Unit): boolean {
    const occupant = this.unitAt(u.startPos.x, u.startPos.y);
    return u.alive && u.walked && !u.acted && !u.locked && (!occupant || occupant === u);
  }

  undoMove(u: Unit): void {
    if (!this.canUndoMove(u)) throw new Error("Can't undo that move");
    u.x = u.startPos.x;
    u.y = u.startPos.y;
    u.moved = false;
    u.walked = false;
    u.ap += 1;
  }

  /** End this unit's turn, giving up any AP left. */
  wait(u: Unit): void {
    if (!this.canAct(u)) throw new Error(`${u.character.name}'s turn is already over`);
    u.ap = 0;
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

  /**
   * Why a single-target skill can't be aimed at `tile` even though it's in reach: nobody there (or only a
   * Stealthed enemy), or a support skill aimed at the other side. Null when the target is fine.
   * Kept out of canTarget so the range box still shows every tile in reach.
   */
  targetError(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): string | null {
    skill = this.skillFor(caster, skill);
    if (skill.target !== 'unit') return null;
    const t = this.occupantFrom(caster, from, tile);
    if (!t || this.hiddenFrom(caster, t)) return `${skill.name} needs a unit to target.`;
    if (skill.affects === 'ally' && t.team !== caster.team) return `${skill.name} only works on your own side.`;
    return null;
  }

  /** In reach and a valid target: what the player can click and the AI can pick. */
  canAim(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): boolean {
    return this.canTarget(caster, skill, tile, from) && !this.targetError(caster, skill, tile, from);
  }

  /** Range / line / landing checks only (ignores engagement). */
  private inReach(caster: Unit, skill: SkillDef, tile: Point, from: Point): boolean {
    if (!this.inMap(tile)) return false;
    skill = this.skillFor(caster, skill);
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
      case 'move':
        // Dash: anywhere the unit could walk to right now.
        return !caster.engagedWith && (tile.x !== from.x || tile.y !== from.y) && this.reachable(caster).has(key(tile.x, tile.y));
      case 'emptyTile': {
        if (d < minRange - EPS || !withinRange(d, range)) return false;
        const occupant = this.occupantFrom(caster, from, tile);
        return passable(this.map, tile.x, tile.y) && !occupant;
      }
      case 'ground': {
        if (d < minRange - EPS || !withinRange(d, range)) return false;
        const los = this.skillLos(caster, skill);
        return !los || this.clearLine(from, tile, los, caster);
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
    if (skill.target === 'move') {
      // Dash: every tile the unit can walk to (one search, not one per tile).
      if (caster.engagedWith) return [];
      return [...this.reachable(caster).keys()].map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y };
      }).filter((p) => p.x !== from.x || p.y !== from.y);
    }
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
    skill = this.skillFor(caster, skill);
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
        return coneTiles(this.map, from, tile, skill.cone!.angle, this.coneRadius(caster, skill));
      case 'ground':
        return this.zoneTiles(skill.zone!, tile);
      default:
        return [tile];
    }
  }

  /** A cone's reach: its own radius, or the skill's range (a 'weapon' cone reaches as far as the weapon). */
  coneRadius(u: Unit, skill: SkillDef): number {
    return skill.cone?.radius ?? this.skillRange(u, skill);
  }

  /** Who stands on `p` if `caster` were standing on `from` instead of its real tile. */
  private occupantFrom(caster: Unit, from: Point, p: Point): Unit | undefined {
    if (p.x === from.x && p.y === from.y) return caster;
    const u = this.unitAt(p.x, p.y);
    return u === caster ? undefined : u;
  }

  /** Stealthed units can't be targeted directly by the other team (see the Stealthed status). */
  isStealthed(u: Unit): boolean {
    return u.statuses.some((s) => STATUSES[s.id]?.stealth);
  }

  hiddenFrom(caster: Unit, t: Unit): boolean {
    return t.team !== caster.team && this.isStealthed(t);
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
    skill = this.skillFor(caster, skill);
    switch (skill.target) {
      case 'cone':
      case 'emptyTile':
      case 'move':
      case 'ground':
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
          if (t && this.hiddenFrom(caster, t)) continue;
          // Passes allies in the way; hits one only if it's the unit aimed at.
          const aimed = p.x === tile.x && p.y === tile.y;
          if (t && (this.matches(caster, skill, t) || (aimed && this.aimedHit(caster, skill, t)))) return [t];
        }
        return [];
      }
      case 'unit': {
        const t = this.occupantFrom(caster, from, tile);
        if (t && this.hiddenFrom(caster, t)) return [];
        // Engage (engaging without attacking) does nothing once either side is already engaged.
        if (t && hasTag(skill, 'engage') && !skill.hits?.length && !skill.basicAttack && (caster.engagedWith || t.engagedWith)) return [];
        return t && (this.matches(caster, skill, t) || this.aimedHit(caster, skill, t)) ? [t] : [];
      }
    }
  }

  /**
   * Where a Charge aimed at `tile` ends: next to the target (or on the tile itself
   * if it is empty), reachable in at most `range` steps (diagonals allowed). Null if impossible.
   */
  chargeDestination(caster: Unit, tile: Point, from: Point = caster, skill?: SkillDef): Point | null {
    const path = this.chargePath(caster, tile, from, skill);
    return path ? (path.length ? path[path.length - 1] : { x: from.x, y: from.y }) : null;
  }

  /**
   * The tiles a charge travels through to its destination (see chargeDestination), in order, without the start;
   * empty when the user is already next to the target. A teleport strike's path is just where it appears. Null if
   * the charge can't land anywhere.
   */
  chargePath(caster: Unit, tile: Point, from: Point = caster, skill?: SkillDef): Point[] | null {
    const chargeSkill = skill ?? Object.values(SKILLS).find((x) => x.charge);
    if (!chargeSkill) return null;
    const target = this.occupantFrom(caster, from, tile);
    if (target === caster) return null;
    const free = (p: Point) => passable(this.map, p.x, p.y) && (!this.occupantFrom(caster, from, p) || (p.x === from.x && p.y === from.y));
    let goals: Point[];
    if (target) {
      if (dist(from, tile) <= 1.5 + EPS) return [];
      goals = DIRS8.map((d) => ({ x: tile.x + d.x, y: tile.y + d.y })).filter((p) => this.inMap(p) && free(p));
    } else {
      // A teleport strike needs someone to appear next to; a dash can just run to the tile.
      goals = free(tile) && !chargeSkill.teleport ? [tile] : [];
    }
    if (goals.length === 0) return null;
    // Teleport strike (Flicker Strike): appear on the free tile next to the target closest to you.
    if (chargeSkill.teleport) return [goals.reduce((a, b) => (dist(from, b) < dist(from, a) - EPS ? b : a))];
    const goalKeys = new Set(goals.map((p) => key(p.x, p.y)));
    const maxSteps = Math.floor(this.skillRange(caster, chargeSkill));
    const seen = new Map<string, number>([[key(from.x, from.y), 0]]);
    const prev = new Map<string, Point>();
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
        prev.set(key(n.x, n.y), p);
        queue.push(n);
      }
    }
    if (!best) return null;
    const path: Point[] = [];
    for (let p: Point | undefined = best; p && (p.x !== from.x || p.y !== from.y); p = prev.get(key(p.x, p.y))) path.unshift(p);
    return path;
  }

  // ---- resist ------------------------------------------------------------------------

  /** Chance (0-100, whole number) that `t` shrugs off a debuff. */
  resistChance(t: Unit): number {
    return Math.round(resistChance(this.stat(t, 'resist'), this.rules.defenseScale) * 100);
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

  /**
   * One hit split by damage type, after the target's mitigation (before shields):
   * P.Atk, Def and missing Health are Physical, M.Atk is Magical. A hybrid hit
   * (Empowered Strike) deals one portion of each.
   */
  hitPortions(attacker: Unit, target: Unit, part: DamagePart): { type: DamageType; amount: number }[] {
    const raw: Record<DamageType, number> = {
      physical: (part.pAtk ?? 0) * this.stat(attacker, 'pAtk') + (part.def ?? 0) * this.stat(attacker, 'defense') + (part.missingHp ?? 0) * (target.stats.health - target.hp),
      magical: (part.mAtk ?? 0) * this.stat(attacker, 'mAtk'),
    };
    const out = DAMAGE_TYPES.filter((t) => raw[t] > 0).map((type) => ({ type, amount: Math.max(1, Math.round(raw[type] * this.mitigation(attacker, target, type))) }));
    return out.length ? out : [{ type: 'physical', amount: 1 }];
  }

  /**
   * Damage multiplier for a hit of `type` on `target`. Both types use Defense for now;
   * this is where magic resistance and physical / magic penetration will go.
   */
  mitigation(_attacker: Unit, target: Unit, _type: DamageType): number {
    return defenseMultiplier(this.stat(target, 'defense'));
  }

  /** Total damage of one hit (all damage types). */
  hitDamage(attacker: Unit, target: Unit, part: DamagePart): number {
    return this.hitPortions(attacker, target, part).reduce((a, p) => a + p.amount, 0);
  }

  /** Deal one hit: a damage event per damage type in it. */
  private dealHit(attacker: Unit, target: Unit, part: DamagePart, cause: DamageCause): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const p of this.hitPortions(attacker, target, part)) {
      if (!target.alive) break;
      events.push(this.dealDamage(target, p.amount, attacker.uid, cause, false, p.type));
    }
    return events;
  }

  /**
   * Execute's multiplier on `target` (1 without a missingHpBonus): 1x at full Health, growing smoothly to the
   * skill's max at its `atHealth` share of max Health and below.
   */
  missingHpMultiplier(skill: SkillDef, target: Unit): number {
    const b = skill.missingHpBonus;
    if (!b) return 1;
    const missing = 1 - target.hp / target.stats.health;
    return 1 + (b.max - 1) * Math.min(1, Math.max(0, missing / (1 - b.atHealth)));
  }

  /** Predicted damage of each hit of `skill` on `target` (accounts for missing health growing). */
  previewHits(attacker: Unit, skill: SkillDef, target: Unit): number[] {
    const swings = this.isWeaponAttack(attacker, skill) ? (this.skillFor(attacker, skill).basicAttack ?? 1) : 0;
    skill = this.skillFor(attacker, skill);
    // Execute: the multiplier comes from Health before the hit, and leaves on-hit effects alone.
    const mult = this.missingHpMultiplier(skill, target);
    if (mult !== 1) skill = { ...skill, hits: scaleHits(skill.hits ?? [], mult) };
    // Weapon on-hit effects (Arcane Weapon) the attacker can pay for.
    if (swings) skill = { ...skill, hits: [...(skill.hits ?? []), ...this.procParts(attacker, swings, skill.mana)] };
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

  /** What the user would take from the skill's recoil (with its own self statuses, e.g. Exposed, applied). */
  recoilDamage(u: Unit, s: SkillDef): number {
    if (!s.recoilIfSurvives) return 0;
    const saved = u.statuses;
    const extra = (s.selfStatus ?? []).filter((a) => !saved.some((x) => x.id === a.status)).map((a) => {
      const def = STATUSES[a.status];
      return { id: a.status, name: def.name, debuff: def.debuff, stacks: 1, amount: 0, turns: a.turns, tick: def.tick };
    });
    u.statuses = [...saved, ...extra];
    try {
      return this.hitDamage(u, u, s.recoilIfSurvives);
    } finally {
      u.statuses = saved;
    }
  }

  // ---- zones ----------------------------------------------------------------------------

  /** Tiles a zone aimed at `center` covers (walkable ones only: rocks and water can't burn or freeze anyone). */
  zoneTiles(def: ZoneDef, center: Point): Point[] {
    const out: Point[] = [];
    const R = Math.ceil(def.radius);
    for (let y = center.y - R; y <= center.y + R; y++) {
      for (let x = center.x - R; x <= center.x + R; x++) {
        if (passable(this.map, x, y) && withinRange(dist(center, { x, y }), def.radius)) out.push({ x, y });
      }
    }
    return out;
  }

  /** Zones covering a tile. */
  zonesAt(p: Point): Zone[] {
    return this.zones.filter((z) => z.tiles.has(key(p.x, p.y)));
  }

  /** Every zone on `tile` hits `u` `times` times. */
  private zoneHits(u: Unit, tile: Point, times: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const z of this.zonesAt(tile)) events.push(...this.zoneHit(z, u, times));
    return events;
  }

  /** One zone hits `u` `times` times: its damage (from the caster's stats) and statuses each time. */
  private zoneHit(z: Zone, u: Unit, times: number): BattleEvent[] {
    const caster = this.unit(z.casterUid);
    const events: BattleEvent[] = [];
    for (let i = 0; i < times && u.alive; i++) {
      events.push({ type: 'zoneHit', source: caster.uid, target: u.uid, name: z.name });
      events.push(...this.dealHit(caster, u, z.def.hit, 'zone'));
      if (!u.alive) break;
      for (const a of z.def.applyStatus) events.push(...this.applyStatus(caster, u, a.status, a.turns, a.stacks ?? 1));
    }
    return events;
  }

  /** Rough damage `u` takes from zones walking `path` (each tile entered) and standing at its end. */
  zoneDanger(u: Unit, path: Point[]): number {
    let total = 0;
    const end = path[path.length - 1] ?? u;
    for (const p of path) for (const z of this.zonesAt(p)) total += this.hitDamage(this.unit(z.casterUid), u, z.def.hit);
    for (const z of this.zonesAt(end)) total += z.def.endTurnHits * this.hitDamage(this.unit(z.casterUid), u, z.def.hit);
    return total;
  }

  /** The stat bonus a caster-scaled status (Protection) gives when `source` applies it. */
  scaledStatusAmount(source: Unit, statusId: string): number {
    const sc = STATUSES[statusId]?.casterScaled;
    if (!sc) return 0;
    return Math.round(this.stat(source, 'pAtk') * (sc.pAtk ?? 0) + this.stat(source, 'mAtk') * (sc.mAtk ?? 0));
  }

  /**
   * Run `fn` as if `target` had status `id` from `source` (one stack, caster-scaled amounts included),
   * then put its statuses back. For previews: what a buff or debuff would change.
   */
  withStatus<T>(source: Unit, target: Unit, id: string, fn: () => T): T {
    const def = STATUSES[id];
    const saved = target.statuses;
    target.statuses = [...saved.filter((s) => s.id !== id), {
      id, name: def.name, debuff: def.debuff, stacks: 1, amount: this.scaledStatusAmount(source, id), turns: 1, tick: def.tick,
    }];
    try {
      return fn();
    } finally {
      target.statuses = saved;
    }
  }

  /** Shield points `skill` gives `target` when `caster` uses it. */
  shieldAmount(caster: Unit, skill: SkillDef, target: Unit): number {
    const sh = skill.shield;
    if (!sh) return 0;
    return Math.round(target.stats.health * (sh.maxHpPct ?? 0) + this.stat(caster, 'mAtk') * (sh.mAtk ?? 0));
  }

  healAmount(caster: Unit, skill: SkillDef): number {
    return Math.round((skill.heal?.mAtk ?? 0) * this.stat(caster, 'mAtk'));
  }

  private dealDamage(target: Unit, amount: number, source: string | undefined, cause: DamageCause, bypassShield = false, damageType?: DamageType): BattleEvent {
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
    target.lowestHp = Math.min(target.lowestHp, target.hp);
    const killed = target.hp === 0;
    if (killed) {
      target.alive = false;
      target.overwatch = null;
      this.breakEngagement(target);
    }
    return { type: 'damage', source, target: target.uid, amount: amount - absorbed, absorbed, killed, cause, ...(damageType ? { damageType } : {}) };
  }

  // ---- actions -------------------------------------------------------------------------

  perform(u: Unit, skillId: string, tile: Point): BattleEvent[] {
    const skill = SKILLS[skillId];
    if (!skill) throw new Error(`Unknown skill ${skillId}`);
    if (!this.canAct(u)) throw new Error(`${u.character.name}'s turn is over`);
    if (skill.target === 'move') throw new Error('Use dash() to dash');
    if (!this.skillIds(u).includes(skillId)) throw new Error(`${u.character.name} doesn't have ${skill.name}`);
    if (!this.canPay(u, skill)) throw new Error(`${skill.name} needs more AP`);
    if (!this.isReady(u, skillId)) throw new Error(`${skill.name} is on cooldown`);
    const switchingOff = !!skill.toggleStatus && this.isToggledOn(u, skill.toggleStatus);
    if (u.mp < skill.mana && !switchingOff) throw new Error(`${skill.name} needs ${skill.mana} mana`);
    if (!this.isUsable(u, skillId)) throw new Error(`${skill.name} needs a weapon`);
    const block = this.engagementBlock(u, skill, tile);
    if (block) throw new Error(block);
    if (!this.canTarget(u, skill, tile)) throw new Error('Target out of range');
    const bad = this.targetError(u, skill, tile);
    if (bad) throw new Error(bad);

    const events: BattleEvent[] = [];
    // The skill's own mana comes first, so per-hit costs during it (Arcane Weapon) only spend what's left.
    if (!switchingOff) u.mp -= skill.mana;
    const origin = { x: u.x, y: u.y };
    // Aim first (Flicker Strike picks its victim before it moves), then resolve.
    const aimed = skill.charge ? this.targetsOf(u, skill, tile) : null;
    const used = this.skillFor(u, skill);
    // Disengage skills end the user's engagement first, with no opportunity attack.
    if (hasTag(skill, 'disengage')) {
      const opp = this.opponentOf(u);
      if (opp) {
        this.breakEngagement(u);
        events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'escaped' });
      }
    }
    for (const a of skill.selfStatus ?? []) events.push(...this.applyStatus(u, u, a.status, a.turns, 1, true));
    if (skill.switchMode) events.push(...this.setWeaponMode(u, u.weaponMode + 1));
    // Toggles: switch the status on (paying the mana) or off again (free).
    if (skill.toggleStatus) {
      if (this.isToggledOn(u, skill.toggleStatus)) {
        events.push(this.toggleOff(u, skill.toggleStatus));
      } else {
        const def = STATUSES[skill.toggleStatus];
        u.statuses.push({ id: def.id, name: def.name, debuff: def.debuff, stacks: 1, amount: 0, turns: Infinity, tick: def.tick });
        events.push({ type: 'toggle', target: u.uid, name: def.name, on: true });
      }
    }
    // Still next to the target after the charge (it can be stopped short)? Melee charges strike only then.
    let stoppedShort = false;
    if (skill.charge && skill.teleport) {
      const dest = this.chargeDestination(u, tile, u, skill)!;
      if (dest.x !== u.x || dest.y !== u.y) {
        u.x = dest.x;
        u.y = dest.y;
        events.push({ type: 'move', target: u.uid, from: origin, to: dest, kind: 'teleport' });
        events.push(...this.zoneHits(u, dest, 1));
      }
    } else if (skill.charge) {
      // A charge runs there on its own feet, tile by tile like a walk: enemy overwatch fires (and an interrupting
      // watch or Frozen stops it) and zones hit on the way. Teleports skip all that.
      const walked = this.walk(u, this.chargePath(u, tile, u, skill)!);
      let at = origin;
      walked.path.forEach((step, i) => {
        events.push({ type: 'move', target: u.uid, from: at, to: step, kind: 'charge' });
        at = step;
        for (const t of walked.triggers) if (t.index === i) events.push(...t.events);
      });
      stoppedShort = walked.interrupted;
      if (!u.alive) {
        this.payFor(u, skillId, true);
        return events;
      }
    } else if (skill.teleport) {
      u.x = tile.x;
      u.y = tile.y;
      events.push({ type: 'move', target: u.uid, from: origin, to: { ...tile }, kind: 'teleport' });
      events.push(...this.zoneHits(u, tile, 1));
    }
    if (skill.zone) {
      const tiles = this.zoneTiles(skill.zone, tile);
      this.zones.push({
        skillId, name: skill.name, casterUid: u.uid, team: u.team,
        tiles: new Set(tiles.map((p) => key(p.x, p.y))), turnsLeft: skill.zone.turns, def: skill.zone,
      });
      events.push({ type: 'zone', source: u.uid, name: skill.name, tiles });
    }
    if (skill.cone) {
      u.overwatch = {
        skillId,
        tiles: new Set(coneTiles(this.map, u, tile, skill.cone.angle, this.coneRadius(u, skill)).map((p) => key(p.x, p.y))),
        interrupt: skill.cone.interrupt,
        los: skill.cone.los ?? this.skillLos(u, skill),
        // Without hits of its own, the watch fires the user's basic attack.
        hits: skill.hits ?? this.basicAttack(u).hits ?? [],
        weapon: !skill.hits,
      };
      events.push({ type: 'overwatch', source: u.uid, skillId });
    }

    let targets = skill.toggleStatus ? [] : aimed ?? this.targetsOf(u, skill, tile);
    // Stopped on the way: the strike only lands on targets it still reaches.
    if (stoppedShort) targets = targets.filter((t) => dist(u, t) <= 1.5 + EPS);
    // Weapon attacks carry on-hit effects (Arcane Weapon): one per swing (Double Strike swings twice).
    const swings = this.isWeaponAttack(u, skill) ? (used.basicAttack ?? 1) : 0;
    for (const t of targets) {
      // Execute: scaled by the target's Health before the hit.
      const mult = this.missingHpMultiplier(used, t);
      for (const part of scaleHits(used.hits ?? [], mult)) {
        if (!t.alive) break;
        events.push(...this.dealHit(u, t, part, 'skill'));
      }
      for (let i = 0; i < swings && t.alive; i++) events.push(...this.weaponProcs(u, t, 'skill'));
      // Life-Risking Strike: the user pays if the target is still standing.
      if (skill.recoilIfSurvives && t.alive && u.alive) {
        events.push(...this.dealHit(u, u, skill.recoilIfSurvives, 'skill'));
        if (!u.alive) u.acted = true;
      }
      if (!t.alive) continue;
      // Engage: locks both units together, unless either is already engaged.
      const engages = hasTag(used, 'engage') || (used.engageWithin !== undefined && withinRange(dist(u, t), used.engageWithin));
      if (engages && t.team !== u.team && u.alive && !u.engagedWith && !t.engagedWith) {
        this.engage(u, t);
        events.push({ type: 'engage', source: u.uid, target: t.uid });
      }
      for (const a of skill.applyStatus ?? []) events.push(...this.applyStatus(u, t, a.status, a.turns, a.stacks ?? 1));
      if (skill.heal) {
        const amount = Math.min(this.healAmount(u, skill), t.stats.health - t.hp);
        t.hp += amount;
        events.push({ type: 'heal', source: u.uid, target: t.uid, amount });
      }
      if (skill.shield) {
        const amount = this.shieldAmount(u, skill, t);
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
    if (used.knockback) {
      for (const t of targets) {
        if (!t.alive) continue;
        const dir = { x: Math.sign(t.x - u.x), y: Math.sign(t.y - u.y) };
        let moved = false;
        for (let i = 0; i < used.knockback; i++) {
          const to = { x: t.x + dir.x, y: t.y + dir.y };
          if (!passable(this.map, to.x, to.y) || this.unitAt(to.x, to.y)) break;
          events.push({ type: 'move', target: t.uid, from: { x: t.x, y: t.y }, to, kind: 'knockback' });
          t.x = to.x;
          t.y = to.y;
          moved = true;
          events.push(...this.zoneHits(t, to, 1));
          if (!t.alive) break;
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

    events.push(...this.separationEvents());
    // Attacking gives a Stealthed unit away.
    if (this.isAttack(used) && used.affects !== 'ally') u.statuses = u.statuses.filter((st) => !STATUSES[st.id]?.stealth);
    this.payFor(u, skillId, true); // mana was paid up front (none when switching a toggle off)
    return events;
  }

  /** Apply a status. Debuffs can be shrugged off: a Resist roll (see resistChance). */
  private applyStatus(source: Unit, t: Unit, id: string, turns: number, stacks: number, unresisted = false): BattleEvent[] {
    const def = STATUSES[id];
    if (!t.alive) return [];
    if (def.debuff && !unresisted) {
      const chance = resistChance(this.stat(t, 'resist'), this.rules.defenseScale);
      if (chance > 0 && this.rng() < chance) return [{ type: 'resist', source: source.uid, target: t.uid, name: def.name, chance: Math.round(chance * 100) }];
    }
    // Instant statuses (Explosion) do their damage now and aren't kept.
    if (def.instantDamagePctMaxHp) {
      return [{ type: 'status', source: source.uid, target: t.uid, name: def.name }, this.statusDamage(t, def.instantDamagePctMaxHp, def.mitigated, source.uid)];
    }
    const existing = t.statuses.find((s) => s.id === id);
    // Past its stack cap the status turns into its overflow (Chilled x3 -> Frozen, Burn x3 -> Explosion).
    const have = existing?.stacks ?? 0;
    if (def.stacking && def.overflow && def.maxStacks !== undefined && have + stacks > def.maxStacks) {
      t.statuses = t.statuses.filter((s) => s.id !== id);
      return this.applyStatus(source, t, def.overflow.status, def.overflow.turns, 1, true);
    }
    // Decaying statuses (Burn, Chilled) last until their stacks run out, not a number of turns.
    const lasts = def.decay ? Infinity : turns;
    if (existing) {
      if (def.stacking) existing.stacks += stacks;
      existing.turns = Math.max(existing.turns, lasts);
    } else {
      t.statuses.push({ id, name: def.name, debuff: def.debuff, stacks: def.stacking ? stacks : 1, amount: 0, turns: lasts, tick: def.tick });
    }
    // Caster-scaled bonuses (Protection) use the caster's stat now; a recast keeps the bigger one.
    const sc = def.casterScaled;
    if (sc) {
      const status = t.statuses.find((s) => s.id === id)!;
      status.amount = Math.max(status.amount, this.scaledStatusAmount(source, id));
    }
    const now = t.statuses.find((s) => s.id === id)!;
    return [{ type: 'status', source: source.uid, target: t.uid, name: def.stacking ? `${def.name} x${now.stacks}` : def.name }];
  }

  /**
   * Damage from a status (a Burn tick, an Explosion): `pct` of max Health. Mitigated statuses are reduced by
   * Defense and absorbed by shields like a hit; others ignore both.
   */
  private statusDamage(u: Unit, pct: number, mitigated: boolean | undefined, source?: string): BattleEvent {
    const raw = u.stats.health * pct;
    const amount = Math.max(1, Math.round(mitigated ? raw * defenseMultiplier(this.stat(u, 'defense')) : raw));
    return this.dealDamage(u, amount, source, 'status', !mitigated);
  }

  /**
   * Statuses that tick at the `when` of the unit's turn: damage over time first (Burn at the end, Poison at the start),
   * then one turn less (or one stack less for decaying ones), dropping any that ran out.
   */
  private tickStatuses(u: Unit, when: 'start' | 'end'): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const s of u.statuses) {
      if (s.tick !== when) continue;
      const def = STATUSES[s.id];
      if (def?.damagePctMaxHpPerStack && u.alive) events.push(this.statusDamage(u, def.damagePctMaxHpPerStack * statusStrength(s), def.mitigated));
      this.tickStatus(s);
    }
    u.statuses = u.statuses.filter((s) => this.stillActive(s));
    return events;
  }

  /** A status ticks (start or end of the unit's turn): one turn less, or one stack less for decaying ones (Burn, Chilled). */
  private tickStatus(s: Status): void {
    if (STATUSES[s.id]?.decay) s.stacks -= 1;
    else s.turns -= 1;
  }

  /** Statuses that are still running (turns left; decaying ones also need stacks left). */
  private stillActive(s: Status): boolean {
    return s.turns > 0 && (!STATUSES[s.id]?.decay || s.stacks > 0);
  }

  // ---- toggles and weapon on-hit effects (Arcane Weapon) -------------------------------

  /** The unit's active toggle statuses with a weapon on-hit effect. */
  private weaponOnHits(u: Unit): Status[] {
    return u.statuses.filter((s) => STATUSES[s.id]?.weaponOnHit);
  }

  /** Is `s` (as listed, not resolved) a weapon attack: the weapon's basic attack (any mode) or a 'weapon' skill? */
  isWeaponAttack(u: Unit, s: SkillDef): boolean {
    const raw = this.rawBasic(u);
    return s.id === raw.id || !!raw.modes?.includes(s.id) || (hasTag(s, 'weapon') && !s.cone);
  }

  /** Switch a toggle status off (out of mana, or the unit used the skill again). */
  private toggleOff(u: Unit, id: string, reason?: 'mana'): BattleEvent {
    u.statuses = u.statuses.filter((s) => s.id !== id);
    return { type: 'toggle', target: u.uid, name: STATUSES[id].name, on: false, ...(reason ? { reason } : {}) };
  }

  /**
   * A weapon attack landed on `t` (one per swing): each active on-hit effect adds its hit, paying its mana.
   * Without the mana for it, the effect switches off.
   */
  private weaponProcs(u: Unit, t: Unit, cause: DamageCause): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const s of this.weaponOnHits(u)) {
      if (!t.alive || !u.alive) break;
      const def = STATUSES[s.id];
      const cost = def.manaPerHit ?? 0;
      if (u.mp < cost) {
        events.push(this.toggleOff(u, s.id, 'mana'));
        continue;
      }
      u.mp -= cost;
      events.push(...this.dealHit(u, t, def.weaponOnHit!, cause));
    }
    return events;
  }

  /** Extra damage each swing of a weapon attack would add on `target` (for previews), as hits. */
  private procParts(u: Unit, swings: number, reserved = 0): DamagePart[] {
    const out: DamagePart[] = [];
    let mp = u.mp - reserved; // the skill's own mana is paid first
    for (let i = 0; i < swings; i++) {
      for (const s of this.weaponOnHits(u)) {
        const def = STATUSES[s.id];
        if (mp < (def.manaPerHit ?? 0)) continue;
        mp -= def.manaPerHit ?? 0;
        out.push(def.weaponOnHit!);
      }
    }
    return out;
  }

  /** Is this toggle status on? */
  isToggledOn(u: Unit, statusId: string): boolean {
    return u.statuses.some((s) => s.id === statusId);
  }

  // ---- turn flow --------------------------------------------------------------------

  /**
   * Start a team's turn: reset actions, tick cooldowns, drop old overwatch, and
   * tick status effects (Burn damages now; durations count the unit's own turns).
   */
  private beginPhase(team: Team): BattleEvent[] {
    this.phase = team;
    const events: BattleEvent[] = [];
    for (const z of this.zones) if (z.team === team) z.turnsLeft -= 1;
    this.zones = this.zones.filter((z) => z.turnsLeft > 0);
    for (const u of this.living(team)) {
      u.ap = AP_PER_TURN;
      u.moved = false;
      u.walked = false;
      u.acted = false;
      u.locked = false;
      u.startPos = { x: u.x, y: u.y };
      u.overwatch = null;
      for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
      events.push(...this.tickStatuses(u, 'start'));
      // Toggles cost mana every turn to keep up; they switch off when the unit can't pay.
      for (const s of [...u.statuses]) {
        const upkeep = STATUSES[s.id]?.manaPerTurn;
        if (!upkeep || !u.alive) continue;
        if (u.mp >= upkeep) u.mp -= upkeep;
        else events.push(this.toggleOff(u, s.id, 'mana'));
      }
      // Frozen: the movement AP is lost this turn.
      if (this.isFrozen(u)) {
        u.ap -= 1;
        u.moved = true;
      }
      if (!u.alive) u.acted = true;
    }
    return events;
  }

  /** End the current team's turn; returns events from the start of the next turn (e.g. Burn). */
  endPhase(): BattleEvent[] {
    // Effects that last "through" the unit's turn (Slow, Chilled, Frozen) count down first, so the end-of-turn zone hits
    // below (and anything they freeze) carry over into the unit's next turn instead of wearing off at once.
    const events: BattleEvent[] = [];
    for (const u of this.living(this.phase)) events.push(...this.tickStatuses(u, 'end'));
    // Units ending their turn inside a zone are hit (Firestorm: twice).
    for (const u of this.living(this.phase)) {
      for (const z of this.zonesAt(u)) events.push(...this.zoneHit(z, u, z.def.endTurnHits));
    }
    const next: Team = this.phase === 'player' ? 'enemy' : 'player';
    if (next === 'player') this.round += 1;
    return [...events, ...this.beginPhase(next)];
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
    appearance: { color: ENEMY_COLOR, model: modelFor(id, def.art.models) },
  };
}

/**
 * The foes of an encounter at `stage`: one main type whose level range fits, plus the other fitting types
 * that fight the same way (so wolves come with wolves and beasts, bandits with other humans). Main type first.
 */
export function pickFoes(stage: number, rng: Rng): string[] {
  const fit = enemyTypesForStage(stage).map((t) => t.type);
  const main = fit[Math.floor(rng() * fit.length)];
  return [main, ...fit.filter((t) => t !== main && ENEMIES[t].ai === ENEMIES[main].ai)];
}

/**
 * An encounter for `stage`: random picks from the foes (see pickFoes) until `budget` threat is spent
 * (see encounterBudget: it comes from the quest, never the party). Weak types come in bigger packs.
 * Past the last level range, the budget keeps growing by 25% per stage. At most `cap` enemies.
 */
export function generateEnemies(stage: number, rng: Rng, budget: number, foes?: string[], cap = ENCOUNTER.maxEnemies): Character[] {
  const fitting = enemyTypesForStage(stage);
  const want = foes?.length ? foes : pickFoes(stage, rng);
  const themed = fitting.filter((t) => want.includes(t.type));
  const options = themed.length ? themed : fitting;
  const top = Math.max(...Object.values(ENEMIES).map((d) => d.levels[1]));
  const total = budget * (1 + Math.max(0, stage - top) * 0.25);
  const out: Character[] = [];
  let spent = 0;
  while (spent < total - 1e-9 && out.length < cap) {
    const pick = options[Math.floor(rng() * options.length)];
    out.push(makeEnemy(pick.type, pick.level, rng));
    spent += ENEMIES[pick.type].threat;
  }
  return out;
}

/** Deployment spots near the left (player) or right (enemy) edge. */
export function deploymentTiles(map: BattleMap, team: Team, count: number): Point[] {
  // The usual three columns at the edge; big encounters spill further in (up to the middle).
  const half = Math.floor(map.width / 2);
  const inner = [...Array(Math.max(0, half - 3)).keys()].map((i) => i + 3);
  const cols = team === 'player' ? [1, 0, 2, ...inner] : [map.width - 2, map.width - 1, map.width - 3, ...inner.map((c) => map.width - 1 - c)];
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
