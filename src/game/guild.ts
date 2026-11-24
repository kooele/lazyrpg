// The Adventurer Guild of Arch City: rival parties, the leaderboard and ranks, and the
// day-by-day simulation of the other adventurers. Pure logic (no Phaser).
import { WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import { RANKS, type AdventurerRank, type FreeAdventurer, type GameState, type GuildState, type Quest, type Rank, type RivalMember, type RivalParty } from '../data/types';
import { postQuests, questDifficulty, questRenown, usualCount } from './board';

export { questDifficulty };
import { newId, type Rng } from './character';
import { randInt, randomAdventurer, randomName, randomPartyName } from './people';

const SIM = GUILD.simulation;
export const PLAYER_ID = 'player';

// ---- ranks -----------------------------------------------------------------------------------------

/** Renown a party needs to hold `rank` (D: none). */
export const rankThreshold = (rank: Rank): number => (rank === 'D' ? 0 : GUILD.ranks.renown[rank]);

/** The rank above (null for S). */
export const nextRank = (rank: Rank): Rank | null => (rank === 'S' ? null : RANKS[RANKS.indexOf(rank) - 1]);

/** The rank below (null for D). */
export const lowerRank = (rank: Rank): Rank | null => (rank === 'D' ? null : RANKS[RANKS.indexOf(rank) + 1]);

/** An adventurer's own rank from their level: D 1-5, C 6-10, B 11-15, A 16-20, S 21+ (adventurerRanks in guild.json). */
export function adventurerRank(level: number): AdventurerRank {
  const r = GUILD.adventurerRanks;
  return level >= r.S ? 'S' : level >= r.A ? 'A' : level >= r.B ? 'B' : level >= r.C ? 'C' : 'D';
}

/** Levels of an adventurer rank (S: from its first level to 5 above). */
export function rankLevels(rank: AdventurerRank): [number, number] {
  const r = GUILD.adventurerRanks;
  const bounds: Record<AdventurerRank, [number, number]> = {
    D: [1, r.C - 1], C: [r.C, r.B - 1], B: [r.B, r.A - 1], A: [r.A, r.S - 1], S: [r.S, r.S + 4],
  };
  return bounds[rank];
}

/** Can a party with this renown take its next rank's promotion quest? */
export const promotionReady = (rank: Rank, renown: number) => {
  const up = nextRank(rank);
  return !!up && renown >= rankThreshold(up);
};

/**
 * Demotion clock: a party below its rank's renown for `ranks.demotionDays` days in a row drops a rank.
 * Returns the new rank (or the same one) and the updated start of the stretch below (0 = not below).
 */
export function demotionCheck(rank: Rank, renown: number, belowSince: number, day: number): { rank: Rank; belowSince: number } {
  if (renown >= rankThreshold(rank)) return { rank, belowSince: 0 };
  const since = belowSince || day;
  if (day - since < GUILD.ranks.demotionDays) return { rank, belowSince: since };
  const down = lowerRank(rank) ?? rank;
  return { rank: down, belowSince: renown >= rankThreshold(down) ? 0 : day };
}

/** How many of `n` parties start at each rank (rankWeights: S 1, A 5, B 20, C 60, D 40 out of 126 by default). */
export function rankCounts(n: number): Record<Rank, number> {
  const w = GUILD.rankWeights;
  const total = RANKS.reduce((t, r) => t + w[r], 0);
  const s = { S: w.S / total, A: w.A / total, B: w.B / total, D: w.D / total };
  const S = Math.min(n, Math.round(n * s.S));
  const A = n > S ? Math.max(1, Math.min(n - S, Math.round(n * s.A))) : 0;
  const B = Math.min(n - S - A, Math.round(n * s.B));
  const D = Math.min(n - S - A - B, Math.round(n * s.D));
  return { S, A, B, C: n - S - A - B - D, D };
}

export interface BoardEntry {
  id: string;
  name: string;
  renown: number;
  rank: Rank;
  members: number;
  avgLevel: number;
  wins: number;
  losses: number;
  last: string;
  isPlayer: boolean;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** All parties (the player's included), by rank, then renown. */
export function leaderboard(state: GameState): BoardEntry[] {
  const fighters = state.party.filter((c) => c.contract?.type !== 'mercenary');
  const entries: BoardEntry[] = [
    ...state.guild.rivals.map((p) => ({
      id: p.id, name: p.name, renown: p.renown, rank: p.rank, members: p.members.length, avgLevel: avg(p.members.map((m) => m.level)),
      wins: p.wins, losses: p.losses, last: p.last, isPlayer: false,
    })),
    {
      id: PLAYER_ID, name: state.partyName, renown: state.renown, rank: state.rank, members: fighters.length, avgLevel: avg(fighters.map((c) => c.level)),
      wins: state.progress.victories, losses: state.progress.defeats, last: '', isPlayer: true,
    },
  ];
  // Ties go to the player's rivals (the guild trusts a known name), then by name for stability.
  return entries.sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || b.renown - a.renown
    || Number(a.isPlayer) - Number(b.isPlayer) || a.name.localeCompare(b.name));
}

/** The day's demotion check for every party. Returns the player's rank change and news about rivals. */
export function updateRanks(state: GameState): { player?: { from: Rank; to: Rank }; news: string[] } {
  const news: string[] = [];
  let player: { from: Rank; to: Rank } | undefined;
  const me = demotionCheck(state.rank, state.renown, state.belowRankSince, state.day);
  if (me.rank !== state.rank) player = { from: state.rank, to: me.rank };
  state.rank = me.rank;
  state.belowRankSince = me.belowSince;
  for (const p of state.guild.rivals) {
    const r = demotionCheck(p.rank, p.renown, p.belowSince ?? 0, state.day);
    if (r.rank !== p.rank && (p.rank === 'S' || p.rank === 'A' || p.rank === 'B')) news.push(`${p.name} dropped to ${r.rank} rank.`);
    p.rank = r.rank;
    p.belowSince = r.belowSince;
  }
  return { player, news };
}

/** Typical member level of a party at each rank when the world is made (adventurers of about that rank). */
const LEVELS_BY_RANK: Record<Rank, [number, number]> = { S: [21, 24], A: [16, 19], B: [11, 14], C: [6, 9], D: [1, 4] };
const RENOWN_BY_RANK: Record<Rank, [number, number]> = { S: [6500, 9000], A: [1650, 2600], B: [420, 1400], C: [110, 380], D: [0, 90] };

function rivalMember(level: number, rng: Rng, avoid: Set<string>): RivalMember {
  const sex = rng() < 0.5 ? 'male' : 'female';
  const name = randomName(sex, rng, avoid);
  avoid.add(name);
  return { name, level, weaponId: Object.keys(WEAPONS)[Math.floor(rng() * Object.keys(WEAPONS).length)] };
}

function partySizeRoll(rng: Rng): number {
  const [lo, hi] = SIM.partySize;
  // Most parties have 4-5 members.
  return Math.max(lo, Math.min(hi, Math.round((lo + hi) / 2 + (rng() + rng() - 1) * (hi - lo) / 2)));
}

function freeAdventurer(level: number, rng: Rng, avoid?: Set<string>): FreeAdventurer {
  return {
    character: randomAdventurer(level, rng, { avoidNames: avoid }),
    greed: Math.round((0.8 + rng() * 0.45) * 100) / 100,
    patience: GUILD.companion.patience,
    refusedUntil: 0,
  };
}

/** Level of a newcomer to the guild: mostly fresh recruits, now and then a veteran from elsewhere. */
function newcomerLevel(rng: Rng): number {
  const r = rng();
  return r < 0.03 ? randInt(11, 16, rng) : r < 0.15 ? randInt(5, 10, rng) : randInt(1, 3, rng);
}

/** A fresh guild: rival parties spread over the ranks (the player fills a D slot), and free adventurers. */
export function createGuild(rng: Rng, day = 1): GuildState {
  const n = SIM.targetParties;
  const counts = rankCounts(n + 1);
  counts.D -= 1; // the player's party starts at the bottom
  const names = new Set<string>();
  const people = new Set<string>();
  const rivals: RivalParty[] = [];
  for (const rank of RANKS) {
    for (let k = 0; k < counts[rank]; k++) {
      const name = randomPartyName(rng, names);
      names.add(name);
      const [lo, hi] = LEVELS_BY_RANK[rank];
      const [r0, r1] = RENOWN_BY_RANK[rank];
      const size = partySizeRoll(rng);
      rivals.push({
        id: newId('p'), name, rank, renown: randInt(r0, r1, rng),
        members: Array.from({ length: size }, () => rivalMember(randInt(lo, hi, rng), rng, people)),
        founded: day - randInt(30, 400, rng), wins: randInt(3, 30, rng), losses: randInt(0, 8, rng), lastDay: 0, last: '',
      });
    }
  }
  const pool = Array.from({ length: SIM.poolTarget }, () => freeAdventurer(newcomerLevel(rng), rng, people));
  return { rivals, pool, board: [], news: [] };
}

export function adventurerCount(state: GameState): number {
  return state.guild.rivals.reduce((s, p) => s + p.members.length, 0) + state.guild.pool.length
    + state.party.filter((c) => c.contract?.type !== 'mercenary').length;
}

/** How much less likely an adventurer of this level is to die on a quest than a fresh recruit (1 at level 1). */
export function deathFactor(level: number): number {
  return Math.max(SIM.minDeathFactor, SIM.deathLevelFalloff ** (Math.max(1, level) - 1));
}

/** A rival party's chance to complete a quest of a rank. */
export function rivalSuccessChance(p: RivalParty, rank: Rank): number {
  const power = avg(p.members.map((m) => m.level)) + 0.25 * (p.members.length - 4);
  return Math.max(0.1, Math.min(0.95, 0.55 + SIM.successPerLevel * (power - rankDifficulty(rank))));
}

/** A usual quest of `rank`: mid-rank enemy level and group size. */
function usualQuest(rank: Rank): Pick<Quest, 'stage' | 'count'> {
  const [lo, hi] = GUILD.quests[rank].stages;
  return { stage: Math.round((lo + hi) / 2), count: usualCount(rank) };
}

/** How hard a usual quest of `rank` is: what rival parties weigh when picking a rank. */
export function rankDifficulty(rank: Rank): number {
  return questDifficulty(usualQuest(rank));
}

/** A rival party's chance to complete a board quest. */
export function rivalQuestChance(p: RivalParty, q: Quest): number {
  const power = avg(p.members.map((m) => m.level)) + 0.25 * (p.members.length - 4);
  return Math.max(0.1, Math.min(0.95, 0.55 + SIM.successPerLevel * (power - questDifficulty(q))));
}

/**
 * The board quest a rival party takes: at its rank or below (never promotion quests), at least a 55% chance,
 * and the best expected value: chance x (gold + renown) minus what a failure costs. Null if nothing suits it.
 */
export function rivalPickQuest(p: RivalParty, board: Quest[]): Quest | null {
  const own = RANKS.indexOf(p.rank);
  let best: Quest | null = null;
  let bestScore = 0;
  for (const q of board) {
    if (q.promotion || RANKS.indexOf(q.rank) < own) continue;
    const chance = rivalQuestChance(p, q);
    if (chance < 0.55) continue;
    const prize = q.reward + q.renown * 5;
    const score = chance * prize - (1 - chance) * prize;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/** Which quest rank a rival takes: the hardest one at or below its rank it is fairly sure of, and now and then one above. */
export function rivalQuestRank(p: RivalParty, rng: Rng): Rank {
  const own = RANKS.indexOf(p.rank);
  if (own > 0 && rng() < 0.3 && rivalSuccessChance(p, RANKS[own - 1]) >= 0.7) return RANKS[own - 1];
  for (let i = own; i < RANKS.length; i++) if (rivalSuccessChance(p, RANKS[i]) >= 0.6) return RANKS[i];
  return 'D';
}

/** Expected adventurers lost today across all parties (used to pace new arrivals). */
export function expectedDailyLosses(state: GameState): number {
  let e = 0;
  for (const p of state.guild.rivals) {
    const size = p.members.length;
    const rank = p.rank;
    const ps = rivalSuccessChance(p, rank);
    const k = deathFactor(avg(p.members.map((m) => m.level)));
    const wipe = SIM.wipeChanceOnFailure * k;
    const fail = (1 - ps) * (wipe * size + (1 - wipe) * SIM.lossChanceOnFailure * k * size);
    e += SIM.questChancePerDay * (ps * SIM.lossChanceOnSuccess * k * size + fail) + SIM.retireChancePerDay * size;
  }
  return e;
}

function poisson(mean: number, rng: Rng): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 50);
  return k - 1;
}

const QUEST_WORDS: Record<Rank, string> = { S: 'an S-rank', A: 'an A-rank', B: 'a B-rank', C: 'a C-rank', D: 'a D-rank' };

/** Renown lost: a failed quest, and each member who died on it. */
export function renownLoss(questRenown: number, failed: boolean, deaths: number): number {
  return questRenown * ((failed ? GUILD.ranks.failedQuestRenown : 0) + deaths * GUILD.ranks.deathRenown);
}

/** One day in the life of the guild's other adventurers. Adds news to the guild. */
export function simulateGuildDay(state: GameState, rng: Rng): void {
  const g = state.guild;
  const day = state.day;
  const news = (text: string) => g.news.push({ day, text });
  const people = new Set<string>([...g.rivals.flatMap((p) => p.members.map((m) => m.name)), ...g.pool.map((a) => a.character.name)]);
  const expected = expectedDailyLosses(state);
  // New postings go up before the parties pick their quests.
  postQuests(state, rng);

  // A different party gets first pick of the board each day.
  const order = [...g.rivals].map((p) => ({ p, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  for (const p of order) {
    // Retirement.
    p.members = p.members.filter((m) => {
      if (rng() >= SIM.retireChancePerDay) return true;
      news(`${m.name} of ${p.name} retired from adventuring.`);
      return false;
    });
    if (p.members.length > 0 && rng() < SIM.questChancePerDay) {
      // With enough renown, a party tries its promotion quest once it's fairly sure of it;
      // otherwise it takes the best deal it can handle from the board (or rests if there's none).
      const up = nextRank(p.rank);
      const promo = !!up && promotionReady(p.rank, p.renown) && rivalSuccessChance(p, up) >= 0.5;
      const q = promo ? null : rivalPickQuest(p, g.board);
      if (promo || q) {
        if (q) g.board = g.board.filter((x) => x !== q);
        const rank = q ? q.rank : up!;
        const chance = q ? rivalQuestChance(p, q) : rivalSuccessChance(p, rank);
        const renown = q ? q.renown : questRenown(usualQuest(rank));
        const what = q ? `"${q.title}"` : `${QUEST_WORDS[rank]} promotion quest`;
        const difficulty = q ? questDifficulty(q) : rankDifficulty(rank);
        p.lastDay = day;
        if (rng() < chance) {
          p.renown += renown * (0.8 + rng() * 0.4);
          p.wins += 1;
          p.last = `Day ${day}: completed ${what}`;
          if (promo) {
            p.rank = rank;
            p.belowSince = 0;
            p.last = `Day ${day}: promoted to ${rank} rank`;
            if (rank === 'S' || rank === 'A' || rank === 'B') news(`${p.name} passed their promotion quest and rose to ${rank} rank.`);
          }
          for (const m of p.members) if (m.level < SIM.maxLevel && rng() < SIM.levelUpChanceOnSuccess * SIM.levelUpFalloff ** (m.level - 1)) m.level += 1;
          const lost = p.members.filter((m) => rng() < SIM.lossChanceOnSuccess * deathFactor(m.level));
          if (lost.length) {
            p.members = p.members.filter((m) => !lost.includes(m));
            p.renown = Math.max(0, p.renown - renownLoss(renown, false, lost.length));
            news(`${p.name} completed ${what}, but ${lost.map((m) => m.name).join(' and ')} did not come back.`);
          }
        } else {
          p.losses += 1;
          const outmatched = Math.max(0, difficulty - avg(p.members.map((m) => m.level)));
          if (rng() < SIM.wipeChanceOnFailure * deathFactor(avg(p.members.map((m) => m.level))) * (1 + outmatched * 0.5)) {
            news(`${p.name} were wiped out on ${what}. (${p.members.map((m) => m.name).join(', ')})`);
            p.members = [];
          } else {
            const lost = p.members.filter((m) => rng() < SIM.lossChanceOnFailure * deathFactor(m.level) * (1 + outmatched * 0.5));
            p.members = p.members.filter((m) => !lost.includes(m));
            p.renown = Math.max(0, p.renown - renownLoss(renown, true, lost.length));
            p.last = `Day ${day}: failed ${what}`;
            news(lost.length
              ? `${p.name} failed ${what} and lost ${lost.map((m) => m.name).join(' and ')}.`
              : `${p.name} failed ${what} and limped home.`);
          }
        }
      }
    }
    // Parties that are too small break up; a lone survivor returns to the guild hall.
    if (p.members.length < 2) {
      g.rivals.splice(g.rivals.indexOf(p), 1);
      if (p.members.length === 1) {
        const m = p.members[0];
        const free = freeAdventurer(m.level, rng);
        free.character.name = m.name;
        free.character.weaponId = m.weaponId;
        g.pool.push(free);
        news(`${p.name} disbanded. ${m.name} is looking for a new party.`);
      }
      continue;
    }
    // Short-handed parties recruit from the hall (leaving some for the player); most like to be 4-5 strong.
    const want = p.members.length < 4 ? 0.3 : p.members.length < 5 ? 0.06 : 0;
    const avgLevel = avg(p.members.map((m) => m.level));
    // Only someone near the party's level, unless it's down to the last two.
    const fits = (a: FreeAdventurer) => p.members.length <= 2 || Math.abs(a.character.level - avgLevel) <= SIM.recruitLevelGap;
    if (g.pool.length > 4 && rng() < want && g.pool.some(fits)) {
      g.pool.sort((a, b) => Math.abs(a.character.level - avgLevel) - Math.abs(b.character.level - avgLevel));
      const a = g.pool.shift()!;
      p.members.push({ name: a.character.name, level: a.character.level, weaponId: a.character.weaponId });
      news(`${a.character.name} joined ${p.name}.`);
    }
  }
  for (const a of state.party) if (a.contract?.type === 'mercenary') people.add(a.name);

  // Newcomers arrive at about the rate adventurers are lost, nudged toward the target headcount.
  const total = adventurerCount(state);
  const nudge = Math.max(0.1, Math.min(4, (SIM.targetAdventurers / Math.max(1, total)) ** 4));
  const arrivals = poisson(expected * nudge, rng);
  for (let i = 0; i < arrivals; i++) {
    const a = freeAdventurer(newcomerLevel(rng), rng, people);
    people.add(a.character.name);
    g.pool.push(a);
    if (a.character.level >= 4) news(`${a.character.name}, a level ${a.character.level} veteran, arrived in ${GUILD.city}.`);
  }

  // Crowded halls form new parties (and there are fewer parties than usual).
  const formChance = g.rivals.length < SIM.targetParties - 1 ? 0.5
    : g.pool.length > SIM.poolTarget * 1.5 && g.rivals.length < SIM.targetParties + 1 ? 0.2 : 0;
  if (g.pool.length >= SIM.poolTarget * 0.6 + 3 && rng() < formChance) {
    const size = Math.min(partySizeRoll(rng), g.pool.length - 3);
    if (size >= SIM.partySize[0]) {
      g.pool.sort(() => rng() - 0.5);
      const founders = g.pool.splice(0, size);
      const name = randomPartyName(rng, new Set(g.rivals.map((p) => p.name)));
      g.rivals.push({
        id: newId('p'), name, rank: 'D', renown: 0, founded: day, wins: 0, losses: 0, lastDay: 0, last: `Day ${day}: formed`,
        members: founders.map((a) => ({ name: a.character.name, level: a.character.level, weaponId: a.character.weaponId })),
      });
      news(`A new party registered: ${name} (${founders.map((a) => a.character.name).join(', ')}).`);
    }
  }
  // An overfull hall drifts away to other cities.
  while (g.pool.length > SIM.poolTarget * 1.5) g.pool.splice(Math.floor(rng() * g.pool.length), 1);

  // Patience recovers overnight.
  for (const a of g.pool) a.patience = Math.min(GUILD.companion.patience, a.patience + 1);
  g.news = g.news.slice(-80);
}
