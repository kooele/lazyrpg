// The Adventurer Guild's quest board, shared by the player and the rival parties.
// Pure logic (no Phaser). Quests are posted daily; rivals take some (see guild.ts), the rest expire.
import { ENCOUNTER, ENEMIES } from '../data/enemies';
import { GUILD } from '../data/guild';
import { RANKS, type GameState, type Quest, type Rank } from '../data/types';
import { enemyTypesForStage, pickFoes } from './battle';
import { newId, type Rng } from './character';
import { randInt } from './people';
import { questParLevel, questValue, strengthOfValue } from './power';

const PLACES = ['the Old Sewers', 'Mill Road', 'Briar Farm', 'the Eastern Woods', "Gallow's Pass", 'the Salt Marsh', 'Kestrel Ford',
  'the Ruined Chapel', 'Hollow Creek', 'the Quarry', 'Thornfield', 'the North Gate', 'Lantern Hill', 'the Old Watchtower',
  'Ashford Mine', 'the Sunken Road', 'Raven Hollow', 'the Bone Fields', 'Greywater Bridge', 'the High Moor'];

/** Quest rank whose stages contain `stage` (the lowest below them, the highest past them). */
export function rankForStage(stage: number): Rank {
  const tiers = RANKS.map((r) => ({ r, t: GUILD.quests[r] })).sort((a, b) => a.t.stages[0] - b.t.stages[0]);
  return (tiers.find(({ t }) => stage <= t.stages[1]) ?? tiers[tiers.length - 1]).r;
}

const S = GUILD.strength;

/** The middle of a rank's enemy count range (a usual group; promotion quests and Quick Battle use it). */
export function usualCount(rank: Rank): number {
  const [lo, hi] = GUILD.quests[rank].count;
  return (lo + hi) / 2;
}

/**
 * A quest's strength, from the enemies it can be expected to field (src/game/power.ts): its value (the fighting
 * strength of its enemies, which grows with their number and their stats) and its par level (the level at which the
 * reference party, AI-played, would win strength.parWinRate of the time). Cached per enemy level, size and types.
 */
const cache = new Map<string, { value: number; par: number }>();
function questPower(q: Pick<Quest, 'stage' | 'count' | 'foes'>): { value: number; par: number } {
  const k = `${q.stage}|${q.count}|${(q.foes ?? []).join(',')}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = { value: questValue(q), par: questParLevel(q) };
    if (cache.size > 2000) cache.clear();
    cache.set(k, hit);
  }
  return hit;
}

/**
 * A quest's strength: the fighting power of its expected enemies (the square of their summed values, see
 * strengthOfValue), so a group twice the size is four times as strong. Its gold and renown are proportional to it.
 */
export const questStrength = (q: Pick<Quest, 'stage' | 'count' | 'foes'>) => strengthOfValue(questPower(q).value);

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

/**
 * How hard a quest is, as the party level it calls for: its par level, the level at which the reference party (four
 * Adventurers of average B talent with the gear expected at their level, played by the AI) would win
 * strength.parWinRate of its battles against it.
 */
export const questDifficulty = (q: Pick<Quest, 'stage' | 'count' | 'foes'>) => questPower(q).par;

/** The top of the skull scale: five white skulls, then five red ones over them. */
export const MAX_SKULLS = 10;

/**
 * Danger, shown as skulls: 0.5 to 10 in half steps, rising evenly with the quest's par level (questDifficulty) on one
 * fixed scale for the whole game, from strength.skulls.from (half a skull) to strength.skulls.to (ten). A level's
 * worth of party strength is a fixed share more power, so skulls grow with the log of a quest's strength.
 * Cards show 0.5-5 as white skulls and 5.5-10 as red skulls laid over them.
 */
export function dangerRating(q: Pick<Quest, 'stage' | 'count' | 'foes'>): number {
  return skullsForLevel(questDifficulty(q));
}

/** The skulls a quest with this par level shows. */
export function skullsForLevel(par: number): number {
  const { from, to } = S.skulls;
  const f = (par - from) / (to - from);
  return Math.max(0.5, Math.min(MAX_SKULLS, Math.round((0.5 + (MAX_SKULLS - 0.5) * f) * 2) / 2));
}

/** The par level a number of skulls stands for (the middle of its half step). */
export function levelForSkulls(skulls: number): number {
  const { from, to } = S.skulls;
  return from + ((skulls - 0.5) / (MAX_SKULLS - 0.5)) * (to - from);
}

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

/** "Small group", "" (usual) or "Large band": the group size against its rank's range (bottom or top third). */
export function groupLabel(q: Pick<Quest, 'rank' | 'count'>): string {
  const [lo, hi] = GUILD.quests[q.rank].count;
  const third = (hi - lo) / 3;
  return q.count < lo + third - 1e-9 ? 'Small group' : q.count > hi - third + 1e-9 ? 'Large band' : '';
}

export function makeQuest(rank: Rank, day: number, rng: Rng, promotion = false): Quest {
  const tier = GUILD.quests[rank];
  // A promotion quest is a fair test: the easier half of its rank's levels, a usual-sized group, usual pay.
  const stage = promotion ? randInt(tier.stages[0], Math.ceil((tier.stages[0] + tier.stages[1]) / 2), rng) : randInt(tier.stages[0], tier.stages[1], rng);
  // Group size and level are rolled independently; together (with the enemy types) they make the quest's strength.
  const count = promotion ? Math.round(usualCount(rank)) : randInt(tier.count[0], tier.count[1], rng);
  const pay = promotion ? 1 : roll(GUILD.board.pay, rng);
  const foes = pickFoes(stage, rng);
  const levels = new Map(enemyTypesForStage(stage).map((t) => [t.type, t.level]));
  const place = PLACES[Math.floor(rng() * PLACES.length)];
  const title = `${ENEMIES[foes[0]].questTitle} at ${place}`;
  const names = foes.map((t) => `${ENEMIES[t].name}s (Lv ${levels.get(t)})`);
  const group = groupLabel({ rank, count });
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
