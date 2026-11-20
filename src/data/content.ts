// Game content: classes, weapons and skills. Tweak numbers here to rebalance.
import type { ClassDef, ClassId, SkillDef, WeaponDef } from './types';

export const CLASSES: Record<ClassId, ClassDef> = {
  knight: {
    id: 'knight',
    name: 'Knight',
    description: 'Armored frontliner. High HP and defense, short reach.',
    baseAttributes: { str: 6, dex: 4, int: 2, vit: 6, spd: 3 },
    baseHp: 18,
    armor: 3,
    move: 3,
    weapons: ['longsword', 'spear', 'greataxe'],
    skills: ['power_strike', 'cleave', 'shield_wall', 'rally'],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    description: 'Mobile archer. Strikes from range, fragile up close.',
    baseAttributes: { str: 4, dex: 6, int: 3, vit: 4, spd: 6 },
    baseHp: 14,
    armor: 1,
    move: 4,
    weapons: ['longbow', 'shortbow', 'twin_daggers'],
    skills: ['aimed_shot', 'volley', 'hamstring', 'field_dressing'],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description: 'Glass cannon. Devastating area magic, low HP.',
    baseAttributes: { str: 2, dex: 4, int: 7, vit: 3, spd: 4 },
    baseHp: 12,
    armor: 0,
    move: 3,
    weapons: ['oak_staff', 'spell_tome', 'wand'],
    skills: ['fireball', 'lightning', 'frost_nova', 'arcane_shield'],
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    description: 'Support caster. Heals and blesses allies, smites foes.',
    baseAttributes: { str: 4, dex: 3, int: 6, vit: 5, spd: 3 },
    baseHp: 15,
    armor: 2,
    move: 3,
    weapons: ['mace', 'holy_symbol'],
    skills: ['heal', 'smite', 'blessing', 'sanctuary'],
  },
};

export const WEAPONS: Record<string, WeaponDef> = {
  longsword: { id: 'longsword', name: 'Longsword', description: 'Reliable blade.', damageType: 'physical', power: 4, minRange: 1, maxRange: 1, bonus: {} },
  spear: { id: 'spear', name: 'Spear', description: 'Reach 1-2, a bit weaker.', damageType: 'physical', power: 3, minRange: 1, maxRange: 2, bonus: {} },
  greataxe: { id: 'greataxe', name: 'Greataxe', description: 'Huge damage, slows you down.', damageType: 'physical', power: 7, minRange: 1, maxRange: 1, bonus: { spd: -2 } },
  longbow: { id: 'longbow', name: 'Longbow', description: 'Range 2-4. Cannot hit adjacent foes.', damageType: 'physical', power: 4, minRange: 2, maxRange: 4, bonus: {} },
  shortbow: { id: 'shortbow', name: 'Shortbow', description: 'Range 1-3, light and quick.', damageType: 'physical', power: 3, minRange: 1, maxRange: 3, bonus: { spd: 1 } },
  twin_daggers: { id: 'twin_daggers', name: 'Twin Daggers', description: 'Melee, precise and deadly.', damageType: 'physical', power: 4, minRange: 1, maxRange: 1, bonus: { dex: 2, spd: 1 } },
  oak_staff: { id: 'oak_staff', name: 'Oak Staff', description: 'Magic, range 1-2. Sturdy.', damageType: 'magical', power: 3, minRange: 1, maxRange: 2, bonus: { vit: 1 } },
  spell_tome: { id: 'spell_tome', name: 'Spell Tome', description: 'Magic, range 2-3. Strongest focus.', damageType: 'magical', power: 5, minRange: 2, maxRange: 3, bonus: {} },
  wand: { id: 'wand', name: 'Wand', description: 'Magic, range 1-3. Boosts intellect.', damageType: 'magical', power: 2, minRange: 1, maxRange: 3, bonus: { int: 1 } },
  mace: { id: 'mace', name: 'Mace', description: 'Blunt melee weapon.', damageType: 'physical', power: 4, minRange: 1, maxRange: 1, bonus: { vit: 1 } },
  holy_symbol: { id: 'holy_symbol', name: 'Holy Symbol', description: 'Magic, range 1-2. Boosts intellect.', damageType: 'magical', power: 2, minRange: 1, maxRange: 2, bonus: { int: 2 } },
};

export const SKILLS: Record<string, SkillDef> = {
  // Knight
  power_strike: { id: 'power_strike', name: 'Power Strike', description: 'A heavy blow for 160% physical damage.', kind: 'damage', target: 'enemy', damageType: 'physical', power: 1.6, minRange: 1, maxRange: 1, radius: 0, cooldown: 2 },
  cleave: { id: 'cleave', name: 'Cleave', description: 'Hit an adjacent foe and everyone next to it (100%).', kind: 'damage', target: 'enemy', damageType: 'physical', power: 1.0, minRange: 1, maxRange: 1, radius: 1, cooldown: 3 },
  shield_wall: { id: 'shield_wall', name: 'Shield Wall', description: '+5 defense to yourself for 2 turns.', kind: 'status', target: 'ally', damageType: 'physical', power: 0, minRange: 0, maxRange: 0, radius: 0, cooldown: 3, status: { name: 'Shield Wall', stat: 'defense', amount: 5, turns: 2 } },
  rally: { id: 'rally', name: 'Rally', description: 'Allies within 2 tiles gain +3 physical power for 2 turns.', kind: 'status', target: 'ally', damageType: 'physical', power: 0, minRange: 0, maxRange: 0, radius: 2, cooldown: 4, status: { name: 'Rallied', stat: 'physPower', amount: 3, turns: 2 } },
  // Ranger
  aimed_shot: { id: 'aimed_shot', name: 'Aimed Shot', description: 'Long-range shot for 140% damage (range 2-5).', kind: 'damage', target: 'enemy', damageType: 'physical', power: 1.4, minRange: 2, maxRange: 5, radius: 0, cooldown: 2 },
  volley: { id: 'volley', name: 'Volley', description: 'Rain arrows on an area (radius 1) for 80% damage.', kind: 'damage', target: 'enemy', damageType: 'physical', power: 0.8, minRange: 2, maxRange: 4, radius: 1, cooldown: 3 },
  hamstring: { id: 'hamstring', name: 'Hamstring', description: '90% damage and -2 move for 2 turns (range 1-3).', kind: 'damage', target: 'enemy', damageType: 'physical', power: 0.9, minRange: 1, maxRange: 3, radius: 0, cooldown: 3, status: { name: 'Hamstrung', stat: 'move', amount: -2, turns: 2 } },
  field_dressing: { id: 'field_dressing', name: 'Field Dressing', description: 'Patch up yourself or an adjacent ally.', kind: 'heal', target: 'ally', damageType: 'physical', power: 1.0, minRange: 0, maxRange: 1, radius: 0, cooldown: 3 },
  // Mage
  fireball: { id: 'fireball', name: 'Fireball', description: 'Explodes in radius 1 for 120% magic damage.', kind: 'damage', target: 'enemy', damageType: 'magical', power: 1.2, minRange: 2, maxRange: 4, radius: 1, cooldown: 3 },
  lightning: { id: 'lightning', name: 'Lightning', description: 'A single bolt for 150% magic damage (range 1-3).', kind: 'damage', target: 'enemy', damageType: 'magical', power: 1.5, minRange: 1, maxRange: 3, radius: 0, cooldown: 2 },
  frost_nova: { id: 'frost_nova', name: 'Frost Nova', description: 'Freeze foes within 1 tile of you: 80% damage, -2 speed.', kind: 'damage', target: 'enemy', damageType: 'magical', power: 0.8, minRange: 0, maxRange: 0, radius: 1, cooldown: 3, status: { name: 'Chilled', stat: 'speed', amount: -2, turns: 2 } },
  arcane_shield: { id: 'arcane_shield', name: 'Arcane Shield', description: 'An ally within 3 tiles gains +4 defense for 2 turns.', kind: 'status', target: 'ally', damageType: 'magical', power: 0, minRange: 0, maxRange: 3, radius: 0, cooldown: 3, status: { name: 'Arcane Shield', stat: 'defense', amount: 4, turns: 2 } },
  // Cleric
  heal: { id: 'heal', name: 'Heal', description: 'Restore HP to an ally (range 0-3).', kind: 'heal', target: 'ally', damageType: 'magical', power: 1.3, minRange: 0, maxRange: 3, radius: 0, cooldown: 1 },
  smite: { id: 'smite', name: 'Smite', description: 'Holy damage for 140% magic damage (range 1-2).', kind: 'damage', target: 'enemy', damageType: 'magical', power: 1.4, minRange: 1, maxRange: 2, radius: 0, cooldown: 2 },
  blessing: { id: 'blessing', name: 'Blessing', description: 'An ally gains +3 magic power for 3 turns.', kind: 'status', target: 'ally', damageType: 'magical', power: 0, minRange: 0, maxRange: 3, radius: 0, cooldown: 3, status: { name: 'Blessed', stat: 'magPower', amount: 3, turns: 3 } },
  sanctuary: { id: 'sanctuary', name: 'Sanctuary', description: 'Heal all allies within radius 1 of a tile (80%).', kind: 'heal', target: 'ally', damageType: 'magical', power: 0.8, minRange: 0, maxRange: 2, radius: 1, cooldown: 3 },
};

export const PALETTE = ['#3d7be0', '#36b37e', '#e0b44c', '#9b59d0', '#e07b3d', '#2bb5c4', '#e05a9b', '#c9ced8'];
export const ENEMY_COLOR = '#c0392b';
export const EMBLEMS = ['circle', 'square', 'diamond', 'triangle'] as const;

export const MAX_PARTY_SIZE = 4;
export const CREATION_POINTS = 8;
export const POINTS_PER_LEVEL = 3;
export const XP_PER_LEVEL = 100;
export const MAX_ATTRIBUTE = 30;
export const NAME_MAX_LENGTH = 16;

/** Skill slots grow with level: 2 at level 1, 3 at level 3, 4 at level 6. */
export function skillSlotsForLevel(level: number): number {
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}
