// Game content loaded from the editable JSON files in this folder:
//   skills.json  – skills, tags, status effects, skill trees
//   weapons.json – weapons (stat multipliers + granted skills)
// Everything is validated on load; a mistake fails with a message naming the field.
import skillsRaw from './skills.json';
import weaponsRaw from './weapons.json';
import {
  AP_COSTS, STAT_KEYS, STAT_INFO,
  type ApCost,
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
  /** Abilities every Adventurer has (Dash, Overwatch). */
  basicSkills: string[];
}

/** Tags that change how a skill behaves (the rest are descriptive). */
export const BEHAVIOR_TAGS = ['engage', 'disengage', 'movement', 'weapon', 'free'] as const;

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
      statPct: st.statPct === undefined ? undefined : S.stats(st.statPct, `${p}.statPct`),
      stealth: S.bool(st.stealth, `${p}.stealth`) || undefined,
    };
  }

  const TARGETS: readonly SkillTarget[] = ['unit', 'self', 'line', 'cone', 'emptyTile', 'move'];
  const LOS: readonly LosRule[] = ['sight', 'fire'];
  const skills: Record<string, SkillDef> = {};
  // Skills with modes (the bow's basic attack) are filled in from their modes once every skill is read.
  const moded: [string, Record<string, unknown>][] = [];
  for (const [id, raw] of entries(S.obj(root.skills, 'skills'))) {
    const p = `skills.${id}`;
    const r = S.obj(raw, p);
    if (r.modes !== undefined) {
      moded.push([id, r]);
      continue;
    }
    const skillTags = S.arr(r.tags ?? [], `${p}.tags`).map((t, i) => {
      const tag = S.str(t, `${p}.tags[${i}]`);
      return tags[tag] ? tag : fail('skills.json', `${p}.tags[${i}]`, `"${tag}" is not defined in "tags"`);
    });
    const part = (h: unknown, path: string): DamagePart => {
      const o = S.obj(h, path);
      return {
        pAtk: S.optNum(o.pAtk, `${path}.pAtk`),
        mAtk: S.optNum(o.mAtk, `${path}.mAtk`),
        def: S.optNum(o.def, `${path}.def`),
        missingHp: S.optNum(o.missingHp, `${path}.missingHp`),
      };
    };
    const hits = r.hits === undefined ? undefined : S.arr(r.hits, `${p}.hits`).map((h, i) => part(h, `${p}.hits[${i}]`));
    const statusList = (v: unknown, path: string) => S.arr(v, path).map((a, i) => {
      const o = S.obj(a, `${path}[${i}]`);
      const status = S.str(o.status, `${path}[${i}].status`);
      if (!statuses[status]) fail('skills.json', `${path}[${i}].status`, `"${status}" is not defined in "statuses"`);
      return { status, turns: S.num(o.turns, `${path}[${i}].turns`), stacks: S.optNum(o.stacks, `${path}[${i}].stacks`) };
    });
    let cone: ConeDef | undefined;
    if (r.cone !== undefined) {
      const c = S.obj(r.cone, `${p}.cone`);
      cone = {
        angle: S.num(c.angle, `${p}.cone.angle`),
        radius: S.optNum(c.radius, `${p}.cone.radius`),
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
      cooldown: S.num(r.cooldown ?? 0, `${p}.cooldown`),
      ap: (AP_COSTS as readonly unknown[]).includes(r.ap ?? (skillTags.includes('free') ? 0 : 'end'))
        ? (r.ap ?? (skillTags.includes('free') ? 0 : 'end')) as ApCost
        : fail('skills.json', `${p}.ap`, 'must be 0, 1, 2 or "end"'),
      mana: S.num(r.mana ?? 0, `${p}.mana`),
      hits,
      heal: r.heal === undefined ? undefined : { mAtk: S.num(S.obj(r.heal, `${p}.heal`).mAtk, `${p}.heal.mAtk`) },
      shield: r.shield === undefined ? undefined : (() => {
        const o = S.obj(r.shield, `${p}.shield`);
        return { maxHpPct: S.num(o.maxHpPct, `${p}.shield.maxHpPct`), turns: S.num(o.turns, `${p}.shield.turns`) };
      })(),
      applyStatus: r.applyStatus === undefined ? undefined : statusList(r.applyStatus, `${p}.applyStatus`),
      knockback: S.optNum(r.knockback, `${p}.knockback`),
      cleanse: S.bool(r.cleanse, `${p}.cleanse`) || undefined,
      aoeRadius: S.optNum(r.aoeRadius, `${p}.aoeRadius`),
      cone,
      teleport: S.bool(r.teleport, `${p}.teleport`) || undefined,
      charge: S.bool(r.charge, `${p}.charge`) || undefined,
      level: S.num(r.level ?? 1, `${p}.level`),
      basicAttack: S.optNum(r.basicAttack, `${p}.basicAttack`),
      selfStatus: r.selfStatus === undefined ? undefined : statusList(r.selfStatus, `${p}.selfStatus`),
      recoilIfSurvives: r.recoilIfSurvives === undefined ? undefined : part(r.recoilIfSurvives, `${p}.recoilIfSurvives`),
      modeName: r.modeName === undefined ? undefined : S.str(r.modeName, `${p}.modeName`),
      weaponRange: S.optNum(r.weaponRange, `${p}.weaponRange`),
      basicMode: r.basicMode === undefined ? undefined : S.str(r.basicMode, `${p}.basicMode`),
      switchMode: S.bool(r.switchMode, `${p}.switchMode`) || undefined,
    };
    if (skill.basicAttack !== undefined && (skill.basicAttack < 1 || !Number.isInteger(skill.basicAttack))) fail('skills.json', `${p}.basicAttack`, 'must be a whole number of 1 or more');
    if (skill.basicAttack !== undefined && skill.hits) fail('skills.json', `${p}.basicAttack`, "can't be combined with \"hits\"");
    if (skill.level < 1 || !Number.isInteger(skill.level)) fail('skills.json', `${p}.level`, 'must be a whole number of 1 or more');
    if (skill.target === 'cone' && !skill.cone) fail('skills.json', `${p}.cone`, 'is required when target is "cone"');
    if (skillTags.includes('movement') && skill.rangeScale === undefined) fail('skills.json', `${p}.rangeScale`, 'is required for "movement" skills');
    skills[id] = skill;
  }

  for (const [id, r] of moded) {
    const p = `skills.${id}`;
    const modes = S.arr(r.modes, `${p}.modes`).map((m, i) => {
      const mid = S.str(m, `${p}.modes[${i}]`);
      if (!skills[mid]) fail('skills.json', `${p}.modes[${i}]`, `"${mid}" is not defined in "skills" (modes can't have modes)`);
      return mid;
    });
    if (modes.length < 2) fail('skills.json', `${p}.modes`, 'needs at least two modes');
    const first = skills[modes[0]];
    skills[id] = {
      ...first,
      id,
      name: S.str(r.name, `${p}.name`),
      description: S.str(r.description, `${p}.description`),
      modeName: undefined,
      level: 1,
      modes,
    };
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

  const basicSkills = S.arr(root.basicSkills ?? [], 'basicSkills').map((sid, i) => {
    const id = S.str(sid, `basicSkills[${i}]`);
    return skills[id] ? id : fail('skills.json', `basicSkills[${i}]`, `"${id}" is not defined in "skills"`);
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
      range: W.optNum(o.range, `${p}.range`),
    };
    for (const sid of ws) {
      const needsRange = [sid, ...(skills[sid].modes ?? [])].some((m) => skills[m].weaponRange !== undefined);
      if (needsRange && weapons[id].range === undefined) fail('weapons.json', `${p}.range`, `is required: "${sid}" uses the weapon's range`);
    }
  }
  if (Object.keys(weapons).length === 0) fail('weapons.json', 'weapons', 'must define at least one weapon');
  return { weapons, skills, tags, statuses, skillTabs, skillTrees, basicSkills };
}

export const CONTENT: GameContent = parseContent(skillsRaw, weaponsRaw);
export const WEAPONS = CONTENT.weapons;
export const SKILLS = CONTENT.skills;
export const TAGS = CONTENT.tags;
export const STATUSES = CONTENT.statuses;
export const SKILL_TABS = CONTENT.skillTabs;
export const SKILL_TREES = CONTENT.skillTrees;
export const BASIC_SKILLS = CONTENT.basicSkills;
export const DEFAULT_WEAPON = Object.keys(WEAPONS)[0];

/** Every skill that can be picked from a tree. */
export const TREE_SKILLS: string[] = SKILL_TREES.flatMap((t) => t.skills);

export const hasTag = (s: SkillDef, tag: string) => s.tags.includes(tag);

/**
 * A weapon skill as a unit uses it: a moded basic attack becomes its current mode
 * (`mode` = index, wraps around), and `weaponRange` skills get their range from the weapon.
 */
export function resolveWeaponSkill(s: SkillDef, weapon: WeaponDef | undefined, mode = 0): SkillDef {
  let out = s;
  if (out.modes) out = CONTENT.skills[out.modes[((mode % out.modes.length) + out.modes.length) % out.modes.length]];
  if (out.weaponRange !== undefined && weapon?.range !== undefined) out = { ...out, range: out.weaponRange * weapon.range };
  return out;
}

/** The weapon mode skill with `tag` (e.g. Circle Swing's 'melee'), if the basic attack has modes. */
export function modeWithTag(basic: SkillDef, tag: string): SkillDef | undefined {
  const id = basic.modes?.find((m) => hasTag(CONTENT.skills[m], tag));
  return id ? CONTENT.skills[id] : undefined;
}
export const isFree = (s: SkillDef) => s.ap === 0;

/** "Free", "1 AP", "2 AP" or "Ends turn". */
export const apLabel = (s: SkillDef) => (s.ap === 0 ? 'Free' : s.ap === 'end' ? 'Ends turn' : `${s.ap} AP`);
/** Helpful skills (heals, cleanses, shields, buffs) are drawn green; attacks red. */
export const isSupport = (s: SkillDef) => s.affects === 'ally' || !!(s.heal || s.cleanse || s.shield);

// ---- descriptions generated from the data (always match the numbers) ---------------

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "80% P.Atk, then 40% P.Atk + 100% Def" etc. */
export function skillFormula(s: SkillDef): string {
  if (s.modes) return s.modes.map((m) => `${SKILLS[m].modeName ?? SKILLS[m].name}: ${skillFormula(SKILLS[m])}`).join(' / ');
  const parts: string[] = [];
  if (s.hits?.length) {
    parts.push(s.hits.map((h) => [
      h.pAtk ? `${pct(h.pAtk)} ${STAT_INFO.pAtk.short}` : '',
      h.mAtk ? `${pct(h.mAtk)} ${STAT_INFO.mAtk.short}` : '',
      h.def ? `${pct(h.def)} ${STAT_INFO.defense.short}` : '',
      h.missingHp ? `${pct(h.missingHp)} target's missing HP` : '',
    ].filter(Boolean).join(' + ')).join(', then '));
  }
  if (s.basicAttack) parts.push(s.basicAttack > 1 ? `basic attack x${s.basicAttack}` : 'basic attack');
  for (const a of s.selfStatus ?? []) parts.push(`you: ${STATUSES[a.status].name} (${a.turns} turn${a.turns > 1 ? 's' : ''})`);
  if (s.heal) parts.push(`heals ${pct(s.heal.mAtk)} M.Atk`);
  if (s.shield) parts.push(`shield ${pct(s.shield.maxHpPct)} max HP for ${s.shield.turns} turn${s.shield.turns > 1 ? 's' : ''}`);
  for (const a of s.applyStatus ?? []) parts.push(`${a.stacks ? `${a.stacks}x ` : ''}${STATUSES[a.status].name} (${a.turns} turns)`);
  if (s.recoilIfSurvives) {
    const r = s.recoilIfSurvives;
    const cost = [r.pAtk ? `${pct(r.pAtk)} P.Atk` : '', r.mAtk ? `${pct(r.mAtk)} M.Atk` : ''].filter(Boolean).join(' + ');
    parts.push(`if it survives, you take ${cost}`);
  }
  if (s.knockback) parts.push(`knockback ${s.knockback}`);
  if (s.cleanse) parts.push('removes debuffs');
  if (s.teleport) parts.push('teleport');
  return parts.join(' · ');
}

const tiles = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;
const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;

/** What a skill can be aimed at. */
function targetLabel(s: SkillDef): string {
  const who = s.affects === 'enemy' ? 'Enemy' : s.affects === 'ally' ? 'Ally' : 'Any unit';
  switch (s.target) {
    case 'unit': return s.affects === 'any' ? 'Any unit (you included)' : who;
    case 'self':
      if (hasTag(s, 'weapon') || s.aoeRadius) return s.affects === 'any' ? 'Every unit around you' : s.affects === 'ally' ? 'You and allies around you' : 'Enemies around you';
      return 'Self';
    case 'line': return `First ${who.toLowerCase()} in a line`;
    case 'cone': return `First enemy to enter a ${s.cone?.angle ?? 60}° cone`;
    case 'emptyTile': return 'Empty tile';
    case 'move': return 'Reachable tile';
  }
}

/** How far a skill reaches. */
function rangeLabel(s: SkillDef): string {
  if (s.weaponRange !== undefined) return `Weapon range${s.weaponRange !== 1 ? ` x${s.weaponRange}` : ''}`;
  if (s.rangeScale !== undefined || s.target === 'move') return 'Movement';
  if (s.target === 'self') return hasTag(s, 'weapon') ? 'Weapon range' : s.aoeRadius ? `${tiles(s.aoeRadius)} radius` : 'Self';
  if (hasTag(s, 'weapon')) return 'Weapon range';
  return tiles(s.range);
}

/**
 * A skill's data as a uniform list of rows, always in the same order: the effect rows it has
 * (Damage, Heal, Shield, Applies, On you, Recoil, Knockback, Cleanse, Move), then the rows every
 * skill has (Target, Range, [Needs], AP, Mana, Cooldown, [Unlocks]). A moded skill (the Bow) lists its modes instead.
 */
export function skillStats(s: SkillDef): SkillStat[] {
  const rows: SkillStat[] = [];
  const row = (label: string, value: string, note?: string) => rows.push({ label, value, note });
  if (s.modes) {
    for (const m of s.modes.map((id) => SKILLS[id])) {
      const los = m.los ? [m.los === 'fire' ? 'Line of fire' : 'Line of sight'] : [];
      row(`${m.modeName ?? m.name} mode`, [skillFormula(m), rangeLabel(m), ...los].join(' · '));
    }
    return rows;
  }
  if (s.hits?.length) {
    row('Damage', s.hits.map((h) => [
      h.pAtk ? `${pct(h.pAtk)} ${STAT_INFO.pAtk.short}` : '',
      h.mAtk ? `${pct(h.mAtk)} ${STAT_INFO.mAtk.short}` : '',
      h.def ? `${pct(h.def)} ${STAT_INFO.defense.short}` : '',
      h.missingHp ? `${pct(h.missingHp)} of target's missing HP` : '',
    ].filter(Boolean).join(' + ')).join(', then '));
  }
  if (s.basicAttack) row('Damage', s.basicAttack > 1 ? `Basic attack x${s.basicAttack}` : 'Basic attack');
  if (s.heal) row('Heal', `${pct(s.heal.mAtk)} ${STAT_INFO.mAtk.short}`);
  if (s.shield) row('Shield', `${pct(s.shield.maxHpPct)} of max HP for ${turns(s.shield.turns)}`);
  for (const a of s.applyStatus ?? []) {
    const st = STATUSES[a.status];
    row('Applies', `${st.name}${a.stacks ? ` x${a.stacks}` : ''}, ${turns(a.turns)}`, st.description);
  }
  for (const a of s.selfStatus ?? []) row('On you', `${STATUSES[a.status].name}, ${turns(a.turns)}`, STATUSES[a.status].description);
  if (s.recoilIfSurvives) {
    const r = s.recoilIfSurvives;
    row('Recoil', `${[r.pAtk ? `${pct(r.pAtk)} P.Atk` : '', r.mAtk ? `${pct(r.mAtk)} M.Atk` : ''].filter(Boolean).join(' + ')} if the target survives`);
  }
  if (s.knockback) row('Knockback', tiles(s.knockback));
  if (s.cleanse) row('Cleanse', 'Removes all debuffs');
  if (s.teleport) row('Move', s.charge ? 'Teleport next to the target' : 'Teleport');
  else if (s.charge) row('Move', 'Dash next to the target');
  row('Target', targetLabel(s));
  row('Range', rangeLabel(s));
  const los = s.los ?? s.cone?.los;
  if (los) row('Needs', los === 'fire' ? 'Line of fire' : 'Line of sight');
  row('AP', apLabel(s));
  row('Mana', s.mana ? `${s.mana} MP` : 'None');
  row('Cooldown', s.cooldown > 0 ? turns(s.cooldown) : 'None');
  if (s.level > 1) row('Unlocks', `Level ${s.level}`);
  return rows;
}

/** One row of `skillStats`: "Label: value", with an optional explanation (a status's effect). */
export interface SkillStat { label: string; value: string; note?: string }

/**
 * `skillStats` as text: one "• Label: value" row per line, a note on an indented line under its row.
 * `compact` (the battle panel and the weapon list) leaves the notes out.
 */
export function skillStatText(s: SkillDef, compact = false): string {
  return skillStats(s).map((r) => `• ${r.label}: ${r.value}${r.note && !compact ? `\n   ${r.note}` : ''}`).join('\n');
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

/** Skill points: 2 at level 1 and 1 more every level. Each one learns a tree skill or buys a Body investment. */
export function skillPointsForLevel(level: number): number {
  return level + 1;
}
