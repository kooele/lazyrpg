// Loads src/data/guild.json (management and simulation numbers) and checks every field.
import raw from './guild.json';
import { RANKS, type Rank } from './types';

export interface QuestTier {
  stages: [number, number];
  reward: [number, number];
  renown: number;
  days: [number, number];
}

export type InnTier = 'standard' | 'luxury';
export const INN_TIERS: readonly InnTier[] = ['standard', 'luxury'];
export interface InnConfig {
  name: string;
  pricePerPerson: number;
  relationshipPerNight: number;
}

export interface GuildConfig {
  city: string;
  startingGold: number;
  startingRenown: number;
  maxRoster: number;
  rankShares: Record<Rank, number>;
  renownDecayPerDay: number;
  boardSize: number;
  quests: Record<Rank, QuestTier>;
  upkeep: { foodLodgingPerDay: number };
  inns: Record<InnTier, InnConfig>;
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
      relationshipPerNight: num(inn.relationshipPerNight, `inns.${t}.relationshipPerNight`, 0, 100),
    };
  }
  return out;
}

export function parseGuildConfig(data: unknown): GuildConfig {
  const d = obj(data, '(root)');
  const rankShares = perRank(d.rankShares, 'rankShares', 1);
  const total = RANKS.reduce((s, r) => s + rankShares[r], 0);
  if (Math.abs(total - 1) > 0.001) fail('rankShares', `must add up to 1 (they add up to ${total})`);
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
    rankShares,
    renownDecayPerDay: num(d.renownDecayPerDay, 'renownDecayPerDay', 0, 1),
    boardSize: num(d.boardSize, 'boardSize', 1, 20),
    quests,
    upkeep: numbers(d.upkeep, 'upkeep', ['foodLodgingPerDay']),
    inns: parseInns(d.inns),
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
          'lossChanceOnFailure', 'wipeChanceOnFailure', 'levelUpChanceOnSuccess', 'retireChancePerDay', 'maxLevel']),
      partySize: range(s.partySize, 'simulation.partySize', 1),
      rankDifficulty: perRank(s.rankDifficulty, 'simulation.rankDifficulty'),
    },
  };
}

export const GUILD: GuildConfig = parseGuildConfig(raw);
