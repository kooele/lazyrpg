// Sort orders for the city's lists: the quest board, the guild hall and the slave market.
// Pure logic (no Phaser): scenes keep the chosen key and direction and call these.
import { ENEMIES } from '../data/enemies';
import { RANKS, type Character, type Quest } from '../data/types';
import { dangerRating, questDifficulty } from './board';
import { talentScore } from './talent';

export type SortDir = 'asc' | 'desc';

export type QuestSort = 'rank' | 'gold' | 'renown' | 'difficulty' | 'enemy';
export const QUEST_SORTS: [QuestSort, string][] = [
  ['rank', 'Rank'], ['gold', 'Gold'], ['renown', 'Renown'], ['difficulty', 'Difficulty'], ['enemy', 'Enemy Type'],
];

export type PeopleSort = 'level' | 'talent' | 'name' | 'cost';
export const PEOPLE_SORTS: [PeopleSort, string][] = [['level', 'Level'], ['talent', 'Talent'], ['name', 'Name'], ['cost', 'Cost']];

/** The direction a key sorts in when first picked: names A-Z, everything else highest first. */
export const firstDir = (key: QuestSort | PeopleSort): SortDir => (key === 'name' || key === 'enemy' ? 'asc' : 'desc');

/** Pick `key`: picking the current key again flips its direction; a new key starts in its first direction. */
export function nextSort<K extends QuestSort | PeopleSort>(cur: { key: K; dir: SortDir }, key: K): { key: K; dir: SortDir } {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir(key) };
}

/** The name of a quest's main enemy type (its first foe), for sorting by enemy type. */
export const questEnemyName = (q: Pick<Quest, 'foes'>) => ENEMIES[q.foes?.[0] ?? '']?.name ?? 'Bandit';

/** A higher number for a higher rank (D 0 ... A 3). */
const rankValue = (q: Pick<Quest, 'rank'>) => RANKS.length - 1 - RANKS.indexOf(q.rank);

/**
 * The quest board in the chosen order. The promotion quest always stays on top. Ties fall back to rank, then
 * difficulty, then gold (each highest first), so equal quests keep a steady order.
 */
export function sortQuests(quests: Quest[], key: QuestSort, dir: SortDir): Quest[] {
  const sign = dir === 'asc' ? 1 : -1;
  const primary = (a: Quest, b: Quest): number => {
    switch (key) {
      case 'rank': return rankValue(a) - rankValue(b);
      case 'gold': return a.reward - b.reward;
      case 'renown': return a.renown - b.renown;
      case 'difficulty': return dangerRating(a) - dangerRating(b) || questDifficulty(a) - questDifficulty(b);
      case 'enemy': return questEnemyName(a).localeCompare(questEnemyName(b));
    }
  };
  return [...quests].sort((a, b) => Number(!!b.promotion) - Number(!!a.promotion)
    || sign * primary(a, b)
    || rankValue(b) - rankValue(a)
    || questDifficulty(b) - questDifficulty(a)
    || b.reward - a.reward);
}

/**
 * Adventurers (in the guild hall or on the slave market) in the chosen order. `cost` gives each one's price
 * (a mercenary's fee, a slave's asking price). Ties fall back to level (highest first), then name.
 */
export function sortPeople<T>(items: T[], character: (t: T) => Character, cost: (t: T) => number, key: PeopleSort, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const primary = (a: T, b: T): number => {
    const ca = character(a);
    const cb = character(b);
    switch (key) {
      case 'level': return ca.level - cb.level;
      case 'talent': return talentScore(ca) - talentScore(cb);
      case 'name': return ca.name.localeCompare(cb.name);
      case 'cost': return cost(a) - cost(b);
    }
  };
  return [...items].sort((a, b) => sign * primary(a, b)
    || character(b).level - character(a).level
    || character(a).name.localeCompare(character(b).name));
}
