// Loads and validates enemies.json (enemy types, their level ranges, stats and skills).
import raw from './enemies.json';
import { SKILLS, WEAPONS } from './content';
import { BODY_MODELS, ENEMY_AIS, ENEMY_MODELS, STAT_KEYS, type EnemyAi, type EnemyDef, type MonsterKind, type Stats, type UnitModel } from './types';

export interface EncounterRules {
  /** Threat budget of one encounter (before the quest's threat multiplier); never depends on the party. */
  threat: number;
  maxEnemies: number;
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

export function parseEnemies(data: unknown): { enemies: Record<string, EnemyDef>; encounter: EncounterRules } {
  const root = obj(data, '(root)');
  const enc = obj(root.encounter ?? {}, 'encounter');
  const encounter: EncounterRules = {
    threat: num(enc.threat ?? 4, 'encounter.threat'),
    maxEnemies: num(enc.maxEnemies ?? 8, 'encounter.maxEnemies'),
  };
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
    const art = obj(d.art, `${p}.art`);
    const kind = str(art.kind, `${p}.art.kind`) as MonsterKind;
    if (!KINDS.includes(kind)) fail(`${p}.art.kind`, `must be one of: ${KINDS.join(', ')}`);
    const allModels: readonly string[] = [...BODY_MODELS, ...ENEMY_MODELS];
    const models = art.models === undefined ? undefined : list(art.models, `${p}.art.models`).map((m, i) => {
      const id = str(m, `${p}.art.models[${i}]`);
      return allModels.includes(id) ? (id as UnitModel) : fail(`${p}.art.models[${i}]`, `must be one of: ${allModels.join(', ')}`);
    });
    const weapons = list(d.weapons, `${p}.weapons`).map((w, i) => {
      const wid = str(w, `${p}.weapons[${i}]`);
      return WEAPONS[wid] ? wid : fail(`${p}.weapons[${i}]`, `"${wid}" is not defined in weapons.json`);
    });
    const skills = skillList(d.skills, `${p}.skills`);
    if (skills.length === 0 && weapons.length === 0) fail(`${p}.skills`, 'needs at least one skill (or a weapon)');
    const byLevel: Record<number, string[]> = {};
    for (const [lvl, v] of Object.entries(obj(d.skillsByLevel ?? {}, `${p}.skillsByLevel`))) byLevel[Number(lvl)] = skillList(v, `${p}.skillsByLevel.${lvl}`);
    const weaponSkills: Record<string, string[]> = {};
    for (const [w, v] of Object.entries(obj(d.weaponSkills ?? {}, `${p}.weaponSkills`))) weaponSkills[w] = skillList(v, `${p}.weaponSkills.${w}`);
    const weaponNames: Record<string, string> = {};
    for (const [w, v] of Object.entries(obj(d.weaponNames ?? {}, `${p}.weaponNames`))) weaponNames[w] = str(v, `${p}.weaponNames.${w}`);
    enemies[id] = {
      id,
      name: str(d.name, `${p}.name`),
      levels: [levels[0], levels[1]],
      threat: num(d.threat ?? 1, `${p}.threat`),
      questTitle: typeof d.questTitle === 'string' && d.questTitle ? d.questTitle : `${str(d.name, `${p}.name`)} Sighting`,
      ai: (ENEMY_AIS as readonly unknown[]).includes(d.ai) ? (d.ai as EnemyAi) : fail(`${p}.ai`, `must be one of: ${ENEMY_AIS.join(', ')}`),
      art: { kind, color: typeof art.color === 'string' ? art.color : undefined, models },
      stats,
      growthPerLevel: growth,
      skills,
      skillsByLevel: byLevel,
      weapons,
      weaponNames,
      weaponSkills,
      weaponSkillUse: d.weaponSkillUse === undefined ? 'all'
        : d.weaponSkillUse === 'basic' || d.weaponSkillUse === 'all' ? d.weaponSkillUse
          : fail(`${p}.weaponSkillUse`, 'must be "basic" or "all"'),
    };
  }
  if (Object.keys(enemies).length === 0) fail('enemies', 'must define at least one enemy type');
  return { enemies, encounter };
}

const parsed = parseEnemies(raw);
export const ENEMIES = parsed.enemies;
export const ENCOUNTER = parsed.encounter;
