// Save / load. Saves are pretty-printed JSON so players can read (and edit!) them.
import { MAX_PARTY_SIZE, NAME_MAX_LENGTH, SKILLS, TREE_SKILLS, WEAPONS, skillSlotsForLevel } from '../data/content';
import { GUILD } from '../data/guild';
import {
  BODY_MODELS, ENEMY_MODELS, FACE_COUNT, HAIR_COLORS, HAIR_STYLES, RANKS, SEXES, SKIN_TONES,
  type Character, type Contract, type GameState, type Look, type NewsItem, type Offer, type Quest, type Rank, type RivalParty,
} from '../data/types';
import { makeRng, modelFor } from './character';
import { newCampaign, tidyLineup } from './city';
import { companionContract, companionDemand, foodLodgingWeekly } from './contracts';
import { lookFromModel } from './people';

export const SAVE_FORMAT = 'lazyrpg-save';
/** v1: class + attribute points. v2: classless Adventurers with weapon + skill-tree picks. v3: Arch City (contracts, guild, calendar). */
export const SAVE_VERSION = 3;
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
    const pay = oneOf(o.pay, ['fixed', 'cut'] as const, `${path}.pay`);
    return { type, pay, amount: int(o.amount, `${path}.amount`, 0, pay === 'cut' ? 100 : Number.MAX_SAFE_INTEGER) };
  }
  if (type === 'slave') {
    return { type, price: int(o.price, `${path}.price`), origin: oneOf(o.origin, ['market', 'prisoner'] as const, `${path}.origin`) };
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
  };
}

function validateCharacter(raw: unknown, path: string, opts: { member?: boolean } = {}): Character {
  const r = obj(raw, path);
  const { id, name, level, xp, weaponId, skillIds, appearance } = r;
  if (typeof id !== 'string' || !id) bad(`${path}.id`, 'must be a non-empty string');
  if (typeof name !== 'string' || !name.trim()) bad(`${path}.name`, 'must be a non-empty string');
  if ((name as string).length > NAME_MAX_LENGTH) bad(`${path}.name`, `must be at most ${NAME_MAX_LENGTH} characters`);
  int(level, `${path}.level`, 1, 99);
  int(xp, `${path}.xp`, 0);
  if (typeof weaponId !== 'string' || !WEAPONS[weaponId]) {
    bad(`${path}.weaponId`, `"${String(weaponId)}" is not a known weapon (allowed: ${Object.keys(WEAPONS).join(', ')})`);
  }
  const skills = arr(skillIds, `${path}.skillIds`);
  for (const s of skills) {
    if (typeof s !== 'string' || !SKILLS[s]) bad(`${path}.skillIds`, `contains unknown skill "${String(s)}"`);
    if (!TREE_SKILLS.includes(s as string)) {
      bad(`${path}.skillIds:`, `"${s}" is a weapon skill, not a skill-tree skill (allowed: ${TREE_SKILLS.join(', ')})`);
    }
  }
  if (new Set(skills).size !== skills.length) bad(`${path}.skillIds`, 'contains duplicates');
  const slots = skillSlotsForLevel(level as number);
  if (skills.length > slots) bad(`${path}.skillIds`, `has ${skills.length} skills but level ${level} allows ${slots}`);
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
    weaponId: weaponId as string,
    skillIds: [...(skills as string[])],
    appearance: { color: (a.color as string).toLowerCase(), look },
  };
  if (opts.member) out.contract = validateContract(r.contract, `${path}.contract`);
  return out;
}

function validateOffer(raw: unknown, path: string): Offer {
  const o = obj(raw, path);
  return { character: validateCharacter(o.character, `${path}.character`), price: int(o.price, `${path}.price`) };
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
  };
}

function validateRival(raw: unknown, path: string): RivalParty {
  const o = obj(raw, path);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`, 60),
    renown: num(o.renown, `${path}.renown`),
    rank: oneOf(o.rank, RANKS, `${path}.rank`),
    members: arr(o.members, `${path}.members`).map((m, i) => {
      const mo = obj(m, `${path}.members[${i}]`);
      return {
        name: str(mo.name, `${path}.members[${i}].name`, NAME_MAX_LENGTH),
        level: int(mo.level, `${path}.members[${i}].level`, 1, 99),
        weaponId: oneOf(mo.weaponId, Object.keys(WEAPONS), `${path}.members[${i}].weaponId`),
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
      restockDay: int(market.restockDay, 'market.restockDay'),
    },
    prisoners: arr(raw.prisoners, 'prisoners').map((o, i) => validateOffer(o, `prisoners[${i}]`)),
    quest: raw.quest === null || raw.quest === undefined ? null : validateQuest(raw.quest, 'quest'),
    log: validateNews(raw.log ?? [], 'log'),
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
