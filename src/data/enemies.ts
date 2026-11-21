// Loads and validates enemies.json (enemy types, their level ranges, stats and skills).
import raw from './enemies.json';
import { SKILLS, WEAPONS } from './content';
import { STAT_KEYS, type EnemyDef, type MonsterKind, type Stats } from './types';

export interface EncounterRules {
  threatPerAdventurer: number;
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
const KINDS: MonsterKind[] = ['rat', 'slime', 'wolf', 'human'];

export function parseEnemies(data: unknown): { enemies: Record<string, EnemyDef>; encounter: EncounterRules } {
  const root = obj(data, '(root)');
  const enc = obj(root.encounter ?? {}, 'encounter');
  const encounter: EncounterRules = {
    threatPerAdventurer: num(enc.threatPerAdventurer ?? 1, 'encounter.threatPerAdventurer'),
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
      art: { kind, color: typeof art.color === 'string' ? art.color : undefined },
      stats,
      growthPerLevel: growth,
      skills,
      skillsByLevel: byLevel,
      weapons,
      weaponNames,
      weaponSkills,
    };
  }
  if (Object.keys(enemies).length === 0) fail('enemies', 'must define at least one enemy type');
  return { enemies, encounter };
}

const parsed = parseEnemies(raw);
export const ENEMIES = parsed.enemies;
export const ENCOUNTER = parsed.encounter;
