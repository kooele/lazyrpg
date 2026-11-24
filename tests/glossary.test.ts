import { describe, expect, it } from 'vitest';
import { GLOSSARY_TOPICS, glossaryEntries } from '../src/game/glossary';

describe('guide', () => {
  const entries = glossaryEntries();

  it('every topic has entries, and terms are unique', () => {
    for (const t of GLOSSARY_TOPICS) expect(entries.filter((e) => e.topic === t).length).toBeGreaterThan(0);
    expect(new Set(entries.map((e) => e.term)).size).toBe(entries.length);
  });

  it('entries are filled in from the game data (no missing numbers)', () => {
    for (const e of entries) {
      expect(e.body.length).toBeGreaterThan(40);
      expect(e.body).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it('entries fit the Guide panel (about 20 lines at its width)', () => {
    // ~75 characters a line in the panel; blank lines between paragraphs count as one.
    for (const e of entries) {
      const lines = e.body.split('\n').reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / 75)), 0);
      expect(lines, e.term).toBeLessThanOrEqual(20);
    }
  });
});
