// Save / load. Saves are pretty-printed JSON so players can read (and edit!) them.
import { ARMORS, MAX_PARTY_SIZE, NAME_MAX_LENGTH, QUALITIES, SKILLS, TREE_SKILLS, WEAPONS, WEAPON_TYPES, skillPointsForLevel, maxBodyRank } from '../data/content';
import { ACTIVITIES, FOOD_TIERS, GUILD, type Activity, type FoodTier } from '../data/guild';
import { ENEMIES } from '../data/enemies';
import {
  BODY_MODELS, ENEMY_MODELS, FACE_COUNT, HAIR_COLORS, HAIR_STYLES, GEAR_KINDS, ITEM_KINDS, RANKS, SEXES, SKIN_TONES, STAT_KEYS, TALENT_GRADES, TRAIT_IDS,
  type BodyInvestment, type Character, type Gear, type Item, type SmithyOrder, type StatKey, type Talents, type Contract, type GameState, type Look, type NewsItem, type Offer, type Quest, type QuestTab, type Rank, type RivalParty,
} from '../data/types';
import { usualCount } from './board';
import { bodyStats, makeRng, modelFor } from './character';
import { gear } from './gear';
import { newCampaign, tidyLineup } from './city';
import { companionContract, companionDemand, foodLodgingWeekly } from './contracts';
import { lookFromModel } from './people';

export const SAVE_FORMAT = 'lazyrpg-save';
/**
 * v1: class + attribute points. v2: classless Adventurers with weapon + skill-tree picks. v3: Arch City (contracts, guild, calendar).
 * v4: equipment (weapon and armor with a quality, in place of a weapon id); older characters are converted on load.
 */
export const SAVE_VERSION = 4;
export const SLOT_COUNT = 3;
const SLOT_KEY_PREFIX = 'lazyrpg.save.slot';
export const PARTY_NAME_MAX_LENGTH = 28;

export interface SaveFile extends GameState {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
}

export type ParseResult = { ok: true; state: GameState; savedAt: string } | { ok: false; error: string };

export function serializeSave(state: GameState, now = new Date()): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: now.toISOString(), ...state };
  return JSON.stringify(file, null, 2);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isNum(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Thrown by validators; the message names the exact field. */
class SaveError extends Error {}
const bad = (path: string, msg: string): never => {
  throw new SaveError(`${path} ${msg}`);
};
const int = (v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER) => (isInt(v, min, max) ? v : bad(path, `must be a whole number from ${min}${max < Number.MAX_SAFE_INTEGER ? ` to ${max}` : ' up'}`));
const num = (v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER) => (isNum(v, min, max) ? v : bad(path, `must be a number from ${min}${max < Number.MAX_SAFE_INTEGER ? ` to ${max}` : ' up'}`));
const str = (v: unknown, path: string, max = 200) => (typeof v === 'string' && v.trim() && v.length <= max ? v : bad(path, `must be a non-empty string of at most ${max} characters`));
const obj = (v: unknown, path: string) => (isObj(v) ? v : bad(path, 'must be an object'));
const arr = (v: unknown, path: string) => (Array.isArray(v) ? v : bad(path, 'must be an array'));
function oneOf<T extends string>(v: unknown, list: readonly T[], path: string): T {
  return (list as readonly unknown[]).includes(v) ? (v as T) : bad(path, `must be one of: ${list.join(', ')}`);
}

/** Convert a version-1 character (fixed classes) to the classless format. */
const V1_CLASS_LOADOUT: Record<string, { weaponId: string; skillIds: string[] }> = {
  knight: { weaponId: 'sword_shield', skillIds: ['charge', 'kick'] },
  ranger: { weaponId: 'bow', skillIds: ['execute', 'kick'] },
  mage: { weaponId: 'staff', skillIds: ['fireball', 'arcane_bolt'] },
  cleric: { weaponId: 'staff', skillIds: ['heal', 'cleanse'] },
};

function migrateV1Character(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const loadout = V1_CLASS_LOADOUT[String(raw.classId)] ?? V1_CLASS_LOADOUT.knight;
  const { classId: _c, attributes: _a, unspentPoints: _u, ...rest } = raw;
  return { ...rest, weaponId: loadout.weaponId, skillIds: loadout.skillIds };
}

/** Weapons of older saves, by their old id (the bow became the Longbow). */
const OLD_WEAPONS: Record<string, string> = { sword_shield: 'sword_shield', spear: 'spear', staff: 'staff', bow: 'longbow' };
/** A weapon type from an older save or a rival party (unknown ones become the first weapon). */
const weaponFromOld = (id: unknown) => OLD_WEAPONS[String(id)] ?? (WEAPON_TYPES.includes(String(id)) ? String(id) : WEAPON_TYPES[0]);

/** An equipped weapon or armor (null = none). */
function validateGear(raw: unknown, path: string, kind: 'weapon' | 'armor'): Gear | null {
  if (raw === undefined || raw === null) return null;
  const o = obj(raw, path);
  const defs = kind === 'weapon' ? WEAPONS : ARMORS;
  const types = Object.values(defs).filter((d) => !d.builtIn).map((d) => d.id);
  const qualities = Object.values(QUALITIES).filter((q) => !q.enemyOnly).map((q) => q.id);
  return {
    type: oneOf(o.type, types, `${path}.type`), quality: oneOf(o.quality, qualities, `${path}.quality`),
    ...(o.issued === true ? { issued: true } : {}),
  };
}

/** Orders at the Smithy (older saves have none). */
function validateOrders(raw: unknown, day: unknown): SmithyOrder[] {
  if (raw === undefined) return [];
  return arr(raw, 'smithyOrders').map((r, i) => {
    const path = `smithyOrders[${i}]`;
    const o = obj(r, path);
    const kind = oneOf(o.kind, GEAR_KINDS, `${path}.kind`);
    const g = validateGear(o, path, kind)!;
    return {
      id: str(o.id, `${path}.id`, 40), kind, type: g.type, quality: g.quality,
      worked: int(o.worked, `${path}.worked`), paid: int(o.paid, `${path}.paid`), day: int(o.day ?? day, `${path}.day`),
    };
  });
}

/** The party's stash (older saves have none). */
function validateInventory(raw: unknown, field = 'inventory'): Item[] {
  if (raw === undefined) return [];
  const seen = new Set<string>();
  return arr(raw, field).map((r, i) => {
    const path = `${field}[${i}]`;
    const o = obj(r, path);
    const kind = oneOf(o.kind, ITEM_KINDS, `${path}.kind`);
    const id = str(o.id, `${path}.id`, 40);
    if (seen.has(id)) bad(`${path}.id`, `"${id}" is used twice`);
    seen.add(id);
    if (kind === 'junk' || kind === 'trophy') {
      return { id, kind, name: str(o.name, `${path}.name`, 80), value: int(o.value, `${path}.value`), source: typeof o.source === 'string' ? o.source : '' };
    }
    const g = validateGear(o, path, kind)!;
    return { id, kind, type: g.type, quality: g.quality };
  });
}

function validateLook(raw: unknown, path: string): Look {
  const o = obj(raw, path);
  const sex = oneOf(o.sex, SEXES, `${path}.sex`);
  return {
    sex,
    skin: oneOf(o.skin, SKIN_TONES, `${path}.skin`),
    face: int(o.face, `${path}.face`, 1, FACE_COUNT),
    hair: oneOf(o.hair, HAIR_STYLES[sex], `${path}.hair`),
    hairColor: oneOf(o.hairColor, HAIR_COLORS, `${path}.hairColor`),
  };
}

function validateContract(raw: unknown, path: string): Contract {
  const o = obj(raw, path);
  const type = oneOf(o.type, ['main', 'mercenary', 'companion', 'slave'] as const, `${path}.type`);
  if (type === 'main') return { type };
  if (type === 'mercenary') {
    // Older saves: a mercenary was paid either a fixed fee or a cut.
    if (o.pay !== undefined) {
      const pay = oneOf(o.pay, ['fixed', 'cut'] as const, `${path}.pay`);
      const amount = int(o.amount, `${path}.amount`, 0, pay === 'cut' ? 100 : Number.MAX_SAFE_INTEGER);
      return { type, fee: pay === 'fixed' ? amount : 0, cutPct: pay === 'cut' ? amount : 0 };
    }
    return { type, fee: int(o.fee, `${path}.fee`), cutPct: int(o.cutPct, `${path}.cutPct`, 0, 100) };
  }
  if (type === 'slave') {
    const origin = oneOf(o.origin, ['market', 'prisoner'] as const, `${path}.origin`);
    // Older saves had no relationship or Obedience for slaves: start them in the middle of their range.
    const [lo, hi] = origin === 'market' ? GUILD.slave.obedienceMarket : GUILD.slave.obedienceCaptive;
    return {
      type, price: int(o.price, `${path}.price`), origin,
      relationship: o.relationship === undefined ? GUILD.slave.startingRelationship : num(o.relationship, `${path}.relationship`, 0, 100),
      obedience: o.obedience === undefined ? Math.round((lo + hi) / 2) : num(o.obedience, `${path}.obedience`, 0, 100),
      ...(typeof o.punishedDay === 'number' ? { punishedDay: Math.floor(o.punishedDay) } : {}),
    };
  }
  const startDay = int(o.startDay, `${path}.startDay`, 0);
  return {
    type,
    basePay: int(o.basePay, `${path}.basePay`),
    lootPct: int(o.lootPct, `${path}.lootPct`, 0, 100),
    foodLodging: typeof o.foodLodging === 'boolean' ? o.foodLodging : bad(`${path}.foodLodging`, 'must be true or false'),
    termWeeks: int(o.termWeeks, `${path}.termWeeks`, 1, 520),
    startDay,
    endDay: int(o.endDay, `${path}.endDay`, startDay),
    relationship: num(o.relationship, `${path}.relationship`, 0, 100),
    greed: num(o.greed, `${path}.greed`, 0.1, 5),
    ...(o.carriedWages ? { carriedWages: int(o.carriedWages, `${path}.carriedWages`) } : {}),
  };
}

/** Stats that no longer exist: older saves' talents and Body points for them are dropped (the points come back). */
const REMOVED_STATS = ['accuracy', 'evasion'];

/** Talent grades per stat (optional: a missing stat is C). */
function validateTalents(raw: unknown, path: string): Talents {
  const o = obj(raw, path);
  const out: Talents = {};
  for (const [k, v] of Object.entries(o)) {
    if (REMOVED_STATS.includes(k)) continue;
    if (!(STAT_KEYS as readonly string[]).includes(k)) bad(`${path}.${k}`, `is not a stat (allowed: ${STAT_KEYS.join(', ')})`);
    out[k as keyof Talents] = oneOf(v, TALENT_GRADES, `${path}.${k}`);
  }
  return out;
}

/** Skill points invested per stat (Body tab). */
function validateBody(raw: unknown, path: string): BodyInvestment {
  const o = obj(raw, path);
  const out: BodyInvestment = {};
  for (const [k, v] of Object.entries(o)) {
    if (REMOVED_STATS.includes(k)) continue;
    if (!bodyStats().includes(k as StatKey)) bad(`${path}.${k}`, `can't be trained (allowed: ${bodyStats().join(', ')})`);
    const n = int(v, `${path}.${k}`);
    if (n > 0) out[k as StatKey] = n;
  }
  return out;
}

/**
 * opts.member: a party member (has a contract). opts.slaveForSale: a slave at the market or a prisoner (an older save's
 * weapon is dropped: they come with nothing).
 */
function validateCharacter(raw: unknown, path: string, opts: { member?: boolean; slaveForSale?: boolean } = {}): Character {
  const r = obj(raw, path);
  const { id, name, level, xp, skillIds, appearance } = r;
  if (typeof id !== 'string' || !id) bad(`${path}.id`, 'must be a non-empty string');
  if (typeof name !== 'string' || !name.trim()) bad(`${path}.name`, 'must be a non-empty string');
  if ((name as string).length > NAME_MAX_LENGTH) bad(`${path}.name`, `must be at most ${NAME_MAX_LENGTH} characters`);
  int(level, `${path}.level`, 1, 99);
  int(xp, `${path}.xp`, 0);
  // Older saves had a weapon id and no armor: a Crude weapon of that type, and Crude Leather (slaves: none).
  let weapon: Gear | null;
  let armor: Gear | null;
  if (r.weapon === undefined && r.armor === undefined && r.weaponId !== undefined) {
    const slave = opts.slaveForSale || (isObj(r.contract) && r.contract.type === 'slave');
    weapon = opts.slaveForSale ? null : gear(weaponFromOld(r.weaponId));
    armor = slave ? null : gear('leather');
  } else {
    weapon = validateGear(r.weapon, `${path}.weapon`, 'weapon');
    armor = validateGear(r.armor, `${path}.armor`, 'armor');
  }
  const skills = arr(skillIds, `${path}.skillIds`);
  for (const s of skills) {
    if (typeof s !== 'string' || !SKILLS[s]) bad(`${path}.skillIds`, `contains unknown skill "${String(s)}"`);
    if (!TREE_SKILLS.includes(s as string)) {
      bad(`${path}.skillIds:`, `"${s}" is a weapon skill, not a skill-tree skill (allowed: ${TREE_SKILLS.join(', ')})`);
    }
  }
  if (new Set(skills).size !== skills.length) bad(`${path}.skillIds`, 'contains duplicates');
  // Skills that now need a higher level (level requirements change between versions) are unlearned, refunding the point.
  skills.splice(0, skills.length, ...skills.filter((s) => SKILLS[s as string].level <= (level as number)));
  const points = skillPointsForLevel(level as number);
  const body = r.body === undefined ? undefined : validateBody(r.body, `${path}.body`);
  const spent = skills.length + Object.values(body ?? {}).reduce((a, n) => a + (n ?? 0), 0);
  if (spent > points) bad(`${path}.skillIds`, `${skills.length} skills + ${spent - skills.length} Body investments use ${spent} skill points, but level ${level} has ${points}`);
  // Body ranks above the level's cap (a rule added later) are refunded.
  for (const k of Object.keys(body ?? {}) as StatKey[]) body![k] = Math.min(body![k]!, maxBodyRank(level as number));
  const a = obj(appearance, `${path}.appearance`);
  if (typeof a.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.color)) bad(`${path}.appearance.color`, 'must be a hex color like "#3d7be0"');
  const models: readonly string[] = [...BODY_MODELS, ...ENEMY_MODELS];
  if (a.model !== undefined && !models.includes(a.model as string)) bad(`${path}.appearance.model`, `must be one of: ${BODY_MODELS.join(', ')}`);
  // Adventurers always have a custom look; older saves get the one closest to their body model.
  const look = a.look !== undefined ? validateLook(a.look, `${path}.appearance.look`) : lookFromModel((a.model as string | undefined) ?? modelFor(id as string));
  const out: Character = {
    id: id as string,
    name: (name as string).trim(),
    level: level as number,
    xp: xp as number,
    weapon,
    armor,
    skillIds: [...(skills as string[])],
    appearance: { color: (a.color as string).toLowerCase(), look },
  };
  if (body && Object.keys(body).length) out.body = body;
  if (r.skillBar !== undefined) {
    // Unknown skills just become empty slots (skills change between versions; the bar shouldn't break a save).
    const bar = arr(r.skillBar, `${path}.skillBar`);
    if (bar.length > 100) bad(`${path}.skillBar`, 'can have at most 100 slots');
    out.skillBar = bar.map((s) => (typeof s === 'string' && SKILLS[s] ? s : null));
  }
  // An unknown mode (modes change between versions) just falls back to the weapon's default.
  if (typeof r.weaponMode === 'string' && SKILLS[r.weaponMode]) out.weaponMode = r.weaponMode;
  if (r.talents !== undefined) out.talents = validateTalents(r.talents, `${path}.talents`);
  if (r.health !== undefined) out.health = num(r.health, `${path}.health`, 0, 100);
  if (r.morale !== undefined) out.morale = num(r.morale, `${path}.morale`, 0, 100);
  if (r.traits !== undefined) {
    const traits = arr(r.traits, `${path}.traits`).map((t, i) => oneOf(t, TRAIT_IDS, `${path}.traits[${i}]`));
    if (traits.length) out.traits = [...new Set(traits)];
  }
  if (opts.member) out.contract = validateContract(r.contract, `${path}.contract`);
  return out;
}

/** A slave for sale or a prisoner. */
function validateOffer(raw: unknown, path: string): Offer {
  const o = obj(raw, path);
  return { character: validateCharacter(o.character, `${path}.character`, { slaveForSale: true }), price: int(o.price, `${path}.price`) };
}

function validateQuest(raw: unknown, path: string): Quest {
  const o = obj(raw, path);
  return {
    id: str(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    rank: oneOf(o.rank, RANKS, `${path}.rank`),
    stage: int(o.stage, `${path}.stage`, 1, 99),
    reward: int(o.reward, `${path}.reward`),
    renown: num(o.renown, `${path}.renown`),
    days: int(o.days, `${path}.days`, 1, 60),
    expires: int(o.expires, `${path}.expires`),
    description: typeof o.description === 'string' ? o.description : '',
    ...(o.promotion === true ? { promotion: true } : {}),
    // Group size in threat points. Older saves had a threat multiplier on the rank's usual group instead.
    count: o.count !== undefined ? num(o.count, `${path}.count`, 0.5, 100)
      : Math.max(1, Math.round(usualCount(oneOf(o.rank, RANKS, `${path}.rank`)) * (o.threat !== undefined ? num(o.threat, `${path}.threat`, 0.1, 5) : 1))),
    // Enemy types that no longer exist are dropped; the battle picks new ones if none are left.
    ...(Array.isArray(o.foes) && o.foes.some((f) => typeof f === 'string' && ENEMIES[f]) ? { foes: o.foes.filter((f): f is string => typeof f === 'string' && !!ENEMIES[f]) } : {}),
  };
}

function validateRival(raw: unknown, path: string): RivalParty {
  const o = obj(raw, path);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, 60),
    renown: num(o.renown, `${path}.renown`),
    rank: oneOf(o.rank, RANKS, `${path}.rank`),
    ...(typeof o.belowSince === 'number' ? { belowSince: Math.max(0, Math.floor(o.belowSince)) } : {}),
    members: arr(o.members, `${path}.members`).map((m, i) => {
      const mo = obj(m, `${path}.members[${i}]`);
      return {
        name: str(mo.name, `${path}.members[${i}].name`, NAME_MAX_LENGTH),
        level: int(mo.level, `${path}.members[${i}].level`, 1, 99),
        weaponId: weaponFromOld(mo.weaponId),
      };
    }),
    founded: int(o.founded, `${path}.founded`, -100000),
    wins: int(o.wins, `${path}.wins`),
    losses: int(o.losses, `${path}.losses`),
    lastDay: int(o.lastDay, `${path}.lastDay`),
    last: typeof o.last === 'string' ? o.last : '',
  };
}

const validateNews = (raw: unknown, path: string): NewsItem[] => arr(raw, path).map((n, i) => {
  const o = obj(n, `${path}[${i}]`);
  return { day: int(o.day, `${path}[${i}].day`), text: str(o.text, `${path}[${i}].text`, 500) };
});

function uniqueIds(chars: Character[], path: string): void {
  const seen = new Set<string>();
  chars.forEach((c, i) => {
    if (seen.has(c.id)) bad(`${path}[${i}].id`, `"${c.id}" is used twice`);
    seen.add(c.id);
  });
}

/** Validate a version-3 save. */
/** Members' daily activities. Unknown activities or members are dropped (they fall back to the default). */
function validateSchedule(raw: unknown, party: Character[]): GameState['schedule'] {
  if (raw === undefined) return {};
  const o = obj(raw, 'schedule');
  const out: GameState['schedule'] = {};
  for (const [id, a] of Object.entries(o)) {
    if (party.some((c) => c.id === id) && (ACTIVITIES as readonly unknown[]).includes(a)) out[id] = a as Activity;
  }
  return out;
}

/** Food quality per member (unknown members and tiers are dropped). */
function validateFood(raw: unknown, party: Character[]): GameState['food'] {
  if (raw === undefined) return {};
  const o = obj(raw, 'food');
  const out: GameState['food'] = {};
  for (const [id, t] of Object.entries(o)) {
    if (party.some((c) => c.id === id) && (FOOD_TIERS as readonly unknown[]).includes(t)) out[id] = t as FoodTier;
  }
  return out;
}

const RINGS = ['outer', 'middle', 'inner'] as const;
const CITY_LODGINGS = ['outside', 'standard', 'highEnd', 'luxury', ...RINGS] as const;

/** Lodging per member (unknown members and places are dropped; residences the party doesn't own fall back to outside later). */
function validateLodging(raw: unknown, party: Character[]): GameState['lodging'] {
  if (raw === undefined) return {};
  const o = obj(raw, 'lodging');
  const out: GameState['lodging'] = {};
  for (const [id, l] of Object.entries(o)) {
    if (party.some((c) => c.id === id) && (CITY_LODGINGS as readonly unknown[]).includes(l)) out[id] = l as GameState['lodging'][string];
  }
  return out;
}

/** The quest tab: gold amounts by member (entries for members no longer in the party are dropped). */
function validateTab(raw: unknown, party: Character[]): QuestTab {
  const o = obj(raw, 'tab');
  const byMember = (v: unknown, path: string) => {
    const out: Record<string, number> = {};
    if (v === undefined) return out;
    for (const [id, g] of Object.entries(obj(v, path))) if (party.some((c) => c.id === id)) out[id] = int(g, `${path}.${id}`);
    return out;
  };
  return { upkeep: o.upkeep === undefined ? 0 : int(o.upkeep, 'tab.upkeep'), wages: byMember(o.wages, 'tab.wages'), taxes: byMember(o.taxes, 'tab.taxes') };
}

function validateState(raw: Record<string, unknown>): GameState {
  const progress = obj(raw.progress, 'progress');
  const party = arr(raw.party, 'party').map((c, i) => validateCharacter(c, `party[${i}]`, { member: true }));
  if (party.length === 0) bad('party', 'must contain the main character');
  if (party.length > GUILD.maxRoster) bad('party', `can have at most ${GUILD.maxRoster} members`);
  uniqueIds(party, 'party');
  const mainId = str(raw.mainId, 'mainId');
  const main = party.find((c) => c.id === mainId);
  if (!main) bad('mainId', `"${mainId}" is not in the party`);
  if (main!.contract?.type !== 'main') bad('mainId', 'must point at the member with contract type "main"');
  const mains = party.filter((c) => c.contract?.type === 'main');
  if (mains.length > 1) bad('party', 'can only have one member with contract type "main"');
  // The main character is the Protagonist (older saves had no traits).
  if (!main!.traits?.includes('protagonist')) main!.traits = [...(main!.traits ?? []), 'protagonist'];
  const lineup = arr(raw.lineup, 'lineup').map((id, i) => {
    if (typeof id !== 'string' || !party.some((c) => c.id === id)) bad(`lineup[${i}]`, `"${String(id)}" is not in the party`);
    return id as string;
  });
  if (lineup.length > MAX_PARTY_SIZE) bad('lineup', `can have at most ${MAX_PARTY_SIZE} members`);
  const guild = obj(raw.guild, 'guild');
  const market = obj(raw.market, 'market');
  const state: GameState = {
    progress: { victories: int(progress.victories, 'progress.victories'), defeats: int(progress.defeats, 'progress.defeats') },
    day: int(raw.day, 'day', 1),
    gold: int(raw.gold, 'gold'),
    partyName: str(raw.partyName, 'partyName', PARTY_NAME_MAX_LENGTH),
    renown: num(raw.renown, 'renown'),
    rank: oneOf(raw.rank, RANKS, 'rank') as Rank,
    mainId,
    party,
    lineup,
    guild: {
      rivals: arr(guild.rivals, 'guild.rivals').map((p, i) => validateRival(p, `guild.rivals[${i}]`)),
      pool: arr(guild.pool, 'guild.pool').map((a, i) => {
        const o = obj(a, `guild.pool[${i}]`);
        return {
          character: validateCharacter(o.character, `guild.pool[${i}].character`),
          greed: num(o.greed, `guild.pool[${i}].greed`, 0.1, 5),
          patience: int(o.patience, `guild.pool[${i}].patience`, 0, 99),
          refusedUntil: int(o.refusedUntil, `guild.pool[${i}].refusedUntil`),
        };
      }),
      board: arr(guild.board, 'guild.board').map((q, i) => validateQuest(q, `guild.board[${i}]`)),
      news: validateNews(guild.news, 'guild.news'),
    },
    market: {
      slaves: arr(market.slaves, 'market.slaves').map((o, i) => validateOffer(o, `market.slaves[${i}]`)),
      // Older saves had no price index (and a restock day, which is no longer used).
      priceIndex: market.priceIndex === undefined ? 1 : num(market.priceIndex, 'market.priceIndex', 0.01, 10),
    },
    prisoners: arr(raw.prisoners, 'prisoners').map((o, i) => validateOffer(o, `prisoners[${i}]`)),
    inventory: validateInventory(raw.inventory),
    marketplace: raw.marketplace === undefined ? [] : validateInventory(raw.marketplace, 'marketplace'),
    smithyOrders: validateOrders(raw.smithyOrders, raw.day),
    quest: raw.quest === null || raw.quest === undefined ? null : validateQuest(raw.quest, 'quest'),
    lastQuestDay: raw.lastQuestDay === undefined ? 0 : int(raw.lastQuestDay, 'lastQuestDay'),
    questMembers: raw.questMembers === undefined ? [] : arr(raw.questMembers, 'questMembers').filter((id): id is string => typeof id === 'string'),
    schedule: validateSchedule(raw.schedule, party),
    food: validateFood(raw.food, party),
    lodging: validateLodging(raw.lodging, party),
    drinksDay: raw.drinksDay === undefined ? 0 : int(raw.drinksDay, 'drinksDay'),
    belowRankSince: raw.belowRankSince === undefined ? 0 : int(raw.belowRankSince, 'belowRankSince'),
    residences: raw.residences === undefined ? [] : [...new Set(arr(raw.residences, 'residences').map((r, i) => oneOf(r, RINGS, `residences[${i}]`)))],
    log: validateNews(raw.log ?? [], 'log'),
    ...(raw.tab === undefined ? {} : { tab: validateTab(raw.tab, party) }),
  };
  tidyLineup(state);
  return state;
}

/**
 * Versions 1-2 had only a party and a stage counter. The first member becomes the main
 * character, the others companions on a 4-week contract, and the party joins the guild
 * with renown and gold for the stages it had cleared.
 */
function migrateLegacy(raw: Record<string, unknown>): GameState {
  const progress = obj(raw.progress, 'progress');
  const stage = int(progress.stage, 'progress.stage', 1);
  const members = arr(raw.party, 'party');
  if (members.length > MAX_PARTY_SIZE) bad('party', `can have at most ${MAX_PARTY_SIZE} members`);
  const party = members.map((m, i) => validateCharacter(raw.version === 1 ? migrateV1Character(m) : m, `party[${i}]`));
  uniqueIds(party, 'party');
  if (party.length === 0) bad('party', 'is empty: start a new game instead');
  const rng = makeRng(stage * 7919 + party.length);
  const [main, ...rest] = party;
  const state = newCampaign(main, `${main.name}'s Party`, rng);
  state.progress = { victories: int(progress.victories, 'progress.victories'), defeats: int(progress.defeats, 'progress.defeats') };
  state.gold += (stage - 1) * 50;
  state.renown = (stage - 1) * 15;
  for (const c of rest) {
    const want = companionDemand(c.level, 1, 4);
    c.contract = companionContract({ basePay: Math.max(0, Math.round((want - foodLodgingWeekly()) / 5) * 5), lootPct: 0, foodLodging: true, termWeeks: 4 }, state.day, 1, 30);
    state.party.push(c);
    state.lineup.push(c.id);
  }
  return state;
}

/** Parse and validate save JSON. Errors point at the exact field so hand-edited saves are easy to fix. */
export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!isObj(raw)) return { ok: false, error: 'Save must be a JSON object' };
  if (raw.format !== SAVE_FORMAT) return { ok: false, error: `"format" must be "${SAVE_FORMAT}"` };
  if (!isInt(raw.version, 1)) return { ok: false, error: '"version" must be a whole number' };
  if (raw.version > SAVE_VERSION) {
    return { ok: false, error: `Save version ${raw.version} is newer than this game supports (${SAVE_VERSION})` };
  }
  try {
    const state = raw.version < 3 ? migrateLegacy(raw) : validateState(raw);
    return { ok: true, savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '', state };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---- Browser storage slots -------------------------------------------------

export interface SlotSummary {
  slot: number;
  empty: boolean;
  error?: string;
  savedAt?: string;
  day?: number;
  rank?: string;
  gold?: number;
  party?: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function writeSlot(slot: number, state: GameState): void {
  const s = storage();
  if (!s) throw new Error('Browser storage is unavailable. Use "Export file" instead.');
  s.setItem(`${SLOT_KEY_PREFIX}${slot}`, serializeSave(state));
}

export function readSlot(slot: number): ParseResult | null {
  const text = storage()?.getItem(`${SLOT_KEY_PREFIX}${slot}`);
  return text ? parseSave(text) : null;
}

export function slotSummary(slot: number): SlotSummary {
  const result = readSlot(slot);
  if (!result) return { slot, empty: true };
  if (!result.ok) return { slot, empty: false, error: result.error };
  return {
    slot,
    empty: false,
    savedAt: result.savedAt,
    day: result.state.day,
    rank: result.state.rank,
    gold: result.state.gold,
    party: `${result.state.partyName}: ${result.state.party.map((c) => `${c.name} Lv${c.level}`).join(', ')}`,
  };
}

// ---- File export / import (browser only) ----------------------------------

export function exportToFile(state: GameState): void {
  const blob = new Blob([serializeSave(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `l-rpg-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker; resolves with the parse result, or null if the user cancelled. */
export function importFromFile(): Promise<ParseResult | null> {
  return new Promise((resolve) => {
    // Some browsers (notably Safari) only open pickers for inputs attached to the page.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (result: ParseResult | null) => {
      input.remove();
      resolve(result);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      done(file ? parseSave(await file.text()) : null);
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
