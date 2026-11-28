// The Adventurer Guild's quest board, shared by the player and the rival parties.
// Pure logic (no Phaser). Quests are posted daily; rivals take some (see guild.ts), the rest expire.
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { GUILD } from '../data/guild';
import { RANKS, type GameState, type Quest, type Rank } from '../data/types';
import { enemyTypesForStage } from './battle';
import { newId, type Rng } from './character';
import { randInt } from './people';
import { questThreat, skullsOfThreat, strengthOfPower, threatOfSkulls } from './power';

const PLACES = ['the Old Sewers', 'Mill Road', 'Briar Farm', 'the Eastern Woods', "Gallow's Pass", 'the Salt Marsh', 'Kestrel Ford',
  'the Ruined Chapel', 'Hollow Creek', 'the Quarry', 'Thornfield', 'the North Gate', 'Lantern Hill', 'the Old Watchtower',
  'Ashford Mine', 'the Sunken Road', 'Raven Hollow', 'the Bone Fields', 'Greywater Bridge', 'the High Moor'];

/** Quest rank whose stages contain `stage` (the lowest below them, the highest past them). */
export function rankForStage(stage: number): Rank {
  const tiers = RANKS.map((r) => ({ r, t: GUILD.quests[r] })).sort((a, b) => a.t.stages[0] - b.t.stages[0]);
  return (tiers.find(({ t }) => stage <= t.stages[1]) ?? tiers[tiers.length - 1]).r;
}

const S = GUILD.strength;


/**
 * A quest's strength, from the enemies it can be expected to field (src/game/power.ts): its value (the fighting
 * strength of its enemies, which grows with their number and their stats) and its par level (the level at which the
 * reference party, AI-played, would win strength.parWinRate of the time). Cached per enemy level, size and types.
 */
const cache = new Map<string, { threat: number }>();
function questPower(q: Pick<Quest, 'stage' | 'count' | 'foes'>): { threat: number } {
  const k = `${q.stage}|${q.count}|${(q.foes ?? []).join(',')}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = { threat: questThreat(q) };
    if (cache.size > 2000) cache.clear();
    cache.set(k, hit);
  }
  return hit;
}

/**
 * A quest's strength: the fighting power of its expected enemies (e^threat: groupPower against the four-member
 * reference party of matching strength, in strengthOfPower's units), so a group twice the size is about 3.4 times as
 * strong. Its gold and renown are proportional to it.
 */
export const questStrength = (q: Pick<Quest, 'stage' | 'count' | 'foes'>) => strengthOfPower(Math.exp(questPower(q).threat));

/** The usual gold for a quest: its strength x goldPerStrength (before the board's pay roll). */
export const fairReward = (q: Pick<Quest, 'stage' | 'count' | 'foes'>) => questStrength(q) * S.goldPerStrength;

/**
 * Renown for completing a quest: its strength x renownPerStrength, then x (1 + renownPayFactor x (1 - pay)), so a
 * quest that pays below the usual rate earns more renown and one that pays above it earns less. `pay` is the quest's
 * pay roll (1 = usual).
 */
export function questRenown(q: Pick<Quest, 'stage' | 'count' | 'foes'>, pay = 1): number {
  return Math.max(1, Math.round(questStrength(q) * S.renownPerStrength * Math.max(0, 1 + S.renownPayFactor * (1 - pay))));
}

/**
 * About how many enemies a quest sends: its group size over the average threat of its enemy types
 * (rats are 0.5 each, so a group of 4 is about 8 of them), at most encounter.maxEnemies.
 */
export function expectedEnemies(q: Pick<Quest, 'count' | 'foes'>): number {
  const types = (q.foes ?? []).filter((f) => ENEMIES[f]);
  const each = types.length ? types.reduce((sum, f) => sum + ENEMIES[f].threat, 0) / types.length : 1;
  return Math.max(1, Math.min(ENCOUNTER.maxEnemies, Math.ceil(q.count / each - 1e-9)));
}

/** How hard a quest is: its skulls, unrounded (for sorting; see dangerRating). */
export const questDifficulty = (q: Pick<Quest, 'stage' | 'count' | 'foes'>) => skullsOfThreat(questPower(q).threat);

/** The top of the skull scale: five white skulls, then five red ones over them. */
export const MAX_SKULLS = 10;

/**
 * Danger, shown as skulls: 0.5 to 10 in half steps, from the quest's threat (the power of its enemies, power.ts) on
 * one fixed scale for the whole game: half a skull is a quest three level-1 recruits nearly always come out of well,
 * ten one that five level-20 Adventurers come out of well half the time. Each skull is the same multiple of power.
 * Cards show 0.5-5 as white skulls and 5.5-10 as red skulls laid over them.
 */
export function dangerRating(q: Pick<Quest, 'stage' | 'count' | 'foes'>): number {
  return roundSkulls(questDifficulty(q));
}

/** Skulls in half steps, 0.5 to 10. */
export const roundSkulls = (skulls: number) => Math.max(0.5, Math.min(MAX_SKULLS, Math.round(skulls * 2) / 2));

/** The threat a number of skulls stands for (power.ts). */
export const skullThreat = threatOfSkulls;

const roll = ([lo, hi]: [number, number], rng: Rng) => lo + rng() * (hi - lo);
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

/** How well a quest pays for its danger: reward / the usual reward for its strength (1 = fair). */
export function payRatio(q: Quest): number {
  return q.reward / fairReward(q);
}

/** "generous", "fair" or "poor" pay for the danger. */
export function payRating(q: Quest): 'generous' | 'fair' | 'poor' {
  const r = payRatio(q);
  return r >= 1.15 ? 'generous' : r <= 0.87 ? 'poor' : 'fair';
}

/** "Small group", "" (usual) or "Large band": the group size against its main enemy type's usual group. */
export function groupLabel(q: Pick<Quest, 'count' | 'foes'>): string {
  const usual = ENEMIES[q.foes?.[0] ?? '']?.group;
  if (!usual) return '';
  const r = q.count / usual;
  return r < 0.88 ? 'Small group' : r > 1.15 ? 'Large band' : '';
}

/** A quest's group is GROUP_RANGE of its main type's usual group (largest / smallest = 1.33 / 0.75 = 1.77). */
export const GROUP_RANGE: [number, number] = [0.75, 4 / 3];

/** The threat of a type's usual group at a level (alone), cached. */
const typeThreats = new Map<string, number>();
function typeThreat(type: string, level: number): number {
  const k = `${type}@${level}`;
  let t = typeThreats.get(k);
  if (t === undefined) {
    t = questThreat({ stage: level, count: ENEMIES[type].group, foes: [type] });
    typeThreats.set(k, t);
  }
  return t;
}

/** The other fitting types that fight like `main` at `level`, after it (pickFoes for a chosen main type). */
function companions(main: string, level: number): string[] {
  const fit = enemyTypesForStage(level).map((t) => t.type);
  return [main, ...fit.filter((t) => t !== main && ENEMIES[t].ai === ENEMIES[main].ai)];
}

/**
 * The group size (threat points) that gives `foes` at `level` the threat `target`, within GROUP_RANGE of the main
 * type's usual group. Power grows with size^numbersExponent, so a step or two of log-scaling lands it.
 */
function countForThreat(level: number, foes: string[], target: number): number {
  const usual = ENEMIES[foes[0]].group;
  const [lo, hi] = GROUP_RANGE.map((r) => r * usual);
  const k = GUILD.strength.numbersExponent;
  let c = usual;
  for (let i = 0; i < 2; i++) {
    const t = questThreat({ stage: level, count: c, foes });
    c = Math.min(hi, Math.max(lo, c * Math.exp((target - t) / k)));
  }
  return Math.round(c * 20) / 20;
}

/**
 * A quest's enemies for a target number of skulls: an enemy type (each type with a level whose usual group is
 * within GROUP_RANGE of the threat is as likely), the level of it whose usual group comes closest, its same-style
 * companions, and the group size that fits. With none in reach, the closest type and level.
 */
export function enemiesForSkulls(skulls: number, rng: Rng): { stage: number; count: number; foes: string[] } {
  const target = skullThreat(skulls);
  const k = GUILD.strength.numbersExponent;
  const reach = [k * Math.log(GROUP_RANGE[0]), k * Math.log(GROUP_RANGE[1])];
  const options: { type: string; level: number; gap: number }[] = [];
  let closest: { type: string; level: number; gap: number } | null = null;
  for (const def of Object.values(ENEMIES)) {
    let best: { type: string; level: number; gap: number } | null = null;
    for (let L = def.levels[0]; L <= def.levels[1]; L++) {
      const gap = target - typeThreat(def.id, L);
      const o = { type: def.id, level: L, gap };
      if (!closest || Math.abs(gap) < Math.abs(closest.gap)) closest = o;
      if (gap >= reach[0] && gap <= reach[1] && (!best || Math.abs(gap) < Math.abs(best.gap))) best = o;
    }
    if (best) options.push(best);
  }
  const pick = options.length ? options[Math.floor(rng() * options.length)] : closest!;
  const foes = companions(pick.type, pick.level);
  return { stage: pick.level, count: countForThreat(pick.level, foes, target), foes };
}

/** A usual quest of a rank: the middle of its skulls (rival parties' promotion trials, old saves, Quick Battle). */
const usualQuests = new Map<Rank, { stage: number; count: number; foes: string[] }>();
export function usualQuest(rank: Rank): { stage: number; count: number; foes: string[] } {
  let q = usualQuests.get(rank);
  if (!q) {
    const [lo, hi] = GUILD.quests[rank].skulls;
    q = enemiesForSkulls((lo + hi) / 2, () => 0.5);
    usualQuests.set(rank, q);
  }
  return q;
}

/** The group size of a rank's usual quest (threat points). */
export const usualCount = (rank: Rank) => usualQuest(rank).count;

export function makeQuest(rank: Rank, day: number, rng: Rng, promotion = false): Quest {
  const tier = GUILD.quests[rank];
  // Its danger first: anywhere in the rank's skulls; a promotion quest is a fair test, in the easier half, usual pay.
  const [lo, hi] = tier.skulls;
  const skulls = promotion ? lo + rng() * ((hi - lo) / 2) : lo + rng() * (hi - lo);
  const { stage, count, foes } = enemiesForSkulls(skulls, rng);
  const pay = promotion ? 1 : roll(GUILD.board.pay, rng);
  const place = PLACES[Math.floor(rng() * PLACES.length)];
  const title = `${ENEMIES[foes[0]].questTitle} at ${place}`;
  const names = foes.map((t) => `${ENEMIES[t].name}s (Lv ${stage})`);
  const group = groupLabel({ count, foes });
  const size = group === 'Small group' ? ' A small group.' : group === 'Large band' ? ' A large band: expect many of them.' : '';
  return {
    id: newId('q'),
    title: promotion ? `Promotion: ${title}` : title,
    rank,
    stage,
    reward: round5(fairReward({ stage, count, foes }) * pay),
    renown: questRenown({ stage, count, foes }, pay),
    days: randInt(tier.days[0], tier.days[1], rng),
    expires: day + (promotion ? 365 : randInt(4, 8, rng)),
    description: `${promotion ? `The guild's ${rank}-rank trial. ` : ''}${names.join(' and ')} reported at ${place}.${size}`,
    ...(promotion ? { promotion: true } : {}),
    foes,
    count,
  };
}

/** A rank picked by the board's posting weights (board.rankWeights: S 1, A 7, B 20, C 60, D 40 out of 128). */
function postedRank(rng: Rng): Rank {
  const w = GUILD.board.rankWeights;
  const total = RANKS.reduce((s, r) => s + w[r], 0);
  let x = rng() * total;
  for (const r of RANKS) {
    x -= w[r];
    if (x < 0) return r;
  }
  return 'D';
}

/**
 * The day's postings: expired quests come down, up to board.maxPostsPerDay new ones go up (until the board holds
 * boardSize; `maxPosts` overrides that, e.g. to fill a new game's board). Nothing is kept back for the player:
 * rivals can take every quest at the player's rank.
 */
export function postQuests(state: GameState, rng: Rng, maxPosts = GUILD.board.maxPostsPerDay): void {
  const g = state.guild;
  g.board = g.board.filter((q) => q.expires >= state.day);
  const regular = () => g.board.filter((q) => !q.promotion).length;
  for (let i = 0; i < maxPosts && regular() < GUILD.boardSize; i++) g.board.push(makeQuest(postedRank(rng), state.day, rng));
}
