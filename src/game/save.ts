// Save / load. Saves are pretty-printed JSON so players can read (and edit!) them.
import { MAX_PARTY_SIZE, NAME_MAX_LENGTH, SKILLS, TREE_SKILLS, WEAPONS, skillSlotsForLevel } from '../data/content';
import { BODY_MODELS, type Character, type GameState } from '../data/types';
import { modelFor } from './character';

export const SAVE_FORMAT = 'lazyrpg-save';
/** v1: class + attribute points. v2: classless Adventurers with weapon + skill-tree picks. */
export const SAVE_VERSION = 2;
export const SLOT_COUNT = 3;
const SLOT_KEY_PREFIX = 'lazyrpg.save.slot';

export interface SaveFile extends GameState {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
}

export type ParseResult = { ok: true; state: GameState; savedAt: string } | { ok: false; error: string };

export function newGameState(): GameState {
  return { progress: { stage: 1, victories: 0, defeats: 0 }, party: [] };
}

export function serializeSave(state: GameState, now = new Date()): string {
  const file: SaveFile = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    progress: state.progress,
    party: state.party,
  };
  return JSON.stringify(file, null, 2);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
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

function validateCharacter(raw: unknown, path: string): string | Character {
  if (!isObj(raw)) return `${path} must be an object`;
  const { id, name, level, xp, weaponId, skillIds, appearance } = raw;
  if (typeof id !== 'string' || !id) return `${path}.id must be a non-empty string`;
  if (typeof name !== 'string' || !name.trim()) return `${path}.name must be a non-empty string`;
  if (name.length > NAME_MAX_LENGTH) return `${path}.name must be at most ${NAME_MAX_LENGTH} characters`;
  if (!isInt(level, 1, 99)) return `${path}.level must be a whole number from 1 to 99`;
  if (!isInt(xp, 0)) return `${path}.xp must be a whole number >= 0`;
  if (typeof weaponId !== 'string' || !WEAPONS[weaponId]) {
    return `${path}.weaponId "${String(weaponId)}" is not a known weapon (allowed: ${Object.keys(WEAPONS).join(', ')})`;
  }
  if (!Array.isArray(skillIds)) return `${path}.skillIds must be an array`;
  for (const s of skillIds) {
    if (typeof s !== 'string' || !SKILLS[s]) return `${path}.skillIds contains unknown skill "${String(s)}"`;
    if (!TREE_SKILLS.includes(s)) {
      return `${path}.skillIds: "${s}" is a weapon skill, not a skill-tree skill (allowed: ${TREE_SKILLS.join(', ')})`;
    }
  }
  if (new Set(skillIds).size !== skillIds.length) return `${path}.skillIds contains duplicates`;
  const slots = skillSlotsForLevel(level);
  if (skillIds.length > slots) return `${path}.skillIds has ${skillIds.length} skills but level ${level} allows ${slots}`;
  if (!isObj(appearance)) return `${path}.appearance must be an object`;
  if (typeof appearance.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(appearance.color)) {
    return `${path}.appearance.color must be a hex color like "#3d7be0"`;
  }
  if (appearance.model !== undefined && !(BODY_MODELS as readonly unknown[]).includes(appearance.model)) {
    return `${path}.appearance.model must be one of: ${BODY_MODELS.join(', ')}`;
  }
  return {
    id,
    name: name.trim(),
    level,
    xp,
    weaponId,
    skillIds: [...(skillIds as string[])],
    appearance: {
      color: appearance.color.toLowerCase(),
      model: (appearance.model as Character['appearance']['model'] | undefined) ?? modelFor(id),
    },
  };
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
  const progress = raw.progress;
  if (!isObj(progress)) return { ok: false, error: '"progress" must be an object' };
  for (const key of ['stage', 'victories', 'defeats'] as const) {
    if (!isInt(progress[key], key === 'stage' ? 1 : 0)) return { ok: false, error: `progress.${key} must be a whole number` };
  }
  if (!Array.isArray(raw.party)) return { ok: false, error: '"party" must be an array' };
  if (raw.party.length > MAX_PARTY_SIZE) return { ok: false, error: `"party" can have at most ${MAX_PARTY_SIZE} members` };
  const party: Character[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.party.length; i++) {
    const member = raw.version === 1 ? migrateV1Character(raw.party[i]) : raw.party[i];
    const result = validateCharacter(member, `party[${i}]`);
    if (typeof result === 'string') return { ok: false, error: result };
    if (ids.has(result.id)) return { ok: false, error: `party[${i}].id "${result.id}" is used twice` };
    ids.add(result.id);
    party.push(result);
  }
  return {
    ok: true,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    state: {
      progress: { stage: progress.stage as number, victories: progress.victories as number, defeats: progress.defeats as number },
      party,
    },
  };
}

// ---- Browser storage slots -------------------------------------------------

export interface SlotSummary {
  slot: number;
  empty: boolean;
  error?: string;
  savedAt?: string;
  stage?: number;
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
    stage: result.state.progress.stage,
    party: result.state.party.map((c) => `${c.name} Lv${c.level}`).join(', ') || '(no party)',
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
