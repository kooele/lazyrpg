// Loads src/data/guild.json (management and simulation numbers) and checks every field.
import raw from './guild.json';
import { RANKS, type Rank } from './types';

export interface QuestTier {
  /** Enemy level range. */
  stages: [number, number];
  /** Enemy group size range, in threat points (enemies.json threat per unit). */
  count: [number, number];
  days: [number, number];
}

/** How a quest's total threat (count x strength at its level) turns into gold, renown and difficulty. */
export interface ThreatConfig {
  strengthAtLevel1: number;
  strengthGrowth: number;
  goldPerThreat: number;
  /** Renown for a quest: a x skulls^2 + b x skulls + c (skulls: its danger, 0.5-10). */
  renown: { a: number; b: number; c: number };
  /** Renown x (1 + renownPayFactor x (1 - pay roll)): low-paying quests earn more renown, high-paying ones less. */
  renownPayFactor: number;
  standardCount: number;
  /** Difficulty shown as half a skull (from) and ten skulls (to); evenly in between. */
  skulls: { from: number; to: number };
}

export type InnTier = 'standard' | 'highEnd' | 'luxury';
export const INN_TIERS: readonly InnTier[] = ['standard', 'highEnd', 'luxury'];
/** Residences, cheapest first (ids kept from when the city had three rings: 'outer' is in the Outer City, 'middle' and 'inner' in the Inner City). */
export type Ring = 'outer' | 'middle' | 'inner';
export const RINGS: readonly Ring[] = ['outer', 'middle', 'inner'];
export interface InnConfig {
  name: string;
  pricePerPerson: number;
  /** A round of drinks for the party: gold per member, and Morale for everyone. */
  drinksPerPerson: number;
  drinksMorale: number;
}

/** Where a member spends a night: an inn, a residence (by ring), the stables ('outside', kept for saves), or on the road during a quest. */
export type Lodging = InnTier | Ring | 'outside' | 'road';
/** A night in the city (not on the road). */
export type CityLodging = Exclude<Lodging, 'road'>;
/** Night quality (for adventurers' expectations): the stables 0, then each inn or residence 1-3. */
export const LODGING_QUALITY: Record<CityLodging, number> = { outside: 0, standard: 1, outer: 1, highEnd: 2, middle: 2, luxury: 3, inner: 3 };
export const isResidence = (l: Lodging): l is Ring => (RINGS as readonly string[]).includes(l);

/** Food tiers, worst first: a tier's quality is its index (poor 0 ... luxury 3), compared like lodging quality. */
export type FoodTier = 'poor' | 'common' | 'fine' | 'luxury';
export const FOOD_TIERS: readonly FoodTier[] = ['poor', 'common', 'fine', 'luxury'];
export const foodQuality = (t: FoodTier) => FOOD_TIERS.indexOf(t);

export type Activity = 'recover' | 'training' | 'oddJobs' | 'dayOff';
export const ACTIVITIES: readonly Activity[] = ['dayOff', 'recover', 'training', 'oddJobs'];

export interface GuildConfig {
  city: string;
  startingGold: number;
  startingRenown: number;
  maxRoster: number;
  partyRankWeights: Record<Rank, number>;
  ranks: { renown: Record<Exclude<Rank, 'D'>, number>; highestPromotion: Rank; demotionDays: number; failedQuestRenown: number; deathRenown: number; quitRenownPerLevel: number };
  /** First level of each adventurer rank above D. */
  adventurerRanks: Record<'C' | 'B' | 'A' | 'S', number>;
  boardSize: number;
  board: { maxPostsPerDay: number; rankWeights: Record<Rank, number>; pay: [number, number] };
  quests: Record<Rank, QuestTier>;
  threat: ThreatConfig;
  food: Record<FoodTier, { name: string; pricePerPerson: number }> & { default: FoodTier; moraleAbovePerStep: number; moraleBelowPerStep: number };
  inns: Record<InnTier, InnConfig>;
  lodging: {
    /** Food and night quality adventurers expect (slaves: slaveExpectedQuality). */
    expectedQuality: number;
    slaveExpectedQuality: number;
    /** Where members nobody has placed sleep: the stables ('outside') or an inn. */
    adventurerDefault: 'outside' | InnTier;
    slaveDefault: 'outside' | InnTier;
    moraleAbovePerStep: number;
    moraleBelowPerStep: number;
    stablesPerPerson: number;
  };
  residences: Record<Ring, { name: string; price: number }> & { sellShare: number; capacity: number };
  condition: {
    maxHealthLoss: number;
    healthPerDay: number;
    lowMorale: number;
    lowMoraleRelationshipPerDay: number;
    /** Above this Morale, companions and slaves gain highMoraleRelationshipPerDay relationship a day. */
    highMorale: number;
    highMoraleRelationshipPerDay: number;
    startingMorale: number;
    moralePerTurn: number;
    moraleFailedQuest: number;
    moralePerHealthLost: number;
    moraleMemberDied: number;
  };
  combat: { percentPer5: number };
  market: {
    stock: [number, number];
    shipmentWeekdays: number[];
    shipmentSize: [number, number];
    dailySales: [number, number];
    priceIndex: [number, number];
    drift: number;
    stockReference: number;
  };
  /** Quest XP: each member gets a day of training XP plus an equal share of the pool (a x skulls^2 + b x skulls + c). */
  xp: { pool: { a: number; b: number; c: number } };
  /** trainingXp: XP for a day of training, perLevel x level + flat (see trainingXp()). */
  schedule: { recoverMultiplier: number; trainingXp: { perLevel: number; flat: number }; oddJobsGold: number; dayOffMorale: number };
  /** Price multiplier from talent: max(min, 1 + weight x (average growth rate - 1)). */
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
    /** Releasing a companion early pays them the larger of releaseMinWeeks of their compensation and releaseShareOfRemaining of what the rest of the term is worth. */
    releaseMinWeeks: number;
    releaseShareOfRemaining: number;
  };
  slave: {
    priceBase: number;
    pricePerLevel: number;
    sellBackShare: number;
    bountyPerLevel: number;
    /** An enemy killed on a quest pays this share of a prisoner's bounty (prisoners are harder to take). */
    killBountyShare: number;
    /** Weekly property tax per slave: this share of its normal market value. */
    weeklyTaxShare: number;
    obedienceMarket: [number, number];
    obedienceCaptive: [number, number];
    startingRelationship: number;
    obedienceRiseFrom: number;
    obedienceFallBelow: number;
    obedienceChangePerDay: number;
    punishObedience: number;
    punishRelationship: number;
  };
  simulation: {
    targetAdventurers: number;
    targetParties: number;
    poolTarget: number;
    partySize: [number, number];
    questChancePerDay: number;
    successPerLevel: number;
    lossChanceOnSuccess: number;
    lossChanceOnFailure: number;
    wipeChanceOnFailure: number;
    levelUpChanceOnSuccess: number;
    levelUpFalloff: number;
    deathLevelFalloff: number;
    minDeathFactor: number;
    recruitLevelGap: number;
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

/** A default lodging: the stables ('outside') or an inn tier (residences can't be a default: the party may not own one). */
function defaultLodging(v: unknown, path: string): 'outside' | InnTier {
  if (v === 'outside' || (INN_TIERS as readonly unknown[]).includes(v)) return v as 'outside' | InnTier;
  return fail(path, `must be "outside" or one of ${INN_TIERS.join(', ')} (got ${JSON.stringify(v)})`);
}

function parseFood(v: unknown): GuildConfig['food'] {
  const o = obj(v, 'food');
  const out = {
    moraleAbovePerStep: num(o.moraleAbovePerStep, 'food.moraleAbovePerStep', 0, 100),
    moraleBelowPerStep: num(o.moraleBelowPerStep, 'food.moraleBelowPerStep', 0, 100),
  } as GuildConfig['food'];
  for (const t of FOOD_TIERS) {
    const f = obj(o[t], `food.${t}`);
    if (typeof f.name !== 'string' || !f.name) fail(`food.${t}.name`, 'must be a name');
    out[t] = { name: f.name as string, pricePerPerson: num(f.pricePerPerson, `food.${t}.pricePerPerson`) };
  }
  if (!(FOOD_TIERS as readonly unknown[]).includes(o.default)) fail('food.default', `must be one of: ${FOOD_TIERS.join(', ')}`);
  out.default = o.default as FoodTier;
  return out;
}

function parseResidences(v: unknown): GuildConfig['residences'] {
  const o = obj(v, 'residences');
  const out = { sellShare: num(o.sellShare, 'residences.sellShare', 0, 1), capacity: num(o.capacity ?? 6, 'residences.capacity', 1, 99) } as GuildConfig['residences'];
  for (const r of RINGS) {
    const h = obj(o[r], `residences.${r}`);
    if (typeof h.name !== 'string' || !h.name) fail(`residences.${r}.name`, 'must be a name');
    out[r] = { name: h.name as string, price: num(h.price, `residences.${r}.price`) };
  }
  return out;
}

export function parseGuildConfig(data: unknown): GuildConfig {
  const d = obj(data, '(root)');
  const weights = (v: unknown, path: string) => {
    const w = perRank(v, path);
    if (RANKS.reduce((s, r) => s + w[r], 0) <= 0) fail(path, 'at least one weight must be above 0');
    return w;
  };
  const partyRankWeights = weights(d.partyRankWeights, 'partyRankWeights');
  const rk = obj(d.ranks, 'ranks');
  const thresholds = numbers<Record<'C' | 'B' | 'A' | 'S', number>>(rk.renown, 'ranks.renown', ['C', 'B', 'A', 'S']);
  if (!(thresholds.C < thresholds.B && thresholds.B < thresholds.A && thresholds.A < thresholds.S)) fail('ranks.renown', 'must grow from C to B to A to S');
  const advRanks = numbers<Record<'C' | 'B' | 'A' | 'S', number>>(d.adventurerRanks, 'adventurerRanks', ['C', 'B', 'A', 'S']);
  if (!(1 < advRanks.C && advRanks.C < advRanks.B && advRanks.B < advRanks.A && advRanks.A < advRanks.S)) fail('adventurerRanks', 'must grow from C to B to A to S (and C above 1)');
  const q = obj(d.quests, 'quests');
  const quests = {} as Record<Rank, QuestTier>;
  for (const r of RANKS) {
    const t = obj(q[r], `quests.${r}`);
    quests[r] = {
      stages: range(t.stages, `quests.${r}.stages`, 1),
      count: range(t.count, `quests.${r}.count`, 0.5),
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
    partyRankWeights,
    ranks: {
      renown: thresholds,
      highestPromotion: (() => {
        const r = rk.highestPromotion ?? 'S';
        if (typeof r !== 'string' || !RANKS.includes(r as Rank)) fail('ranks.highestPromotion', 'must be a rank (D to S)');
        return r as Rank;
      })(),
      demotionDays: num(rk.demotionDays, 'ranks.demotionDays', 1, 365),
      failedQuestRenown: num(rk.failedQuestRenown, 'ranks.failedQuestRenown', 0, 10),
      deathRenown: num(rk.deathRenown, 'ranks.deathRenown', 0, 10),
      quitRenownPerLevel: num(rk.quitRenownPerLevel, 'ranks.quitRenownPerLevel', 0, 1000),
    },
    adventurerRanks: advRanks,
    boardSize: num(d.boardSize, 'boardSize', 1, 60),
    board: (() => {
      const b = obj(d.board, 'board');
      return {
        maxPostsPerDay: num(b.maxPostsPerDay, 'board.maxPostsPerDay', 1, 60),
        rankWeights: weights(b.rankWeights, 'board.rankWeights'),
        pay: range(b.pay, 'board.pay', 0.1),
      };
    })(),
    quests,
    threat: (() => {
      const t = obj(d.threat, 'threat');
      return {
        strengthAtLevel1: num(t.strengthAtLevel1, 'threat.strengthAtLevel1', 0.01),
        strengthGrowth: num(t.strengthGrowth, 'threat.strengthGrowth', 1, 3),
        goldPerThreat: num(t.goldPerThreat, 'threat.goldPerThreat', 0),
        renown: numbers(t.renown, 'threat.renown', ['a', 'b', 'c']),
        renownPayFactor: num(t.renownPayFactor, 'threat.renownPayFactor', 0, 10),
        standardCount: num(t.standardCount, 'threat.standardCount', 0.5),
        skulls: (() => {
          const k = obj(t.skulls, 'threat.skulls');
          const from = num(k.from, 'threat.skulls.from', -100);
          const to = num(k.to, 'threat.skulls.to', -100);
          if (!(to > from)) fail('threat.skulls.to', 'must be above threat.skulls.from');
          return { from, to };
        })(),
      };
    })(),
    food: parseFood(d.food),
    inns: parseInns(d.inns),
    lodging: {
      ...numbers<Pick<GuildConfig['lodging'], 'moraleAbovePerStep' | 'moraleBelowPerStep' | 'stablesPerPerson'>>(d.lodging, 'lodging', ['moraleAbovePerStep', 'moraleBelowPerStep', 'stablesPerPerson']),
      expectedQuality: num(obj(d.lodging, 'lodging').expectedQuality, 'lodging.expectedQuality', 0, 3),
      slaveExpectedQuality: num(obj(d.lodging, 'lodging').slaveExpectedQuality ?? 0, 'lodging.slaveExpectedQuality', 0, 3),
      adventurerDefault: defaultLodging(obj(d.lodging, 'lodging').adventurerDefault, 'lodging.adventurerDefault'),
      slaveDefault: defaultLodging(obj(d.lodging, 'lodging').slaveDefault, 'lodging.slaveDefault'),
    },
    residences: parseResidences(d.residences),
    condition: numbers<GuildConfig['condition']>(d.condition, 'condition', ['maxHealthLoss', 'healthPerDay', 'startingMorale', 'moralePerTurn',
      'moraleFailedQuest', 'moralePerHealthLost', 'moraleMemberDied', 'lowMorale', 'lowMoraleRelationshipPerDay', 'highMorale', 'highMoraleRelationshipPerDay'], 100),
    xp: {
      pool: numbers(obj(d.xp, 'xp').pool, 'xp.pool', ['a', 'b', 'c']),
    },
    schedule: {
      ...numbers<Omit<GuildConfig['schedule'], 'trainingXp'>>(d.schedule, 'schedule', ['recoverMultiplier', 'oddJobsGold', 'dayOffMorale']),
      trainingXp: numbers(obj(d.schedule, 'schedule').trainingXp, 'schedule.trainingXp', ['perLevel', 'flat']),
    },
    mercenary: numbers(d.mercenary, 'mercenary', ['feePerLevel', 'cutBase', 'cutPerLevel']),
    companion: {
      ...numbers<Omit<GuildConfig['companion'], 'terms' | 'termDemand' | 'expectedWeeklyLoot' | 'relationshipUnpaid'>>(c, 'companion',
        ['wageBase', 'wagePerLevel', 'patience', 'startingRelationship', 'relationshipPerQuest', 'renewalDiscountAtMax', 'graceDays', 'releaseMinWeeks', 'releaseShareOfRemaining']),
      relationshipUnpaid: num(c.relationshipUnpaid, 'companion.relationshipUnpaid', -100, 0),
      terms,
      termDemand: termDemand as Record<string, number>,
      expectedWeeklyLoot: perRank(c.expectedWeeklyLoot, 'companion.expectedWeeklyLoot'),
    },
    slave: {
      ...numbers<Omit<GuildConfig['slave'], 'obedienceMarket' | 'obedienceCaptive'>>(d.slave, 'slave', ['priceBase', 'pricePerLevel',
        'sellBackShare', 'bountyPerLevel', 'killBountyShare', 'weeklyTaxShare', 'startingRelationship', 'obedienceRiseFrom', 'obedienceFallBelow',
        'obedienceChangePerDay', 'punishObedience', 'punishRelationship']),
      obedienceMarket: range(obj(d.slave, 'slave').obedienceMarket, 'slave.obedienceMarket'),
      obedienceCaptive: range(obj(d.slave, 'slave').obedienceCaptive, 'slave.obedienceCaptive'),
    },
    combat: numbers(d.combat, 'combat', ['percentPer5'], 20),
    market: (() => {
      const m = obj(d.market, 'market');
      const days = Array.isArray(m.shipmentWeekdays) && m.shipmentWeekdays.length
        ? m.shipmentWeekdays.map((v, i) => num(v, `market.shipmentWeekdays[${i}]`, 0, 6)) : fail('market.shipmentWeekdays', 'must list days of the week (0-6)');
      return {
        stock: range(m.stock, 'market.stock'),
        shipmentWeekdays: days,
        shipmentSize: range(m.shipmentSize, 'market.shipmentSize'),
        dailySales: range(m.dailySales, 'market.dailySales'),
        priceIndex: range(m.priceIndex, 'market.priceIndex', 0.01),
        drift: num(m.drift, 'market.drift', 0, 1),
        stockReference: num(m.stockReference, 'market.stockReference', 1),
      };
    })(),
    simulation: {
      ...numbers<Omit<GuildConfig['simulation'], 'partySize'>>(s, 'simulation',
        ['targetAdventurers', 'targetParties', 'poolTarget', 'questChancePerDay', 'successPerLevel', 'lossChanceOnSuccess',
          'lossChanceOnFailure', 'wipeChanceOnFailure', 'levelUpChanceOnSuccess', 'levelUpFalloff', 'deathLevelFalloff', 'minDeathFactor', 'recruitLevelGap', 'retireChancePerDay', 'maxLevel']),
      partySize: range(s.partySize, 'simulation.partySize', 1),
    },
  };
}

export const GUILD: GuildConfig = parseGuildConfig(raw);

/** XP for a day of training at `level`: schedule.trainingXp perLevel x level + flat (22 at level 1). */
export const trainingXp = (level: number) => {
  const { perLevel, flat } = GUILD.schedule.trainingXp;
  return Math.round(perLevel * Math.max(1, level) + flat);
};
