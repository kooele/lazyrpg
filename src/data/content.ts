// Game content loaded from the editable JSON files in this folder:
//   skills.json  – skills, tags, status effects, skill trees
//   equipment.json – weapons and armor (base stats, stat modifiers, granted skills) and quality tiers
// Everything is validated on load; a mistake fails with a message naming the field.
import skillsRaw from './skills.json';
import equipmentRaw from './equipment.json';
import { STAT_CONFIG } from './stats';
import {
  AP_COSTS, STAT_KEYS, STAT_INFO,
  type ApCost,
  type ConeDef, type DamagePart, type LosRule, type SkillDef, type SkillTab, type SkillTarget, type SkillTreeDef,
  ELEMENTS,
  type ArmorDef, type QualityDef, type Stats, type StatusDef, type TagDef, type WeaponDef, type ZoneDef,
} from './types';

export interface GameContent {
  weapons: Record<string, WeaponDef>;
  armors: Record<string, ArmorDef>;
  qualities: Record<string, QualityDef>;
  /** Enemy gear: chance per level of Common instead of Crude. */
  enemyGear: { commonChancePerLevel: number };
  /** The Smithy: the quality it sells on the spot, the days each orderable quality takes, and how many orders it works on at once. */
  smithy: { buyQuality: string; orderDays: Record<string, number>; workers: number };
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

export function parseContent(skillsData: unknown, equipmentData: unknown): GameContent {
  const S = reader('skills.json');
  const root = S.obj(skillsData, '(root)');

  const tags: Record<string, TagDef> = {};
  for (const [id, raw] of entries(S.obj(root.tags, 'tags'))) {
    const t = S.obj(raw, `tags.${id}`);
    tags[id] = { id, name: S.str(t.name, `tags.${id}.name`), description: S.str(t.description, `tags.${id}.description`) };
  }
  for (const t of BEHAVIOR_TAGS) if (!tags[t]) fail('skills.json', `tags.${t}`, 'is required (the game uses it)');

  const part = (h: unknown, path: string): DamagePart => {
    const o = S.obj(h, path);
    return {
      pAtk: S.optNum(o.pAtk, `${path}.pAtk`),
      mAtk: S.optNum(o.mAtk, `${path}.mAtk`),
      def: S.optNum(o.def, `${path}.def`),
      missingHp: S.optNum(o.missingHp, `${path}.missingHp`),
    };
  };
  const statuses: Record<string, StatusDef> = {};
  // Lists of statuses are checked once every status is read (a status can apply another, e.g. Burning Ground's Burn).
  const statusList = (v: unknown, path: string) => S.arr(v, path).map((a, i) => {
    const o = S.obj(a, `${path}[${i}]`);
    const status = S.str(o.status, `${path}[${i}].status`);
    if (!statuses[status]) fail('skills.json', `${path}[${i}].status`, `"${status}" is not defined in "statuses"`);
    // Decaying statuses (Burn, Chilled) last by stacks, not turns.
    const turns = statuses[status].decay && o.turns === undefined ? 0 : S.num(o.turns, `${path}[${i}].turns`);
    return { status, turns, stacks: S.optNum(o.stacks, `${path}[${i}].stacks`) };
  });
  const shiftList = (v: unknown, path: string) => S.arr(v, path).map((a, i) => {
    const o = S.obj(a, `${path}[${i}]`);
    const status = S.str(o.status, `${path}[${i}].status`);
    if (!statuses[status]) fail('skills.json', `${path}[${i}].status`, `"${status}" is not defined in "statuses"`);
    return { status, stacks: S.num(o.stacks, `${path}[${i}].stacks`) };
  });
  const zoneDef = (v: unknown, path: string): ZoneDef => {
    const o = S.obj(v, path);
    return {
      name: o.name === undefined ? undefined : S.str(o.name, `${path}.name`),
      element: o.element === undefined ? undefined : S.oneOf(o.element, `${path}.element`, ELEMENTS),
      radius: S.num(o.radius, `${path}.radius`),
      turns: S.num(o.turns, `${path}.turns`),
      hit: o.hit === undefined ? undefined : part(o.hit, `${path}.hit`),
      applyStatus: o.applyStatus === undefined ? [] : statusList(o.applyStatus, `${path}.applyStatus`),
      shiftStatus: o.shiftStatus === undefined ? undefined : shiftList(o.shiftStatus, `${path}.shiftStatus`),
      endTurnHits: S.num(o.endTurnHits ?? 1, `${path}.endTurnHits`),
      affects: S.oneOf(o.affects ?? 'any', `${path}.affects`, ['any', 'enemy'] as const),
      statPct: o.statPct === undefined ? undefined : S.stats(o.statPct, `${path}.statPct`),
    };
  };
  const statusZones: [string, unknown][] = [];
  const statusOnHit: [string, unknown][] = [];
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
      maxStacks: S.optNum(st.maxStacks, `${p}.maxStacks`),
      overflow: st.overflow === undefined ? undefined : (() => {
        const o = S.obj(st.overflow, `${p}.overflow`);
        return { status: S.str(o.status, `${p}.overflow.status`), turns: S.num(o.turns, `${p}.overflow.turns`) };
      })(),
      frozen: S.bool(st.frozen, `${p}.frozen`) || undefined,
      decay: S.bool(st.decay, `${p}.decay`) || undefined,
      mitigated: S.bool(st.mitigated, `${p}.mitigated`) || undefined,
      instantDamagePctMaxHp: S.optNum(st.instantDamagePctMaxHp, `${p}.instantDamagePctMaxHp`),
      toggle: S.bool(st.toggle, `${p}.toggle`) || undefined,
      manaPerTurn: S.optNum(st.manaPerTurn, `${p}.manaPerTurn`),
      manaPerHit: S.optNum(st.manaPerHit, `${p}.manaPerHit`),
      weaponOnHit: st.weaponOnHit === undefined ? undefined : (() => {
        const o = S.obj(st.weaponOnHit, `${p}.weaponOnHit`);
        return { pAtk: S.optNum(o.pAtk, `${p}.weaponOnHit.pAtk`), mAtk: S.optNum(o.mAtk, `${p}.weaponOnHit.mAtk`) };
      })(),
      enchantment: S.bool(st.enchantment, `${p}.enchantment`) || undefined,
      unresisted: S.bool(st.unresisted, `${p}.unresisted`) || undefined,
      reveals: S.bool(st.reveals, `${p}.reveals`) || undefined,
      debuffImmune: S.bool(st.debuffImmune, `${p}.debuffImmune`) || undefined,
      apLoss: S.optNum(st.apLoss, `${p}.apLoss`),
      quickCast: S.bool(st.quickCast, `${p}.quickCast`) || undefined,
      thisTurnOnly: S.bool(st.thisTurnOnly, `${p}.thisTurnOnly`) || undefined,
      freeBasicAttacks: S.bool(st.freeBasicAttacks, `${p}.freeBasicAttacks`) || undefined,
      casterScaled: st.casterScaled === undefined ? undefined : (() => {
        const o = S.obj(st.casterScaled, `${p}.casterScaled`);
        return { stat: S.oneOf(o.stat, `${p}.casterScaled.stat`, STAT_KEYS), pAtk: S.optNum(o.pAtk, `${p}.casterScaled.pAtk`), mAtk: S.optNum(o.mAtk, `${p}.casterScaled.mAtk`) };
      })(),
    };
    if (st.zone !== undefined) statusZones.push([id, st.zone]);
    if (st.weaponOnHitStatus !== undefined) statusOnHit.push([id, st.weaponOnHitStatus]);
  }
  for (const [id, z] of statusZones) statuses[id].zone = zoneDef(z, `statuses.${id}.zone`);
  for (const [id, l] of statusOnHit) statuses[id].weaponOnHitStatus = statusList(l, `statuses.${id}.weaponOnHitStatus`);
  for (const st of Object.values(statuses)) {
    if (st.overflow && !statuses[st.overflow.status]) fail('skills.json', `statuses.${st.id}.overflow.status`, `"${st.overflow.status}" is not defined in "statuses"`);
  }

  const TARGETS: readonly SkillTarget[] = ['unit', 'self', 'line', 'cone', 'emptyTile', 'move', 'ground', 'passive'];
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
    const hits = r.hits === undefined ? undefined : S.arr(r.hits, `${p}.hits`).map((h, i) => part(h, `${p}.hits[${i}]`));
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
        const shield = { maxHpPct: S.optNum(o.maxHpPct, `${p}.shield.maxHpPct`), mAtk: S.optNum(o.mAtk, `${p}.shield.mAtk`), turns: S.num(o.turns, `${p}.shield.turns`) };
        if (!shield.maxHpPct && !shield.mAtk) fail('skills.json', `${p}.shield`, 'needs maxHpPct and/or mAtk');
        return shield;
      })(),
      applyStatus: r.applyStatus === undefined ? undefined : statusList(r.applyStatus, `${p}.applyStatus`),
      knockback: S.optNum(r.knockback, `${p}.knockback`),
      cleanse: S.bool(r.cleanse, `${p}.cleanse`) || undefined,
      aoeRadius: S.optNum(r.aoeRadius, `${p}.aoeRadius`),
      cone,
      zone: r.zone === undefined ? undefined : zoneDef(r.zone, `${p}.zone`),
      teleport: S.bool(r.teleport, `${p}.teleport`) || undefined,
      charge: S.bool(r.charge, `${p}.charge`) || undefined,
      level: S.num(r.level ?? 1, `${p}.level`),
      basicAttack: S.optNum(r.basicAttack, `${p}.basicAttack`),
      basicAttackDamage: r.basicAttackDamage === undefined ? undefined : S.arr(r.basicAttackDamage, `${p}.basicAttackDamage`).map((v, i) => S.num(v, `${p}.basicAttackDamage[${i}]`)),
      missingHpBonus: r.missingHpBonus === undefined ? undefined : (() => {
        const o = S.obj(r.missingHpBonus, `${p}.missingHpBonus`);
        const bonus = { max: S.num(o.max, `${p}.missingHpBonus.max`), atHealth: S.num(o.atHealth, `${p}.missingHpBonus.atHealth`) };
        if (bonus.max < 1) fail('skills.json', `${p}.missingHpBonus.max`, 'must be 1 or more');
        if (bonus.atHealth < 0 || bonus.atHealth >= 1) fail('skills.json', `${p}.missingHpBonus.atHealth`, 'must be from 0 up to (not including) 1');
        return bonus;
      })(),
      engageWithin: S.optNum(r.engageWithin, `${p}.engageWithin`),
      selfStatus: r.selfStatus === undefined ? undefined : statusList(r.selfStatus, `${p}.selfStatus`),
      recoilIfSurvives: r.recoilIfSurvives === undefined ? undefined : part(r.recoilIfSurvives, `${p}.recoilIfSurvives`),
      modeName: r.modeName === undefined ? undefined : S.str(r.modeName, `${p}.modeName`),
      weaponRange: S.optNum(r.weaponRange, `${p}.weaponRange`),
      basicMode: r.basicMode === undefined ? undefined : S.str(r.basicMode, `${p}.basicMode`),
      switchMode: S.bool(r.switchMode, `${p}.switchMode`) || undefined,
      toggleStatus: r.toggleStatus === undefined ? undefined : (() => {
        const st = S.str(r.toggleStatus, `${p}.toggleStatus`);
        if (!statuses[st]?.toggle) fail('skills.json', `${p}.toggleStatus`, `"${st}" must be a status with "toggle": true`);
        return st;
      })(),
      shape: r.shape === undefined ? undefined : S.oneOf(r.shape, `${p}.shape`, ['cross'] as const),
      bonusVsTag: r.bonusVsTag === undefined ? undefined : (() => {
        const o = S.obj(r.bonusVsTag, `${p}.bonusVsTag`);
        return { tag: S.str(o.tag, `${p}.bonusVsTag.tag`), mult: S.num(o.mult, `${p}.bonusVsTag.mult`) };
      })(),
      shiftStatus: r.shiftStatus === undefined ? undefined : shiftList(r.shiftStatus, `${p}.shiftStatus`),
      spreadFire: S.optNum(r.spreadFire, `${p}.spreadFire`),
      push: S.optNum(r.push, `${p}.push`),
      followUp: S.bool(r.followUp, `${p}.followUp`) || undefined,
      backstab: S.bool(r.backstab, `${p}.backstab`) || undefined,
      pPenPct: S.optNum(r.pPenPct, `${p}.pPenPct`),
      pierce: S.optNum(r.pierce, `${p}.pierce`),
      weaponRangeBonus: S.optNum(r.weaponRangeBonus, `${p}.weaponRangeBonus`),
    };
    if (skill.basicAttack !== undefined && (skill.basicAttack < 1 || !Number.isInteger(skill.basicAttack))) fail('skills.json', `${p}.basicAttack`, 'must be a whole number of 1 or more');
    if (skill.basicAttackDamage && skill.basicAttackDamage.length !== skill.basicAttack) fail('skills.json', `${p}.basicAttackDamage`, 'needs one multiplier per basic attack (and "basicAttack")');
    if (skill.basicAttackDamage?.some((m) => m < 0)) fail('skills.json', `${p}.basicAttackDamage`, 'must not be negative');
    if (skill.engageWithin !== undefined && (skillTags as string[]).includes('engage')) fail('skills.json', `${p}.engageWithin`, "can't be combined with the \"engage\" tag (that always engages)");
    if (skill.basicAttack !== undefined && skill.hits) fail('skills.json', `${p}.basicAttack`, "can't be combined with \"hits\"");
    if (skill.level < 1 || !Number.isInteger(skill.level)) fail('skills.json', `${p}.level`, 'must be a whole number of 1 or more');
    if (skill.target === 'cone' && !skill.cone) fail('skills.json', `${p}.cone`, 'is required when target is "cone"');
    if (skill.zone && skill.target !== 'ground') fail('skills.json', `${p}.zone`, 'goes with target "ground"');
    if (skill.target === 'ground' && !skill.zone && !skill.shape) fail('skills.json', `${p}.zone`, 'is required for target "ground" (or a "shape" to hit)');
    if (skill.followUp && !skill.charge) fail('skills.json', `${p}.followUp`, 'needs "charge" (the follow-up is a second charge)');
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

  const F = 'equipment.json';
  const W = reader(F);
  const eroot = W.obj(equipmentData, '(root)');
  const qualities: Record<string, QualityDef> = {};
  for (const [id, raw] of entries(W.obj(eroot.qualities, 'qualities'))) {
    const p = `qualities.${id}`;
    const o = W.obj(raw, p);
    qualities[id] = {
      id,
      name: W.str(o.name, `${p}.name`),
      baseMultiplier: W.num(o.baseMultiplier, `${p}.baseMultiplier`),
      value: W.num(o.value, `${p}.value`),
      enemyOnly: W.bool(o.enemyOnly, `${p}.enemyOnly`),
    };
  }
  for (const q of ['crude', 'common']) if (!qualities[q]) fail(F, `qualities.${q}`, 'is required (the game uses it)');
  const sm = W.obj(eroot.smithy ?? {}, 'smithy');
  const orderDays: Record<string, number> = {};
  for (const [q, d] of entries(W.obj(sm.orderDays ?? {}, 'smithy.orderDays'))) {
    if (!qualities[q] || qualities[q].enemyOnly) fail(F, `smithy.orderDays.${q}`, 'must be a quality the party can own');
    orderDays[q] = W.num(d, `smithy.orderDays.${q}`);
  }
  const smithy = {
    buyQuality: W.oneOf(sm.buyQuality ?? 'common', 'smithy.buyQuality', Object.keys(qualities)),
    orderDays,
    workers: Math.max(1, Math.round(W.num(sm.workers ?? 3, 'smithy.workers'))),
  };
  const eg = W.obj(eroot.enemyGear ?? {}, 'enemyGear');
  const enemyGear = { commonChancePerLevel: W.num(eg.commonChancePerLevel ?? 0, 'enemyGear.commonChancePerLevel') };
  const gearStats = (o: Record<string, unknown>, p: string) => ({
    base: W.stats(o.base ?? {}, `${p}.base`),
    modifiers: W.stats(o.modifiers ?? {}, `${p}.modifiers`),
  });
  const weapons: Record<string, WeaponDef> = {};
  for (const [id, raw] of entries(W.obj(eroot.weapons, 'weapons'))) {
    const p = `weapons.${id}`;
    const o = W.obj(raw, p);
    const ws = W.arr(o.skills, `${p}.skills`).map((sid, j) => {
      const sk = W.str(sid, `${p}.skills[${j}]`);
      return skills[sk] ? sk : fail(F, `${p}.skills[${j}]`, `"${sk}" is not defined in skills.json`);
    });
    if (ws.length === 0) fail(F, `${p}.skills`, 'needs at least one skill (the first is the basic attack)');
    weapons[id] = {
      id,
      name: W.str(o.name, `${p}.name`),
      class: W.str(o.class, `${p}.class`),
      tag: W.str(o.tag, `${p}.tag`),
      art: W.str(o.art ?? id, `${p}.art`),
      description: W.str(o.description, `${p}.description`),
      ...gearStats(o, p),
      skills: ws,
      range: W.num(o.range, `${p}.range`),
      builtIn: W.bool(o.builtIn, `${p}.builtIn`),
    };
  }
  const armors: Record<string, ArmorDef> = {};
  for (const [id, raw] of entries(W.obj(eroot.armors, 'armors'))) {
    const p = `armors.${id}`;
    const o = W.obj(raw, p);
    armors[id] = {
      id,
      name: W.str(o.name, `${p}.name`),
      description: W.str(o.description, `${p}.description`),
      outfit: W.str(o.outfit, `${p}.outfit`),
      ...gearStats(o, p),
      builtIn: W.bool(o.builtIn, `${p}.builtIn`),
    };
  }
  const builtIns = (list: { builtIn: boolean }[], what: string) => {
    if (list.filter((x) => x.builtIn).length !== 1) fail(F, what, 'needs exactly one "builtIn" entry (what a unit has with nothing equipped)');
  };
  builtIns(Object.values(weapons), 'weapons');
  builtIns(Object.values(armors), 'armors');
  if (!Object.values(weapons).some((w) => !w.builtIn)) fail(F, 'weapons', 'must define at least one weapon');
  return { weapons, armors, qualities, enemyGear, smithy, skills, tags, statuses, skillTabs, skillTrees, basicSkills };
}

export const CONTENT: GameContent = parseContent(skillsRaw, equipmentRaw);
export const WEAPONS = CONTENT.weapons;
export const ARMORS = CONTENT.armors;
export const QUALITIES = CONTENT.qualities;
export const ENEMY_GEAR = CONTENT.enemyGear;
export const SMITHY = CONTENT.smithy;
export const SKILLS = CONTENT.skills;
export const TAGS = CONTENT.tags;
export const STATUSES = CONTENT.statuses;
export const SKILL_TABS = CONTENT.skillTabs;
export const SKILL_TREES = CONTENT.skillTrees;
export const BASIC_SKILLS = CONTENT.basicSkills;
/** What a unit without a weapon fights with (Unarmed) and wears without armor (No Armor). */
export const UNARMED = Object.values(WEAPONS).find((w) => w.builtIn)!.id;
export const NO_ARMOR = Object.values(ARMORS).find((a) => a.builtIn)!.id;
/** Weapons and armor that exist as items (everything but Unarmed and No Armor). */
export const WEAPON_TYPES = Object.values(WEAPONS).filter((w) => !w.builtIn).map((w) => w.id);
export const ARMOR_TYPES = Object.values(ARMORS).filter((a) => !a.builtIn).map((a) => a.id);
/** The weapon a new Adventurer is offered first. */
export const DEFAULT_WEAPON = WEAPON_TYPES[0];
/** Qualities the party can own (not the enemy-only ones). */
export const PLAYER_QUALITIES = Object.values(QUALITIES).filter((q) => !q.enemyOnly).map((q) => q.id);

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
  if (out.weaponRange !== undefined && weapon) out = { ...out, range: out.weaponRange * weapon.range };
  return out;
}

/** The weapon mode skill with `tag` (e.g. Circle Swing's 'melee'), if the basic attack has modes. */
export function modeWithTag(basic: SkillDef, tag: string): SkillDef | undefined {
  const id = basic.modes?.find((m) => hasTag(CONTENT.skills[m], tag));
  return id ? CONTENT.skills[id] : undefined;
}
export const isFree = (s: SkillDef) => s.ap === 0;

/** "Free", "1 AP", "2 AP" or "Ends Turn". */
export const apLabel = (s: SkillDef) => (s.ap === 0 ? 'Free' : s.ap === 'end' ? 'Ends Turn' : `${s.ap} AP`);
/** Helpful skills (heals, cleanses, shields, buffs) are drawn green; attacks red. */
export const isSupport = (s: SkillDef) =>
  s.affects === 'ally' || !!(s.heal || s.cleanse || s.shield) || (s.applyStatus ?? []).some((a) => !STATUSES[a.status]?.debuff);

// ---- descriptions generated from the data (always match the numbers) ---------------

const pct = (v: number) => `${Math.round(v * 100)}%`;

const tiles = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;
const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;

/** One hit's damage: "100% P.Atk + 15% of target's missing HP". */
function damageText(h: DamagePart): string {
  return [
    h.pAtk ? `${pct(h.pAtk)} ${STAT_INFO.pAtk.short}` : '',
    h.mAtk ? `${pct(h.mAtk)} ${STAT_INFO.mAtk.short}` : '',
    h.def ? `${pct(h.def)} ${STAT_INFO.defense.short}` : '',
    h.missingHp ? `${pct(h.missingHp)} of target's missing HP` : '',
  ].filter(Boolean).join(' + ');
}

/** What a skill does, with its numbers: "100% M.Atk, Burn x1 (2 turns)". Falls back to the description. */
/**
 * An applied status: "a stack of Burn" / "2 stacks of Burn" for decaying ones (they lose a stack a turn),
 * "Blinded (1 turn)" for the rest.
 */
function statusText(a: { status: string; turns: number; stacks?: number }): string {
  const st = STATUSES[a.status];
  if (st.decay) {
    const n = a.stacks ?? 1;
    return n === 1 ? `a stack of ${st.name}` : `${n} stacks of ${st.name}`;
  }
  return `${st.name}${a.stacks && a.stacks > 1 ? ` x${a.stacks}` : ''} (${turns(a.turns)})`;
}

/** "+1 stack of Chilled if Chilled" / "-1 stack of Burn if burning". */
function shiftText(sh: { status: string; stacks: number }): string {
  const name = STATUSES[sh.status].name;
  const n = Math.abs(sh.stacks);
  return `${sh.stacks > 0 ? '+' : '-'}${n} stack${n === 1 ? '' : 's'} of ${name} if it has ${name}`;
}

/** A zone's numbers: "3x3 zone for 3 turns. Each tile entered: 50% M.Atk, a stack of Burn. Ending a turn inside: 2 hits". */
export function zoneText(z: ZoneDef): string {
  const side = 2 * Math.floor(z.radius) + 1;
  const hit = [z.hit ? damageText(z.hit) : '', ...z.applyStatus.map(statusText), ...(z.shiftStatus ?? []).map(shiftText)].filter(Boolean).join(', ');
  const who = z.affects === 'enemy' ? ' (enemies only)' : '';
  const inside = z.statPct ? `. Inside: ${Object.entries(z.statPct).map(([k, v]) => `${(v ?? 0) > 0 ? '+' : ''}${pct(v ?? 0)} ${STAT_INFO[k as keyof Stats].short}`).join(', ')}` : '';
  const end = z.endTurnHits ? `. Ending a turn inside: ${z.endTurnHits} hit${z.endTurnHits === 1 ? '' : 's'}` : '';
  return `${side}x${side} zone for ${turns(z.turns)}${who}${inside}. Each tile entered: ${hit}${end}`;
}

/** Display names of unit tags (enemies.json "unitTags"), filled in by enemies.ts. */
export const UNIT_TAG_NAMES: Record<string, string> = {};

export function skillEffect(s: SkillDef): string {
  if (s.modes) return s.description;
  if (s.target === 'passive') return `Passive: ${s.description}`;
  if (s.zone) return zoneText(s.zone);
  const parts: string[] = [];
  if (s.shape === 'cross') parts.push('5-tile cross');
  if (s.hits?.length) parts.push(s.hits.map(damageText).join(', then '));
  if (s.bonusVsTag) parts.push(`x${s.bonusVsTag.mult} vs ${UNIT_TAG_NAMES[s.bonusVsTag.tag] ?? s.bonusVsTag.tag}`);
  if (s.pPenPct) parts.push(`+${s.pPenPct}% P.Pen`);
  if (s.pierce) parts.push(`${pct(s.pierce)} basic attack damage to the unit behind the target`);
  if (s.basicAttack) {
    const dmg = s.basicAttackDamage;
    if (dmg && dmg.some((m) => m !== 1)) parts.push(`Basic attack${s.basicAttack > 1 ? ` x${s.basicAttack}` : ''} (${dmg.map(pct).join(', then ')} damage)`);
    else parts.push(s.basicAttack > 1 ? `Basic attack x${s.basicAttack}` : 'Basic attack');
  }
  if (s.missingHpBonus) parts.push(`x1 to x${s.missingHpBonus.max} damage by the target's missing Health (x${s.missingHpBonus.max} at ${pct(s.missingHpBonus.atHealth)} Health or less)`);
  if (s.heal) parts.push(`Heal ${pct(s.heal.mAtk)} ${STAT_INFO.mAtk.short}`);
  if (s.shield) {
    const sh = s.shield;
    const amount = [sh.maxHpPct ? `${pct(sh.maxHpPct)} of max HP` : '', sh.mAtk ? `${pct(sh.mAtk)} ${STAT_INFO.mAtk.short}` : ''].filter(Boolean).join(' + ');
    parts.push(`Shield ${amount} (${turns(sh.turns)})`);
  }
  for (const a of s.applyStatus ?? []) {
    const st = STATUSES[a.status];
    const sc = st.casterScaled;
    if (sc) {
      const from = [sc.pAtk ? `${pct(sc.pAtk)} ${STAT_INFO.pAtk.short}` : '', sc.mAtk ? `${pct(sc.mAtk)} ${STAT_INFO.mAtk.short}` : ''].filter(Boolean).join(' + ');
      parts.push(`${STAT_INFO[sc.stat].name} +${from} (${turns(a.turns)})`);
    } else parts.push(statusText(a));
  }
  for (const a of s.selfStatus ?? []) parts.push(`You: ${STATUSES[a.status].name} (${turns(a.turns)})`);
  if (s.recoilIfSurvives) {
    const r = s.recoilIfSurvives;
    parts.push(`${[r.pAtk ? `${pct(r.pAtk)} P.Atk` : '', r.mAtk ? `${pct(r.mAtk)} M.Atk` : ''].filter(Boolean).join(' + ')} recoil if the target survives`);
  }
  for (const sh of s.shiftStatus ?? []) parts.push(shiftText(sh));
  if (s.spreadFire) parts.push(`Fire tiles hit spread ${tiles(s.spreadFire)} (same duration)`);
  if (s.knockback) parts.push(`Knockback ${tiles(s.knockback)}`);
  if (s.push) parts.push(`Push ${tiles(s.push)} in a direction you pick`);
  if (s.followUp) parts.push(`Then break away for free and charge another enemy within ${tiles(s.range)} for the same`);
  if (s.backstab) parts.push('Only on an engaged enemy, from one of the 3 tiles behind it');
  if (s.engageWithin !== undefined) parts.push(s.engageWithin <= 1.5 ? 'Engages an adjacent target' : `Engages a target within ${tiles(s.engageWithin)}`);
  if (s.cleanse) parts.push('Removes all debuffs');
  if (s.toggleStatus) {
    const st = STATUSES[s.toggleStatus];
    const onHit = [st.weaponOnHit ? `+${damageText(st.weaponOnHit)}` : '', ...(st.weaponOnHitStatus ?? []).map(statusText)].filter(Boolean).join(' and ');
    const hit = onHit ? `Weapon attacks ${onHit} per hit${st.manaPerHit ? ` (${st.manaPerHit} mana each)` : ''}`
      : st.quickCast ? 'your next Mage spell of 2 AP or Ends Turn costs 1 AP' : st.name;
    if (st.thisTurnOnly) {
      parts.push(`Toggle: ${hit}; ends with your turn if unused (use again to cancel)`);
      return parts.join(', ');
    }
    parts.push(`Toggle: ${hit}${st.manaPerTurn ? `; ${st.manaPerTurn} mana a turn while on` : ''}`);
  }
  if (s.teleport) parts.push(s.charge ? 'Teleport next to the target' : 'Teleport');
  else if (s.charge) parts.push('Dash next to the target');
  return parts.length ? parts.join(', ') : s.description;
}

/** One row of a skill's info: "Label: value". */
export interface SkillStat { label: string; value: string }

/**
 * A skill's info rows, always in this order: Effect, Tags, AP, Mana, Cooldown.
 * Mana and Cooldown are left out when they are 0. (The targeting grid is drawn separately.)
 */
export function skillStats(s: SkillDef): SkillStat[] {
  const rows: SkillStat[] = [{ label: 'Effect', value: skillEffect(s) }];
  const tags = tagNames(s);
  if (tags.length) rows.push({ label: 'Tags', value: tags.join(', ') });
  // A moded skill (the bow's Basic Attack) costs what its modes cost.
  const c = s.modes ? SKILLS[s.modes[0]] : s;
  if (c.target === 'passive') return rows;
  rows.push({ label: 'AP', value: apLabel(c) });
  if (c.mana) rows.push({ label: 'Mana', value: String(c.mana) });
  if (c.cooldown > 0) rows.push({ label: 'Cooldown', value: `${c.cooldown} Turn${c.cooldown === 1 ? '' : 's'}` });
  return rows;
}

/** `skillStats` as text, one "Label: value" row per line. */
export function skillStatText(s: SkillDef): string {
  return skillStats(s).map((r) => `${r.label}: ${r.value}`).join('\n');
}

/** Display names of a skill's tags. */
export function tagNames(s: SkillDef): string[] {
  return s.tags.map((t) => TAGS[t]?.name ?? t);
}

export const PALETTE = ['#3d7be0', '#36b37e', '#e0b44c', '#9b59d0', '#e07b3d', '#2bb5c4', '#e05a9b', '#c9ced8'];
export const ENEMY_COLOR = '#c0392b';

export const MAX_PARTY_SIZE = 5;
/** XP to go from `level` to the next: stats.json xpPerLevel, a x L^2 + b x L + c (80 at level 1, 3560 at level 25). */
export const xpToNext = (level: number) => {
  const { a, b, c } = STAT_CONFIG.xpPerLevel;
  const L = Math.max(1, level);
  return Math.max(1, Math.round(a * L * L + b * L + c));
};
export const NAME_MAX_LENGTH = 16;

/** Skill points: 2 at level 1 and 1 more every level. Each one learns a tree skill or buys a Body investment. */
export function skillPointsForLevel(level: number): number {
  return level + 1;
}

/** Most skill points one stat can take in the Body tab: level / 3, rounded up. */
export function maxBodyRank(level: number): number {
  return Math.ceil(level / 3);
}
