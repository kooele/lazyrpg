import { GUILD } from '../src/data/guild';
import { describe, expect, it } from 'vitest';
import { buildCharacter, BUILDS } from '../src/game/reference';
import { expectedEnemy, fighterValue, partyFighters, partyStrength, powerRatio, questStrength, referenceGearMultiplier, referenceParty, strengthAt } from '../src/game/power';
import { talentScore } from '../src/game/talent';

const party = (level: number, quality = 'crude', talent: Parameters<typeof buildCharacter>[2] = 'profile', size = 4) =>
  ['guardian', 'caster', 'archer', 'cleric', 'bruiser'].slice(0, size).map((b) => buildCharacter(b, level, talent, quality));

describe('strength model', () => {
  it('reference builds average a B talent', () => {
    for (const b of Object.values(BUILDS)) expect(talentScore({ talents: b.talents })).toBeCloseTo(1.2, 5);
  });

  it('the reference party is its own even match, at its own level', () => {
    for (const L of [1, 4.5, 10, 17, 25]) {
      expect(powerRatio(referenceParty(L), referenceParty(L))).toBeCloseTo(1, 5);
      expect(strengthAt(referenceParty(L))).toBeCloseTo(L, 1);
    }
  });

  it('reference gear follows its curve: Crude through 5, Common at 8, Fine at 13, Masterwork at 20', () => {
    expect(referenceGearMultiplier(1)).toBe(1);
    expect(referenceGearMultiplier(5)).toBe(1);
    expect(referenceGearMultiplier(8)).toBe(2);
    expect(referenceGearMultiplier(13)).toBe(4);
    expect(referenceGearMultiplier(25)).toBe(7);
  });

  it('level, talent, gear and numbers all add strength', () => {
    const s = (...a: Parameters<typeof party>) => partyStrength(party(...a));
    expect(s(10)).toBeGreaterThan(s(8));
    expect(s(10, 'common')).toBeGreaterThan(s(10, 'crude'));
    expect(s(10, 'masterwork')).toBeGreaterThan(s(10, 'fine'));
    expect(s(10, 'crude', 'A')).toBeGreaterThan(s(10, 'crude', 'C'));
    expect(s(10, 'crude', 'profile', 5)).toBeGreaterThan(s(10, 'crude', 'profile', 4));
    expect(s(10, 'crude', 'profile', 3)).toBeLessThan(s(10, 'crude', 'profile', 4));
  });

  it('numbers count almost twice: twice the fighters is 2^numbersExponent (about 3.4) times the power', () => {
    const one = partyFighters(party(8).slice(0, 2));
    expect(powerRatio([...one, ...one], one)).toBeCloseTo(2 ** GUILD.strength.numbersExponent, 1);
  });

  it('bigger and higher-level quests are stronger', () => {
    expect(questStrength({ stage: 8, count: 6 })).toBeGreaterThan(questStrength({ stage: 8, count: 4 }));
    expect(questStrength({ stage: 10, count: 4 })).toBeGreaterThan(questStrength({ stage: 8, count: 4 }));
  });

  it('a giant rat is weaker than any level-1 Adventurer: enemies come in numbers, not as giants', () => {
    const rat = expectedEnemy('rat', 1)[0];
    for (const a of referenceParty(1)) {
      expect(rat.stats.health).toBeLessThan(a.stats.health);
      expect(fighterValue(rat, a.stats.defense)).toBeLessThan(fighterValue(a, rat.stats.defense));
    }
  });
});
