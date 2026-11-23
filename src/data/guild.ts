// Loads src/data/guild.json (management and simulation numbers) and checks every field.
import raw from './guild.json';
import { RANKS, type Rank } from './types';

export interface QuestTier {
  stages: [number, number];
  reward: [number, number];
  renown: number;
  days: [number, number];
}

export type InnTier = 'standard' | 'highEnd' | 'luxury';
export const INN_TIERS: readonly InnTier[] = ['standard', 'highEnd', 'luxury'];
/** City rings (where residences are). */
export type Ring = 'outer' | 'middle' | 'inner';
export const RINGS: readonly Ring[] = ['outer', 'middle', 'inner'];
export interface InnConfig {
  name: string;
  pricePerPerson: number;
  /** A round of drinks for the party: gold per member, and Morale for everyone. */
  drinksPerPerson: number;
  drinksMorale: number;
}

/** Where the party spends a night: an inn, a residence (by ring), outside (free), or on the road during a quest. */
export type Lodging = InnTier | Ring | 'outside' | 'road';
/** A night in the city (not on the road). */
export type CityLodging = Exclude<Lodging, 'road'>;
/** Night quality (for adventurers' expectations): outside 0, then each ring's inn or residence 1-3. */
export const LODGING_QUALITY: Record<CityLodging, number> = { outside: 0, standard: 1, outer: 1, highEnd: 2, middle: 2, luxury: 3, inner: 3 };
export const isResidence = (l: Lodging): l is Ring => (RINGS as readonly string[]).includes(l);

export type Activity = 'recover' | 'training' | 'oddJobs' | 'dayOff';
export const ACTIVITIES: readonly Activity[] = ['recover', 'training', 'oddJobs', 'dayOff'];

export interface GuildConfig {
  city: string;
  startingGold: number;
  startingRenown: number;
  maxRoster: number;
  startingRankShares: Record<Rank, number>;
  ranks: { renown: Record<Exclude<Rank, 'D'>, number>; demotionDays: number; failedQuestRenown: number; deathRenown: number };
  /** First level of each adventurer rank above D. */
  adventurerRanks: Record<'C' | 'B' | 'A' | 'S', number>;
  boardSize: number;
  quests: Record<Rank, QuestTier>;
  upkeep: { foodLodgingPerDay: number };
  inns: Record<InnTier, InnConfig>;
  lodging: { expectedQuality: Record<'S' | Rank, number>; relationshipAbove: number; relationshipBelowPerStep: number; outsidePerPerson: number };
  residences: Record<Ring, { name: string; price: number }>;
  condition: {
    maxHealthLoss: number;
    healthPerDay: number;
    lowMorale: number;
    lowMoraleRelationshipPerDay: number;
    startingMorale: number;
    moralePerQuest: number;
    moraleFailedQuest: number;
    moralePerHealthLost: number;
    moraleMemberDied: number;
  };
  schedule: { recoverMultiplier: number; trainingXp: number; oddJobsGold: number; dayOffMorale: number };
  /** Price multiplier from talent: max(min, 1 + weight x (average growth rate - 1)). */
  talentPrice: { weight: number; min: number };
  mercenary: { feePerLevel: number; cutBase: number; cutPerLevel: number };
  companion: {
    wageBase: number;
    wagePerLevel: number;
    terms: number[];
    termDemand: Record<string, number>;
    expectedWeeklyLoot: Record<Rank, number>;
    patience: number;
    startingRelationship: number;
    relationshipPerQuest: number;
    relationshipUnpaid: number;
    renewalDiscountAtMax: number;
    graceDays: number;
  };
  slave: {
    priceBase: number;
    pricePerLevel: number;
    marketSize: number;
    restockDays: number;
    sellBackShare: number;
    registrationFee: number;
    bountyPerLevel: number;
    captureChance: number;
  };
  simulation: {
    targetAdventurers: number;
    targetParties: number;
    poolTarget: number;
    partySize: [number, number];
    questChancePerDay: number;
    rankDifficulty: Record<Rank, number>;
    successPerLevel: number;
    lossChanceOnSuccess: number;
    lossChanceOnFailure: number;
    wipeChanceOnFailure: number;
    levelUpChanceOnSuccess: number;
    levelUpFalloff: number;
    retireChancePerDay: number;
    maxLevel: number;
  };
}

function fail(path: string, msg: string): never {
  throw new Error(`guild.json: "${path}" ${msg}`);
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object');
  return v as Record<string, unknown>;
}
function num(v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(path, `must be a number from ${min} to ${max}`);
  return v;
}
function range(v: unknown, path: string, min = 0): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) fail(path, 'must be a [min, max] pair');
  const a = num(v[0], `${path}[0]`, min);
  const b = num(v[1], `${path}[1]`, a);
  return [a, b];
}
/** Check that every key of `shape` exists in `v` as a number (or as a nested shape). */
function numbers<T>(v: unknown, path: string, keys: string[], max = Number.MAX_SAFE_INTEGER): T {
  const o = obj(v, path);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = num(o[k], `${path}.${k}`, 0, max);
  return out as T;
}
const perRank = (v: unknown, path: string, max?: number) => numbers<Record<Rank, number>>(v, path, [...RANKS], max);

function parseInns(v: unknown): Record<InnTier, InnConfig> {
  const o = obj(v, 'inns');
  const out = {} as Record<InnTier, InnConfig>;
  for (const t of INN_TIERS) {
    const inn = obj(o[t], `inns.${t}`);
    if (typeof inn.name !== 'string' || !inn.name) fail(`inns.${t}.name`, 'must be a name');
    out[t] = {
      name: inn.name as string,
      pricePerPerson: num(inn.pricePerPerson, `inns.${t}.pricePerPerson`),
      drinksPerPerson: num(inn.drinksPerPerson, `inns.${t}.drinksPerPerson`),
      drinksMorale: num(inn.drinksMorale, `inns.${t}.drinksMorale`, 0, 100),
    };
  }
  return out;
}

function parseResidences(v: unknown): Record<Ring, { name: string; price: number }> {
  const o = obj(v, 'residences');
  const out = {} as Record<Ring, { name: string; price: number }>;
  for (const r of RINGS) {
    const h = obj(o[r], `residences.${r}`);
    if (typeof h.name !== 'string' || !h.name) fail(`residences.${r}.name`, 'must be a name');
    out[r] = { name: h.name as string, price: num(h.price, `residences.${r}.price`) };
  }
  return out;
}

export function parseGuildConfig(data: unknown): GuildConfig {
  const d = obj(data, '(root)');
  const startingRankShares = perRank(d.startingRankShares, 'startingRankShares', 1);
  const total = RANKS.reduce((s, r) => s + startingRankShares[r], 0);
  if (Math.abs(total - 1) > 0.001) fail('startingRankShares', `must add up to 1 (they add up to ${total})`);
  const rk = obj(d.ranks, 'ranks');
  const thresholds = numbers<Record<'C' | 'B' | 'A', number>>(rk.renown, 'ranks.renown', ['C', 'B', 'A']);
  if (!(thresholds.C < thresholds.B && thresholds.B < thresholds.A)) fail('ranks.renown', 'must grow from C to B to A');
  const advRanks = numbers<Record<'C' | 'B' | 'A' | 'S', number>>(d.adventurerRanks, 'adventurerRanks', ['C', 'B', 'A', 'S']);
  if (!(1 < advRanks.C && advRanks.C < advRanks.B && advRanks.B < advRanks.A && advRanks.A < advRanks.S)) fail('adventurerRanks', 'must grow from C to B to A to S (and C above 1)');
  const q = obj(d.quests, 'quests');
  const quests = {} as Record<Rank, QuestTier>;
  for (const r of RANKS) {
    const t = obj(q[r], `quests.${r}`);
    quests[r] = {
      stages: range(t.stages, `quests.${r}.stages`, 1),
      reward: range(t.reward, `quests.${r}.reward`),
      renown: num(t.renown, `quests.${r}.renown`),
      days: range(t.days, `quests.${r}.days`, 1),
    };
  }
  const c = obj(d.companion, 'companion');
  const terms = Array.isArray(c.terms) && c.terms.length ? c.terms.map((t, i) => num(t, `companion.terms[${i}]`, 1, 520)) : fail('companion.terms', 'must be a non-empty list of week counts');
  const termDemand = obj(c.termDemand, 'companion.termDemand');
  for (const t of terms) num(termDemand[String(t)], `companion.termDemand.${t}`, 0.1, 10);
  const s = obj(d.simulation, 'simulation');
  if (typeof d.city !== 'string' || !d.city) fail('city', 'must be a name');
  return {
    city: d.city,
    startingGold: num(d.startingGold, 'startingGold'),
    startingRenown: num(d.startingRenown, 'startingRenown'),
    maxRoster: num(d.maxRoster, 'maxRoster', 1, 20),
    startingRankShares,
    ranks: {
      renown: thresholds,
      demotionDays: num(rk.demotionDays, 'ranks.demotionDays', 1, 365),
      failedQuestRenown: num(rk.failedQuestRenown, 'ranks.failedQuestRenown', 0, 10),
      deathRenown: num(rk.deathRenown, 'ranks.deathRenown', 0, 10),
    },
    adventurerRanks: advRanks,
    boardSize: num(d.boardSize, 'boardSize', 1, 20),
    quests,
    upkeep: numbers(d.upkeep, 'upkeep', ['foodLodgingPerDay']),
    inns: parseInns(d.inns),
    lodging: {
      ...numbers<Omit<GuildConfig['lodging'], 'expectedQuality'>>(d.lodging, 'lodging', ['relationshipAbove', 'relationshipBelowPerStep', 'outsidePerPerson']),
      expectedQuality: numbers(obj(d.lodging, 'lodging').expectedQuality, 'lodging.expectedQuality', ['S', ...RANKS], 3),
    },
    residences: parseResidences(d.residences),
    condition: numbers<GuildConfig['condition']>(d.condition, 'condition', ['maxHealthLoss', 'healthPerDay', 'startingMorale', 'moralePerQuest',
      'moraleFailedQuest', 'moralePerHealthLost', 'moraleMemberDied', 'lowMorale', 'lowMoraleRelationshipPerDay'], 100),
    schedule: numbers(d.schedule, 'schedule', ['recoverMultiplier', 'trainingXp', 'oddJobsGold', 'dayOffMorale']),
    talentPrice: numbers(d.talentPrice ?? { weight: 2, min: 0.4 }, 'talentPrice', ['weight', 'min']),
    mercenary: numbers(d.mercenary, 'mercenary', ['feePerLevel', 'cutBase', 'cutPerLevel']),
    companion: {
      ...numbers<Omit<GuildConfig['companion'], 'terms' | 'termDemand' | 'expectedWeeklyLoot' | 'relationshipUnpaid'>>(c, 'companion',
        ['wageBase', 'wagePerLevel', 'patience', 'startingRelationship', 'relationshipPerQuest', 'renewalDiscountAtMax', 'graceDays']),
      relationshipUnpaid: num(c.relationshipUnpaid, 'companion.relationshipUnpaid', -100, 0),
      terms,
      termDemand: termDemand as Record<string, number>,
      expectedWeeklyLoot: perRank(c.expectedWeeklyLoot, 'companion.expectedWeeklyLoot'),
    },
    slave: numbers(d.slave, 'slave', ['priceBase', 'pricePerLevel', 'marketSize', 'restockDays', 'sellBackShare', 'registrationFee', 'bountyPerLevel', 'captureChance']),
    simulation: {
      ...numbers<Omit<GuildConfig['simulation'], 'partySize' | 'rankDifficulty'>>(s, 'simulation',
        ['targetAdventurers', 'targetParties', 'poolTarget', 'questChancePerDay', 'successPerLevel', 'lossChanceOnSuccess',
          'lossChanceOnFailure', 'wipeChanceOnFailure', 'levelUpChanceOnSuccess', 'levelUpFalloff', 'retireChancePerDay', 'maxLevel']),
      partySize: range(s.partySize, 'simulation.partySize', 1),
      rankDifficulty: perRank(s.rankDifficulty, 'simulation.rankDifficulty'),
    },
  };
}

export const GUILD: GuildConfig = parseGuildConfig(raw);
