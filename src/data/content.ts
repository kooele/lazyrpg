// Game content loaded from the editable JSON files in this folder:
//   skills.json  – skills, tags, status effects, skill trees
//   weapons.json – weapons (stat multipliers + granted skills)
// Everything is validated on load; a mistake fails with a message naming the field.
import skillsRaw from './skills.json';
import weaponsRaw from './weapons.json';
import {
  STAT_KEYS, STAT_INFO,
  type ConeDef, type DamagePart, type LosRule, type SkillDef, type SkillTab, type SkillTarget, type SkillTreeDef,
  type Stats, type StatusDef, type TagDef, type WeaponDef,
} from './types';

export interface GameContent {
  weapons: Record<string, WeaponDef>;
  skills: Record<string, SkillDef>;
  tags: Record<string, TagDef>;
  statuses: Record<string, StatusDef>;
  skillTabs: { id: SkillTab; name: string }[];
  skillTrees: SkillTreeDef[];
}

/** Tags that change how a skill behaves (the rest are descriptive). */
export const BEHAVIOR_TAGS = ['engage', 'movement', 'weapon', 'free'] as const;

// ---- validation helpers ---------------------------------------------------------

class ContentError extends Error {}
const fail = (file: string, path: string, msg: string): never => {
  throw new ContentError(`${file}: "${path}" ${msg}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function reader(file: string) {
  const obj = (v: unknown, path: string) => (isObj(v) ? v : fail(file, path, 'must be an object'));
  const str = (v: unknown, path: string) => (typeof v === 'string' && v.length > 0 ? v : fail(file, path, 'must be a non-empty string'));
  const num = (v: unknown, path: string) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(file, path, 'must be a number'));
  const optNum = (v: unknown, path: string) => (v === undefined ? undefined : num(v, path));
  const bool = (v: unknown, path: string) => (v === undefined ? false : typeof v === 'boolean' ? v : fail(file, path, 'must be true or false'));
  const oneOf = <T extends string>(v: unknown, path: string, allowed: readonly T[]): T =>
    (allowed as readonly unknown[]).includes(v) ? (v as T) : fail(file, path, `must be one of: ${allowed.join(', ')}`);
  const arr = (v: unknown, path: string) => (Array.isArray(v) ? v : fail(file, path, 'must be a list'));
  const stats = (v: unknown, path: string): Partial<Stats> => {
    const o = obj(v, path);
    const out: Partial<Stats> = {};
    for (const [k, val] of Object.entries(o)) {
      if (k.startsWith('_')) continue;
      if (!(STAT_KEYS as readonly string[]).includes(k)) fail(file, `${path}.${k}`, `is not a stat (use: ${STAT_KEYS.join(', ')})`);
      out[k as keyof Stats] = num(val, `${path}.${k}`);
    }
    return out;
  };
  return { obj, str, num, optNum, bool, oneOf, arr, stats };
}

const entries = (o: Record<string, unknown>) => Object.entries(o).filter(([k]) => !k.startsWith('_'));

// ---- parsing ---------------------------------------------------------------------------

export function parseContent(skillsData: unknown, weaponsData: unknown): GameContent {
  const S = reader('skills.json');
  const root = S.obj(skillsData, '(root)');

  const tags: Record<string, TagDef> = {};
  for (const [id, raw] of entries(S.obj(root.tags, 'tags'))) {
    const t = S.obj(raw, `tags.${id}`);
    tags[id] = { id, name: S.str(t.name, `tags.${id}.name`), description: S.str(t.description, `tags.${id}.description`) };
  }
  for (const t of BEHAVIOR_TAGS) if (!tags[t]) fail('skills.json', `tags.${t}`, 'is required (the game uses it)');

  const statuses: Record<string, StatusDef> = {};
  for (const [id, raw] of entries(S.obj(root.statuses, 'statuses'))) {
    const p = `statuses.${id}`;
    const st = S.obj(raw, p);
    statuses[id] = {
      id,
      name: S.str(st.name, `${p}.name`),
      description: S.str(st.description, `${p}.description`),
      debuff: S.bool(st.debuff, `${p}.debuff`),
      stacking: S.bool(st.stacking, `${p}.stacking`),
      tick: S.oneOf(st.tick ?? 'start', `${p}.tick`, ['start', 'end'] as const),
      damagePctMaxHpPerStack: S.optNum(st.damagePctMaxHpPerStack, `${p}.damagePctMaxHpPerStack`),
      statMods: st.statMods === undefined ? undefined : S.stats(st.statMods, `${p}.statMods`),
    };
  }

  const TARGETS: readonly SkillTarget[] = ['unit', 'self', 'line', 'cone', 'emptyTile'];
  const LOS: readonly LosRule[] = ['sight', 'fire'];
  const skills: Record<string, SkillDef> = {};
  for (const [id, raw] of entries(S.obj(root.skills, 'skills'))) {
    const p = `skills.${id}`;
    const r = S.obj(raw, p);
    const skillTags = S.arr(r.tags ?? [], `${p}.tags`).map((t, i) => {
      const tag = S.str(t, `${p}.tags[${i}]`);
      return tags[tag] ? tag : fail('skills.json', `${p}.tags[${i}]`, `"${tag}" is not defined in "tags"`);
    });
    const hits = r.hits === undefined ? undefined : S.arr(r.hits, `${p}.hits`).map((h, i): DamagePart => {
      const o = S.obj(h, `${p}.hits[${i}]`);
      return {
        pAtk: S.optNum(o.pAtk, `${p}.hits[${i}].pAtk`),
        mAtk: S.optNum(o.mAtk, `${p}.hits[${i}].mAtk`),
        def: S.optNum(o.def, `${p}.hits[${i}].def`),
        missingHp: S.optNum(o.missingHp, `${p}.hits[${i}].missingHp`),
      };
    });
    let cone: ConeDef | undefined;
    if (r.cone !== undefined) {
      const c = S.obj(r.cone, `${p}.cone`);
      cone = {
        angle: S.num(c.angle, `${p}.cone.angle`),
        radius: S.num(c.radius, `${p}.cone.radius`),
        interrupt: S.bool(c.interrupt, `${p}.cone.interrupt`),
        los: c.los === undefined ? undefined : S.oneOf(c.los, `${p}.cone.los`, LOS),
      };
    }
    const skill: SkillDef = {
      id,
      name: S.str(r.name, `${p}.name`),
      description: S.str(r.description, `${p}.description`),
      tags: skillTags,
      target: S.oneOf(r.target, `${p}.target`, TARGETS),
      affects: S.oneOf(r.affects, `${p}.affects`, ['enemy', 'ally', 'any'] as const),
      range: S.num(r.range, `${p}.range`),
      minRange: S.num(r.minRange ?? 0, `${p}.minRange`),
      rangeScale: S.optNum(r.rangeScale, `${p}.rangeScale`),
      los: r.los === undefined ? undefined : S.oneOf(r.los, `${p}.los`, LOS),
      accuracy: S.optNum(r.accuracy, `${p}.accuracy`),
      cooldown: S.num(r.cooldown ?? 0, `${p}.cooldown`),
      hits,
      heal: r.heal === undefined ? undefined : { mAtk: S.num(S.obj(r.heal, `${p}.heal`).mAtk, `${p}.heal.mAtk`) },
      shield: r.shield === undefined ? undefined : (() => {
        const o = S.obj(r.shield, `${p}.shield`);
        return { maxHpPct: S.num(o.maxHpPct, `${p}.shield.maxHpPct`), turns: S.num(o.turns, `${p}.shield.turns`) };
      })(),
      applyStatus: r.applyStatus === undefined ? undefined : S.arr(r.applyStatus, `${p}.applyStatus`).map((a, i) => {
        const o = S.obj(a, `${p}.applyStatus[${i}]`);
        const status = S.str(o.status, `${p}.applyStatus[${i}].status`);
        if (!statuses[status]) fail('skills.json', `${p}.applyStatus[${i}].status`, `"${status}" is not defined in "statuses"`);
        return { status, turns: S.num(o.turns, `${p}.applyStatus[${i}].turns`), stacks: S.optNum(o.stacks, `${p}.applyStatus[${i}].stacks`) };
      }),
      knockback: S.optNum(r.knockback, `${p}.knockback`),
      cleanse: S.bool(r.cleanse, `${p}.cleanse`) || undefined,
      aoeRadius: S.optNum(r.aoeRadius, `${p}.aoeRadius`),
      lineLength: S.optNum(r.lineLength, `${p}.lineLength`),
      cone,
      teleport: S.bool(r.teleport, `${p}.teleport`) || undefined,
      charge: S.bool(r.charge, `${p}.charge`) || undefined,
    };
    if (skill.target === 'cone' && !skill.cone) fail('skills.json', `${p}.cone`, 'is required when target is "cone"');
    if (skill.target === 'line' && !skill.lineLength) fail('skills.json', `${p}.lineLength`, 'is required when target is "line"');
    if (skillTags.includes('movement') && skill.rangeScale === undefined) fail('skills.json', `${p}.rangeScale`, 'is required for "movement" skills');
    skills[id] = skill;
  }

  const skillTabs = S.arr(root.skillTabs, 'skillTabs').map((t, i) => {
    const o = S.obj(t, `skillTabs[${i}]`);
    return { id: S.str(o.id, `skillTabs[${i}].id`), name: S.str(o.name, `skillTabs[${i}].name`) };
  });
  const tabIds = skillTabs.map((t) => t.id);
  const skillTrees = S.arr(root.skillTrees, 'skillTrees').map((t, i): SkillTreeDef => {
    const p = `skillTrees[${i}]`;
    const o = S.obj(t, p);
    return {
      id: S.str(o.id, `${p}.id`),
      name: S.str(o.name, `${p}.name`),
      tab: S.oneOf(o.tab, `${p}.tab`, tabIds),
      skills: S.arr(o.skills, `${p}.skills`).map((sid, j) => {
        const id = S.str(sid, `${p}.skills[${j}]`);
        return skills[id] ? id : fail('skills.json', `${p}.skills[${j}]`, `"${id}" is not defined in "skills"`);
      }),
    };
  });

  const W = reader('weapons.json');
  const weapons: Record<string, WeaponDef> = {};
  for (const [id, raw] of entries(W.obj(W.obj(weaponsData, '(root)').weapons, 'weapons'))) {
    const p = `weapons.${id}`;
    const o = W.obj(raw, p);
    const ws = W.arr(o.skills, `${p}.skills`).map((sid, j) => {
      const s = W.str(sid, `${p}.skills[${j}]`);
      return skills[s] ? s : fail('weapons.json', `${p}.skills[${j}]`, `"${s}" is not defined in skills.json`);
    });
    if (ws.length === 0) fail('weapons.json', `${p}.skills`, 'needs at least one skill (the first is the basic attack)');
    weapons[id] = {
      id,
      name: W.str(o.name, `${p}.name`),
      tag: W.str(o.tag, `${p}.tag`),
      art: W.str(o.art ?? id, `${p}.art`),
      description: W.str(o.description, `${p}.description`),
      statMultipliers: W.stats(o.statMultipliers ?? {}, `${p}.statMultipliers`),
      skills: ws,
    };
  }
  if (Object.keys(weapons).length === 0) fail('weapons.json', 'weapons', 'must define at least one weapon');
  return { weapons, skills, tags, statuses, skillTabs, skillTrees };
}

export const CONTENT: GameContent = parseContent(skillsRaw, weaponsRaw);
export const WEAPONS = CONTENT.weapons;
export const SKILLS = CONTENT.skills;
export const TAGS = CONTENT.tags;
export const STATUSES = CONTENT.statuses;
export const SKILL_TABS = CONTENT.skillTabs;
export const SKILL_TREES = CONTENT.skillTrees;
export const DEFAULT_WEAPON = Object.keys(WEAPONS)[0];

/** Every skill that can be picked from a tree. */
export const TREE_SKILLS: string[] = SKILL_TREES.flatMap((t) => t.skills);

export const hasTag = (s: SkillDef, tag: string) => s.tags.includes(tag);
export const isFree = (s: SkillDef) => hasTag(s, 'free');

// ---- descriptions generated from the data (always match the numbers) ---------------

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "80% P.Atk, then 40% P.Atk + 100% Def" etc. */
export function skillFormula(s: SkillDef): string {
  const parts: string[] = [];
  if (s.hits?.length) {
    parts.push(s.hits.map((h) => [
      h.pAtk ? `${pct(h.pAtk)} ${STAT_INFO.pAtk.short}` : '',
      h.mAtk ? `${pct(h.mAtk)} ${STAT_INFO.mAtk.short}` : '',
      h.def ? `${pct(h.def)} ${STAT_INFO.defense.short}` : '',
      h.missingHp ? `${pct(h.missingHp)} target's missing HP` : '',
    ].filter(Boolean).join(' + ')).join(', then '));
  }
  if (s.heal) parts.push(`heals ${pct(s.heal.mAtk)} M.Atk`);
  if (s.shield) parts.push(`shield ${pct(s.shield.maxHpPct)} max HP for ${s.shield.turns} turn${s.shield.turns > 1 ? 's' : ''}`);
  for (const a of s.applyStatus ?? []) parts.push(`${a.stacks ? `${a.stacks}x ` : ''}${STATUSES[a.status].name} (${a.turns} turns)`);
  if (s.knockback) parts.push(`knockback ${s.knockback}`);
  if (s.cleanse) parts.push('removes debuffs');
  if (s.teleport) parts.push('teleport');
  return parts.join(' · ');
}

/** One-line summary of a skill's rules: cooldown and line requirement. (Reach is shown as a tile diagram.) */
export function skillDetails(s: SkillDef): string {
  const parts = [s.cooldown > 0 ? `Cooldown ${s.cooldown}` : 'No cooldown'];
  const los = s.los ?? s.cone?.los;
  if (los === 'fire') parts.push('Needs line of fire');
  else if (los === 'sight') parts.push('Needs line of sight');
  return parts.join(' · ');
}

/** Display names of a skill's tags. */
export function tagNames(s: SkillDef): string[] {
  return s.tags.map((t) => TAGS[t]?.name ?? t);
}

export const PALETTE = ['#3d7be0', '#36b37e', '#e0b44c', '#9b59d0', '#e07b3d', '#2bb5c4', '#e05a9b', '#c9ced8'];
export const ENEMY_COLOR = '#c0392b';

export const MAX_PARTY_SIZE = 4;
export const XP_PER_LEVEL = 100;
export const NAME_MAX_LENGTH = 16;

/** Skill-tree slots grow with level: 2 at level 1, 3 at level 3, 4 at level 6. */
export function skillSlotsForLevel(level: number): number {
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}
