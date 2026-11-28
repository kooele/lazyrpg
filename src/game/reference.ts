// Reference Adventurer builds: the archetypes the strength model measures quests against (src/game/power.ts) and the
// balance simulations field (tools/balance). Skills are listed in the order they are learned; only ones the level has
// unlocked count. The AI can't place zones (Firestorm, Blizzard) or use teleports and cones well, so builds lean on
// skills it plays properly.
import { SKILLS, maxBodyRank, skillPointsForLevel } from '../data/content';
import type { BodyInvestment, Character, QualityId, StatKey, Talent, Talents } from '../data/types';
import { gear } from './gear';
import { talentStats } from './talent';

export interface Build {
  id: string;
  weapon: string;
  armor: string;
  skills: string[];
  /** Body tab investment, in order of preference (each stat up to its cap). */
  body: StatKey[];
  /**
   * The talent spread a player would train for this role, averaging B (growth 1.2): front liners high in Health and
   * Defense, damage dealers high in their attack stat and Mana.
   */
  talents: Talents;
}

const FRONT: Talents = { health: 'A', defense: 'A', pAtk: 'B', resist: 'B', mana: 'C', mAtk: 'C' };
const PHYSICAL: Talents = { pAtk: 'A', mana: 'A', health: 'B', defense: 'B', resist: 'C', mAtk: 'C' };
const MAGICAL: Talents = { mAtk: 'A', mana: 'A', health: 'B', resist: 'B', defense: 'C', pAtk: 'C' };

export const BUILDS: Record<string, Build> = {
  guardian: {
    id: 'guardian', weapon: 'sword_shield', armor: 'plate',
    skills: ['engage', 'double_strike', 'charge', 'tough_it_out', 'execute', 'power_strike', 'blitz', 'fighting_spirit', 'kick', 'tooth_for_tooth'],
    body: ['health', 'defense', 'pAtk'], talents: FRONT,
  },
  caster: {
    id: 'caster', weapon: 'staff', armor: 'leather',
    skills: ['ignite', 'freeze', 'fireball', 'iceblast', 'arcane_bolt', 'sonic_boom', 'lightning_strike', 'arcane_pulse', 'explosion_spell', 'draft'],
    body: ['mAtk', 'mana', 'health'], talents: MAGICAL,
  },
  archer: {
    id: 'archer', weapon: 'longbow', armor: 'leather',
    skills: ['double_strike', 'execute', 'pocket_sand', 'power_strike', 'in_the_zone', 'scout', 'hit_and_run'],
    body: ['pAtk', 'health', 'mana'], talents: PHYSICAL,
  },
  cleric: {
    id: 'cleric', weapon: 'crystal', armor: 'leather',
    skills: ['heal', 'cleanse', 'protection', 'barrier', 'smite', 'emergency_heal', 'arcane_bolt', 'ignite'],
    body: ['mAtk', 'mana', 'health'], talents: MAGICAL,
  },
  bruiser: {
    id: 'bruiser', weapon: 'greatsword', armor: 'mail',
    skills: ['double_strike', 'kick', 'charge', 'execute', 'sucker_punch', 'power_strike', 'fighting_spirit', 'in_the_zone', 'brutal_strike'],
    body: ['pAtk', 'health', 'defense'], talents: PHYSICAL,
  },
};

/** Who goes first as the party grows: a front liner, then damage, then support. */
export const PARTY_ORDER = ['guardian', 'caster', 'archer', 'cleric', 'bruiser'];

/** Every growing stat at one grade. */
export function flatTalents(grade: Talent): Talents {
  return Object.fromEntries(talentStats().map((k) => [k, grade]));
}

let serial = 0;

/**
 * One Adventurer of a build at a level and gear quality, at full Health and Morale. `talent` 'profile' uses the
 * build's own spread (average B); a grade gives every stat that grade.
 */
export function buildCharacter(buildId: string, level: number, talent: Talent | 'profile', quality: QualityId): Character {
  const b = BUILDS[buildId];
  if (!b) throw new Error(`Unknown build ${buildId}`);
  let points = skillPointsForLevel(level);
  const skillIds: string[] = [];
  for (const id of b.skills) {
    if (points <= 0) break;
    if (!SKILLS[id]) throw new Error(`Build ${buildId}: unknown skill ${id}`);
    if (SKILLS[id].level > level) continue;
    skillIds.push(id);
    points--;
  }
  const body: BodyInvestment = {};
  const cap = maxBodyRank(level);
  for (let i = 0; points > 0 && i < 100; i++) {
    const k = b.body.find((s) => (body[s] ?? 0) < cap);
    if (!k) break;
    body[k] = (body[k] ?? 0) + 1;
    points--;
  }
  serial++;
  return {
    id: `sim${serial}`,
    name: `${buildId} ${serial}`,
    level,
    xp: 0,
    weapon: gear(b.weapon, quality),
    armor: gear(b.armor, quality),
    skillIds,
    appearance: { color: '#3d7be0' },
    talents: talent === 'profile' ? { ...b.talents } : flatTalents(talent),
    body,
    health: 100,
    morale: 100,
  };
}
