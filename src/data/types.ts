// Shared type definitions for game data. Everything here is plain data so it
// can be written to and read from human-readable JSON save files.

export const ATTRIBUTE_KEYS = ['str', 'dex', 'int', 'vit', 'spd'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTE_INFO: Record<AttributeKey, { name: string; description: string }> = {
  str: { name: 'Strength', description: 'Physical damage.' },
  dex: { name: 'Dexterity', description: 'Hit chance and critical chance.' },
  int: { name: 'Intellect', description: 'Magic damage, healing and magic resistance.' },
  vit: { name: 'Vitality', description: 'Max HP and defense.' },
  spd: { name: 'Speed', description: 'Evasion (harder to hit). 9+ grants +1 move.' },
};

export type ClassId = 'knight' | 'ranger' | 'mage' | 'cleric';
export type DamageType = 'physical' | 'magical';
export type Emblem = 'circle' | 'square' | 'diamond' | 'triangle';

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
  /** Starting attributes before the player spends creation points. */
  baseAttributes: Attributes;
  baseHp: number;
  armor: number;
  move: number;
  weapons: string[];
  skills: string[];
}

export interface WeaponDef {
  id: string;
  name: string;
  description: string;
  damageType: DamageType;
  power: number;
  minRange: number;
  maxRange: number;
  /** Attribute modifiers while equipped (can be negative). */
  bonus: Partial<Attributes>;
}

export type StatusStat = 'physPower' | 'magPower' | 'defense' | 'resistance' | 'move' | 'speed';

export interface StatusEffectDef {
  name: string;
  stat: StatusStat;
  amount: number;
  /** Number of the affected unit's own turns the effect lasts. */
  turns: number;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  kind: 'damage' | 'heal' | 'status';
  /** Who the skill can affect. */
  target: 'enemy' | 'ally';
  damageType: DamageType;
  /** Damage/heal multiplier applied to the caster's power. */
  power: number;
  minRange: number;
  maxRange: number;
  /** 0 = single target, 1+ = everything within that Manhattan distance of the target tile. */
  radius: number;
  cooldown: number;
  status?: StatusEffectDef;
}

export interface Appearance {
  color: string;
  emblem: Emblem;
}

/** A party member as stored in the save file. */
export interface Character {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  /** Total attributes (class base + all points spent). Weapon bonuses are NOT included. */
  attributes: Attributes;
  unspentPoints: number;
  weaponId: string;
  skillIds: string[];
  appearance: Appearance;
}

export interface Progress {
  stage: number;
  victories: number;
  defeats: number;
}

export interface GameState {
  progress: Progress;
  party: Character[];
}
