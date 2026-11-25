import { describe, expect, it } from 'vitest';
import { titleCase } from '../src/game/titleCase';

describe('titleCase', () => {
  it('uses Chicago style for minor words', () => {
    expect(titleCase('Set out from the city gate')).toBe('Set Out from the City Gate');
    expect(titleCase('no adventurers in the lineup')).toBe('No Adventurers in the Lineup');
    expect(titleCase('back to it')).toBe('Back to It');
  });
  it('capitalizes the first word after a colon or dot separator', () => {
    expect(titleCase('night quality 2 of 3: an inn')).toBe('Night Quality 2 of 3: An Inn');
    expect(titleCase('120 gold · a day')).toBe('120 Gold · A Day');
  });
  it('leaves parentheses, abbreviations and units alone', () => {
    expect(titleCase('living expenses: 18g/day (food 6, lodging 12)')).toBe('Living Expenses: 18g/day (food 6, lodging 12)');
    expect(titleCase('4 wk · 30 dmg · Lv 5')).toBe('4 wk · 30 dmg · Lv 5');
    expect(titleCase('export to .json file')).toBe('Export to .json File');
  });
  it('capitalizes both halves of hyphenated words', () => {
    expect(titleCase('a high-end inn')).toBe('A High-End Inn');
  });
});
