// Random people for Arch City: names, looks, and ready-to-fight adventurers.
import { PALETTE, SKILL_TREES, WEAPONS, skillSlotsForLevel } from '../data/content';
import {
  FACE_COUNT, HAIR_COLORS, HAIR_STYLES, SEXES, SKIN_TONES,
  type BodyModel, type Character, type HairColor, type HairStyle, type Look, type Sex, type SkinTone,
} from '../data/types';
import { newId, type Rng } from './character';

export const SEX_NAMES: Record<Sex, string> = { male: 'Male', female: 'Female' };
export const SKIN_NAMES: Record<SkinTone, string> = {
  pale: 'Pale', light: 'Light', fair: 'Fair', olive: 'Olive', lightBrown: 'Light Brown', brown: 'Brown',
};
export const HAIR_NAMES: Record<HairStyle, string> = {
  crewCut: 'Crew Cut', bowlCut: 'Bowl Cut', permed: 'Permed', tied: 'Tied',
  bobCut: 'Bob Cut', ponytail: 'Ponytail', crownBraid: 'Crown Braid', downWithBangs: 'Down with Bangs', braided: 'Braided', bun: 'Bun',
};
export const HAIR_COLOR_NAMES: Record<HairColor, string> = {
  black: 'Black', darkBrown: 'Dark Brown', brown: 'Brown', auburn: 'Auburn', red: 'Red', blonde: 'Blonde', ash: 'Ash',
};
export const FACE_NAMES: Record<Sex, string[]> = {
  male: ['Earnest', 'Stern', 'Bearded', 'Cheery'],
  female: ['Gentle', 'Bright', 'Fierce', 'Calm'],
};

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)];
export const randInt = (lo: number, hi: number, rng: Rng) => lo + Math.floor(rng() * (hi - lo + 1));

export function randomLook(rng: Rng, sex: Sex = pick(SEXES, rng)): Look {
  return {
    sex,
    skin: pick(SKIN_TONES, rng),
    face: randInt(1, FACE_COUNT, rng),
    hair: pick(HAIR_STYLES[sex], rng),
    hairColor: pick(HAIR_COLORS, rng),
  };
}

/** Keep a look valid when its sex changes (hair styles differ by sex). */
export function fixLook(look: Look): Look {
  const styles: readonly string[] = HAIR_STYLES[look.sex];
  return { ...look, hair: styles.includes(look.hair) ? look.hair : HAIR_STYLES[look.sex][0] };
}

/** The custom look closest to one of the old fixed body models (for old saves). */
export function lookFromModel(model: BodyModel | string | undefined): Look {
  const table: Record<string, Look> = {
    m1: { sex: 'male', skin: 'light', face: 1, hair: 'crewCut', hairColor: 'brown' },
    m2: { sex: 'male', skin: 'fair', face: 4, hair: 'tied', hairColor: 'black' },
    m3: { sex: 'male', skin: 'brown', face: 3, hair: 'crewCut', hairColor: 'black' },
    m4: { sex: 'male', skin: 'pale', face: 2, hair: 'bowlCut', hairColor: 'blonde' },
    f1: { sex: 'female', skin: 'light', face: 1, hair: 'downWithBangs', hairColor: 'brown' },
    f2: { sex: 'female', skin: 'pale', face: 2, hair: 'ponytail', hairColor: 'red' },
    f3: { sex: 'female', skin: 'brown', face: 3, hair: 'bun', hairColor: 'black' },
    f4: { sex: 'female', skin: 'fair', face: 4, hair: 'bobCut', hairColor: 'blonde' },
  };
  return { ...(table[model ?? ''] ?? table.m1) };
}

const NAMES: Record<Sex, string[]> = {
  male: ['Aldric', 'Corvin', 'Fenwick', 'Halvard', 'Jory', 'Bram', 'Cedric', 'Dorian', 'Edric', 'Garrick', 'Hugo', 'Ivo', 'Kester',
    'Lucan', 'Marek', 'Nils', 'Osric', 'Piers', 'Quill', 'Roderick', 'Silas', 'Tobin', 'Ulric', 'Vance', 'Wendel', 'Yorick', 'Alaric',
    'Benedikt', 'Caspian', 'Dunstan', 'Emeric', 'Falk', 'Gideon', 'Hale', 'Ansel', 'Merrick', 'Rowan', 'Tamsin', 'Leof', 'Odo'],
  female: ['Brienne', 'Dahlia', 'Edda', 'Gwyn', 'Isolde', 'Astrid', 'Beatrix', 'Celandine', 'Delphine', 'Elowen', 'Freya', 'Greta',
    'Hilde', 'Ingrid', 'Juniper', 'Kestrel', 'Liesel', 'Maren', 'Nessa', 'Odette', 'Petra', 'Rosalind', 'Sigrid', 'Thea', 'Ursa',
    'Vesna', 'Wren', 'Ysolde', 'Alys', 'Briar', 'Cressida', 'Ebba', 'Fenna', 'Ilse', 'Linnea', 'Mira', 'Saoirse', 'Tilde', 'Vala', 'Zora'],
};
const PARTY_ADJ = ['Iron', 'Silver', 'Crimson', 'Golden', 'Ashen', 'Verdant', 'Storm', 'Hollow', 'Bright', 'Gilded', 'Black', 'Copper',
  'Wild', 'Seventh', 'Lucky', 'Twin', 'Morning', 'Last', 'Quiet', 'Ember', 'Frost', 'Azure', 'Rusty', 'Wandering'];
const PARTY_NOUN = ['Wolves', 'Lanterns', 'Blades', 'Hawks', 'Oaths', 'Shields', 'Foxes', 'Crowns', 'Stags', 'Ravens', 'Thorns',
  'Banners', 'Hounds', 'Spears', 'Owls', 'Wardens', 'Boars', 'Comets', 'Keys', 'Anvils', 'Vipers', 'Bells', 'Pilgrims', 'Sparrows'];

export function randomName(sex: Sex, rng: Rng, avoid: ReadonlySet<string> = new Set()): string {
  const free = NAMES[sex].filter((n) => !avoid.has(n));
  return pick(free.length ? free : NAMES[sex], rng);
}

export function randomPartyName(rng: Rng, avoid: ReadonlySet<string> = new Set()): string {
  // Prefer words no other party uses yet ("The Wild Hawks" and "The Wild Spears" read like twins).
  const used = new Set([...avoid].flatMap((n) => n.split(' ')));
  for (let i = 0; i < 80; i++) {
    const adj = pick(PARTY_ADJ, rng);
    const noun = pick(PARTY_NOUN, rng);
    if (!used.has(adj) && !used.has(noun)) return `The ${adj} ${noun}`;
  }
  for (let i = 0; i < 50; i++) {
    const name = `The ${pick(PARTY_ADJ, rng)} ${pick(PARTY_NOUN, rng)}`;
    if (!avoid.has(name)) return name;
  }
  return `The ${pick(PARTY_ADJ, rng)} ${pick(PARTY_NOUN, rng)} ${randInt(2, 9, rng)}`;
}

/** A complete adventurer: random look, weapon and skill picks for their level. */
export function randomAdventurer(level: number, rng: Rng, opts: { name?: string; avoidNames?: ReadonlySet<string> } = {}): Character {
  const look = randomLook(rng);
  const weaponId = pick(Object.keys(WEAPONS), rng);
  // Picks lean on one tab (warrior or mage), like a real build.
  const tab = pick([...new Set(SKILL_TREES.map((t) => t.tab))], rng);
  const preferred = SKILL_TREES.filter((t) => t.tab === tab).flatMap((t) => t.skills);
  const others = SKILL_TREES.filter((t) => t.tab !== tab).flatMap((t) => t.skills);
  const pool = [...shuffle(preferred, rng), ...shuffle(others, rng)];
  return {
    id: newId(),
    name: opts.name ?? randomName(look.sex, rng, opts.avoidNames),
    level,
    xp: 0,
    weaponId,
    skillIds: pool.slice(0, skillSlotsForLevel(level)),
    appearance: { color: pick(PALETTE, rng), look },
  };
}

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
