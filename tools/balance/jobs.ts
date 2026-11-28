// Balance jobs: the cross product of party and quest settings, each cell fought over the same seeds
// (common random numbers, so neighbouring cells compare on the same maps).
import { readFileSync } from 'node:fs';
import { ENCOUNTER, ENEMIES } from '../../src/data/enemies';
import { GUILD } from '../../src/data/guild';
import { QUALITIES } from '../../src/data/content';
import { partyFighters, powerRatio, questFighters, referenceGearMultiplier, referenceParty, referenceSize } from '../../src/game/power';
import { RANKS } from '../../src/data/types';
import { enemiesForSkulls, makeQuest } from '../../src/game/board';
import { adventurerRank } from '../../src/game/guild';
import { makeRng } from '../../src/game/character';
import { buildParty, type PartySpec, type QuestSpec } from './sim';

export interface Cell {
  id: string;
  party: PartySpec;
  quest: QuestSpec;
}

export interface JobArgs {
  name: string;
  seeds: number;
  /** First seed index (so a job can be extended with more seeds later). */
  seedStart?: number;
  level?: number[];
  talent?: string[];
  quality?: string[];
  size?: number[];
  builds?: string[];
  /** Quest enemy level; or stageOffset: relative to the party level. */
  stage?: number[];
  stageOffset?: number[];
  count?: number[];
  foes?: string[];
  /** A preset in place of the cross product: 'types' (each enemy type alone, around par; see typeCells). */
  plan?: string;
  /** Random-recruit parties (buildParty's `random` seeds) instead of the reference builds. */
  random?: number[];
  /** For plan 'types': target power ratios (party / quest), and the enemy types (all if missing). */
  ratio?: number[];
}

/** The player quality closest to the reference gear at a level. */
export function referenceQuality(level: number): string {
  const m = referenceGearMultiplier(level);
  return Object.values(QUALITIES).filter((q) => !q.enemyOnly)
    .reduce((a, b) => (Math.abs(Math.log(b.baseMultiplier / m)) < Math.abs(Math.log(a.baseMultiplier / m)) ? b : a)).id;
}

/** The group size (threat points) at which `party` has power ratio `ratio` against `foes` at `stage`. */
export function countFor(party: PartySpec, stage: number, foes: string[] | undefined, ratio: number, cap: number): number {
  const p = party.quality === 'expected' ? referenceParty(party.level, party.size ?? referenceSize(party.level)) : partyFighters(buildParty(party));
  let lo = 0.25, hi = cap;
  if (powerRatio(p, questFighters({ stage, count: hi, foes })) > ratio) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (powerRatio(p, questFighters({ stage, count: mid, foes })) > ratio) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 20) / 20;
}

/** The score wanted at a level (targets.json) and the power ratio that gives it by the game's curve. */
function targetRatio(level: number): number {
  const t: [number, number][] = JSON.parse(readFileSync('tools/balance/targets.json', 'utf8')).targets;
  const near = t.reduce((a, b) => (Math.abs(b[0] - level) < Math.abs(a[0] - level) ? b : a));
  const p = near[1];
  const { a, b } = GUILD.strength.winCurve;
  return Math.exp((Math.log(p / (1 - p)) - a) / b);
}

/**
 * Each enemy type alone, at the bottom, middle and top of its levels, against the reference builds at the same
 * level with the reference gear, in groups sized for each target power ratio.
 */
function typeCells(a: JobArgs): Cell[] {
  const out: Cell[] = [];
  const types = a.foes?.length ? a.foes : Object.keys(ENEMIES);
  for (const type of types) {
    const [lo, hi] = ENEMIES[type].levels;
    for (const stage of [...new Set([lo, Math.round((lo + hi) / 2), hi])]) {
      const party: PartySpec = { level: stage, talent: 'profile', quality: 'expected', size: a.size?.[0] ?? referenceSize(stage) };
      // Power ratios: `ratio`, or by default around the one at which the party scores its level's target
      // (targets.json; times 0.8, 1 and 1.25), so fights are tested at the odds the game aims for.
      const want = targetRatio(stage);
      for (const ratio of a.ratio?.length ? a.ratio : [0.8, 1, 1.25].map((m) => Math.round(want * m * 1000) / 1000)) {
        const count = countFor(party, stage, [type], ratio, ENCOUNTER.maxEnemies * ENEMIES[type].threat);
        out.push({ id: `${type} St${stage} ${party.quality} r${ratio} c${count}`, party, quest: { stage, count, foes: [type] } });
      }
    }
  }
  return out;
}

const list = <T>(v: T[] | undefined, d: T[]): T[] => (v && v.length ? v : d);

/**
 * Real board quests: `seeds` is per battle, and each rank gets `count[0]` (default 12) quests from makeQuest, fought
 * by the reference builds (3, 4 or 5 by level) with the reference gear at the quest's enemy level; stageOffset
 * moves it.
 */
function boardCells(a: JobArgs): Cell[] {
  const out: Cell[] = [];
  const per = a.count?.[0] ?? 12;
  for (const rank of RANKS) {
    for (let i = 0; i < per; i++) {
      const q = makeQuest(rank, 1, makeRng(1000 + i * 17 + RANKS.indexOf(rank)));
      const base = q.stage;
      for (const off of list(a.stageOffset, [0])) {
        const level = Math.max(1, base + off);
        const party: PartySpec = { level, talent: 'profile', quality: 'expected', size: a.size?.[0] ?? referenceSize(level) };
        out.push({ id: `${rank} ${q.foes?.join('+')} St${q.stage} c${q.count} L${level}`, party, quest: { stage: q.stage, count: q.count, foes: q.foes } });
      }
    }
  }
  return out;
}

/**
 * The campaign check: for each `level`, the expected party (its size and gear for the level) against `count[0]`
 * (default 12) quests posted for its adventurer rank (makeQuest).
 */
function rankCells(a: JobArgs): Cell[] {
  const out: Cell[] = [];
  const per = a.count?.[0] ?? 12;
  for (const level of list(a.level, [1, 3, 5, 8, 10, 13, 15, 18, 20])) {
    const rank = adventurerRank(level);
    for (let i = 0; i < per; i++) {
      const q = makeQuest(rank, 1, makeRng(2000 + i * 13 + level));
      const party: PartySpec = { level, talent: 'profile', quality: 'expected', size: a.size?.[0] ?? referenceSize(level) };
      out.push({ id: `L${level} ${rank} ${q.foes?.join('+')} St${q.stage} c${q.count}`, party, quest: { stage: q.stage, count: q.count, foes: q.foes } });
    }
  }
  return out;
}

/**
 * Quests at given skulls (`stage` is read as skulls here), `count[0]` (default 12) of each from enemiesForSkulls,
 * against the party of `level` / `size` / `random` (random recruits) or the expected party.
 */
function skullCells(a: JobArgs): Cell[] {
  const out: Cell[] = [];
  const per = a.count?.[0] ?? 12;
  for (const skulls of list(a.stage, [0.5]))
    for (const level of list(a.level, [1]))
      for (const random of a.random?.length ? a.random : [undefined])
        for (let i = 0; i < per; i++) {
          const q = enemiesForSkulls(skulls, makeRng(3000 + i * 17));
          const party: PartySpec = { level, talent: 'profile', quality: random !== undefined ? 'crude' : 'expected', size: a.size?.[0] ?? referenceSize(level), ...(random !== undefined ? { random } : {}) };
          out.push({ id: `${skulls} skulls L${level} ${random !== undefined ? `rand${random}` : 'ref'} ${q.foes.join('+')} St${q.stage} c${q.count}`, party, quest: q });
        }
  return out;
}

/**
 * The score curve check: for each `level`, the expected party against `count[0]` (default 12) quests near the
 * skulls typical for that level (out/skulls.json, from skulls.sim.ts; within a quarter skull), as a player would
 * pick quests that suit the party.
 */
function levelCells(a: JobArgs): Cell[] {
  const typical: { level: number; skulls: number }[] = JSON.parse(readFileSync('tools/balance/out/skulls.json', 'utf8')).typical;
  const out: Cell[] = [];
  const per = a.count?.[0] ?? 12;
  for (const level of list(a.level, [1, 3, 5, 8, 10, 13, 15, 18, 20])) {
    const s = typical[level - 1].skulls;
    for (let i = 0; i < per; i++) {
      const rng = makeRng(5000 + i * 19 + level);
      const q = enemiesForSkulls(Math.max(0.5, s - 0.25 + rng() * 0.5), rng);
      const party: PartySpec = { level, talent: 'profile', quality: 'expected', size: a.size?.[0] ?? referenceSize(level) };
      out.push({ id: `L${level} typical ${q.foes.join('+')} St${q.stage} c${q.count}`, party, quest: q });
    }
  }
  return out;
}

export function cells(a: JobArgs): Cell[] {
  if (a.plan === 'types') return typeCells(a);
  if (a.plan === 'levels') return levelCells(a);
  if (a.plan === 'ranks') return rankCells(a);
  if (a.plan === 'skulls') return skullCells(a);
  if (a.plan === 'board') return boardCells(a);
  const out: Cell[] = [];
  const builds = a.builds?.length ? a.builds : undefined;
  for (const level of list(a.level, [5]))
    for (const talent of list(a.talent, ['profile']))
      for (const quality of list(a.quality, ['crude']))
        for (const size of a.size?.length ? a.size : [referenceSize(level)])
          for (const random of a.random?.length ? a.random : [undefined])
          for (const stage of a.stage?.length ? a.stage : list(a.stageOffset, [0]).map((o) => Math.max(1, level + o)))
            for (const count of list(a.count, [4])) {
              const party: PartySpec = { level, talent: talent as PartySpec['talent'], quality, size, ...(builds ? { builds } : {}), ...(random !== undefined ? { random } : {}) };
              const quest: QuestSpec = { stage, count, ...(a.foes?.length ? { foes: a.foes } : {}) };
              out.push({ id: `L${level} ${random !== undefined ? `rand${random}` : talent} ${quality} x${size} | St${stage} c${count}${a.foes?.length ? ` ${a.foes.join('+')}` : ''}`, party, quest });
            }
  return out;
}

export const seedOf = (i: number) => i * 1000003 + 7;
