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

/** Enemy threat budget of a quest of `rank`: the rank's encounter size times the quest's threat. Never depends on the party. */
export function encounterBudget(rank: Rank, threat = 1): number {
  return GUILD.quests[rank].encounter * threat;
}

const roll = ([lo, hi]: [number, number], rng: Rng) => lo + rng() * (hi - lo);
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);

/** The reward table's figure for a quest of `rank` at enemy level `stage` (for a standard encounter): up the rank's range with the level. */
export function baseReward(rank: Rank, stage: number): number {
  const t = GUILD.quests[rank];
  const [s0, s1] = t.stages;
  const f = s1 > s0 ? Math.max(0, Math.min(1, (stage - s0) / (s1 - s0))) : 0.5;
  return t.reward[0] + (t.reward[1] - t.reward[0]) * f;
}

/**
 * How big a quest's encounter is next to the standard one the reward table is set for (board.standardEncounter):
 * its rank's encounter budget times its threat, over the standard. Rewards scale with it.
 */
export function encounterScale(q: Pick<Quest, 'rank' | 'threat'>): number {
  return encounterBudget(q.rank, q.threat ?? 1) / GUILD.board.standardEncounter;
}

/** The usual reward for a quest: its level's base reward, scaled by the size of its encounter. */
export function fairReward(q: Pick<Quest, 'rank' | 'stage' | 'threat'>): number {
  return baseReward(q.rank, q.stage) * encounterScale(q);
}

/** How well a quest pays for its danger: reward / the usual reward for its level and encounter size (1 = fair). */
export function payRatio(q: Quest): number {
  return q.reward / fairReward(q);
}

/** "generous", "fair" or "poor" pay for the danger. */
export function payRating(q: Quest): 'generous' | 'fair' | 'poor' {
  const r = payRatio(q);
  return r >= 1.15 ? 'generous' : r <= 0.87 ? 'poor' : 'fair';
}

/** "Small group", "" (usual) or "Large band": how many foes to expect. */
export function groupLabel(q: Quest): string {
  const t = q.threat ?? 1;
  return t <= 0.9 ? 'Small group' : t >= 1.15 ? 'Large band' : '';
}

export function makeQuest(rank: Rank, day: number, rng: Rng, promotion = false): Quest {
  const tier = GUILD.quests[rank];
  // A promotion quest is a fair test: the easier half of its rank's levels, a usual-sized group, usual pay.
  const stage = promotion ? randInt(tier.stages[0], Math.ceil((tier.stages[0] + tier.stages[1]) / 2), rng) : randInt(tier.stages[0], tier.stages[1], rng);
  const threat = promotion ? 1 : Math.round(roll(GUILD.board.threat, rng) * 100) / 100;
  const pay = promotion ? 1 : roll(GUILD.board.pay, rng);
  const foes = pickFoes(stage, rng);
  const levels = new Map(enemyTypesForStage(stage).map((t) => [t.type, t.level]));
  const place = PLACES[Math.floor(rng() * PLACES.length)];
  const title = `${ENEMIES[foes[0]].questTitle} at ${place}`;
  const names = foes.map((t) => `${ENEMIES[t].name}s (Lv ${levels.get(t)})`);
  const size = threat <= 0.9 ? ' A small group.' : threat >= 1.15 ? ' A large band: expect many of them.' : '';
  return {
    id: newId('q'),
    title: promotion ? `Promotion: ${title}` : title,
    rank,
    stage,
    reward: round5(fairReward({ rank, stage, threat }) * pay),
    renown: Math.round(tier.renown * threat),
    days: randInt(tier.days[0], tier.days[1], rng),
    expires: day + (promotion ? 365 : randInt(4, 8, rng)),
    description: `${promotion ? `The guild's ${rank}-rank trial. ` : ''}${names.join(' and ')} reported at ${place}.${size}`,
    ...(promotion ? { promotion: true } : {}),
    foes,
    threat,
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
