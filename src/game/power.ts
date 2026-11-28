// The strength model: how strong a group of fighters is, on one ruler for parties and enemies alike.
// Pure logic (no Phaser). Calibrated against AI-vs-AI battles (tools/balance).
//
// A fighter's value is sqrt(effective HP x damage per turn): effective HP is Health stretched by its Defense,
// damage per turn its best attack stat cut by the other side's Defense (after its penetration). By Lanchester's
// square law a group's fighting power is the square of its summed values, so a side twice the value is four times
// as strong, and numbers count twice: once in the damage dealt and once in the damage soaked.
//
// Strength is measured in levels: a group's strength is the level at which the reference party (four Adventurers of
// the reference builds, src/game/reference.ts, with the gear expected at that level) would be its even match.
import { ENEMY_GEAR, QUALITIES, SKILLS } from '../data/content';
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { GUILD } from '../data/guild';
import type { Character, Stats } from '../data/types';
import { defenseMultiplier, enemyTypesForStage, makeEnemy, makeUnit, penetrate } from './battle';
import { deriveStats } from './character';
import { BUILDS, buildCharacter } from './reference';

/** Model settings (calibrated by tools/balance). */
export const POWER = {
  /** The reference party: build ids (reference.ts), the first referenceSize(level) of them. */
  referenceParty: ['guardian', 'caster', 'archer', 'cleric', 'bruiser'],
  /** How many the reference party has, by level: [from level, members]. 3 to start, 4 by mid C rank, 5 by mid B. */
  referenceSizes: [[-99, 3], [8, 4], [13, 5]] as [number, number][],
  /**
   * The reference party's gear: per level, the chance a piece is at least Common, at least Fine, and Masterwork
   * (10%, 5%, 2% a level, at most 100%); it fights with the average of that (see referenceGearMultiplier).
   */
  gearChancePerLevel: { common: 0.1, fine: 0.05, masterwork: 0.02 },
  /** Lowest and highest strength the model reports. */
  range: [-5, 40] as [number, number],
};

/** What the model needs of a fighter: its battle stats and how much of it the value counts (enemy power factor). */
export interface Fighter {
  stats: Stats;
  /** Multiplier on the fighter's value (skills the stats don't show); 1 for Adventurers. */
  factor?: number;
  /** How likely this fighter is to be in the group (expected encounters); 1 = always. */
  weight?: number;
  /** Fights at range (bows, casters, monsters whose basic attack reaches 3+ tiles) rather than in melee. */
  ranged?: boolean;
}

/** Weapons whose users fight at range: bows and spellcasting focuses. */
const RANGED_WEAPONS = new Set(['shortbow', 'longbow', 'staff', 'crystal']);

/** Does this character fight at range? Its weapon (bows, staves, crystals), or for monsters, its basic attack's reach. */
export function isRanged(c: Character): boolean {
  if (c.weapon && RANGED_WEAPONS.has(c.weapon.type)) return true;
  if (c.enemyType && !ENEMIES[c.enemyType].loadouts.length) return (SKILLS[ENEMIES[c.enemyType].skills[0]]?.range ?? 0) >= 3;
  return false;
}

/** A fighter's effective HP: Health stretched by its Defense. */
export const effectiveHp = (s: Stats) => s.health / defenseMultiplier(Math.max(0, s.defense));

/** A fighter's damage per turn against `oppDefense`: its best attack stat, cut by that Defense after penetration. */
export function damagePerTurn(s: Stats, oppDefense: number): number {
  const phys = s.pAtk * defenseMultiplier(penetrate(oppDefense, s.pPenPct, s.pPen));
  const mag = s.mAtk * defenseMultiplier(penetrate(oppDefense, s.mPenPct, s.mPen));
  return Math.max(phys, mag);
}

/** A fighter's value against a side with `oppDefense` Defense: sqrt(effective HP x damage per turn). */
export function fighterValue(f: Fighter, oppDefense: number): number {
  return Math.sqrt(Math.max(0, effectiveHp(f.stats) * damagePerTurn(f.stats, oppDefense))) * (f.factor ?? 1);
}

/**
 * How long a fight between two groups lasts, before the walk in (Lanchester): sqrt(HP of a x HP of b / (damage of a x
 * damage of b)), in turns of basic attacks. Fitted to battle lengths by tools/balance (rounds = start + per x tempo).
 */
export function tempo(a: Fighter[], b: Fighter[]): number {
  const hp = (g: Fighter[]) => g.reduce((s, f) => s + effectiveHp(f.stats) * (f.weight ?? 1), 0);
  const dmg = (g: Fighter[], d: number) => g.reduce((s, f) => s + damagePerTurn(f.stats, d) * (f.weight ?? 1), 0);
  return Math.sqrt((hp(a) * hp(b)) / Math.max(1e-9, dmg(a, groupDefense(b)) * dmg(b, groupDefense(a))));
}

/** A group's Defense as its foes meet it: weighted by Health (the bulk of what they have to cut through). */
export function groupDefense(g: Fighter[]): number {
  const w = g.reduce((s, f) => s + f.stats.health * (f.weight ?? 1), 0);
  return w ? g.reduce((s, f) => s + f.stats.defense * f.stats.health * (f.weight ?? 1), 0) / w : 0;
}

/** A group's value against a side with `oppDefense`: the sum of its fighters' values. */
export function groupValue(g: Fighter[], oppDefense: number): number {
  return g.reduce((s, f) => s + fighterValue(f, oppDefense) * (f.weight ?? 1), 0);
}

/** How many fighters a group counts as (expected numbers for quests). */
export const groupSize = (g: Fighter[]) => g.reduce((t, f) => t + (f.weight ?? 1), 0);

/**
 * A group's fighting power against a side with `oppDefense`: N^k x (average value)^2, N its fighters and k
 * strength.numbersExponent. With k = 2 this is Lanchester's square law ((sum of values)^2: numbers count as much as
 * quality), with k = 1 the linear law; battles fit k = 1.75 best (tools/balance/fitlaws.py).
 */
export function groupPower(g: Fighter[], oppDefense: number): number {
  const n = groupSize(g);
  if (n <= 0) return 0;
  const v = groupValue(g, oppDefense);
  return n ** GUILD.strength.numbersExponent * (v / n) ** 2;
}

/** How much stronger `a` is than `b`: the ratio of their powers, each against the other's Defense. 1 = even. */
export function powerRatio(a: Fighter[], b: Fighter[]): number {
  const pa = groupPower(a, groupDefense(b));
  const pb = groupPower(b, groupDefense(a));
  return pb > 0 ? pa / pb : Infinity;
}

// ---- the reference party -------------------------------------------------------------------------------------

/** The chances a reference piece of gear is Crude, Common, Fine or Masterwork at a level (gearChancePerLevel). */
export function referenceGearOdds(level: number): Record<'crude' | 'common' | 'fine' | 'masterwork', number> {
  const g = POWER.gearChancePerLevel;
  const L = Math.max(0, level);
  const atLeast = (p: number) => Math.min(1, p * L);
  const mw = atLeast(g.masterwork);
  const fine = Math.max(mw, atLeast(g.fine));
  const common = Math.max(fine, atLeast(g.common));
  return { crude: 1 - common, common: common - fine, fine: fine - mw, masterwork: mw };
}

/** The reference gear's average base-stat multiplier at a level (1.3 at level 1, 2.3 at 5, 3.6 at 10, 5.2 at 20). */
export function referenceGearMultiplier(level: number): number {
  const odds = referenceGearOdds(level);
  return (Object.keys(odds) as (keyof typeof odds)[]).reduce((t, q) => t + odds[q] * (QUALITIES[q]?.baseMultiplier ?? 1), 0);
}

/** Qualities players can own, by base multiplier (Crude 1 ... Masterwork 7). */
const PLAYER_QUALITIES = Object.values(QUALITIES).filter((q) => !q.enemyOnly).sort((a, b) => a.baseMultiplier - b.baseMultiplier);

const lerpStats = (a: Stats, b: Stats, t: number): Stats =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Stats] + (b[k as keyof Stats] - a[k as keyof Stats]) * t])) as Stats;

/** A reference build's stats at a whole level and a gear multiplier (between the qualities around it). */
/** A build's stats per whole level and quality (they never change during a game). */
const buildCache = new Map<string, Stats>();
function buildStats(build: string, level: number, mult: number): Stats {
  const lo = [...PLAYER_QUALITIES].reverse().find((q) => q.baseMultiplier <= mult) ?? PLAYER_QUALITIES[0];
  const hi = PLAYER_QUALITIES.find((q) => q.baseMultiplier >= mult) ?? PLAYER_QUALITIES[PLAYER_QUALITIES.length - 1];
  const at = (q: string) => {
    const k = `${build}@${level}@${q}`;
    let s = buildCache.get(k);
    if (!s) {
      s = deriveStats(buildCharacter(build, level, 'profile', q));
      buildCache.set(k, s);
    }
    return s;
  };
  if (lo === hi) return at(lo.id);
  return lerpStats(at(lo.id), at(hi.id), (mult - lo.baseMultiplier) / (hi.baseMultiplier - lo.baseMultiplier));
}

/** How many members the reference party has at a level (POWER.referenceSizes). */
export function referenceSize(level: number): number {
  return [...POWER.referenceSizes].reverse().find(([from]) => level >= from)?.[1] ?? 4;
}

const refCache = new Map<string, Fighter[]>();

/** The reference party at a level (fractional levels blend the whole levels around them). */
export function referenceParty(level: number, size = referenceSize(level)): Fighter[] {
  const L = Math.round(level * 100) / 100;
  const key = `${L}x${size}`;
  const hit = refCache.get(key);
  if (hit) return hit;
  const lo = Math.floor(L);
  const t = L - lo;
  const mult = referenceGearMultiplier(L);
  // Below level 1 the stats keep falling at the level-1 to level-2 rate.
  const whole = (l: number, b: string) => buildStats(b, Math.max(1, l), mult);
  const out = POWER.referenceParty.slice(0, size).map((b) => {
    if (lo < 1) {
      const s1 = whole(1, b);
      const s2 = whole(2, b);
      return { stats: lerpStats(s1, s2, L - 1), ranged: RANGED_WEAPONS.has(BUILDS[b].weapon) };
    }
    return { stats: t ? lerpStats(whole(lo, b), whole(lo + 1, b), t) : whole(lo, b), ranged: RANGED_WEAPONS.has(BUILDS[b].weapon) };
  });
  if (refCache.size > 5000) refCache.clear();
  refCache.set(key, out);
  return out;
}

/**
 * The level at which the reference party's power ratio against `g` is `ratio` (1: an even match). The reference
 * party grows stronger with level, so this is a simple search.
 */
export function strengthAt(g: Fighter[], ratio = 1, size?: number): number {
  let [lo, hi] = POWER.range;
  const f = (L: number) => powerRatio(referenceParty(L, size ?? referenceSize(L)), g) - ratio;
  if (f(lo) >= 0) return lo;
  if (f(hi) <= 0) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- parties and enemies --------------------------------------------------------------------------------------

/** Party members as fighters, as they would fight (injuries, Morale and a blessing included). */
export function partyFighters(members: Character[], blessing = 0): Fighter[] {
  return members.map((c) => ({ stats: makeUnit(c, 'player', { x: 0, y: 0 }, blessing).stats, ranged: isRanged(c) }));
}

/** A party's strength in levels: the level of the reference party that would be its even match. */
export const partyStrength = (members: Character[], blessing = 0) => strengthAt(partyFighters(members, blessing));

/** How much an enemy type's value counts (enemies.json power: skills its stats don't show). */
export const enemyFactor = (type: string) => ENEMIES[type]?.power ?? 1;

const enemyCache = new Map<string, Fighter[]>();

/** Forget cached enemy fighters (after enemy stats change, as the balance tools do). */
export const clearEnemyCache = () => {
  enemyCache.clear();
  questCache.clear();
};

/**
 * One enemy of a type at a level, as the fighters it may turn out to be: each loadout, and crude gear that may be
 * Common (enemyGear.commonChancePerLevel), weighted by how likely each is. Weights add up to 1.
 */
export function expectedEnemy(type: string, level: number): Fighter[] {
  const k = `${type}@${level}`;
  const hit = enemyCache.get(k);
  if (hit) return hit;
  const def = ENEMIES[type];
  const factor = enemyFactor(type);
  const out: Fighter[] = [];
  const loadouts = def.loadouts.length || 1;
  const total = def.loadouts.reduce((t, l) => t + l.weight, 0) || 1;
  // The middle of each loadout's band of the roll (pickLoadout), and its share.
  const band = (i: number) => {
    if (!def.loadouts.length) return { mid: 0.5, share: 1 };
    const before = def.loadouts.slice(0, i).reduce((t, l) => t + l.weight, 0);
    return { mid: (before + def.loadouts[i].weight / 2) / total, share: def.loadouts[i].weight / total };
  };
  const common = def.gearQuality === 'crude' && def.loadouts.length ? Math.min(1, ENEMY_GEAR.commonChancePerLevel * level) : 0;
  for (let i = 0; i < loadouts; i++) {
    // makeEnemy picks the loadout from the rng: a stub rng that returns the loadout's slot, then "no upgrade" (0.999).
    for (const upgraded of common > 0 ? [false, true] : [false]) {
      let calls = 0;
      const { mid, share } = band(i);
      const rng = () => (calls++ === 0 ? mid : upgraded ? 0 : 0.999999);
      const c = makeEnemy(type, level, rng);
      out.push({ stats: deriveStats(c), factor, weight: share * (common > 0 ? (upgraded ? common : 1 - common) : 1), ranged: isRanged(c) });
    }
  }
  enemyCache.set(k, out);
  return out;
}

/** What a quest needs for its strength: its enemy level, group size (threat points) and enemy types. */
export interface QuestLike {
  stage: number;
  count: number;
  foes?: string[];
}

/**
 * The enemies a quest can be expected to field, as weighted fighters: generateEnemies picks its types evenly until
 * the threat budget is spent, so each type comes count / (average threat) / types times on average (and the last
 * pick overshoots the budget by about half a pick when the types differ in size). Past the top level range the budget grows 25% a level.
 */
const questCache = new Map<string, Fighter[]>();
export function questFighters(q: QuestLike, opts: { smooth?: boolean } = {}): Fighter[] {
  const key = `${q.stage}|${q.count}|${(q.foes ?? []).join(',')}|${opts.smooth ? 1 : 0}`;
  const hit = questCache.get(key);
  if (hit) return hit;
  const out = questFightersUncached(q, opts);
  if (questCache.size > 5000) questCache.clear();
  questCache.set(key, out);
  return out;
}

function questFightersUncached(q: QuestLike, opts: { smooth?: boolean }): Fighter[] {
  const types = enemyTypesFor(q);
  const top = Math.max(...Object.values(ENEMIES).map((d) => d.levels[1]));
  const budget = q.count * (1 + Math.max(0, q.stage - top) * 0.25);
  const avgThreat = types.reduce((s, t) => s + ENEMIES[t.type].threat, 0) / types.length;
  // One threat size: exactly enough picks to cover the budget (1 threat point of rats is 2 rats). Mixed sizes: the
  // last pick overshoots by about half a pick.
  const sizes = new Set(types.map((t) => ENEMIES[t.type].threat));
  // `smooth` (balance tuning): the budget over the threat, unrounded, so the group grows evenly with its size.
  const picks = Math.min(ENCOUNTER.maxEnemies, opts.smooth ? budget / avgThreat : sizes.size === 1 ? Math.ceil(budget / avgThreat - 1e-9) : budget / avgThreat + 0.5);
  return types.flatMap((t) => expectedEnemy(t.type, t.level).map((f) => ({ ...f, weight: (f.weight ?? 1) * picks / types.length })));
}

/** The enemy types a quest draws from, each at its level (all fitting types when the quest names none that fit). */
function enemyTypesFor(q: QuestLike): { type: string; level: number }[] {
  const fit = enemyTypesForStage(q.stage);
  const themed = fit.filter((t) => q.foes?.includes(t.type));
  return themed.length ? themed : fit;
}

/** A quest's strength in levels: the level of the reference party that would be its even match. */
export const questStrength = (q: QuestLike) => strengthAt(questFighters(q));

/** The power ratio of a party against a quest (1 = an even match by the model). */
export const matchup = (members: Character[], q: QuestLike, blessing = 0) => powerRatio(partyFighters(members, blessing), questFighters(q));


// ---- win chances, par and quest strength --------------------------------------------------------------------------

/** The AI party's chance to win at a power ratio (strength.winCurve, fitted by tools/balance). */
export function winChance(ratio: number): number {
  const { a, b } = GUILD.strength.winCurve;
  return 1 / (1 + Math.exp(-(a + b * Math.log(Math.max(1e-9, ratio)))));
}

/** The power ratio at which the AI party wins strength.parWinRate of the time. */
export function parRatio(): number {
  const { a, b } = GUILD.strength.winCurve;
  const p = GUILD.strength.parWinRate;
  return Math.exp((Math.log(p / (1 - p)) - a) / b);
}

/** A quest's par level: the level at which the reference party would win strength.parWinRate of its battles. */
export const questParLevel = (q: QuestLike, opts: { smooth?: boolean } = {}) => strengthAt(questFighters(q, opts), parRatio());

/**
 * A quest's strength as a value: the sum of its expected enemies' values (sqrt(effective HP x damage per turn)),
 * against the reference party at its par level. It grows in proportion to the enemies' number and stats.
 */
export function questValue(q: QuestLike): number {
  const foes = questFighters(q);
  return groupValue(foes, groupDefense(referenceParty(strengthAt(foes, parRatio()))));
}

/** A quest's fighting power (groupPower) against the reference party at its par level. */
export function questPowerOf(q: QuestLike): number {
  const foes = questFighters(q);
  return groupPower(foes, groupDefense(referenceParty(strengthAt(foes, parRatio()))));
}

/**
 * Strength in the game's own units: a group's power (groupPower), scaled down by STRENGTH_UNIT^2 so the numbers stay
 * readable. Twice the enemies is 2^1.75 (about 3.4) times the strength.
 */
export const STRENGTH_UNIT = 100;
export const strengthOfPower = (power: number) => power / STRENGTH_UNIT ** 2;

/** A rival party member as a fighter: the reference build for their place in the party, at their level. */
export function rivalFighter(level: number, index: number): Fighter {
  const ref = referenceParty(level);
  return ref[index % ref.length];
}

// ---- threat and skulls -----------------------------------------------------------------------------------------

/** The fixed party threat is measured against (so a quest's threat doesn't depend on who takes it). */
const RULER_SIZE = 4;

/**
 * A quest's threat: the log of its expected enemies' power (groupPower), against the Defense of a four-member
 * reference party of matching strength. It doesn't depend on levels: more enemies, or stronger ones, raise it.
 */
export function questThreat(q: QuestLike, opts: { smooth?: boolean } = {}): number {
  const foes = questFighters(q, opts);
  const even = strengthAt(foes, 1, RULER_SIZE);
  return Math.log(Math.max(1e-9, groupPower(foes, groupDefense(referenceParty(even, RULER_SIZE)))));
}

/** Linear through rising [x, y] points, extended past the ends along the first and last segments. */
function through(pts: [number, number][], x: number): number {
  let i = 1;
  while (i < pts.length - 1 && x > pts[i][0]) i++;
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/**
 * Skulls for a threat, unrounded: through strength.skulls, [threat, skulls] points. Half a skull is the threat
 * random level-1 recruits, three of them, score 95% on; ten skulls the threat five level-20 Adventurers score 50%
 * on; the points between spread each rank's typical quests evenly (tools/balance/skulls.sim.ts). Not clamped.
 */
export function skullsOfThreat(threat: number): number {
  return through(GUILD.strength.skulls, threat);
}

/** The threat a number of skulls stands for. */
export function threatOfSkulls(skulls: number): number {
  return through(GUILD.strength.skulls.map(([t, s]) => [s, t] as [number, number]), skulls);
}
