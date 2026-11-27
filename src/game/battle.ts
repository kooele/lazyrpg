// Pure battle rules (no rendering). BattleScene drives this and animates the events it returns.
import { ENEMY_COLOR, SKILLS, SKILL_TREES, STATUSES, hasTag, modeWithTag, resolveWeaponSkill } from '../data/content';
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { STAT_CONFIG, type StatConfig } from '../data/stats';
import { DAMAGE_TYPES, PEN_KEYS, type ApCost, type Character, type DamagePart, type DamageType, type LosRule, type SkillDef, type StatKey, type Stats, type ZoneDef, type ZoneElement } from '../data/types';
import { allSkills, deriveStats, modelFor, newId, type Rng } from './character';
import { combatPenalty } from './condition';
import { combinePenPct, enemyGearQuality, gear, weaponOf } from './gear';
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
  /** Its shots are projectiles (a bow's Direct or Indirect mode): forest shelters the target. */
  projectile?: boolean;
}

/** Action points every unit gets each turn: one movement AP and one action AP. */
export const AP_PER_TURN = 2;

/** Moves each side can undo per battle (Undo Move). */
export const UNDO_LIMIT = 3;
/** A move that brings more than this many new tiles into its side's sight (fog of war) can't be undone. */
export const UNDO_REVEAL_TILES = 10;

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
  /** Why this turn's move can't be undone because of what it revealed (fog of war), if it can't. */
  undoBlock?: 'spotted' | 'scouted';
  /** Fled off the edge of the map (counts as gone, not dead). */
  escaped?: boolean;
  /** Gave up (human enemies that can't escape): out of the fight, and taken prisoner if the party wins. */
  surrendered?: boolean;
  /** Hit and Run fired: the unit has one free movement action left this turn (walk, or a Movement, Leap or Teleport skill). */
  bonusMove?: boolean;
}

/**
 * Why damage happened: a skill, a status tick (e.g. Burn), overwatch, an opportunity attack on disengage, a zone, or a
 * passive's free counter attack (Fighting Spirit, Tooth for Tooth).
 */
export type DamageCause = 'skill' | 'status' | 'overwatch' | 'opportunity' | 'zone' | 'counter';

export type BattleEvent =
  | { type: 'damage'; source?: string; target: string; amount: number; absorbed: number; killed: boolean; cause: DamageCause; damageType?: DamageType }
  | { type: 'engage'; source: string; target: string }
  | { type: 'disengage'; source: string; target: string; reason: 'disengage' | 'separated' | 'displaced' | 'escaped' }
  | { type: 'heal'; source: string; target: string; amount: number }
  | { type: 'shield'; source: string; target: string; amount: number }
  | { type: 'status'; source: string; target: string; name: string }
  | { type: 'resist'; source: string; target: string; name: string; chance: number; immune?: boolean }
  | { type: 'cleanse'; source: string; target: string; removed: string[] }
  | { type: 'move'; target: string; from: Point; to: Point; kind: 'knockback' | 'teleport' | 'charge' | 'leap' }
  | { type: 'overwatch'; source: string; skillId: string }
  | { type: 'escape'; target: string }
  | { type: 'surrender'; target: string }
  | { type: 'mode'; target: string; name: string }
  /** A toggle (Arcane Weapon) switched on or off; `reason` says why it went off on its own. */
  | { type: 'toggle'; target: string; name: string; on: boolean; reason?: 'mana' | 'health' | 'turn' }
  /** Hit and Run fired: the unit gets a free movement action. */
  | { type: 'bonusMove'; target: string }
  /** A zone (Firestorm) was placed on these tiles. */
  | { type: 'zone'; source: string; name: string; tiles: Point[] }
  /** A unit is caught by a zone (followed by its damage and status events). */
  | { type: 'zoneHit'; source: string; target: string; name: string }
  /** A unit walked into an enemy it couldn't see (Stealthed, or in fog of war): it stops, and the hidden unit is found. */
  | { type: 'bump'; source: string; target: string }
  /** A passive struck back for free (Fighting Spirit, Tooth for Tooth); its damage events follow. */
  | { type: 'counter'; source: string; target: string; name: string };

/** A lasting ground effect from a 'ground' skill (Firestorm, Blizzard). */
export interface Zone {
  /** The skill (or status, "status:explosion") that made it. */
  skillId: string;
  name: string;
  /** Fire, ice or water: a tile holds one elemental effect (see Battle.addZone). */
  element?: ZoneElement;
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

/** `blessing`: a church blessing's share added to every stat (0.06 = +6%), on top of any penalty. */
export function makeUnit(character: Character, team: Team, pos: Point, blessing = 0): Unit {
  const stats = deriveStats(character);
  // Party members fight with every stat lowered by injuries, low Morale and (slaves) low Obedience, and raised by a
  // church blessing (not penetration: that's the weapon's, not the fighter's).
  const penalty = character.enemyType ? 0 : combatPenalty(character);
  const factor = (1 - penalty) * (1 + blessing);
  if (factor !== 1) for (const k of Object.keys(stats) as StatKey[]) if (!(PEN_KEYS as readonly string[]).includes(k)) stats[k] = Math.round(stats[k] * factor);
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

/**
 * Defense after penetration: percent first, then flat (100 Defense, 50% and 10 = 40). Penetration only
 * lowers Defense down to 0, and does nothing to Defense that is already 0 or less.
 */
export function penetrate(defense: number, pct: number, flat: number): number {
  if (defense <= 0) return defense;
  return Math.max(0, defense * (1 - Math.min(100, Math.max(0, pct)) / 100) - Math.max(0, flat));
}

/** Does this skill's damage come from a projectile (arrows, bolts, thrown spells)? Forest shelters from those. */
export const isProjectile = (s: SkillDef) => hasTag(s, 'projectile') || hasTag(s, 'indirect');

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

/** Penetration for display, e.g. "P.Pen: 50% | 10" (percent, then flat); '' when the unit has none of that type. */
export function penText(stats: Pick<Stats, 'pPen' | 'pPenPct' | 'mPen' | 'mPenPct'>, type: DamageType): string {
  const [pct, flat, label] = type === 'physical' ? [stats.pPenPct, stats.pPen, 'P.Pen'] : [stats.mPenPct, stats.mPen, 'M.Pen'];
  return pct || flat ? `${label}: ${pct}% | ${flat}` : '';
}

/** Both penetration lines that apply, joined ("P.Pen: 50% | 0   M.Pen: 0% | 5"), or ''. */
export const penLine = (stats: Pick<Stats, 'pPen' | 'pPenPct' | 'mPen' | 'mPenPct'>, sep = '   ') =>
  [penText(stats, 'physical'), penText(stats, 'magical')].filter(Boolean).join(sep);

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

/** Skills of the Mage tab's trees (Quick Cast speeds these up). */
const MAGE_SPELLS = new Set(SKILL_TREES.filter((t) => t.tab === 'mage').flatMap((t) => t.skills));

/** Sign of each coordinate of b - a: the 8-way direction from a toward b. */
const dirTo = (a: Point, b: Point): Point => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });

export class Battle {
  readonly units: Unit[];
  /**
   * Where each team last saw each enemy it can't see now (by uid). The AI plans around these instead of the real
   * positions of units hidden in fog of war. Starts with where the enemies were deployed.
   */
  readonly lastSeen: Record<Team, Map<string, Point>> = { player: new Map(), enemy: new Map() };
  /** Undo Move uses left this battle, per side (UNDO_LIMIT). */
  readonly undosLeft: Record<Team, number> = { player: UNDO_LIMIT, enemy: UNDO_LIMIT };
  /**
   * Where each party member stood when the party's last turn began (not Stealthed ones). The enemy AI learns these when
   * its own turn begins: a rough, one-turn-old idea of where units out of sight are (see beginPhase). The player gets
   * no such information about the enemy.
   */
  private turnStart = new Map<string, Point>();
  /** visibleTiles results per team, valid while its units stand where they did (see sightKey). */
  private sight: Partial<Record<Team, { key: string; tiles: Set<string> }>> = {};
  /** Ground effects in play (Firestorm, Blizzard). */
  zones: Zone[] = [];
  phase: Team = 'player';
  round = 1;

  constructor(readonly map: BattleMap, units: Unit[], readonly rng: Rng, readonly rules: StatConfig = STAT_CONFIG) {
    this.units = units;
    // Scout: Stealthed from the start until the unit first attacks.
    for (const u of units) {
      if (!this.hasPassive(u, 'scout') || this.isStealthed(u)) continue;
      const def = STATUSES.stealth;
      u.statuses.push({ id: def.id, name: def.name, debuff: false, stacks: 1, amount: 0, turns: Infinity, tick: def.tick });
    }
    // Each side starts out knowing where the other deployed (not where Stealthed units are).
    for (const u of units) for (const f of units) if (f.team !== u.team && !this.isStealthed(f)) this.lastSeen[u.team].set(f.uid, { x: f.x, y: f.y });
    this.beginPhase('player');
  }

  /** Has the unit learned this passive (Fighting Spirit, Scout...)? */
  hasPassive(u: Unit, id: string): boolean {
    return SKILLS[id]?.target === 'passive' && this.skillIds(u).includes(id);
  }

  /** The unit's tags ("evil"), from its enemy type. */
  unitTags(u: Unit): string[] {
    return (u.character.enemyType && ENEMIES[u.character.enemyType]?.tags) || [];
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

  /** Current stat including status effects. */
  stat(u: Unit, stat: StatKey): number {
    let value = u.stats[stat];
    for (const s of u.statuses) {
      const mod = STATUSES[s.id]?.statMods?.[stat];
      if (mod) value += mod * statusStrength(s);
      if (STATUSES[s.id]?.casterScaled?.stat === stat) value += s.amount;
    }
    // Percentage changes multiply: Slow and Chilled (-25% Movement each) together leave 75% x 75% = 56%.
    for (const s of u.statuses) {
      const pct = STATUSES[s.id]?.statPct?.[stat];
      if (pct) value *= Math.max(0, 1 + pct * statusStrength(s));
    }
    // Zones the unit stands in (Rain: -25% P.Atk and M.Atk for the caster's enemies).
    if (this.zones.length) {
      for (const z of this.zonesAt(u)) {
        const pct = z.def.statPct?.[stat];
        if (pct && this.zoneAffects(z, u)) value *= Math.max(0, 1 + pct);
      }
    }
    if (stat === 'movement') value = Math.max(0, value);
    // Scout: sees further while Stealthed.
    if (stat === 'vision' && this.isStealthed(u)) {
      for (const id of this.skillIds(u)) if (SKILLS[id]?.stealthVision && this.hasPassive(u, id)) value += SKILLS[id].stealthVision!;
    }
    return Math.round(value);
  }

  // ---- skill properties that depend on the user (tags) ----------------------------

  /** The weapon's basic attack (first weapon skill). */
  basicAttack(u: Unit): SkillDef {
    return this.skillFor(u, this.rawBasic(u));
  }

  /** The basic attack as listed (a bow's is its moded Basic Attack, whatever the mode). */
  private rawBasic(u: Unit): SkillDef {
    return SKILLS[allSkills(u.character)[0] ?? 'basic_attack'];
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
    const m = resolveWeaponSkill(raw, weaponOf(u.character), mode);
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
      const weapon = weaponOf(u.character);
      out = resolveWeaponSkill(s, weapon, mode);
      if (out.basicAttack || areaFromWeapon) {
        // Circle Swing always swings a bow in Melee mode ('basicMode').
        const forced = out.basicMode ? modeWithTag(this.rawBasic(u), out.basicMode) : undefined;
        const basic = forced ? resolveWeaponSkill(forced, weapon) : this.basicAttack(u);
        out = {
          ...out,
          hits: out.basicAttack ? Array.from({ length: out.basicAttack }, (_, i) => scaleHits(basic.hits ?? [], out!.basicAttackDamage?.[i] ?? 1)).flat() : out.hits,
          aoeRadius: areaFromWeapon ? basic.range + (out.weaponRangeBonus ?? 0) : out.aoeRadius,
        };
        // A basic attack skill (Double Strike, Execute) engages like the basic attack it swings: an adjacent target
        // (engageWithin), or any target (a basic attack with the engage tag, e.g. Bow Strike).
        if (out.basicAttack && out.target === 'unit' && !hasTag(out, 'engage') && out.engageWithin === undefined) {
          const within = hasTag(basic, 'engage') ? Infinity : basic.engageWithin;
          if (within !== undefined) out = { ...out, engageWithin: within };
        }
      }
      perSkill.set(cacheKey, out);
    }
    return out;
  }

  /** What the unit's tag-dependent skills scale from (Movement, weapon). */
  reachContext(u: Unit): ReachContext {
    const basicMode = (tag: string) => {
      const m = modeWithTag(this.rawBasic(u), tag);
      return m && resolveWeaponSkill(m, weaponOf(u.character));
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
    const switchingOn = !!s.toggleStatus && !this.isToggledOn(u, s.toggleStatus);
    const mana = s.toggleStatus && !switchingOn ? 0 : s.mana;
    // Soul Ignition: switching on also costs Health, and needs more than that left.
    if (switchingOn && u.hp <= this.toggleHpCost(u, s.toggleStatus!)) return false;
    return this.isReady(u, skillId) && u.mp >= mana && !(u.weaponDisabled && hasTag(s, 'weapon')) && !(this.isFrozen(u) && this.movesUser(s));
  }

  /** Health a toggle (Soul Ignition) costs to switch on and each turn after: its share of max HP, rounded (0 for most). */
  toggleHpCost(u: Unit, statusId: string): number {
    const pct = STATUSES[statusId]?.hpPctPerTurn;
    return pct ? Math.max(1, Math.round(u.stats.health * pct)) : 0;
  }

  /** Movement actions (Hit and Run's free move allows only these): Dash, and Movement, Leap and Teleport skills. */
  isMovementSkill(s: SkillDef): boolean {
    return s.target === 'move' || hasTag(s, 'movement') || hasTag(s, 'leap') || hasTag(s, 'teleport');
  }

  /** Frozen units can't move (see the Frozen status). */
  isFrozen(u: Unit): boolean {
    return u.statuses.some((s) => STATUSES[s.id]?.frozen);
  }

  /** Skills that move the user on its own feet (Dash, Charge, Movement and Leap skills); teleports don't count. */
  private movesUser(s: SkillDef): boolean {
    return s.target === 'move' || hasTag(s, 'movement') || hasTag(s, 'leap') || (!!s.charge && !s.teleport);
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
    if (hasTag(skill, 'movement') || hasTag(skill, 'leap')) return `Engaged with ${opp.character.name}: disengage before moving.`;
    // Heal, Cleanse, shields and buffs only on yourself while engaged.
    const helps = skill.heal || skill.cleanse || skill.shield || (skill.applyStatus ?? []).some((a) => !STATUSES[a.status]?.debuff);
    if (skill.target === 'unit' && helps && targets.some((t) => t !== caster)) return busy;
    if (!this.isAttack(skill)) return null;
    if (skill.cone) return `Engaged with ${opp.character.name}: can't watch other enemies.`;
    // Area attacks (Circle Swing, Smite) are fine as long as they hit the opponent;
    // aimed attacks must hit exactly the opponent.
    const area = skill.target === 'self' || skill.target === 'ground';
    const ok = area ? targets.includes(opp) : targets.length === 1 && targets[0] === opp;
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
    this.updateSightings();
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
    if ((u.cooldowns[skillId] ?? 0) <= 0) return true;
    // A toggle that's on can always be switched off (Quick Cast is on cooldown from the moment it's switched on).
    const toggle = SKILLS[skillId]?.toggleStatus;
    if (toggle && this.isToggledOn(u, toggle)) return true;
    // In the Zone: free basic attacks ignore the cooldown.
    return this.isBasic(u, SKILLS[skillId]) && !!this.statusWith(u, 'freeBasicAttacks');
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
    const ap = this.apCost(u, skill);
    if (ap === 0) return true;
    return u.ap >= (ap === 'end' ? 1 : ap);
  }

  /** The unit's active status with this flag (Quick Cast, In the Zone), if any. */
  private statusWith(u: Unit, flag: 'quickCast' | 'freeBasicAttacks'): Status | undefined {
    return u.statuses.find((s) => STATUSES[s.id]?.[flag] && s.stacks > 0);
  }

  /** Is this the unit's weapon basic attack (any mode)? */
  isBasic(u: Unit, s: SkillDef): boolean {
    const raw = this.rawBasic(u);
    return s.id === raw.id || !!raw.modes?.includes(s.id);
  }

  /**
   * What the skill costs `u` right now: its AP, except that In the Zone makes basic attacks free and Quick Cast makes
   * the next Mage spell of 2 AP or Ends Turn cost 1 AP.
   */
  apCost(u: Unit, skill: SkillDef): ApCost {
    if (skill.ap === 0) return 0;
    if (this.isBasic(u, skill) && this.statusWith(u, 'freeBasicAttacks')) return 0;
    if ((skill.ap === 2 || skill.ap === 'end') && MAGE_SPELLS.has(skill.id) && this.statusWith(u, 'quickCast')) return 1;
    return skill.ap;
  }

  /** Units of the current team that still have AP this turn. */
  readyUnits(): Unit[] {
    return this.living(this.phase).filter((u) => !u.acted && u.ap > 0);
  }

  /** Can `u` use this skill right now (ignoring targets)? AP, mana, cooldown and weapon permitting. */
  canUseSkill(u: Unit, skillId: string): boolean {
    const skill = SKILLS[skillId];
    if (skill.target === 'passive') return false;
    if (!this.canAct(u) || !this.skillIds(u).includes(skillId) || !this.isUsable(u, skillId) || !this.canPay(u, skill)) return false;
    if (u.bonusMove && !this.isMovementSkill(skill)) return false;
    // Dash: a second move with the action AP, only once the regular move is spent.
    if (skill.target === 'move') return u.moved && !u.engagedWith;
    if (skill.switchMode) return !!this.modesOf(u);
    return true;
  }

  /** Pay an AP cost (see ApCost). */
  private spendAp(u: Unit, ap: ApCost): void {
    if (ap === 0) return;
    if (ap === 1) {
      u.moved = true; // uses the movement AP if it was still there
      u.ap -= 1;
      return;
    }
    u.ap = 0;
    u.moved = true;
    if (ap === 'end') u.acted = true;
  }

  /** Free skills (e.g. Kick) the unit could use right now on at least one unit. */
  usableFreeActions(u: Unit): string[] {
    return this.skillIds(u).filter((id) => {
      const s = SKILLS[id];
      // Switch Mode, toggles and self-buffs (Quick Cast) never keep a turn open on their own.
      if (this.apCost(u, s) !== 0 || s.switchMode || s.toggleStatus || !this.canUseSkill(u, id)) return false;
      if (s.target === 'self' && !s.aoeRadius && !this.isAttack(s)) return false;
      return this.rangeTiles(u, s).some((t) => this.targetsOf(u, s, t).length > 0);
    });
  }

  /** Units the player can still do something with this turn (an action, or a usable free action). */
  commandableUnits(): Unit[] {
    return this.living(this.phase).filter((u) => this.canAct(u) || this.usableFreeActions(u).length > 0);
  }

  // ---- movement -----------------------------------------------------------------

  /**
   * Tiles the unit can end its move on (including where it stands). Orthogonal steps only. `avoid`: tiles it won't
   * step onto (it may still pass through an ally standing on one), e.g. enemy overwatch arcs (see watchedTiles).
   */
  reachable(u: Unit, avoid?: Set<string>): Map<string, ReachInfo> {
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
        // Enemies block, unless the unit doesn't know they're there (Stealthed, or in fog of war): it plans as if the
        // tile were empty and bumps into them on the way (see walk).
        const seen = this.unitAt(nx, ny);
        const occupant = seen && seen.team !== u.team && this.hiddenFrom(u, seen) ? undefined : seen;
        if (occupant && occupant.team !== u.team) continue; // can't pass through enemies
        if (!occupant && avoid?.has(key(nx, ny))) continue; // overwatch doesn't fire while passing through an ally
        const cost = cur.cost + (TERRAIN[this.map.tiles[ny][nx]].moveCost ?? 99);
        if (cost > budget) continue;
        const k = key(nx, ny);
        const hazards = cur.hazards + this.hazardsAt(u, { x: nx, y: ny });
        const known = result.get(k);
        if (known && (known.cost < cost || (known.cost === cost && (known.hazards ?? 0) <= hazards))) continue;
        result.set(k, { cost, prev: key(cur.x, cur.y), hazards });
        frontier.push({ x: nx, y: ny, cost, hazards });
      }
    }
    // Can pass through allies but not stop on them (unseen enemies' tiles look empty).
    for (const k of [...result.keys()]) {
      const [x, y] = k.split(',').map(Number);
      const occupant = this.unitAt(x, y);
      if (occupant && occupant !== u && !(occupant.team !== u.team && this.hiddenFrom(u, occupant))) result.delete(k);
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

  /** Tiles where enemy overwatch `u` knows about would fire at it if it stepped there (none while it's Stealthed). */
  watchedTiles(u: Unit): Set<string> {
    const out = new Set<string>();
    if (this.isStealthed(u)) return out;
    for (const w of this.living()) if (w.team !== u.team && w.overwatch && !this.hiddenFrom(u, w)) for (const k of w.overwatch.tiles) out.add(k);
    return out;
  }

  /**
   * The path a move to `dest` takes: the cheapest one, or with `avoidWatch` one around every enemy overwatch arc
   * when there's such a path within the unit's Movement (the cheapest one otherwise). `reach` and `safe` can be
   * passed in when already worked out (reachable(u), and reachable(u, watchedTiles(u))).
   */
  routeTo(u: Unit, dest: Point, avoidWatch = false, reach = this.reachable(u), safe?: Map<string, ReachInfo>): Point[] {
    if (dest.x === u.x && dest.y === u.y) return [];
    if (avoidWatch) {
      const around = safe ?? this.safeReach(u);
      if (around?.has(key(dest.x, dest.y))) return this.pathTo(around, dest);
    }
    return this.pathTo(reach, dest);
  }

  /** Where `u` can get to without stepping into enemy overwatch; null when nothing is watched. */
  safeReach(u: Unit): Map<string, ReachInfo> | null {
    const watched = this.watchedTiles(u);
    return watched.size ? this.reachable(u, watched) : null;
  }

  /**
   * Walk to `dest` with the movement AP. Enemy overwatch can shoot (and an interrupting watch can stop) the unit on
   * the way. `avoidWatch`: go around enemy overwatch arcs when that's possible (see routeTo).
   */
  move(u: Unit, dest: Point, avoidWatch = false): MoveResult {
    if (!this.canMove(u)) throw new Error(`${u.character.name} can't move now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y))) throw new Error('Destination not reachable');
    const before = u.ap;
    u.moved = true;
    u.walked = true;
    u.ap -= 1;
    this.lockTeammates(u);
    // What the side could see before, to tell what the move reveals (fog of war).
    const sightBefore = this.rules.vision.enabled ? new Set(this.visibleTiles(u.team)) : null;
    const foesBefore = sightBefore ? new Set(this.spottedFoes(u.team)) : null;
    const result = this.walk(u, this.routeTo(u, dest, avoidWatch, reach));
    // A move that spots an enemy, or brings more than UNDO_REVEAL_TILES new tiles into sight, can't be taken back:
    // otherwise it would be free scouting.
    if (sightBefore && foesBefore) {
      const newTiles = [...this.visibleTiles(u.team)].filter((k) => !sightBefore.has(k)).length;
      const spotted = this.spottedFoes(u.team).some((f) => !foesBefore.has(f));
      u.undoBlock = spotted ? 'spotted' : newTiles > UNDO_REVEAL_TILES ? 'scouted' : undefined;
      if (u.undoBlock) u.locked = true;
    }
    const bonus = this.bonusMoveCheck(u, before);
    if (bonus.length) result.triggers.push({ index: result.path.length - 1, events: bonus });
    this.updateSightings();
    return result;
  }

  /** Enemies `team` can see right now (not Stealthed ones). */
  private spottedFoes(team: Team): Unit[] {
    return this.living().filter((f) => f.team !== team && this.canSee(team, f) && !this.isStealthed(f));
  }

  /** Dash: after the regular move, spend the action AP (and its mana, cooldown) to move again. */
  dash(u: Unit, dest: Point): MoveResult {
    const id = this.skillIds(u).find((s) => SKILLS[s].target === 'move');
    if (!id || !this.canUseSkill(u, id)) throw new Error(`${u.character.name} can't dash now`);
    const reach = this.reachable(u);
    if (!reach.has(key(dest.x, dest.y)) || (dest.x === u.x && dest.y === u.y)) throw new Error('Destination not reachable');
    const bonus = this.payFor(u, id);
    const result = this.walk(u, this.pathTo(reach, dest));
    if (bonus.length) result.triggers.push({ index: result.path.length - 1, events: bonus });
    this.updateSightings();
    return result;
  }

  /**
   * Spend a skill's AP (`ap`: its cost worked out before it was used, see apCost), mana and cooldown, and use up
   * what lowered the cost (a free basic attack doesn't start the cooldown). Using a skill can't be undone.
   */
  private payFor(u: Unit, skillId: string, noMana = false, ap: ApCost = this.apCost(u, SKILLS[skillId]), noCooldown = false): BattleEvent[] {
    const skill = SKILLS[skillId];
    const before = u.ap;
    this.spendAp(u, ap);
    if (!noMana) u.mp -= skill.mana;
    const free = ap === 0 && skill.ap !== 0 ? this.statusWith(u, 'freeBasicAttacks') : undefined;
    const quick = ap === 1 && skill.ap !== 1 ? this.statusWith(u, 'quickCast') : undefined;
    if (free) free.stacks -= 1;
    if (free || quick) u.statuses = u.statuses.filter((s) => s !== quick && s.stacks > 0);
    // Cooldown N counts from the current turn: the counter ticks at the start of each of
    // the unit's turns, so 1 = not again this turn, usable next turn.
    else if (skill.cooldown > 0 && !noCooldown) u.cooldowns[skillId] = skill.cooldown;
    if (quick && skill.cooldown > 0) u.cooldowns[skillId] = skill.cooldown;
    u.locked = true;
    this.lockTeammates(u);
    // Hit and Run: spending the last AP (a turn-ending attack included, not a reaction like Overwatch) gives a free move.
    return skill.cone ? [] : this.bonusMoveCheck(u, before);
  }

  /**
   * Hit and Run: `u` just spent its last AP (it had `before`). If it has a bonusMove status, that's used up and the
   * unit gets one free movement action: 1 AP, usable only to walk or for a Movement, Leap or Teleport skill.
   */
  private bonusMoveCheck(u: Unit, before: number): BattleEvent[] {
    if (!u.alive || before <= 0 || u.ap > 0 || u.bonusMove) return [];
    const st = u.statuses.find((x) => STATUSES[x.id]?.bonusMove);
    if (!st) return [];
    u.statuses = u.statuses.filter((x) => x !== st);
    u.bonusMove = true;
    u.acted = false;
    u.ap = 1;
    u.moved = false;
    u.walked = false;
    u.locked = true;
    return [{ type: 'bonusMove', target: u.uid }];
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
      // Walking into an enemy it didn't know about: stop short, and the hidden unit is found (loses Stealth).
      const hidden = this.unitAt(step.x, step.y);
      if (hidden && hidden.team !== u.team) {
        hidden.statuses = hidden.statuses.filter((st) => !STATUSES[st.id]?.stealth);
        result.triggers.push({ index: result.path.length - 1, events: [{ type: 'bump', source: u.uid, target: hidden.uid }] });
        result.interrupted = true;
        u.locked = true;
        break;
      }
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
      // A watch only fires on what its side can see (not Stealthed units, not units in fog of war).
      if (!w.overwatch.tiles.has(key(mover.x, mover.y)) || this.hiddenFrom(w, mover)) continue;
      if (w.overwatch.los && !this.clearLine(w, mover, w.overwatch.los, w)) continue;
      const ow = w.overwatch;
      w.overwatch = null;
      for (const part of ow.hits) {
        if (!mover.alive) break;
        events.push(...this.dealHit(w, mover, part, 'overwatch', ow.projectile));
      }
      if (ow.weapon) events.push(...this.weaponProcs(w, mover, 'overwatch', ow.projectile));
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
    return u.alive && u.walked && !u.acted && !u.locked && this.undosLeft[u.team] > 0 && (!occupant || occupant === u);
  }

  /** Why the unit's move can't be undone right now (for the UI), or null if it can (or there's no move to undo). */
  undoBlockReason(u: Unit): string | null {
    if (!u.walked || u.acted || this.canUndoMove(u)) return null;
    if (u.undoBlock === 'spotted') return 'This move spotted an enemy.';
    if (u.undoBlock === 'scouted') return `This move revealed more than ${UNDO_REVEAL_TILES} new tiles.`;
    if (this.undosLeft[u.team] <= 0) return `No undos left this battle (${UNDO_LIMIT} per battle).`;
    return 'Something has happened since (an action, an attack on the way, or another unit moved).';
  }

  undoMove(u: Unit): void {
    if (!this.canUndoMove(u)) throw new Error("Can't undo that move");
    u.x = u.startPos.x;
    u.y = u.startPos.y;
    u.moved = false;
    u.walked = false;
    u.ap += 1;
    u.undoBlock = undefined;
    this.undosLeft[u.team] -= 1;
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
        if (skill.backstab && !this.behindTarget(caster, tile, from)) return false;
        if (skill.charge) return this.chargeDestination(caster, tile, from, skill) !== null;
        return true;
      }
      case 'passive':
        return false;
    }
  }

  /**
   * The 3 tiles behind `t`: on the side away from the unit it's engaged with (none if it isn't engaged).
   * Facing the opponent, these are directly behind it and diagonally behind on each side.
   */
  behindTiles(t: Unit): Point[] {
    const opp = this.opponentOf(t);
    if (!opp) return [];
    const d = dirTo(opp, t);
    return DIRS8.filter((n) => n.x * d.x + n.y * d.y > 0).map((n) => ({ x: t.x + n.x, y: t.y + n.y }));
  }

  /** Backstab: is there an enemy on `tile` engaged with someone other than `caster`, with `from` one of the 3 tiles behind it? */
  behindTarget(caster: Unit, tile: Point, from: Point = caster): boolean {
    const t = this.occupantFrom(caster, from, tile);
    if (!t || t === caster || !t.engagedWith || t.engagedWith === caster.uid) return false;
    return this.behindTiles(t).some((p) => p.x === from.x && p.y === from.y);
  }

  /** The unit `skill` (Power Strike) also hits behind its target: the next tile on from the user, past the target. */
  pierceVictim(caster: Unit, skill: SkillDef, tile: Point, from: Point = caster): Unit | undefined {
    if (!skill.pierce) return undefined;
    const d = dirTo(from, tile);
    if (!d.x && !d.y) return undefined;
    const t = this.occupantFrom(caster, from, { x: tile.x + d.x, y: tile.y + d.y });
    return t && t !== caster ? t : undefined;
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
        return skill.zone ? this.zoneTiles(skill.zone, tile) : this.shapeTiles(tile);
      case 'emptyTile': {
        if (!skill.aoeRadius) return [tile];
        const out: Point[] = [];
        const R = Math.ceil(skill.aoeRadius);
        for (let y = tile.y - R; y <= tile.y + R; y++) {
          for (let x = tile.x - R; x <= tile.x + R; x++) if (this.inMap({ x, y }) && withinRange(dist(tile, { x, y }), skill.aoeRadius)) out.push({ x, y });
        }
        return out;
      }
      default:
        return [tile];
    }
  }

  /** A 'cross' (Smite, Draft): the tile and its 4 neighbours, inside the map. */
  shapeTiles(center: Point): Point[] {
    return [center, ...DIRS.map((d) => ({ x: center.x + d.x, y: center.y + d.y }))].filter((p) => this.inMap(p));
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

  /** Stealthed units can't be targeted directly by the other team (see the Stealthed status). Revealed units can't be Stealthed. */
  isStealthed(u: Unit): boolean {
    return u.statuses.some((s) => STATUSES[s.id]?.stealth) && !this.isRevealed(u);
  }

  /** Revealed (Revelation): seen through fog of war and can't be Stealthed. */
  isRevealed(u: Unit): boolean {
    return u.statuses.some((s) => STATUSES[s.id]?.reveals);
  }

  /** Is `t` hidden from `caster`'s side: an enemy that is Stealthed, or out of its side's sight (fog of war)? */
  hiddenFrom(caster: Unit, t: Unit): boolean {
    return t.team !== caster.team && (this.isStealthed(t) || !this.canSee(caster.team, t));
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
      case 'emptyTile':
        // Heroic Leap: everyone around where it lands (hidden units too, like other area attacks).
        if (!skill.aoeRadius) return [];
        return this.living().filter((t) => t !== caster && this.matches(caster, skill, t) && withinRange(dist(tile, t), skill.aoeRadius!));
      case 'cone':
      case 'move':
      case 'passive':
        return [];
      case 'ground': {
        if (skill.zone) return [];
        // A shape (Smite's cross) hits every matching unit on its tiles, hidden ones included.
        const area = new Set(this.shapeTiles(tile).map((p) => key(p.x, p.y)));
        return this.living().filter((t) => {
          const pos = t === caster ? from : t;
          return area.has(key(pos.x, pos.y)) && this.matches(caster, skill, t);
        });
      }
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
    // Leap (Pounce): fly straight to the closest free tile next to the target within range, over anything in the way.
    if (hasTag(chargeSkill, 'leap')) {
      const range = this.skillRange(caster, chargeSkill);
      const inRange = goals.filter((g) => withinRange(dist(from, g), range));
      if (!inRange.length) return null;
      const goal = inRange.reduce((a, b) => (dist(from, b) < dist(from, a) - EPS ? b : a));
      return [...tilesBetween(from, goal).filter((p) => this.inMap(p)), goal];
    }
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
        if (occ && occ.team !== caster.team && !this.hiddenFrom(caster, occ)) continue;
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

  // ---- vision (fog of war; stats.json "vision".enabled) --------------------------------

  /** Tiles `team` can currently see: within some living member's Vision, in line of sight. Everything while vision is off. */
  visibleTiles(team: Team): Set<string> {
    const viewers = this.living(team);
    const enabled = this.rules.vision.enabled;
    // Worked out again only when the team's units move (or their Vision changes); everything else reads the cache.
    const sightKey = enabled ? viewers.map((v) => `${v.x},${v.y},${this.stat(v, 'vision')}`).join('|') : 'all';
    const cached = this.sight[team];
    if (cached && cached.key === sightKey) return cached.tiles;
    const seen = new Set<string>();
    if (!enabled) {
      for (let y = 0; y < this.map.height; y++) for (let x = 0; x < this.map.width; x++) seen.add(key(x, y));
    } else {
      for (const v of viewers) {
        const r = this.stat(v, 'vision');
        const R = Math.ceil(r);
        for (let y = Math.max(0, v.y - R); y <= Math.min(this.map.height - 1, v.y + R); y++) {
          for (let x = Math.max(0, v.x - R); x <= Math.min(this.map.width - 1, v.x + R); x++) {
            const k = key(x, y);
            if (seen.has(k)) continue;
            const p = { x, y };
            if (withinRange(dist(v, p), r) && hasLineOfSight(this.map, v, p)) seen.add(k);
          }
        }
      }
    }
    this.sight[team] = { key: sightKey, tiles: seen };
    return seen;
  }

  /** Can `team` see `u`? Own units are always visible, and so are Revealed ones. */
  canSee(team: Team, u: Unit): boolean {
    return u.team === team || !this.rules.vision.enabled || this.isRevealed(u) || this.visibleTiles(team).has(key(u.x, u.y));
  }

  /**
   * Update each team's memory of where its enemies are (lastSeen): units in sight are noted where they stand;
   * a remembered spot that is in sight again but empty of that unit is forgotten, and so are fallen units.
   */
  updateSightings(): void {
    for (const team of ['player', 'enemy'] as const) {
      const memory = this.lastSeen[team];
      for (const f of this.units) {
        if (f.team === team) continue;
        if (!f.alive) memory.delete(f.uid);
        else if (this.canSee(team, f) && !this.isStealthed(f)) memory.set(f.uid, { x: f.x, y: f.y });
        else {
          const at = memory.get(f.uid);
          if (at && this.visibleTiles(team).has(key(at.x, at.y))) memory.delete(f.uid);
        }
      }
    }
  }

  /**
   * Where `u`'s side thinks its enemies are: the ones it can see where they stand, the rest where it last saw them.
   * Fallen units and forgotten spots are left out.
   */
  knownFoes(u: Unit): { foe: Unit; at: Point }[] {
    const out: { foe: Unit; at: Point }[] = [];
    for (const f of this.living()) {
      if (f.team === u.team) continue;
      if (!this.hiddenFrom(u, f)) out.push({ foe: f, at: { x: f.x, y: f.y } });
      else {
        const at = this.lastSeen[u.team].get(f.uid);
        if (at) out.push({ foe: f, at });
      }
    }
    return out;
  }

  // ---- damage -----------------------------------------------------------------------

  /**
   * One hit split by damage type, after the target's mitigation (before shields):
   * P.Atk, Def and missing Health are Physical, M.Atk is Magical. A hybrid hit
   * (Magic Bolt) deals one portion of each. `projectile`: the hit comes from a projectile
   * (a forest tile shelters the target from it).
   */
  hitPortions(attacker: Unit, target: Unit, part: DamagePart, projectile = false, pPenBonus = 0): { type: DamageType; amount: number }[] {
    const raw: Record<DamageType, number> = {
      physical: (part.pAtk ?? 0) * this.stat(attacker, 'pAtk') + (part.def ?? 0) * this.stat(attacker, 'defense') + (part.missingHp ?? 0) * (target.stats.health - target.hp),
      magical: (part.mAtk ?? 0) * this.stat(attacker, 'mAtk'),
    };
    const cover = projectile ? 1 - this.coverFrom(target) : 1;
    const out = DAMAGE_TYPES.filter((t) => raw[t] > 0).map((type) => ({
      type, amount: Math.max(1, Math.round(raw[type] * this.mitigation(attacker, target, type, type === 'physical' ? pPenBonus : 0) * cover)),
    }));
    return out.length ? out : [{ type: 'physical', amount: 1 }];
  }

  /** Damage reduction (0-1) from projectiles for a unit on its tile: forest shelters it. */
  coverFrom(target: Unit): number {
    return TERRAIN[this.map.tiles[target.y][target.x]].projectileCover;
  }

  /**
   * The target's Defense against the attacker's damage of `type`, after the attacker's penetration. `bonusPct`: a
   * skill's own penetration % (Backstab), multiplied with the attacker's (see combinePenPct).
   */
  effectiveDefense(attacker: Unit, target: Unit, type: DamageType, bonusPct = 0): number {
    const def = this.stat(target, 'defense');
    const [flat, pct] = type === 'physical' ? ['pPen', 'pPenPct'] as const : ['mPen', 'mPenPct'] as const;
    return penetrate(def, combinePenPct(this.stat(attacker, pct), bonusPct), this.stat(attacker, flat));
  }

  /** Damage multiplier for a hit of `type` on `target`: Defense (both types), lowered by the attacker's penetration. */
  mitigation(attacker: Unit, target: Unit, type: DamageType, bonusPct = 0): number {
    return defenseMultiplier(this.effectiveDefense(attacker, target, type, bonusPct));
  }

  /** Total damage of one hit (all damage types). */
  hitDamage(attacker: Unit, target: Unit, part: DamagePart, projectile = false, pPenBonus = 0): number {
    return this.hitPortions(attacker, target, part, projectile, pPenBonus).reduce((a, p) => a + p.amount, 0);
  }

  /** Deal one hit: a damage event per damage type in it. */
  private dealHit(attacker: Unit, target: Unit, part: DamagePart, cause: DamageCause, projectile = false, pPenBonus = 0): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const p of this.hitPortions(attacker, target, part, projectile, pPenBonus)) {
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

  /** Execute's missing-Health multiplier times the bonus against the target's tags (Smite: x2 vs Evil). */
  hitMultiplier(skill: SkillDef, target: Unit): number {
    const tag = skill.bonusVsTag && this.unitTags(target).includes(skill.bonusVsTag.tag) ? skill.bonusVsTag.mult : 1;
    return this.missingHpMultiplier(skill, target) * tag;
  }

  /** Predicted damage of each hit of `skill` on `target` (accounts for missing health growing). */
  previewHits(attacker: Unit, skill: SkillDef, target: Unit): number[] {
    const swings = this.isWeaponAttack(attacker, skill) ? (this.skillFor(attacker, skill).basicAttack ?? 1) : 0;
    skill = this.skillFor(attacker, skill);
    // Execute: the multiplier comes from Health before the hit, and leaves on-hit effects alone.
    const mult = this.hitMultiplier(skill, target);
    if (mult !== 1) skill = { ...skill, hits: scaleHits(skill.hits ?? [], mult) };
    // Weapon on-hit effects (Arcane Weapon) the attacker can pay for.
    if (swings) skill = { ...skill, hits: [...(skill.hits ?? []), ...this.procParts(attacker, swings, skill.mana)] };
    let hp = target.hp;
    let shield = this.shieldOf(target);
    const out: number[] = [];
    for (const part of skill.hits ?? []) {
      const saved = target.hp;
      target.hp = hp;
      const amount = this.hitDamage(attacker, target, part, isProjectile(skill), skill.pPenPct ?? 0);
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

  /** Does the zone act on `u`? Most hit anyone; Rain only the caster's enemies. */
  zoneAffects(z: Zone, u: Unit): boolean {
    return z.def.affects !== 'enemy' || u.team !== z.team;
  }

  /** Zones on `p` that would act on `u` walking in (paths steer around them when they can). */
  private hazardsAt(u: Unit, p: Point): number {
    if (!this.zones.length) return 0;
    return this.zonesAt(p).filter((z) => !z.def.delayed && this.zoneAffects(z, u)).length;
  }

  /**
   * Put `tiles` under zone `z` (new or growing). A tile holds one elemental effect: other elemental zones lose
   * those tiles (and vanish once they have none left).
   */
  private paintZone(z: Zone, tiles: Point[]): void {
    const keys = tiles.map((p) => key(p.x, p.y));
    if (z.element) {
      for (const o of this.zones) if (o !== z && o.element) for (const k of keys) o.tiles.delete(k);
    }
    for (const k of keys) z.tiles.add(k);
    if (!this.zones.includes(z)) this.zones.push(z);
    this.zones = this.zones.filter((o) => o.tiles.size > 0);
  }

  /** Place a zone from `def` on `tiles` for `caster`'s side. */
  private addZone(skillId: string, name: string, caster: Unit, def: ZoneDef, tiles: Point[]): BattleEvent {
    this.paintZone({ skillId, name, element: def.element, casterUid: caster.uid, team: caster.team, tiles: new Set(), turnsLeft: def.turns, def }, tiles);
    return { type: 'zone', source: caster.uid, name, tiles };
  }

  /**
   * Draft: fire zones on `hit` tiles spread to every walkable tile within `radius` of them, keeping their caster and
   * turns left. Returns an event per zone that grew.
   */
  private spreadFire(source: Unit, hit: Point[], radius: number): BattleEvent[] {
    const growth = new Map<Zone, Point[]>();
    for (const p of hit) {
      for (const z of this.zonesAt(p)) {
        if (z.element !== 'fire') continue;
        const list = growth.get(z) ?? [];
        list.push(...this.zoneTiles({ ...z.def, radius }, p).filter((q) => !z.tiles.has(key(q.x, q.y))));
        growth.set(z, list);
      }
    }
    const events: BattleEvent[] = [];
    for (const [z, tiles] of growth) {
      const fresh = [...new Map(tiles.map((q) => [key(q.x, q.y), q])).values()];
      if (!fresh.length) continue;
      this.paintZone(z, fresh);
      events.push({ type: 'zone', source: source.uid, name: z.name, tiles: fresh });
    }
    return events;
  }

  /** Every zone on `tile` that acts on `u` hits it `times` times. */
  private zoneHits(u: Unit, tile: Point, times: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (const z of this.zonesAt(tile)) if (!z.def.delayed) events.push(...this.zoneHit(z, u, times));
    return events;
  }

  /** One zone hits `u` `times` times: its damage (from the caster's stats), statuses and status shifts each time. */
  private zoneHit(z: Zone, u: Unit, times: number): BattleEvent[] {
    if (!this.zoneAffects(z, u)) return [];
    const caster = this.unit(z.casterUid);
    const events: BattleEvent[] = [];
    for (let i = 0; i < times && u.alive; i++) {
      events.push({ type: 'zoneHit', source: caster.uid, target: u.uid, name: z.name });
      if (z.def.hit) events.push(...this.dealHit(caster, u, z.def.hit, 'zone'));
      if (!u.alive) break;
      for (const a of z.def.applyStatus) events.push(...this.applyStatus(caster, u, a.status, a.turns, a.stacks ?? 1));
      for (const sh of z.def.shiftStatus ?? []) events.push(...this.shiftStatus(caster, u, sh.status, sh.stacks));
    }
    return events;
  }

  /** Rough damage `u` takes from zones walking `path` (each tile entered) and standing at its end. */
  zoneDanger(u: Unit, path: Point[]): number {
    let total = 0;
    const end = path[path.length - 1] ?? u;
    const hit = (z: Zone) => (z.def.hit && this.zoneAffects(z, u) ? this.hitDamage(this.unit(z.casterUid), u, z.def.hit) : 0);
    for (const p of path) for (const z of this.zonesAt(p)) if (!z.def.delayed) total += hit(z);
    // A wind-up (Brutal Strike) hits whoever is still on it at the start of its caster's next turn.
    for (const z of this.zonesAt(end)) total += (z.def.delayed ? 1 : z.def.endTurnHits) * hit(z);
    return total;
  }

  /**
   * Damage `u` would take from enemy overwatch walking (or charging) along `path`: each watch fires once, on the
   * first tile of the path in its arc where `u` could stop (not while passing through a unit), as in walk().
   */
  overwatchDanger(u: Unit, path: Point[]): number {
    const watchers = this.living().filter((w) => w.team !== u.team && w.overwatch && !this.hiddenFrom(u, w));
    if (watchers.length === 0 || this.isStealthed(u)) return 0;
    const fired = new Set<Unit>();
    let total = 0;
    const home = { x: u.x, y: u.y };
    try {
      for (const p of path) {
        if (this.units.some((o) => o !== u && o.alive && o.x === p.x && o.y === p.y)) continue;
        // Stand on the tile for the line checks, as the walk would.
        u.x = p.x;
        u.y = p.y;
        for (const w of watchers) {
          const ow = w.overwatch!;
          if (fired.has(w) || !ow.tiles.has(key(p.x, p.y)) || this.hiddenFrom(w, u)) continue;
          if (ow.los && !this.clearLine(w, u, ow.los, w)) continue;
          fired.add(w);
          total += ow.hits.reduce((sum, part) => sum + this.hitDamage(w, u, part, ow.projectile), 0);
        }
      }
    } finally {
      u.x = home.x;
      u.y = home.y;
    }
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

  /** What `skill` heals: its share of the caster's M.Atk, plus (Emergency Heal) a share of `target`'s missing HP. */
  healAmount(caster: Unit, skill: SkillDef, target?: Unit): number {
    const missing = target ? target.stats.health - target.hp : 0;
    return Math.round((skill.heal?.mAtk ?? 0) * this.stat(caster, 'mAtk') + (skill.heal?.missingHp ?? 0) * missing);
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

  /**
   * Use a skill on `tile`. `aim2` is the second pick of two-step skills: the direction tile for a push (Sonic Boom:
   * any tile; the push goes the 8-way direction from the target toward it), or the second target of a follow-up
   * (Blitz). Without it a push goes straight away from the user and a follow-up picks the nearest enemy it can reach.
   */
  perform(u: Unit, skillId: string, tile: Point, aim2?: Point): BattleEvent[] {
    const skill = SKILLS[skillId];
    if (!skill) throw new Error(`Unknown skill ${skillId}`);
    if (!this.canAct(u)) throw new Error(`${u.character.name}'s turn is over`);
    if (skill.target === 'move') throw new Error('Use dash() to dash');
    if (skill.target === 'passive') throw new Error(`${skill.name} is a passive skill`);
    if (!this.skillIds(u).includes(skillId)) throw new Error(`${u.character.name} doesn't have ${skill.name}`);
    if (!this.canPay(u, skill)) throw new Error(`${skill.name} needs more AP`);
    if (u.bonusMove && !this.isMovementSkill(skill)) throw new Error('The free move from Hit and Run is for moving only');
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
    // Worked out before anything changes (Quick Cast and In the Zone lower it, and are used up when it's paid).
    const ap = this.apCost(u, skill);
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
    for (const a of skill.selfStatus ?? []) events.push(...this.applyStatus(u, u, a.status, a.turns, a.stacks ?? 1, true));
    if (skill.switchMode) events.push(...this.setWeaponMode(u, u.weaponMode + 1));
    // Toggles: switch the status on (paying the mana) or off again (free). A weapon holds one enchantment at a time.
    if (skill.toggleStatus) {
      if (this.isToggledOn(u, skill.toggleStatus)) {
        // Cancelling a this-turn-only toggle (Quick Cast) before it's used refunds its mana and cooldown.
        if (STATUSES[skill.toggleStatus].thisTurnOnly) this.refundToggle(u, skill.toggleStatus);
        events.push(this.toggleOff(u, skill.toggleStatus));
      } else {
        const def = STATUSES[skill.toggleStatus];
        if (def.enchantment) for (const s of [...u.statuses]) if (s.id !== def.id && STATUSES[s.id]?.enchantment) events.push(this.toggleOff(u, s.id));
        // Most toggles stay on until switched off; Quick Cast only lasts the turn.
        u.statuses.push({ id: def.id, name: def.name, debuff: def.debuff, stacks: 1, amount: 0, turns: def.thisTurnOnly ? 1 : Infinity, tick: def.thisTurnOnly ? 'end' : def.tick });
        events.push({ type: 'toggle', target: u.uid, name: def.name, on: true });
        // Soul Ignition: switching on costs Health too.
        const hpCost = this.toggleHpCost(u, def.id);
        if (hpCost) events.push(this.dealDamage(u, hpCost, u.uid, 'status', true));
      }
    }
    // Still next to the target after the charge (it can be stopped short)? Melee charges strike only then.
    let stoppedShort = false;
    if (skill.charge) {
      stoppedShort = this.chargeTo(u, skill, tile, events);
      if (!u.alive) {
        this.payFor(u, skillId, true, ap);
        return events;
      }
    } else if (skill.teleport) {
      u.x = tile.x;
      u.y = tile.y;
      events.push({ type: 'move', target: u.uid, from: origin, to: { ...tile }, kind: 'teleport' });
      events.push(...this.zoneHits(u, tile, 1));
    } else if (hasTag(skill, 'leap') && skill.target === 'emptyTile') {
      this.leapTo(u, tile, events);
      if (!u.alive) {
        this.payFor(u, skillId, true, ap);
        return events;
      }
    }
    if (skill.zone) events.push(this.addZone(skillId, skill.name, u, skill.zone, this.zoneTiles(skill.zone, tile)));
    if (skill.cone) {
      u.overwatch = {
        skillId,
        tiles: new Set(coneTiles(this.map, u, tile, skill.cone.angle, this.coneRadius(u, skill)).map((p) => key(p.x, p.y))),
        interrupt: skill.cone.interrupt,
        los: skill.cone.los ?? this.skillLos(u, skill),
        // Without hits of its own, the watch fires the user's basic attack.
        hits: skill.hits ?? this.basicAttack(u).hits ?? [],
        weapon: !skill.hits,
        projectile: isProjectile(skill.hits ? skill : this.basicAttack(u)),
      };
      events.push({ type: 'overwatch', source: u.uid, skillId });
    }

    let targets = skill.toggleStatus ? [] : aimed ?? this.targetsOf(u, skill, tile);
    // Stopped on the way: the strike only lands on targets it still reaches.
    if (stoppedShort) targets = targets.filter((t) => dist(u, t) <= 1.5 + EPS);
    // Power Strike: whoever stands behind the target, picked before anyone is pushed or falls.
    const pierced = this.pierceVictim(u, used, tile);
    this.strike(u, skill, used, targets, events);
    // Heroic Leap: a stack of Heroic Guard per unit hit (allies too).
    const perHit = used.selfStatusPerUnitHit;
    const unitsHit = targets.filter((t) => t !== u).length;
    if (perHit && unitsHit && u.alive) events.push(...this.applyStatus(u, u, perHit.status, perHit.turns, unitsHit, true));
    if (pierced && pierced.alive && used.pierce) {
      for (const part of scaleHits(this.basicAttack(u).hits ?? [], used.pierce)) {
        if (!pierced.alive) break;
        events.push(...this.dealHit(u, pierced, part, 'skill', isProjectile(used), used.pPenPct ?? 0));
      }
    }
    // Draft: fire on the tiles hit spreads.
    if (used.spreadFire) events.push(...this.spreadFire(u, this.areaTiles(u, used, tile), used.spreadFire));

    // Knockback: push each surviving target away from the attacker, if there is room.
    if (used.knockback) for (const t of targets) if (t.alive) events.push(...this.pushUnit(t, dirTo(u, t), used.knockback));
    // Sonic Boom: push the target the way the user picked.
    if (used.push) {
      for (const t of targets) {
        if (!t.alive) continue;
        const d = aim2 ? dirTo(t, aim2) : { x: 0, y: 0 };
        events.push(...this.pushUnit(t, d.x || d.y ? d : dirTo(u, t), used.push));
      }
    }

    // Blitz: break away for free, then charge a second enemy within range of where the first strike landed.
    if (used.followUp && u.alive) {
      const first = targets[0];
      const opp = this.opponentOf(u);
      if (opp) {
        this.breakEngagement(u);
        events.push({ type: 'disengage', source: u.uid, target: opp.uid, reason: 'escaped' });
      }
      const next = this.followUpTarget(u, skill, first, aim2);
      if (next) {
        const short = this.chargeTo(u, skill, next, events);
        const t2 = this.unitAt(next.x, next.y);
        if (u.alive && t2 && (!short || dist(u, t2) <= 1.5 + EPS)) this.strike(u, skill, used, [t2], events);
      }
    }

    events.push(...this.separationEvents());
    // Attacking gives a Stealthed unit away.
    if (this.isAttack(used) && used.affects !== 'ally') u.statuses = u.statuses.filter((st) => !STATUSES[st.id]?.stealth);
    if (!u.alive) u.acted = true;
    // Mana was paid up front (none when switching a toggle off); switching a toggle off doesn't restart its cooldown.
    events.push(...this.payFor(u, skillId, true, ap, switchingOff || !!skill.cooldownAfterOff));
    this.updateSightings();
    return events;
  }

  /**
   * Charge (or teleport-strike) at the unit on `tile`, adding the move events. A charge runs there on its own feet,
   * tile by tile like a walk: enemy overwatch fires (and an interrupting watch, Frozen or an unseen enemy stops it)
   * and zones hit on the way. Returns true if it was stopped short.
   */
  private chargeTo(u: Unit, skill: SkillDef, tile: Point, events: BattleEvent[]): boolean {
    const origin = { x: u.x, y: u.y };
    if (hasTag(skill, 'leap')) {
      const path = this.chargePath(u, tile, u, skill) ?? [];
      if (path.length) this.leapTo(u, path[path.length - 1], events);
      return false;
    }
    if (skill.teleport) {
      const dest = this.chargeDestination(u, tile, u, skill)!;
      if (dest.x !== u.x || dest.y !== u.y) {
        u.x = dest.x;
        u.y = dest.y;
        events.push({ type: 'move', target: u.uid, from: origin, to: dest, kind: 'teleport' });
        events.push(...this.zoneHits(u, dest, 1));
      }
      return false;
    }
    const walked = this.walk(u, this.chargePath(u, tile, u, skill) ?? []);
    for (const t of walked.triggers) if (t.index < 0) events.push(...t.events);
    let at = origin;
    walked.path.forEach((step, i) => {
      events.push({ type: 'move', target: u.uid, from: at, to: step, kind: 'charge' });
      at = step;
      for (const t of walked.triggers) if (t.index === i) events.push(...t.events);
    });
    return walked.interrupted;
  }

  /**
   * Leap (Heroic Leap, Pounce) from where `u` stands to `dest`, in a straight line over terrain and units. Enemy
   * overwatch fires on the tiles it passes over that it could stand on (it can't stop a leap); zones only act where it
   * lands. Killed in the air, it falls where it was hit.
   */
  private leapTo(u: Unit, dest: Point, events: BattleEvent[]): void {
    const origin = { x: u.x, y: u.y };
    const shots: BattleEvent[] = [];
    for (const p of [...tilesBetween(origin, dest), dest]) {
      if (!u.alive) break;
      if (!this.inMap(p) || !passable(this.map, p.x, p.y) || this.units.some((o) => o !== u && o.alive && o.x === p.x && o.y === p.y)) continue;
      u.x = p.x;
      u.y = p.y;
      shots.push(...this.triggerOverwatch(u).events);
    }
    if (u.alive) {
      u.x = dest.x;
      u.y = dest.y;
    }
    events.push({ type: 'move', target: u.uid, from: origin, to: { x: u.x, y: u.y }, kind: 'leap' }, ...shots);
    if (shots.length) u.locked = true;
    if (u.alive) events.push(...this.zoneHits(u, dest, 1));
  }

  /**
   * Blitz's second target: the enemy on `aim2` if it can still be reached from where the user stands, else the
   * nearest one that can (never `first`). Null if there's none.
   */
  private followUpTarget(u: Unit, skill: SkillDef, first: Unit | undefined, aim2?: Point): Point | null {
    const options = this.followUpTargets(u, skill, first);
    if (aim2) {
      const pick = options.find((p) => p.x === aim2.x && p.y === aim2.y);
      if (pick) return pick;
    }
    return options.length ? options.reduce((a, b) => (dist(u, b) < dist(u, a) - EPS ? b : a)) : null;
  }

  /**
   * Enemies a follow-up (Blitz) could charge next from `from`: in range, visible, reachable, and not `first`.
   * Used for the player's second pick (with `from` = where the first charge lands).
   */
  followUpTargets(u: Unit, skill: SkillDef, first: Unit | undefined, from: Point = u): Point[] {
    const range = this.skillRange(u, skill);
    return this.living().filter((t) => t !== first && t.team !== u.team && !this.hiddenFrom(u, t)
      && withinRange(dist(from, t), range) && this.chargePath(u, t, from, skill) !== null).map((t) => ({ x: t.x, y: t.y }));
  }

  /**
   * The skill lands on each target: its hits (and weapon on-hit effects), recoil, engagement, statuses, heals,
   * shields and cleanses, and the target striking back (Tooth for Tooth).
   */
  private strike(u: Unit, skill: SkillDef, used: SkillDef, targets: Unit[], events: BattleEvent[]): void {
    // Weapon attacks carry on-hit effects (Arcane Weapon): one per swing (Double Strike swings twice).
    const swings = this.isWeaponAttack(u, skill) ? (used.basicAttack ?? 1) : 0;
    for (const t of targets) {
      // Tooth for Tooth answers its opponent only (engaged before this attack).
      const wasEngaged = t !== u && t.engagedWith === u.uid;
      // Execute: scaled by the target's Health before the hit. Smite: more against Evil.
      const mult = this.hitMultiplier(used, t);
      const hits = scaleHits(used.hits ?? [], mult);
      for (const part of hits) {
        if (!t.alive) break;
        events.push(...this.dealHit(u, t, part, 'skill', isProjectile(used), used.pPenPct ?? 0));
      }
      for (let i = 0; i < swings && t.alive; i++) events.push(...this.weaponProcs(u, t, 'skill', isProjectile(used)));
      // Life-Risking Strike: the user pays if the target is still standing.
      if (skill.recoilIfSurvives && t.alive && u.alive) {
        events.push(...this.dealHit(u, u, skill.recoilIfSurvives, 'skill'));
        if (!u.alive) u.acted = true;
      }
      if (!t.alive) continue;
      if (wasEngaged && hits.length && u.alive && this.hasPassive(t, 'tooth_for_tooth')) events.push(...this.counter(t, u, 'Tooth for Tooth'));
      if (!t.alive || !u.alive) continue;
      // Engage: locks both units together, unless either is already engaged.
      const engages = hasTag(used, 'engage') || (used.engageWithin !== undefined && withinRange(dist(u, t), used.engageWithin));
      if (engages && t.team !== u.team && !u.engagedWith && !t.engagedWith) events.push(...this.engagePair(u, t));
      if (!t.alive) continue;
      for (const a of skill.applyStatus ?? []) events.push(...this.applyStatus(u, t, a.status, a.turns, a.stacks ?? 1));
      for (const sh of used.shiftStatus ?? []) events.push(...this.shiftStatus(u, t, sh.status, sh.stacks));
      if (skill.heal) {
        const amount = Math.min(this.healAmount(u, skill, t), t.stats.health - t.hp);
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
  }

  /** `a` engages `b`. Fighting Spirit: each side that has it hits the other with a free half-strength basic attack. */
  private engagePair(a: Unit, b: Unit): BattleEvent[] {
    this.engage(a, b);
    const events: BattleEvent[] = [{ type: 'engage', source: a.uid, target: b.uid }];
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.alive && y.alive && this.hasPassive(x, 'fighting_spirit')) events.push(...this.counter(x, y, 'Fighting Spirit'));
    }
    return events;
  }

  /**
   * A passive's free basic attack at half damage (Fighting Spirit, Tooth for Tooth), with weapon on-hit effects. It
   * ignores range, and never sets off another counter.
   */
  private counter(attacker: Unit, victim: Unit, name: string): BattleEvent[] {
    if (!attacker.alive || !victim.alive) return [];
    const events: BattleEvent[] = [{ type: 'counter', source: attacker.uid, target: victim.uid, name }];
    const basic = this.basicAttack(attacker);
    for (const part of scaleHits(basic.hits ?? [], 0.5)) {
      if (!victim.alive) break;
      events.push(...this.dealHit(attacker, victim, part, 'counter', isProjectile(basic)));
    }
    events.push(...this.weaponProcs(attacker, victim, 'counter', isProjectile(basic)));
    return events;
  }

  /**
   * Push `t` up to `tiles` tiles in direction `dir` (knockback, Sonic Boom). Walls and units stop it. Each tile it's
   * pushed onto counts as entering it: zones hit and enemy overwatch fires. Being moved breaks Stealth, and pushes it
   * out of an engagement: the old opponent gets a free basic attack (opportunity attack).
   */
  private pushUnit(t: Unit, dir: Point, tiles: number): BattleEvent[] {
    const events: BattleEvent[] = [];
    let moved = false;
    for (let i = 0; i < tiles && t.alive; i++) {
      const to = { x: t.x + dir.x, y: t.y + dir.y };
      if (!passable(this.map, to.x, to.y) || this.unitAt(to.x, to.y)) break;
      events.push({ type: 'move', target: t.uid, from: { x: t.x, y: t.y }, to, kind: 'knockback' });
      t.x = to.x;
      t.y = to.y;
      // Being moved breaks Stealth at once, so the push can be seen by overwatch.
      if (!moved) t.statuses = t.statuses.filter((st) => !STATUSES[st.id]?.stealth);
      moved = true;
      events.push(...this.zoneHits(t, to, 1));
      if (!t.alive) break;
      // Each tile it's pushed onto counts as entering it: enemy overwatch fires (an interrupting watch stops the push).
      const watch = this.triggerOverwatch(t);
      events.push(...watch.events);
      if (watch.interrupted) break;
    }
    if (!moved) return events;
    const partner = t.alive ? this.opponentOf(t) : null;
    if (partner) {
      this.breakEngagement(t);
      events.push({ type: 'disengage', source: t.uid, target: partner.uid, reason: 'displaced' });
      events.push(...this.opportunityAttack(partner, t));
    }
    return events;
  }

  /**
   * Where a push (Sonic Boom) of `t` toward `dir` would end, tile by tile (for previews). Stops at walls and units.
   */
  pushPath(t: Unit, dir: Point, tiles: number): Point[] {
    const out: Point[] = [];
    let at = { x: t.x, y: t.y };
    for (let i = 0; i < tiles; i++) {
      const to = { x: at.x + dir.x, y: at.y + dir.y };
      const occ = this.unitAt(to.x, to.y);
      if (!passable(this.map, to.x, to.y) || (occ && occ !== t)) break;
      out.push(to);
      at = to;
    }
    return out;
  }

  /**
   * Move `stacks` stacks of a status the target already has (nothing if it doesn't): more (Draft fans a Burn, Rain
   * deepens a Chill; resisted like any debuff) or fewer (Rain dampens a Burn).
   */
  private shiftStatus(source: Unit, t: Unit, id: string, stacks: number): BattleEvent[] {
    const have = t.statuses.find((s) => s.id === id);
    if (!have || !t.alive || stacks === 0) return [];
    if (stacks > 0) return this.applyStatus(source, t, id, have.turns, stacks);
    have.stacks += stacks;
    if (have.stacks <= 0) t.statuses = t.statuses.filter((s) => s !== have);
    return [{ type: 'status', source: source.uid, target: t.uid, name: `${have.name} ${stacks}` }];
  }

  /** Apply a status. Debuffs can be shrugged off: a Resist roll (see resistChance), unless the target is immune to them. */
  private applyStatus(source: Unit, t: Unit, id: string, turns: number, stacks: number, unresisted = false): BattleEvent[] {
    const def = STATUSES[id];
    if (!t.alive) return [];
    // Tough It Out: no debuffs from others while it lasts.
    if (def.debuff && !unresisted && t.statuses.some((s) => STATUSES[s.id]?.debuffImmune)) {
      return [{ type: 'resist', source: source.uid, target: t.uid, name: def.name, chance: 100, immune: true }];
    }
    if (def.debuff && !unresisted && !def.unresisted) {
      const chance = resistChance(this.stat(t, 'resist'), this.rules.defenseScale);
      if (chance > 0 && this.rng() < chance) return [{ type: 'resist', source: source.uid, target: t.uid, name: def.name, chance: Math.round(chance * 100) }];
    }
    // Revealed units can't be Stealthed.
    if (def.stealth && this.isRevealed(t)) return [];
    // Instant statuses (Explosion) do their damage now and aren't kept. Explosion also sets the ground on fire.
    if (def.instantDamagePctMaxHp) {
      const events: BattleEvent[] = [{ type: 'status', source: source.uid, target: t.uid, name: def.name }, this.statusDamage(t, def.instantDamagePctMaxHp, def.mitigated, source.uid)];
      if (def.zone) events.push(this.addZone(`status:${id}`, def.zone.name ?? def.name, source, def.zone, this.zoneTiles(def.zone, t)));
      return events;
    }
    const existing = t.statuses.find((s) => s.id === id);
    // Past its stack cap the status turns into its overflow (Chilled x3 -> Frozen, Burn x3 -> Explosion).
    const have = existing?.stacks ?? 0;
    if (def.stacking && def.overflow && def.maxStacks !== undefined && have + stacks > def.maxStacks) {
      t.statuses = t.statuses.filter((s) => s.id !== id);
      return this.applyStatus(source, t, def.overflow.status, def.overflow.turns, 1, true);
    }
    // Decaying statuses (Burn, Chilled) last until their stacks run out, not a number of turns; Quick Cast until used.
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
    // Revealed: Stealth is gone.
    if (def.reveals) t.statuses = t.statuses.filter((s) => !STATUSES[s.id]?.stealth);
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
      // Quick Cast unused at the end of the turn: it switches off, refunded like a cancel.
      if (def?.thisTurnOnly && !this.stillActive(s)) {
        this.refundToggle(u, s.id);
        events.push({ type: 'toggle', target: u.uid, name: s.name, on: false, reason: 'turn' });
      }
      // Hit and Run unused (the turn ended with Wait, Overwatch or End Turn): its mana and cooldown come back.
      if (def?.refundIfUnused && !this.stillActive(s)) {
        const id = this.skillIds(u).find((sid) => SKILLS[sid].applyStatus?.some((a) => a.status === s.id));
        if (id) {
          u.mp = Math.min(u.stats.mana, u.mp + SKILLS[id].mana);
          delete u.cooldowns[id];
        }
        events.push({ type: 'toggle', target: u.uid, name: s.name, on: false, reason: 'turn' });
      }
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
    return u.statuses.filter((s) => STATUSES[s.id]?.weaponOnHit || STATUSES[s.id]?.weaponOnHitStatus);
  }

  /** Is `s` (as listed, not resolved) a weapon attack: the weapon's basic attack (any mode) or a 'weapon' skill? */
  isWeaponAttack(u: Unit, s: SkillDef): boolean {
    const raw = this.rawBasic(u);
    return s.id === raw.id || !!raw.modes?.includes(s.id) || (hasTag(s, 'weapon') && !s.cone);
  }

  /** A cancellable toggle (Quick Cast) is off unused: the skill's mana comes back and its cooldown is cleared. */
  private refundToggle(u: Unit, statusId: string): void {
    const id = this.skillIds(u).find((sid) => SKILLS[sid].toggleStatus === statusId);
    if (!id) return;
    u.mp = Math.min(u.stats.mana, u.mp + SKILLS[id].mana);
    delete u.cooldowns[id];
  }

  /** Is this skill a toggle that's on and can be cancelled for a refund (Quick Cast, before it's used)? */
  isCancellable(u: Unit, s: SkillDef): boolean {
    return !!s.toggleStatus && !!STATUSES[s.toggleStatus]?.thisTurnOnly && this.isToggledOn(u, s.toggleStatus);
  }

  /** Switch a toggle status off (out of mana, or the unit used the skill again). */
  private toggleOff(u: Unit, id: string, reason?: 'mana' | 'health'): BattleEvent {
    u.statuses = u.statuses.filter((s) => s.id !== id);
    // Soul Ignition: its cooldown starts now.
    const sid = this.skillIds(u).find((x) => SKILLS[x].toggleStatus === id && SKILLS[x].cooldownAfterOff);
    if (sid) u.cooldowns[sid] = SKILLS[sid].cooldown;
    return { type: 'toggle', target: u.uid, name: STATUSES[id].name, on: false, ...(reason ? { reason } : {}) };
  }

  /**
   * A weapon attack landed on `t` (one per swing): each active on-hit effect adds its hit, paying its mana.
   * Without the mana for it, the effect switches off.
   */
  private weaponProcs(u: Unit, t: Unit, cause: DamageCause, projectile = false): BattleEvent[] {
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
      if (def.weaponOnHit) events.push(...this.dealHit(u, t, def.weaponOnHit, cause, projectile));
      // Fire Weapon / Ice Weapon: a stack of Burn / Chilled with each hit.
      for (const a of def.weaponOnHitStatus ?? []) if (t.alive) events.push(...this.applyStatus(u, t, a.status, a.turns, a.stacks ?? 1));
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
        if (mp < (def.manaPerHit ?? 0) || !def.weaponOnHit) continue;
        mp -= def.manaPerHit ?? 0;
        out.push(def.weaponOnHit);
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
    // The enemy AI (only: the player gets nothing it can't see) learns where the party stood when its last turn began:
    // a turn out of date, and never where Stealthed units were. Units it can see now are noted where they really are
    // (updateSightings below).
    if (team === 'enemy') {
      for (const f of this.living('player')) {
        const at = this.turnStart.get(f.uid);
        if (at) this.lastSeen.enemy.set(f.uid, at);
      }
    } else {
      for (const u of this.living('player')) {
        if (this.isStealthed(u)) this.turnStart.delete(u.uid);
        else this.turnStart.set(u.uid, { x: u.x, y: u.y });
      }
    }
    // Wind-ups (Brutal Strike) land at the start of their caster's next turn, on whoever stands there, then end.
    for (const z of this.zones) {
      if (z.team !== team || !z.def.delayed) continue;
      if (this.unit(z.casterUid).alive) for (const t of this.living()) if (z.tiles.has(key(t.x, t.y))) events.push(...this.zoneHit(z, t, 1));
      z.turnsLeft = 0;
    }
    for (const z of this.zones) if (z.team === team) z.turnsLeft -= 1;
    this.zones = this.zones.filter((z) => z.turnsLeft > 0);
    for (const u of this.living(team)) {
      u.ap = AP_PER_TURN;
      u.moved = false;
      u.walked = false;
      u.acted = false;
      u.locked = false;
      u.startPos = { x: u.x, y: u.y };
      u.undoBlock = undefined;
      u.overwatch = null;
      u.bonusMove = false;
      for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
      events.push(...this.tickStatuses(u, 'start'));
      // Toggles cost mana (Soul Ignition: and Health) every turn to keep up; they switch off when the unit can't pay.
      for (const s of [...u.statuses]) {
        const upkeep = STATUSES[s.id]?.manaPerTurn ?? 0;
        const hpCost = this.toggleHpCost(u, s.id);
        if ((!upkeep && !hpCost) || !u.alive) continue;
        if (u.mp < upkeep) events.push(this.toggleOff(u, s.id, 'mana'));
        else if (hpCost && u.hp <= hpCost) events.push(this.toggleOff(u, s.id, 'health'));
        else {
          u.mp -= upkeep;
          if (hpCost) events.push(this.dealDamage(u, hpCost, u.uid, 'status', true));
        }
      }
      // Frozen: the movement AP is lost this turn.
      if (this.isFrozen(u)) {
        u.ap -= 1;
        u.moved = true;
      }
      // Staggered (Sucker Punch): AP lost, the movement AP first.
      const loss = u.statuses.reduce((n, s) => n + (STATUSES[s.id]?.apLoss ?? 0), 0);
      for (let i = 0; i < loss && u.ap > 0; i++) {
        u.ap -= 1;
        u.moved = true;
      }
      if (!u.alive) u.acted = true;
    }
    this.updateSightings();
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

/** Build one enemy of a type at a level. Humanoid types pick a loadout (gear, name and extra skills). */
export function makeEnemy(type: string, level: number, rng: Rng): Character {
  const def = ENEMIES[type];
  const loadout = def.loadouts.length ? def.loadouts[Math.floor(rng() * def.loadouts.length)] : undefined;
  const id = newId('e');
  return {
    id,
    name: loadout?.name ?? def.name,
    level,
    xp: 0,
    enemyType: type,
    ...(loadout ? {
      weapon: gear(loadout.weapon, enemyGearQuality(def.gearQuality, level, rng)),
      armor: loadout.armor ? gear(loadout.armor, enemyGearQuality(def.gearQuality, level, rng)) : null,
    } : {}),
    skillIds: loadout ? [...loadout.skills] : [],
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
