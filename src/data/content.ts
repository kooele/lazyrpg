// Game content: weapons, skills and skill trees. Base stats and level growth
// live in stats.json. Percentages are written as fractions (0.8 = 80%).
import type { SkillDef, SkillTab, SkillTreeDef, WeaponDef } from './types';

export const WEAPONS: Record<string, WeaponDef> = {
  sword_shield: {
    id: 'sword_shield', name: 'Sword & Shield', tag: 'SW',
    description: 'Sturdy all-rounder. Hits hard up close and protects itself.',
    bonus: { pAtk: 40, defense: 20 },
    skills: ['sword_slash', 'slash_and_smash', 'shield_up'],
  },
  spear: {
    id: 'spear', name: 'Spear', tag: 'SP',
    description: 'Reach and crowd control. Pushes enemies around and guards lanes.',
    bonus: { pAtk: 50 },
    skills: ['spear_thrust', 'circle_swing', 'intercept'],
  },
  bow: {
    id: 'bow', name: 'Bow', tag: 'BW',
    description: 'Long range. Direct shots need line of sight; lobbed shots do not.',
    bonus: { pAtk: 40 },
    skills: ['direct_shot', 'indirect_shot', 'overwatch'],
  },
  staff: {
    id: 'staff', name: 'Staff', tag: 'ST',
    description: 'Channels magic through every strike. Pairs with Mage skills.',
    bonus: { pAtk: 10, mAtk: 50 },
    skills: ['empowered_strike', 'magic_bolt'],
  },
};

export const SKILLS: Record<string, SkillDef> = {
  // ---- Sword & Shield ----
  sword_slash: {
    id: 'sword_slash', name: 'Sword Slash', description: 'Strike a unit for 100% P.Atk.',
    target: 'unit', affects: 'enemy', range: 1.5, minRange: 1, cooldown: 0, hits: [{ pAtk: 1 }],
  },
  slash_and_smash: {
    id: 'slash_and_smash', name: 'Slash and Smash',
    description: 'Sword for 80% P.Atk, then shield for 40% P.Atk + 100% Def.',
    target: 'unit', affects: 'enemy', range: 1, minRange: 1, cooldown: 2, hits: [{ pAtk: 0.8 }, { pAtk: 0.4, def: 1 }],
  },
  shield_up: {
    id: 'shield_up', name: 'Shield Up', description: 'Gain a shield worth 10% of max health until your next turn.',
    target: 'self', affects: 'ally', range: 0, minRange: 0, cooldown: 1, shield: { maxHpPct: 0.1, turns: 1 },
  },
  // ---- Spear ----
  spear_thrust: {
    id: 'spear_thrust', name: 'Spear Thrust',
    description: 'Thrust up to 2 tiles in a direction: 100% P.Atk to the first enemy hit, knocking it back 1 tile.',
    target: 'line', affects: 'enemy', range: 2, minRange: 1, lineLength: 2, cooldown: 0, hits: [{ pAtk: 1 }], knockback: 1,
  },
  circle_swing: {
    id: 'circle_swing', name: 'Circle Swing',
    description: 'Hit ALL units on the 8 surrounding tiles (allies too!) for 100% P.Atk and knock them back 1 tile.',
    target: 'self', affects: 'any', range: 0, minRange: 0, aoeRadius: 1.5, cooldown: 2, hits: [{ pAtk: 1 }], knockback: 1,
  },
  intercept: {
    id: 'intercept', name: 'Intercept',
    description: 'Overwatch a 60° cone (2 tiles). Strikes the first enemy that moves into it for 100% P.Atk and stops its movement.',
    target: 'cone', affects: 'enemy', range: 2, minRange: 1, cooldown: 0, hits: [{ pAtk: 1 }],
    cone: { angle: 60, radius: 2, interrupt: true },
  },
  // ---- Bow ----
  direct_shot: {
    id: 'direct_shot', name: 'Direct Shot', description: 'Shoot a unit for 100% P.Atk. Needs line of fire: rocks AND units in between block the shot.',
    target: 'unit', affects: 'enemy', range: 5, minRange: 1, los: 'fire', cooldown: 0, hits: [{ pAtk: 1 }],
  },
  indirect_shot: {
    id: 'indirect_shot', name: 'Indirect Shot', description: 'Lob an arrow over obstacles for 70% P.Atk.',
    target: 'unit', affects: 'enemy', range: 6, minRange: 1, cooldown: 0, hits: [{ pAtk: 0.7 }],
  },
  overwatch: {
    id: 'overwatch', name: 'Overwatch',
    description: 'Watch a 90° cone (5 tiles, needs line of sight). Shoots the first enemy that moves into it for 100% P.Atk without stopping it.',
    target: 'cone', affects: 'enemy', range: 5, minRange: 1, cooldown: 0, hits: [{ pAtk: 1 }],
    cone: { angle: 90, radius: 5, interrupt: false, los: 'sight' },
  },
  // ---- Staff ----
  empowered_strike: {
    id: 'empowered_strike', name: 'Empowered Strike', description: 'Strike a unit for 100% P.Atk + 50% M.Atk.',
    target: 'unit', affects: 'enemy', range: 1.5, minRange: 1, cooldown: 0, hits: [{ pAtk: 1, mAtk: 0.5 }],
  },
  magic_bolt: {
    id: 'magic_bolt', name: 'Magic Bolt', description: 'Bolt a unit for 50% P.Atk + 50% M.Atk.',
    target: 'unit', affects: 'enemy', range: 5, minRange: 1, los: 'sight', cooldown: 0, hits: [{ pAtk: 0.5, mAtk: 0.5 }],
  },

  // ---- Mage tab: Arcanist ----
  arcane_bolt: {
    id: 'arcane_bolt', name: 'Arcane Bolt', description: 'Blast a unit for 100% M.Atk.',
    target: 'unit', affects: 'enemy', range: 5, minRange: 1, los: 'sight', cooldown: 0, hits: [{ mAtk: 1 }],
  },
  arcane_shift: {
    id: 'arcane_shift', name: 'Arcane Shift', description: 'Teleport yourself to an empty tile.',
    target: 'emptyTile', affects: 'ally', range: 2.8, minRange: 1, cooldown: 2, teleport: true,
  },
  // ---- Mage tab: Elementalist ----
  fireball: {
    id: 'fireball', name: 'Fireball',
    description: '100% M.Atk and 1 stack of Burn for 2 turns (each stack burns 1% max health per turn).',
    target: 'unit', affects: 'enemy', range: 5, minRange: 1, los: 'sight', cooldown: 2, hits: [{ mAtk: 1 }], burn: { stacks: 1, turns: 2 },
  },
  // ---- Mage tab: Cleric ----
  heal: {
    id: 'heal', name: 'Heal', description: 'Heal a unit for 80% M.Atk.',
    target: 'unit', affects: 'ally', range: 5, minRange: 0, cooldown: 2, heal: { mAtk: 0.8 },
  },
  cleanse: {
    id: 'cleanse', name: 'Cleanse', description: 'Remove all debuffs (e.g. Burn) from a unit.',
    target: 'unit', affects: 'ally', range: 5, minRange: 0, cooldown: 0, cleanse: true,
  },
  // ---- Warrior tab: Vanguard ----
  charge: {
    id: 'charge', name: 'Charge', description: 'Dash next to a unit (up to 5 tiles) and strike for 80% P.Atk.',
    target: 'unit', affects: 'enemy', range: 5, minRange: 1, cooldown: 2, hits: [{ pAtk: 0.8 }], charge: true,
  },
  // ---- Warrior tab: Infighter ----
  kick: {
    id: 'kick', name: 'Kick', description: 'Kick for 60% P.Atk. Free: you can still act afterwards.',
    target: 'unit', affects: 'enemy', range: 1.5, minRange: 1, cooldown: 1, free: true, hits: [{ pAtk: 0.6 }],
  },
  // ---- Warrior tab: Assassin ----
  execute: {
    id: 'execute', name: 'Execute', description: "50% P.Atk plus 10% of the target's missing health.",
    target: 'unit', affects: 'enemy', range: 1.5, minRange: 1, cooldown: 0, hits: [{ pAtk: 0.5, missingHp: 0.1 }],
  },
};

export const SKILL_TABS: { id: SkillTab; name: string }[] = [
  { id: 'mage', name: 'Mage' },
  { id: 'warrior', name: 'Warrior' },
];

export const SKILL_TREES: SkillTreeDef[] = [
  { id: 'arcanist', name: 'Arcanist', tab: 'mage', skills: ['arcane_bolt', 'arcane_shift'] },
  { id: 'elementalist', name: 'Elementalist', tab: 'mage', skills: ['fireball'] },
  { id: 'cleric', name: 'Cleric', tab: 'mage', skills: ['heal', 'cleanse'] },
  { id: 'vanguard', name: 'Vanguard', tab: 'warrior', skills: ['charge'] },
  { id: 'infighter', name: 'Infighter', tab: 'warrior', skills: ['kick'] },
  { id: 'assassin', name: 'Assassin', tab: 'warrior', skills: ['execute'] },
];

/** Every skill that can be picked from a tree. */
export const TREE_SKILLS: string[] = SKILL_TREES.flatMap((t) => t.skills);

/** One-line summary of a skill's rules (range, cooldown...). */
export function skillDetails(s: SkillDef): string {
  const parts: string[] = [];
  if (s.target === 'self') parts.push(s.aoeRadius ? `Around you (${s.aoeRadius})` : 'Self');
  else if (s.target === 'cone' && s.cone) parts.push(`${s.cone.angle}° cone, ${s.cone.radius} tiles`);
  else if (s.target === 'line') parts.push(`Line, ${s.lineLength} tiles`);
  else parts.push(`Range ${s.range}`);
  parts.push(s.cooldown > 0 ? `Cooldown ${s.cooldown} (skips ${s.cooldown === 1 ? 'next turn' : `next ${s.cooldown} turns`})` : 'No cooldown');
  if (s.free) parts.push('Free action');
  const los = s.los ?? s.cone?.los;
  if (los === 'fire') parts.push('Needs line of fire');
  else if (los === 'sight') parts.push('Needs line of sight');
  return parts.join(' · ');
}

export const PALETTE = ['#3d7be0', '#36b37e', '#e0b44c', '#9b59d0', '#e07b3d', '#2bb5c4', '#e05a9b', '#c9ced8'];
export const ENEMY_COLOR = '#c0392b';
export const EMBLEMS = ['circle', 'square', 'diamond', 'triangle'] as const;

export const MAX_PARTY_SIZE = 4;
export const XP_PER_LEVEL = 100;
export const NAME_MAX_LENGTH = 16;

/** Skill-tree slots grow with level: 2 at level 1, 3 at level 3, 4 at level 6. */
export function skillSlotsForLevel(level: number): number {
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}
