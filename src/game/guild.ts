// The Adventurer Guild of Arch City: rival parties, the leaderboard and ranks, and the
// day-by-day simulation of the other adventurers. Pure logic (no Phaser).
import { WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import { RANKS, type FreeAdventurer, type GameState, type GuildState, type Rank, type RivalMember, type RivalParty } from '../data/types';
import { newId, type Rng } from './character';
import { randInt, randomAdventurer, randomName, randomPartyName } from './people';

const SIM = GUILD.simulation;
export const PLAYER_ID = 'player';

/** How many of `n` parties hold each rank (top 5% A, 20% B, 60% C, 15% D by default). */
export function rankCounts(n: number): Record<Rank, number> {
  const s = GUILD.rankShares;
  const A = n > 0 ? Math.max(1, Math.round(n * s.A)) : 0;
  const B = Math.min(n - A, Math.round(n * s.B));
  const D = Math.min(n - A - B, Math.round(n * s.D));
  return { A, B, C: n - A - B - D, D };
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

/** All parties (the player's included), best first, with the rank their position gives them. */
export function leaderboard(state: GameState): BoardEntry[] {
  const fighters = state.party.filter((c) => c.contract?.type !== 'mercenary');
  const entries: Omit<BoardEntry, 'rank'>[] = [
    ...state.guild.rivals.map((p) => ({
      id: p.id, name: p.name, renown: p.renown, members: p.members.length, avgLevel: avg(p.members.map((m) => m.level)),
      wins: p.wins, losses: p.losses, last: p.last, isPlayer: false,
    })),
    {
      id: PLAYER_ID, name: state.partyName, renown: state.renown, members: fighters.length, avgLevel: avg(fighters.map((c) => c.level)),
      wins: state.progress.victories, losses: state.progress.defeats, last: '', isPlayer: true,
    },
  ];
  // Ties go to the player's rivals (the guild trusts a known name), then by name for stability.
  entries.sort((a, b) => b.renown - a.renown || Number(a.isPlayer) - Number(b.isPlayer) || a.name.localeCompare(b.name));
  const counts = rankCounts(entries.length);
  const out: BoardEntry[] = [];
  let i = 0;
  for (const rank of RANKS) for (let k = 0; k < counts[rank]; k++, i++) out.push({ ...entries[i], rank });
  return out;
}

/** Re-rank everyone from the leaderboard. Returns news about rank changes. */
export function updateRanks(state: GameState): { player?: { from: Rank; to: Rank }; news: string[] } {
  const board = leaderboard(state);
  const news: string[] = [];
  let player: { from: Rank; to: Rank } | undefined;
  for (const e of board) {
    if (e.isPlayer) {
      if (e.rank !== state.rank) player = { from: state.rank, to: e.rank };
      state.rank = e.rank;
      continue;
    }
    const p = state.guild.rivals.find((r) => r.id === e.id)!;
    if (p.rank !== e.rank) {
      const up = RANKS.indexOf(e.rank) < RANKS.indexOf(p.rank);
      if (up && (e.rank === 'A' || e.rank === 'B')) news.push(`${p.name} rose to ${e.rank} rank.`);
      p.rank = e.rank;
    }
  }
  return { player, news };
}

/** Typical member level of a party at each rank when the world is made. */
const LEVELS_BY_RANK: Record<Rank, [number, number]> = { A: [7, 9], B: [5, 7], C: [2, 5], D: [1, 2] };
const RENOWN_BY_RANK: Record<Rank, [number, number]> = { A: [1300, 1800], B: [500, 800], C: [130, 380], D: [30, 110] };

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
  return rng() < 0.12 ? randInt(4, 7, rng) : randInt(1, 3, rng);
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

/** A rival party's chance to complete a quest of a rank. */
export function rivalSuccessChance(p: RivalParty, rank: Rank): number {
  const power = avg(p.members.map((m) => m.level)) + 0.25 * (p.members.length - 4);
  return Math.max(0.1, Math.min(0.95, 0.55 + SIM.successPerLevel * (power - SIM.rankDifficulty[rank])));
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
    const fail = (1 - ps) * (SIM.wipeChanceOnFailure * size + (1 - SIM.wipeChanceOnFailure) * SIM.lossChanceOnFailure * size);
    e += SIM.questChancePerDay * (ps * SIM.lossChanceOnSuccess * size + fail) + SIM.retireChancePerDay * size;
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

const QUEST_WORDS: Record<Rank, string> = { A: 'an A-rank', B: 'a B-rank', C: 'a C-rank', D: 'a D-rank' };

/** One day in the life of the guild's other adventurers. Adds news to the guild. */
export function simulateGuildDay(state: GameState, rng: Rng): void {
  const g = state.guild;
  const day = state.day;
  const news = (text: string) => g.news.push({ day, text });
  const people = new Set<string>([...g.rivals.flatMap((p) => p.members.map((m) => m.name)), ...g.pool.map((a) => a.character.name)]);
  const expected = expectedDailyLosses(state);

  for (const p of [...g.rivals]) {
    // Fame fades: the leaderboard follows recent success.
    p.renown *= 1 - GUILD.renownDecayPerDay;
    // Retirement.
    p.members = p.members.filter((m) => {
      if (rng() >= SIM.retireChancePerDay) return true;
      news(`${m.name} of ${p.name} retired from adventuring.`);
      return false;
    });
    if (p.members.length > 0 && rng() < SIM.questChancePerDay) {
      const rank = rivalQuestRank(p, rng);
      const chance = rivalSuccessChance(p, rank);
      p.lastDay = day;
      if (rng() < chance) {
        const tier = GUILD.quests[rank];
        p.renown += tier.renown * (0.8 + rng() * 0.4);
        p.wins += 1;
        p.last = `Day ${day}: completed ${QUEST_WORDS[rank]} quest`;
        for (const m of p.members) if (m.level < SIM.maxLevel && rng() < SIM.levelUpChanceOnSuccess) m.level += 1;
        const lost = p.members.filter(() => rng() < SIM.lossChanceOnSuccess);
        if (lost.length) {
          p.members = p.members.filter((m) => !lost.includes(m));
          news(`${p.name} completed ${QUEST_WORDS[rank]} quest, but ${lost.map((m) => m.name).join(' and ')} did not come back.`);
        }
      } else {
        p.losses += 1;
        const outmatched = Math.max(0, SIM.rankDifficulty[rank] - avg(p.members.map((m) => m.level)));
        if (rng() < SIM.wipeChanceOnFailure * (1 + outmatched * 0.5)) {
          news(`${p.name} were wiped out on ${QUEST_WORDS[rank]} quest. (${p.members.map((m) => m.name).join(', ')})`);
          p.members = [];
        } else {
          const lost = p.members.filter(() => rng() < SIM.lossChanceOnFailure * (1 + outmatched * 0.5));
          p.members = p.members.filter((m) => !lost.includes(m));
          p.last = `Day ${day}: failed ${QUEST_WORDS[rank]} quest`;
          news(lost.length
            ? `${p.name} failed ${QUEST_WORDS[rank]} quest and lost ${lost.map((m) => m.name).join(' and ')}.`
            : `${p.name} failed ${QUEST_WORDS[rank]} quest and limped home.`);
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
    if (g.pool.length > 4 && rng() < want) {
      const avgLevel = avg(p.members.map((m) => m.level));
      g.pool.sort((a, b) => Math.abs(a.character.level - avgLevel) - Math.abs(b.character.level - avgLevel));
      const a = g.pool.shift()!;
      p.members.push({ name: a.character.name, level: a.character.level, weaponId: a.character.weaponId });
      news(`${a.character.name} joined ${p.name}.`);
    }
  }
  for (const a of state.party) if (a.contract?.type === 'mercenary') people.add(a.name);

  // Newcomers arrive at about the rate adventurers are lost, nudged toward the target headcount.
  const total = adventurerCount(state);
  const nudge = Math.max(0.25, Math.min(4, (SIM.targetAdventurers / Math.max(1, total)) ** 2));
  const arrivals = poisson(expected * nudge, rng);
  for (let i = 0; i < arrivals; i++) {
    const a = freeAdventurer(newcomerLevel(rng), rng, people);
    people.add(a.character.name);
    g.pool.push(a);
    if (a.character.level >= 4) news(`${a.character.name}, a level ${a.character.level} veteran, arrived in ${GUILD.city}.`);
  }

  // Crowded halls form new parties (and there are fewer parties than usual).
  const formChance = g.rivals.length < SIM.targetParties - 1 ? 0.5
    : g.pool.length > SIM.poolTarget * 1.5 && g.rivals.length < SIM.targetParties + 2 ? 0.2 : 0;
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
  while (g.pool.length > SIM.poolTarget * 2) g.pool.splice(Math.floor(rng() * g.pool.length), 1);

  // Patience recovers overnight.
  for (const a of g.pool) a.patience = Math.min(GUILD.companion.patience, a.patience + 1);
  g.news = g.news.slice(-80);
}
