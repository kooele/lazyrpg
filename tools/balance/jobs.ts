// Balance jobs: the cross product of party and quest settings, each cell fought over the same seeds
// (common random numbers, so neighbouring cells compare on the same maps).
import { ENCOUNTER, ENEMIES } from '../../src/data/enemies';
import { QUALITIES } from '../../src/data/content';
import { GUILD } from '../../src/data/guild';
import { partyFighters, powerRatio, questFighters, questParLevel, referenceGearMultiplier, referenceSize, usualCountAt } from '../../src/game/power';
import { RANKS } from '../../src/data/types';
import { makeQuest } from '../../src/game/board';
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
  const p = partyFighters(buildParty(party));
  let lo = 0.25, hi = cap;
  if (powerRatio(p, questFighters({ stage, count: hi, foes })) > ratio) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (powerRatio(p, questFighters({ stage, count: mid, foes })) > ratio) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 20) / 20;
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
      const party: PartySpec = { level: stage, talent: 'profile', quality: referenceQuality(stage), size: a.size?.[0] ?? referenceSize(stage) };
      for (const ratio of list(a.ratio, [0.35, 0.5, 0.7])) {
        const count = countFor(party, stage, [type], ratio, ENCOUNTER.maxEnemies * ENEMIES[type].threat);
        out.push({ id: `${type} St${stage} ${party.quality} r${ratio} c${count}`, party, quest: { stage, count, foes: [type] } });
      }
    }
  }
  return out;
}

const list = <T>(v: T[] | undefined, d: T[]): T[] => (v && v.length ? v : d);

/** The skulls of the usual quest at each level 1-25 (smooth group sizes), for matching quests to party levels. */
let usualSkulls: number[] | null = null;
function skullsOfUsual(level: number): number {
  usualSkulls ??= Array.from({ length: 25 }, (_, i) => skullsAt(questParLevel({ stage: i + 1, count: usualCountAt(i + 1) }, { smooth: true })));
  return usualSkulls[Math.max(1, Math.min(25, level)) - 1];
}
/** Unrounded skulls for a par level (as skullsForLevel, before the half steps). */
function skullsAt(par: number): number {
  const pts = GUILD.strength.skulls;
  let i = 1;
  while (i < pts.length - 1 && par > pts[i][0]) i++;
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  return Math.max(0.5, Math.min(10, y0 + ((y1 - y0) * (par - x0)) / (x1 - x0)));
}
/** The party level a quest's skulls suit: the level whose usual quest shows the nearest skulls. */
export function levelForQuest(q: QuestSpec): number {
  const s = skullsAt(questParLevel(q));
  let best = 1;
  for (let L = 1; L <= 25; L++) if (Math.abs(skullsOfUsual(L) - s) < Math.abs(skullsOfUsual(best) - s)) best = L;
  return best;
}

/**
 * Real board quests: `seeds` is per battle, and each rank gets `count[0]` (default 12) quests from makeQuest, fought
 * by the reference builds (3, 4 or 5 by level) with the reference gear: at the quest's enemy level, or with plan
 * 'board-skulls' at the level its skulls suit (levelForQuest); stageOffset moves it.
 */
function boardCells(a: JobArgs): Cell[] {
  const out: Cell[] = [];
  const per = a.count?.[0] ?? 12;
  for (const rank of RANKS) {
    for (let i = 0; i < per; i++) {
      const q = makeQuest(rank, 1, makeRng(1000 + i * 17 + RANKS.indexOf(rank)));
      const base = a.plan === 'board-skulls' ? levelForQuest({ stage: q.stage, count: q.count, foes: q.foes }) : q.stage;
      for (const off of list(a.stageOffset, [0])) {
        const level = Math.max(1, base + off);
        const party: PartySpec = { level, talent: 'profile', quality: referenceQuality(level), size: a.size?.[0] ?? referenceSize(level) };
        out.push({ id: `${rank} ${q.foes?.join('+')} St${q.stage} c${q.count} L${level}`, party, quest: { stage: q.stage, count: q.count, foes: q.foes } });
      }
    }
  }
  return out;
}

export function cells(a: JobArgs): Cell[] {
  if (a.plan === 'types') return typeCells(a);
  if (a.plan === 'board' || a.plan === 'board-skulls') return boardCells(a);
  const out: Cell[] = [];
  const builds = a.builds?.length ? a.builds : undefined;
  for (const level of list(a.level, [5]))
    for (const talent of list(a.talent, ['profile']))
      for (const quality of list(a.quality, ['crude']))
        for (const size of list(a.size, [4]))
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
