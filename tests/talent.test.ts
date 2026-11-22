import { describe, expect, it } from 'vitest';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import { TALENT_GRADES, type Talent } from '../src/data/types';
import { createCharacter, deriveStats, levelStats, makeRng } from '../src/game/character';
import { companionDemand, mercenaryRates, slavePrice, talentPriceFactor } from '../src/game/contracts';
import { newCampaign } from '../src/game/city';
import { randomAdventurer } from '../src/game/people';
import { parseSave, serializeSave } from '../src/game/save';
import { overallTalent, rollTalent, rollTalents, talentStats } from '../src/game/talent';

const all = (g: Talent) => Object.fromEntries(talentStats().map((k) => [k, g]));

describe('talent', () => {
  it('growth rates and roll chances come from stats.json', () => {
    expect(STAT_CONFIG.talent.growthRate).toEqual({ S: 1.6, A: 1.4, B: 1.2, C: 1, D: 0.8, F: 0.6 });
    expect(STAT_CONFIG.talent.chance).toEqual({ S: 0.05, A: 0.1, B: 0.2, C: 0.4, D: 0.2, F: 0.05 });
    expect(talentStats()).toEqual(['health', 'pAtk', 'mAtk', 'defense']);
  });

  it('rejects chances that do not add up to 1', () => {
    const raw = JSON.parse(JSON.stringify({ ...STAT_CONFIG, talent: { growthRate: STAT_CONFIG.talent.growthRate, chance: { ...STAT_CONFIG.talent.chance, S: 0.5 } } }));
    expect(() => parseStatConfig(raw)).toThrow(/talent.chance/);
  });

  it('scales level growth by grade (C = 100%, S = 160%, F = 60%)', () => {
    expect(levelStats(5)).toMatchObject({ health: 700, pAtk: 140, defense: 70 });
    expect(levelStats(5, all('C'))).toEqual(levelStats(5));
    expect(levelStats(5, all('S'))).toMatchObject({ health: 820, pAtk: 164, mAtk: 164, defense: 82, movement: 16 });
    expect(levelStats(5, all('F'))).toMatchObject({ health: 620, pAtk: 124, defense: 62 });
    expect(levelStats(1, all('S'))).toEqual(levelStats(1)); // talent only affects growth
    const c = createCharacter('T', '#3d7be0', 'sword_shield', undefined, { health: 'A', pAtk: 'D' });
    c.level = 3;
    expect(deriveStats(c)).toMatchObject({ health: 500 + 140, pAtk: 100 + 16 });
  });

  it('rolls grades with the configured odds', () => {
    const rng = makeRng(42);
    const n = 20000;
    const counts = Object.fromEntries(TALENT_GRADES.map((g) => [g, 0])) as Record<Talent, number>;
    for (let i = 0; i < n; i++) counts[rollTalent(rng)] += 1;
    for (const g of TALENT_GRADES) expect(counts[g] / n).toBeCloseTo(STAT_CONFIG.talent.chance[g], 1);
    expect(Object.keys(rollTalents(rng))).toEqual(talentStats());
    expect(randomAdventurer(3, makeRng(1)).talents).toBeDefined();
  });

  it('overall talent is the grade nearest the average growth rate', () => {
    expect(overallTalent({})).toBe('C');
    expect(overallTalent({ talents: all('S') })).toBe('S');
    expect(overallTalent({ talents: { health: 'S', pAtk: 'S', mAtk: 'C', defense: 'C' } })).toBe('B'); // 1.3 -> B (tie goes down)
  });

  it('talented adventurers cost more', () => {
    expect(talentPriceFactor({})).toBe(1);
    expect(talentPriceFactor({ talents: all('S') })).toBeCloseTo(2.2);
    expect(talentPriceFactor({ talents: all('F') })).toBeCloseTo(0.4);
    const s = talentPriceFactor({ talents: all('A') });
    expect(mercenaryRates(3, 1, s).fee).toBeGreaterThan(mercenaryRates(3, 1).fee);
    expect(companionDemand(3, 1, 4, 0, s)).toBeGreaterThan(companionDemand(3, 1, 4));
    expect(slavePrice(3, () => 0.5, s)).toBeGreaterThan(slavePrice(3, () => 0.5));
  });

  it('talents survive a save and load; bad grades are rejected; old saves are all C', () => {
    const main = createCharacter('Main', '#3d7be0', 'bow', undefined, { health: 'S', pAtk: 'F', mAtk: 'B', defense: 'D' });
    const state = newCampaign(main, 'Testers', makeRng(3));
    const r = parseSave(serializeSave(state));
    expect(r.ok && r.state.party[0].talents).toEqual(main.talents);
    expect(r.ok && r.state.guild.pool.every((a) => a.character.talents)).toBe(true);

    const file = JSON.parse(serializeSave(state));
    file.party[0].talents.health = 'Z';
    const bad = parseSave(JSON.stringify(file));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/talents.health/);

    delete file.party[0].talents;
    const old = parseSave(JSON.stringify(file));
    expect(old.ok && old.state.party[0].talents).toBeUndefined();
    expect(old.ok && overallTalent(old.state.party[0])).toBe('C');
  });
});
