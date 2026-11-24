import { describe, expect, it } from 'vitest';
import { STAT_CONFIG, parseStatConfig } from '../src/data/stats';
import { TALENT_GRADES, type Talent } from '../src/data/types';
import { createCharacter, deriveStats, levelStats, makeRng } from '../src/game/character';
import { companionDemand, mercenaryRates, slavePrice, talentPriceFactor } from '../src/game/contracts';
import { newCampaign } from '../src/game/city';
import { randomAdventurer } from '../src/game/people';
import { parseSave, serializeSave } from '../src/game/save';
import { overallTalent, overallTalentLabel, rollTalent, rollTalents, talentStats } from '../src/game/talent';

const all = (g: Talent) => Object.fromEntries(talentStats().map((k) => [k, g]));

describe('talent', () => {
  it('growth rates and roll weights come from stats.json', () => {
    expect(STAT_CONFIG.talent.growthRate).toEqual({ S: 1.6, A: 1.4, B: 1.2, C: 1, D: 0.8, F: 0.6 });
    expect(STAT_CONFIG.talent.weight).toEqual({ S: 5, A: 10, B: 20, C: 40, D: 20, F: 5 });
    expect(STAT_CONFIG.talent.chance).toEqual({ S: 0.05, A: 0.1, B: 0.2, C: 0.4, D: 0.2, F: 0.05 });
    expect(talentStats()).toEqual(['health', 'mana', 'pAtk', 'mAtk', 'defense', 'resist']);
  });

  it('weights become chances (any total); a grade left out never comes up', () => {
    const cfg = (weight: unknown) => parseStatConfig({ ...JSON.parse(JSON.stringify(STAT_CONFIG)), talent: { growthRate: STAT_CONFIG.talent.growthRate, weight } });
    expect(cfg({ S: 1, A: 1, B: 1, C: 1, D: 0, F: 0 }).talent.chance).toEqual({ S: 0.25, A: 0.25, B: 0.25, C: 0.25, D: 0, F: 0 });
    const onlyS = cfg({ S: 3 });
    expect(onlyS.talent.chance.S).toBe(1);
    expect(rollTalent(makeRng(1), onlyS)).toBe('S');
    expect(() => cfg({ S: 0 })).toThrow(/talent.weight/);
    expect(() => cfg({ S: -1, C: 5 })).toThrow(/talent.weight.S/);
  });

  it('scales level growth by grade (C = 100%, S = 160%, F = 60%)', () => {
    expect(levelStats(5)).toMatchObject({ health: 700, mana: 280, pAtk: 140, defense: 40, resist: 40 });
    expect(levelStats(5, all('C'))).toEqual(levelStats(5));
    expect(levelStats(5, all('S'))).toMatchObject({ health: 820, mana: 328, pAtk: 164, mAtk: 164, defense: 64, resist: 64, movement: 16 });
    expect(levelStats(5, all('F'))).toMatchObject({ health: 620, pAtk: 124, defense: 24 });
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
    expect(overallTalent({ talents: { health: 'S', mana: 'C', pAtk: 'S', mAtk: 'C', defense: 'C', resist: 'C' } })).toBe('B'); // 1.2
  });

  it('the overall label adds + or - within a grade: A+ just under S, S- just under all-S', () => {
    const t = (...g: Talent[]) => ({ talents: { health: g[0], mana: g[1], pAtk: g[2], mAtk: g[3], defense: g[4], resist: g[5] } });
    expect(overallTalentLabel({})).toBe('C');
    expect(overallTalentLabel({ talents: all('S') })).toBe('S'); // nothing above S
    expect(overallTalentLabel({ talents: all('F') })).toBe('F'); // nothing below F
    expect(overallTalentLabel(t('S', 'S', 'S', 'S', 'S', 'A'))).toBe('S-'); // 1.567
    expect(overallTalentLabel(t('A', 'A', 'A', 'A', 'S', 'S'))).toBe('A+'); // 1.467
    expect(overallTalentLabel(t('B', 'C', 'C', 'C', 'C', 'C'))).toBe('C+'); // 1.033
    expect(overallTalentLabel(t('D', 'C', 'C', 'C', 'C', 'C'))).toBe('C-'); // 0.967
    expect(overallTalentLabel(t('A', 'C', 'C', 'C', 'C', 'D'))).toBe('C+'); // 1.033
    expect(overallTalentLabel(t('B', 'B', 'B', 'C', 'C', 'C'))).toBe('C+'); // 1.1: halfway, rounds to C
    expect(overallTalentLabel(t('B', 'B', 'B', 'B', 'C', 'C'))).toBe('B-'); // 1.133
    expect(overallTalentLabel(t('B', 'B', 'B', 'B', 'B', 'B'))).toBe('B');
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

  it('older saves with Accuracy / Evasion talents and Body points still load (those are dropped)', () => {
    const c = createCharacter('Main', '#3d7be0', 'bow', undefined, { health: 'A' });
    const file = JSON.parse(serializeSave(newCampaign(c, 'Testers', makeRng(3))));
    file.party[0].talents = { health: 'A', accuracy: 'S', evasion: 'F' };
    file.party[0].body = { accuracy: 1, evasion: 1 };
    const r = parseSave(JSON.stringify(file));
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.party[0].talents).toEqual({ health: 'A' });
    expect(r.ok && r.state.party[0].body).toBeUndefined();
  });

  it('talents survive a save and load; bad grades are rejected; old saves are all C', () => {
    const main = createCharacter('Main', '#3d7be0', 'bow', undefined, { health: 'S', mana: 'A', pAtk: 'F', mAtk: 'B', defense: 'D', resist: 'B' });
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
