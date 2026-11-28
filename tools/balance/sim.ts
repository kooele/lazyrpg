// Headless battles for balance work: an AI-played party against a quest's enemies, on random maps, seeded.
import type { Character, QualityId, Talent } from '../../src/data/types';
import { runAiTurn } from '../../src/game/ai';
import { Battle, deploymentTiles, generateEnemies, makeUnit } from '../../src/game/battle';
import { makeRng } from '../../src/game/character';
import { generateMap } from '../../src/game/grid';
import { randomAdventurer } from '../../src/game/people';
import { PARTY_ORDER, buildCharacter } from '../../src/game/reference';
import { referenceGearOdds, referenceSize } from '../../src/game/power';
import type { Rng } from '../../src/game/character';

export interface PartySpec {
  level: number;
  /** 'profile' (default): each build's own spread, averaging B. A grade: every stat at it. */
  talent?: Talent | 'profile';
  quality?: QualityId;
  size?: number;
  /** Build ids, in place of the default order (PARTY_ORDER). */
  builds?: string[];
  /** Random recruits instead (randomAdventurer, as the guild hall makes them), from this seed. */
  random?: number;
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
  /**
   * The party's Health lost (the Strategic Layer stat): each member's share of HP at its lowest point (all of it for
   * falling), averaged over the party: 0 = untouched, 1 = everyone fell.
   */
  healthLoss: number;
  /**
   * The battle's score: rewards earned against Health spent. A win earns 1, a loss the share of enemies defeated;
   * minus HEALTH_WEIGHT x healthLoss; 0 to 1.
   */
  score: number;
}

/** What losing all of the party's Health costs, as a share of a won quest's value. */
export const HEALTH_WEIGHT = 0.5;

export const ROUND_CAP = 40;

/**
 * The party of a spec. Quality 'expected': each piece of gear rolled from the reference odds at its level
 * (referenceGearOdds; with `rng`, else the most likely tier).
 */
export function buildParty(p: PartySpec, rng?: Rng): Character[] {
  const builds = p.builds ?? PARTY_ORDER;
  const size = p.size ?? referenceSize(p.level);
  if (p.random !== undefined) {
    const r = makeRng(p.random * 7919 + 13);
    return Array.from({ length: size }, () => randomAdventurer(p.level, r));
  }
  const odds = referenceGearOdds(p.level);
  const tiers = Object.keys(odds) as (keyof typeof odds)[];
  const roll = () => {
    if (!rng) return tiers.reduce((a, b) => (odds[b] > odds[a] ? b : a));
    let x = rng();
    for (const t of tiers) if ((x -= odds[t]) < 0) return t;
    return tiers[tiers.length - 1];
  };
  return Array.from({ length: size }, (_, i) => {
    const c = buildCharacter(builds[i % builds.length], p.level, p.talent ?? 'profile', p.quality === 'expected' ? roll() : (p.quality ?? 'crude'));
    if (p.quality === 'expected' && c.armor) c.armor = { ...c.armor, quality: roll() };
    return c;
  });
}

/** One battle, AI on both sides. */
export function runBattle(party: PartySpec, quest: QuestSpec, seed: number): RunResult {
  const rng = makeRng(seed);
  const map = generateMap(rng);
  const members = buildParty(party, rng);
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
  const win = b.outcome() === 'victory';
  const defeated = theirs.filter((u) => !u.alive).length / Math.max(1, theirs.length);
  const healthLoss = mine.reduce((s, u) => s + (u.alive ? 1 - Math.min(1, Math.max(0, u.lowestHp / u.stats.health)) : 1), 0) / Math.max(1, mine.length);
  return {
    healthLoss,
    score: Math.max(0, Math.min(1, (win ? 1 : defeated) - HEALTH_WEIGHT * healthLoss)),
    win,
    rounds: b.round,
    hpLeft: mine.reduce((s, u) => s + (u.alive ? u.hp : 0), 0) / total,
    survivors: mine.filter((u) => u.alive).length,
    enemies: theirs.length,
    defeated,
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
