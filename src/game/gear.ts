// Equipment on a character: what it's wielding and wearing, the stats it gives, and how it's named.
import { ARMORS, ENEMY_GEAR, NO_ARMOR, QUALITIES, SKILLS, UNARMED, WEAPONS } from '../data/content';
import { ENEMIES } from '../data/enemies';
import { PEN_PCT_KEYS, STAT_INFO, STAT_KEYS, type ArmorDef, type Character, type Gear, type QualityId, type Stats, type WeaponDef } from '../data/types';
import type { Rng } from './character';

/** Monsters fight with their bodies: no weapon, no armor, no Unarmed or No Armor penalties either. */
export function usesGear(c: Pick<Character, 'enemyType'>): boolean {
  return !c.enemyType || (ENEMIES[c.enemyType]?.loadouts.length ?? 0) > 0;
}

/** The weapon the character fights with (Unarmed without one), or undefined for monsters. */
export function weaponOf(c: Pick<Character, 'enemyType' | 'weapon'>): WeaponDef | undefined {
  if (!usesGear(c)) return undefined;
  return WEAPONS[c.weapon?.type ?? UNARMED] ?? WEAPONS[UNARMED];
}

/** The armor the character wears (No Armor without one), or undefined for monsters. */
export function armorOf(c: Pick<Character, 'enemyType' | 'armor'>): ArmorDef | undefined {
  if (!usesGear(c)) return undefined;
  return ARMORS[c.armor?.type ?? NO_ARMOR] ?? ARMORS[NO_ARMOR];
}

/** Weapon type id ('unarmed' without one; '' for monsters). */
export const weaponType = (c: Pick<Character, 'enemyType' | 'weapon'>) => weaponOf(c)?.id ?? '';

/** A new piece of equipment (Crude unless said otherwise). */
export const gear = (type: string, quality: QualityId = 'crude'): Gear => ({ type, quality });

/** "Crude Longbow", "Masterwork Plate". */
export function gearName(g: Gear, kind: 'weapon' | 'armor'): string {
  const def = kind === 'weapon' ? WEAPONS[g.type] : ARMORS[g.type];
  return `${QUALITIES[g.quality]?.name ?? g.quality} ${def?.name ?? g.type}`;
}

/** The character's weapon by name: "Crude Longbow", or "Unarmed". */
export function weaponName(c: Pick<Character, 'enemyType' | 'weapon'>): string {
  return c.weapon && WEAPONS[c.weapon.type] ? gearName(c.weapon, 'weapon') : (weaponOf(c)?.name ?? '');
}

/** The character's armor by name: "Crude Leather", or "No Armor". */
export function armorName(c: Pick<Character, 'enemyType' | 'armor'>): string {
  return c.armor && ARMORS[c.armor.type] ? gearName(c.armor, 'armor') : (armorOf(c)?.name ?? '');
}

/** A piece's flat base stats at a quality (Crude 1x, Common 2x, Fine 4x, Masterwork 7x). */
export function baseStats(def: WeaponDef | ArmorDef, quality: QualityId | undefined): Partial<Stats> {
  const m = def.builtIn ? 1 : (QUALITIES[quality ?? 'crude']?.baseMultiplier ?? 1);
  const out: Partial<Stats> = {};
  for (const [k, v] of Object.entries(def.base)) out[k as keyof Stats] = (v ?? 0) * m;
  return out;
}

/**
 * Add the character's equipment to its stats: every piece's base stats (x quality) first, then every piece's
 * modifiers multiply the total (penetration % adds instead). Rounded. Monsters are left alone.
 */
export function applyGear(stats: Stats, c: Pick<Character, 'enemyType' | 'weapon' | 'armor'>): Stats {
  const pieces: [WeaponDef | ArmorDef | undefined, QualityId | undefined][] = [[weaponOf(c), c.weapon?.quality], [armorOf(c), c.armor?.quality]];
  for (const [def, q] of pieces) {
    if (!def) continue;
    for (const [k, v] of Object.entries(baseStats(def, q))) stats[k as keyof Stats] += v ?? 0;
  }
  for (const [def] of pieces) {
    if (!def) continue;
    for (const [k, v] of Object.entries(def.modifiers)) {
      const key = k as keyof Stats;
      if (PEN_PCT_KEYS.includes(key)) stats[key] += v ?? 0;
      else stats[key] *= v ?? 1;
    }
  }
  for (const k of STAT_KEYS) stats[k] = Math.round(stats[k]);
  return stats;
}

/**
 * Quality of an enemy's gear at `level`: its type's gearQuality, except that crude gear is Common
 * with a chance of enemyGear.commonChancePerLevel per level.
 */
export function enemyGearQuality(base: QualityId, level: number, rng: Rng): QualityId {
  if (base !== 'crude') return base;
  return rng() < ENEMY_GEAR.commonChancePerLevel * level ? 'common' : 'crude';
}

/** What a figure is drawn with: the weapon's pose and the armor's outfit ('' = the body model's own clothes). */
export interface FigureKit {
  art: string;
  outfit: string;
}

export function figureKit(c: Pick<Character, 'enemyType' | 'weapon' | 'armor'>): FigureKit {
  return { art: weaponOf(c)?.art ?? '', outfit: armorOf(c)?.outfit ?? '' };
}

/** The combined modifier the character's gear puts on a stat: multipliers multiply (1 = none); penetration % adds (0 = none). */
export function gearModifier(c: Pick<Character, 'enemyType' | 'weapon' | 'armor'>, k: keyof Stats): number {
  const pct = PEN_PCT_KEYS.includes(k);
  let out = pct ? 0 : 1;
  for (const def of [weaponOf(c), armorOf(c)]) {
    const v = def?.modifiers[k];
    if (v === undefined) continue;
    out = pct ? out + v : out * v;
  }
  return out;
}

/** The flat amount the character's gear adds to a stat (base stats x quality, before modifiers). */
export function gearBase(c: Pick<Character, 'enemyType' | 'weapon' | 'armor'>, k: keyof Stats): number {
  return [[weaponOf(c), c.weapon?.quality] as const, [armorOf(c), c.armor?.quality] as const]
    .reduce((sum, [def, q]) => sum + (def ? (baseStats(def, q)[k] ?? 0) : 0), 0);
}

/** A stat amount or modifier as a short label: "+15 P.Atk", "x0.8 M.Atk", "+50% P.Pen". */
export function statBonusText(k: keyof Stats, v: number, kind: 'base' | 'modifier'): string {
  const short = { pPen: 'P.Pen', pPenPct: 'P.Pen', mPen: 'M.Pen', mPenPct: 'M.Pen' }[k as string] ?? STAT_SHORT[k];
  if (kind === 'base') return `+${Number(v.toFixed(1))} ${short}`;
  return PEN_PCT_KEYS.includes(k) ? `+${v}% ${short}` : `x${Number(v.toFixed(2))} ${short}`;
}
const STAT_SHORT = Object.fromEntries(Object.entries(STAT_INFO).map(([k, v]) => [k, v.short])) as Record<keyof Stats, string>;

/** A weapon's or armor's stats as text lines: "Base: +15 P.Atk, +10 Def" (at a quality) and "Modifiers: x0.8 M.Atk". */
export function gearStatLines(def: WeaponDef | ArmorDef, quality: QualityId = 'crude'): string[] {
  const base = Object.entries(baseStats(def, quality)).filter(([, v]) => v).map(([k, v]) => statBonusText(k as keyof Stats, v!, 'base'));
  const mods = Object.entries(def.modifiers).map(([k, v]) => statBonusText(k as keyof Stats, v!, 'modifier'));
  return [`Base: ${base.join(', ') || 'None'}`, `Modifiers: ${mods.join(', ') || 'None'}`];
}

/** A weapon's or armor's tooltip at a quality: name, kind (weapon class and range), description, base stats, modifiers, skills. */
export function gearTooltip(kind: 'weapon' | 'armor', type: string, quality: QualityId = 'crude'): string {
  const def = kind === 'weapon' ? WEAPONS[type] : ARMORS[type];
  if (!def) return '';
  const w = kind === 'weapon' ? WEAPONS[type] : null;
  return [
    gearName({ type, quality }, kind),
    w ? `${w.class} · Range ${w.range}` : 'Body Armor',
    def.description,
    ...gearStatLines(def, quality),
    ...(w ? [`Skills: ${w.skills.map((s) => SKILLS[s]?.name ?? s).join(', ')}`] : []),
  ].join('\n');
}
