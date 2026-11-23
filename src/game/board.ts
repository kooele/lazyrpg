// The Adventurer Guild's quest board, shared by the player and the rival parties.
// Pure logic (no Phaser). Quests are posted daily; rivals take some (see guild.ts), the rest expire.
import { ENEMIES } from '../data/enemies';
import { GUILD } from '../data/guild';
import { RANKS, type GameState, type Quest, type Rank } from '../data/types';
import { enemyTypesForStage, pickFoes } from './battle';
import { newId, type Rng } from './character';
import { randInt } from './people';

const PLACES = ['the Old Sewers', 'Mill Road', 'Briar Farm', 'the Eastern Woods', "Gallow's Pass", 'the Salt Marsh', 'Kestrel Ford',
  'the Ruined Chapel', 'Hollow Creek', 'the Quarry', 'Thornfield', 'the North Gate', 'Lantern Hill', 'the Old Watchtower',
  'Ashford Mine', 'the Sunken Road', 'Raven Hollow', 'the Bone Fields', 'Greywater Bridge', 'the High Moor'];

/** Quest rank whose stages contain `stage` (the lowest below them, the highest past them). */
export function rankForStage(stage: number): Rank {
  const tiers = RANKS.map((r) => ({ r, t: GUILD.quests[r] })).sort((a, b) => a.t.stages[0] - b.t.stages[0]);
  return (tiers.find(({ t }) => stage <= t.stages[1]) ?? tiers[tiers.length - 1]).r;
}

const T = GUILD.threat;

/** The middle of a rank's enemy count range (a usual group; promotion quests and Quick Battle use it). */
export function usualCount(rank: Rank): number {
  const [lo, hi] = GUILD.quests[rank].count;
  return (lo + hi) / 2;
}

/** How strong one enemy (one threat point) is at `level`: strengthAtLevel1 x strengthGrowth^(level - 1). */
export const strength = (level: number) => T.strengthAtLevel1 * T.strengthGrowth ** (Math.max(1, level) - 1);

/** A quest's total threat: its enemy count (threat points) x the strength of one enemy at its level. */
export const totalThreat = (q: Pick<Quest, 'stage' | 'count'>) => q.count * strength(q.stage);

/** The usual gold for a quest: its total threat x goldPerThreat (before the board's pay roll). */
export const fairReward = (q: Pick<Quest, 'stage' | 'count'>) => totalThreat(q) * T.goldPerThreat;

/** Renown for completing a quest: its total threat x renownPerThreat. */
export const questRenown = (q: Pick<Quest, 'stage' | 'count'>) => Math.max(1, Math.round(totalThreat(q) * T.renownPerThreat));

const roll = ([lo, hi]: [number, number], rng: Rng) => lo + rng() * (hi - lo);
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

/** How well a quest pays for its danger: reward / the usual reward for its total threat (1 = fair). */
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
  // Group size and level are rolled independently; together they make the quest's total threat.
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
    reward: round5(fairReward({ stage, count }) * pay),
    renown: questRenown({ stage, count }),
    days: randInt(tier.days[0], tier.days[1], rng),
    expires: day + (promotion ? 365 : randInt(4, 8, rng)),
    description: `${promotion ? `The guild's ${rank}-rank trial. ` : ''}${names.join(' and ')} reported at ${place}.${size}`,
    ...(promotion ? { promotion: true } : {}),
    foes,
    count,
  };
}

/** A rank picked by the board's posting weights. */
function postedRank(rng: Rng): Rank {
  const w = GUILD.board.postWeights;
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
 * boardSize; `maxPosts` overrides that, e.g. to fill a new game's board), and there are always at least
 * board.minAtPartyRank quests at the player's rank.
 */
export function postQuests(state: GameState, rng: Rng, maxPosts = GUILD.board.maxPostsPerDay): void {
  const g = state.guild;
  g.board = g.board.filter((q) => q.expires >= state.day);
  const regular = () => g.board.filter((q) => !q.promotion).length;
  for (let i = 0; i < maxPosts && regular() < GUILD.boardSize; i++) g.board.push(makeQuest(postedRank(rng), state.day, rng));
  while (g.board.filter((q) => !q.promotion && q.rank === state.rank).length < GUILD.board.minAtPartyRank) {
    g.board.push(makeQuest(state.rank, state.day, rng));
  }
}
