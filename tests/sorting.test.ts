import { describe, expect, it } from 'vitest';
import type { Quest } from '../src/data/types';
import { createCharacter } from '../src/game/character';
import { nextSort, questEnemyName, sortPeople, sortQuests } from '../src/game/sorting';
import { dangerRating } from '../src/game/board';

const quest = (id: string, over: Partial<Quest>): Quest => ({
  id, title: id, rank: 'D', stage: 1, reward: 50, renown: 5, days: 1, expires: 10, description: '', foes: ['bandit'], count: 3, ...over,
});

describe('quest board sorting', () => {
  const qs = [
    quest('d', { rank: 'D', stage: 2, reward: 40, renown: 3, foes: ['rat'] }),
    quest('b', { rank: 'B', stage: 12, reward: 400, renown: 30, foes: ['orc'] }),
    quest('c', { rank: 'C', stage: 7, reward: 600, renown: 12, foes: ['goblin'] }),
    quest('p', { rank: 'C', stage: 6, reward: 100, renown: 10, promotion: true, foes: ['wolf'] }),
  ];
  const ids = (list: Quest[]) => list.map((q) => q.id);

  it('defaults to rank, highest first, and keeps the promotion quest on top', () => {
    expect(ids(sortQuests(qs, 'rank', 'desc'))).toEqual(['p', 'b', 'c', 'd']);
    expect(ids(sortQuests(qs, 'rank', 'asc'))).toEqual(['p', 'd', 'c', 'b']);
  });

  it('sorts by gold, renown, difficulty and enemy type', () => {
    expect(ids(sortQuests(qs, 'gold', 'desc'))).toEqual(['p', 'c', 'b', 'd']);
    expect(ids(sortQuests(qs, 'renown', 'asc'))).toEqual(['p', 'd', 'c', 'b']);
    const hard = sortQuests(qs, 'difficulty', 'desc').slice(1);
    for (let i = 1; i < hard.length; i++) expect(dangerRating(hard[i - 1])).toBeGreaterThanOrEqual(dangerRating(hard[i]));
    const names = sortQuests(qs, 'enemy', 'asc').slice(1).map(questEnemyName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('picking the same key flips it; a new key starts in its own direction', () => {
    expect(nextSort({ key: 'rank', dir: 'desc' }, 'rank')).toEqual({ key: 'rank', dir: 'asc' });
    expect(nextSort({ key: 'rank', dir: 'desc' }, 'enemy')).toEqual({ key: 'enemy', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'cost')).toEqual({ key: 'cost', dir: 'desc' });
  });
});

describe('adventurer sorting', () => {
  const mk = (name: string, level: number, grade: 'S' | 'C' | 'F', price: number) => {
    const c = createCharacter(name);
    c.level = level;
    c.talents = Object.fromEntries(Object.keys(c.talents ?? { health: 1 }).map((k) => [k, grade]));
    return { character: c, price };
  };
  const people = [mk('Bree', 3, 'C', 300), mk('Arlo', 5, 'F', 100), mk('Cass', 1, 'S', 200)];
  const names = (list: typeof people) => list.map((o) => o.character.name);
  const sort = (key: 'level' | 'talent' | 'name' | 'cost', dir: 'asc' | 'desc') => names(sortPeople(people, (o) => o.character, (o) => o.price, key, dir));

  it('sorts by level, talent, name and cost', () => {
    expect(sort('level', 'desc')).toEqual(['Arlo', 'Bree', 'Cass']);
    expect(sort('talent', 'desc')).toEqual(['Cass', 'Bree', 'Arlo']);
    expect(sort('name', 'asc')).toEqual(['Arlo', 'Bree', 'Cass']);
    expect(sort('cost', 'asc')).toEqual(['Arlo', 'Cass', 'Bree']);
  });
});
