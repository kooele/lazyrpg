// Headless battles for balance work: an AI-played party against a quest's enemies, on random maps, seeded.
import type { Character, QualityId, Talent } from '../../src/data/types';
import { runAiTurn } from '../../src/game/ai';
import { Battle, deploymentTiles, generateEnemies, makeUnit } from '../../src/game/battle';
import { makeRng } from '../../src/game/character';
import { generateMap } from '../../src/game/grid';
import { PARTY_ORDER, buildCharacter } from '../../src/game/reference';

export interface PartySpec {
  level: number;
  /** 'profile' (default): each build's own spread, averaging B. A grade: every stat at it. */
  talent?: Talent | 'profile';
  quality?: QualityId;
  size?: number;
  /** Build ids, in place of the default order (PARTY_ORDER). */
  builds?: string[];
}

export interface QuestSpec {
  stage: number;
  /** Threat points (the quest's group size). */
  count: number;
  /** Enemy types to draw from (all fitting types if missing). */
  foes?: string[];
}

export interface RunResult {
  win: boolean;
  rounds: number;
  /** The party's HP left, as a share of its total. */
  hpLeft: number;
  survivors: number;
  enemies: number;
  /** Share of the enemies killed, fled or surrendered. */
  defeated: number;
  timeout: boolean;
}

export const ROUND_CAP = 40;

export function buildParty(p: PartySpec): Character[] {
  const builds = p.builds ?? PARTY_ORDER;
  const size = p.size ?? 4;
  return Array.from({ length: size }, (_, i) => buildCharacter(builds[i % builds.length], p.level, p.talent ?? 'profile', p.quality ?? 'crude'));
}

/** One battle, AI on both sides. */
export function runBattle(party: PartySpec, quest: QuestSpec, seed: number): RunResult {
  const rng = makeRng(seed);
  const map = generateMap(rng);
  const members = buildParty(party);
  const generated = generateEnemies(quest.stage, rng, quest.count, quest.foes);
  const pSpots = deploymentTiles(map, 'player', members.length);
  const eSpots = deploymentTiles(map, 'enemy', generated.length);
  const foes = generated.slice(0, eSpots.length);
  const units = [
    ...members.map((c, i) => makeUnit(c, 'player', pSpots[i])),
    ...foes.map((c, i) => makeUnit(c, 'enemy', eSpots[i])),
  ];
  const b = new Battle(map, units, rng);
  while (!b.outcome() && b.round <= ROUND_CAP) {
    for (const u of [...b.readyUnits()]) {
      if (!u.alive || b.outcome()) continue;
      runAiTurn(b, u);
    }
    if (b.outcome()) break;
    b.endPhase();
  }
  const mine = b.units.filter((u) => u.team === 'player');
  const theirs = b.units.filter((u) => u.team === 'enemy');
  const total = mine.reduce((s, u) => s + u.stats.health, 0);
  return {
    win: b.outcome() === 'victory',
    rounds: b.round,
    hpLeft: mine.reduce((s, u) => s + (u.alive ? u.hp : 0), 0) / total,
    survivors: mine.filter((u) => u.alive).length,
    enemies: theirs.length,
    defeated: theirs.filter((u) => !u.alive).length / Math.max(1, theirs.length),
    timeout: !b.outcome(),
  };
}

export interface CellSummary {
  n: number;
  winRate: number;
  rounds: number;
  hpLeft: number;
  survivors: number;
  defeated: number;
  timeouts: number;
}

export function summarize(runs: RunResult[]): CellSummary {
  const n = runs.length;
  const avg = (f: (r: RunResult) => number) => (n ? runs.reduce((s, r) => s + f(r), 0) / n : 0);
  return {
    n,
    winRate: avg((r) => (r.win ? 1 : 0)),
    rounds: avg((r) => r.rounds),
    hpLeft: avg((r) => r.hpLeft),
    survivors: avg((r) => r.survivors),
    defeated: avg((r) => r.defeated),
    timeouts: runs.filter((r) => r.timeout).length,
  };
}
