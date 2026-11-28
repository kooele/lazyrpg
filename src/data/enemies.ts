// Loads and validates enemies.json (enemy types, their level ranges, stats and skills).
import raw from './enemies.json';
import { ARMORS, QUALITIES, SKILLS, UNIT_TAG_NAMES, WEAPONS } from './content';
import { BODY_MODELS, ENEMY_AIS, ENEMY_MODELS, STAT_KEYS, type EnemyAi, type EnemyDef, type EnemyLoadout, type MonsterKind, type Stats, type UnitModel } from './types';

export interface EncounterRules {
  maxEnemies: number;
}

/** What enemies drop (enemies.json "loot"). */
export interface LootRules {
  trophyGoldPerLevel: number;
  junkGoldPerLevel: number;
  /** Chance (0-1) that a piece of a human's gear is broken (junk). */
  brokenChance: number;
  /** A broken piece is worth this share of its value. */
  brokenValueShare: number;
}

const fail = (path: string, msg: string): never => {
  throw new Error(`enemies.json: "${path}" ${msg}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, p: string) => (isObj(v) ? v : fail(p, 'must be an object'));
const num = (v: unknown, p: string) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(p, 'must be a number'));
const str = (v: unknown, p: string) => (typeof v === 'string' && v ? v : fail(p, 'must be a non-empty string'));
const list = (v: unknown, p: string) => (v === undefined ? [] : Array.isArray(v) ? v : fail(p, 'must be a list'));
const skillList = (v: unknown, p: string) => list(v, p).map((x, i) => {
  const id = str(x, `${p}[${i}]`);
  return SKILLS[id] ? id : fail(`${p}[${i}]`, `"${id}" is not defined in skills.json`);
});
const KINDS: MonsterKind[] = ['rat', 'slime', 'wolf', 'spider', 'bear', 'troll', 'wraith', 'wyvern', 'demon', 'human'];

/** A tag enemy types can carry ("evil"): skills can do more against it (Smite). */
export interface UnitTagDef {
  id: string;
  name: string;
  description: string;
}

export function parseEnemies(data: unknown): { enemies: Record<string, EnemyDef>; encounter: EncounterRules; loot: LootRules; unitTags: Record<string, UnitTagDef> } {
  const root = obj(data, '(root)');
  const unitTags: Record<string, UnitTagDef> = {};
  for (const [id, t] of Object.entries(obj(root.unitTags ?? {}, 'unitTags'))) {
    if (id.startsWith('_')) continue;
    const o = obj(t, `unitTags.${id}`);
    unitTags[id] = { id, name: str(o.name, `unitTags.${id}.name`), description: str(o.description, `unitTags.${id}.description`) };
  }
  const enc = obj(root.encounter ?? {}, 'encounter');
  const encounter: EncounterRules = {
    maxEnemies: num(enc.maxEnemies ?? 8, 'encounter.maxEnemies'),
  };
  const L = obj(root.loot ?? {}, 'loot');
  const loot: LootRules = {
    trophyGoldPerLevel: num(L.trophyGoldPerLevel ?? 4.5, 'loot.trophyGoldPerLevel'),
    junkGoldPerLevel: num(L.junkGoldPerLevel ?? 4.5, 'loot.junkGoldPerLevel'),
    brokenChance: num(L.brokenChance ?? 2 / 3, 'loot.brokenChance'),
    brokenValueShare: num(L.brokenValueShare ?? 0.25, 'loot.brokenValueShare'),
  };
  if (loot.brokenChance < 0 || loot.brokenChance > 1) fail('loot.brokenChance', 'must be from 0 to 1');
  const enemies: Record<string, EnemyDef> = {};
  for (const [id, rawDef] of Object.entries(obj(root.enemies, 'enemies'))) {
    if (id.startsWith('_')) continue;
    const p = `enemies.${id}`;
    const d = obj(rawDef, p);
    const levels = list(d.levels, `${p}.levels`).map((v, i) => num(v, `${p}.levels[${i}]`));
    if (levels.length !== 2 || levels[0] < 1 || levels[1] < levels[0]) fail(`${p}.levels`, 'must be [lowest, highest] with 1 <= lowest <= highest');
    const st = obj(d.stats, `${p}.stats`);
    const stats = {} as Stats;
    for (const k of STAT_KEYS) stats[k] = num(st[k] ?? 0, `${p}.stats.${k}`);
    if (stats.health <= 0) fail(`${p}.stats.health`, 'must be positive');
    const growth: Partial<Stats> = {};
    for (const [k, v] of Object.entries(obj(d.growthPerLevel ?? {}, `${p}.growthPerLevel`))) {
      if (!(STAT_KEYS as readonly string[]).includes(k)) fail(`${p}.growthPerLevel.${k}`, 'is not a stat');
      growth[k as keyof Stats] = num(v, `${p}.growthPerLevel.${k}`);
    }
    const bend: Partial<Stats> = {};
    for (const [k, v] of Object.entries(obj(d.growthBend ?? {}, `${p}.growthBend`))) {
      if (!(STAT_KEYS as readonly string[]).includes(k)) fail(`${p}.growthBend.${k}`, 'is not a stat');
      bend[k as keyof Stats] = num(v, `${p}.growthBend.${k}`);
    }
    const art = obj(d.art, `${p}.art`);
    const kind = str(art.kind, `${p}.art.kind`) as MonsterKind;
    if (!KINDS.includes(kind)) fail(`${p}.art.kind`, `must be one of: ${KINDS.join(', ')}`);
    const allModels: readonly string[] = [...BODY_MODELS, ...ENEMY_MODELS];
    const models = art.models === undefined ? undefined : list(art.models, `${p}.art.models`).map((m, i) => {
      const id = str(m, `${p}.art.models[${i}]`);
      return allModels.includes(id) ? (id as UnitModel) : fail(`${p}.art.models[${i}]`, `must be one of: ${allModels.join(', ')}`);
    });
    const loadouts = list(d.loadouts, `${p}.loadouts`).map((l, i): EnemyLoadout => {
      const lp = `${p}.loadouts[${i}]`;
      const o = obj(l, lp);
      const weapon = str(o.weapon, `${lp}.weapon`);
      if (!WEAPONS[weapon] || WEAPONS[weapon].builtIn) fail(`${lp}.weapon`, `"${weapon}" is not a weapon in equipment.json`);
      const armor = o.armor === undefined ? undefined : str(o.armor, `${lp}.armor`);
      if (armor !== undefined && (!ARMORS[armor] || ARMORS[armor].builtIn)) fail(`${lp}.armor`, `"${armor}" is not an armor in equipment.json (leave it out for no armor)`);
      const weight = o.weight === undefined ? 1 : num(o.weight, `${lp}.weight`);
      if (weight <= 0) fail(`${lp}.weight`, 'must be positive');
      return { name: str(o.name, `${lp}.name`), weapon, ...(armor ? { armor } : {}), skills: skillList(o.skills, `${lp}.skills`), weight };
    });
    const gearQuality = d.gearQuality === undefined ? 'crude' : str(d.gearQuality, `${p}.gearQuality`);
    if (!QUALITIES[gearQuality]) fail(`${p}.gearQuality`, `"${gearQuality}" is not a quality in equipment.json`);
    const skills = skillList(d.skills, `${p}.skills`);
    if (skills.length === 0 && loadouts.length === 0) fail(`${p}.skills`, 'needs at least one skill (or a loadout)');
    const byLevel: Record<number, string[]> = {};
    for (const [lvl, v] of Object.entries(obj(d.skillsByLevel ?? {}, `${p}.skillsByLevel`))) byLevel[Number(lvl)] = skillList(v, `${p}.skillsByLevel.${lvl}`);
    enemies[id] = {
      id,
      name: str(d.name, `${p}.name`),
      levels: [levels[0], levels[1]],
      threat: num(d.threat ?? 1, `${p}.threat`),
      power: num(d.power ?? 1, `${p}.power`),
      group: num(d.group ?? 4, `${p}.group`),
      questTitle: typeof d.questTitle === 'string' && d.questTitle ? d.questTitle : `${str(d.name, `${p}.name`)} Sighting`,
      ai: (ENEMY_AIS as readonly unknown[]).includes(d.ai) ? (d.ai as EnemyAi) : fail(`${p}.ai`, `must be one of: ${ENEMY_AIS.join(', ')}`),
      art: { kind, color: typeof art.color === 'string' ? art.color : undefined, models },
      stats,
      growthPerLevel: growth,
      growthBend: bend,
      skills,
      skillsByLevel: byLevel,
      loadouts,
      gearQuality,
      tags: list(d.tags, `${p}.tags`).map((t, i) => {
        const tag = str(t, `${p}.tags[${i}]`);
        return unitTags[tag] ? tag : fail(`${p}.tags[${i}]`, `"${tag}" is not defined in "unitTags"`);
      }),
      ...(d.drops !== undefined ? { drops: (() => {
        const o = obj(d.drops, `${p}.drops`);
        const junk = str(o.junk, `${p}.drops.junk`);
        if (junk.includes('{weapon}') && loadouts.length === 0) fail(`${p}.drops.junk`, 'uses {weapon}, but the type has no loadouts');
        return { trophy: str(o.trophy, `${p}.drops.trophy`), junk };
      })() } : {}),
      weaponSkillUse: d.weaponSkillUse === undefined ? 'all'
        : d.weaponSkillUse === 'basic' || d.weaponSkillUse === 'all' ? d.weaponSkillUse
          : fail(`${p}.weaponSkillUse`, 'must be "basic" or "all"'),
    };
  }
  if (Object.keys(enemies).length === 0) fail('enemies', 'must define at least one enemy type');
  for (const e of Object.values(enemies)) if (e.ai !== 'human' && !e.drops) fail(`enemies.${e.id}.drops`, 'is required for non-human types ({ trophy, junk })');
  return { enemies, encounter, loot, unitTags };
}

const parsed = parseEnemies(raw);
export const ENEMIES = parsed.enemies;
export const ENCOUNTER = parsed.encounter;
export const LOOT = parsed.loot;
export const UNIT_TAGS = parsed.unitTags;
for (const t of Object.values(UNIT_TAGS)) UNIT_TAG_NAMES[t.id] = t.name;
