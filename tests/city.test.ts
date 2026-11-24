import { describe, expect, it } from 'vitest';
import guildJson from '../src/data/guild.json';
import { FOOD_TIERS, GUILD, parseGuildConfig } from '../src/data/guild';
import type { Character, GameState, Quest } from '../src/data/types';
import { createCharacter, deriveStats, makeRng } from '../src/game/character';
import { makeEnemy, makeUnit } from '../src/game/battle';
import {
  acceptQuest, advanceDay, advanceDays, askingPrice, buyDrinks, isShipmentDay, marketBuyPrice, marketDay, sellSlave, turnInPrisoner, buyResidence, buySlave, makeQuest, sellResidence, stayAtHome, stayAtInn, canTakeQuest, dailyUpkeep, foodCost, departBlock, lineupMembers, mainCharacter, moveMember,
  killBounty, newCampaign, questXpShares, registerPrisoner, resolveQuest, rewardShares, sleepOutside, toggleLineup, weeklyTaxes, xpLevelFactor,
} from '../src/game/city';
import { activityOf, combatPenalty, expectedQuality, foodRelationship, healthOf, isInjured, moraleOf, moralePenalty, obediencePenalty } from '../src/game/condition';
import { parseSave, serializeSave } from '../src/game/save';
import {
  companionContract, companionDemand, evaluateOffer, joinParty, mercenaryRates, offerValue, openingTerms, punishSlave, slaveContract, bounty, registrationFee, slaveTax, slaveValue,
} from '../src/game/contracts';
import { DEMO_STAGES, newDemo, resolveDemoBattle } from '../src/game/demo';
import { dangerRating, expectedEnemies, fairReward, payRatio, questRenown, strength, totalThreat, usualCount } from '../src/game/board';
import { adventurerCount, adventurerRank, deathFactor, leaderboard, questDifficulty, rankDifficulty, rivalPickQuest, rivalQuestChance, rankCounts, simulateGuildDay } from '../src/game/guild';

const start = (seed = 1): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(seed));
/** Feed everyone exactly what their rank expects, so food doesn't move relationships (for tests about something else). */
const neutralFood = (s: GameState) => {
  for (const c of s.party) s.food[c.id] = FOOD_TIERS[expectedQuality(c)];
};

describe('guild.json', () => {
  it('names the field when a number is wrong', () => {
    const bad = JSON.parse(JSON.stringify(guildJson));
    bad.quests.C.count = [6, 3];
    expect(() => parseGuildConfig(bad)).toThrow(/quests\.C\.count\[1\]/);
    const shares = JSON.parse(JSON.stringify(guildJson));
    shares.startingRankShares.A = 0.5;
    expect(() => parseGuildConfig(shares)).toThrow(/startingRankShares.*add up to 1/);
  });
});

describe('ranks and the leaderboard', () => {
  it('splits parties 5% A, 20% B, 60% C, 15% D', () => {
    expect(rankCounts(21)).toEqual({ A: 1, B: 4, C: 13, D: 3 });
    expect(rankCounts(20)).toEqual({ A: 1, B: 4, C: 12, D: 3 });
  });

  it('a new game: about 100 adventurers in 20 parties, and the player starts at D rank', () => {
    const s = start();
    expect(s.guild.rivals).toHaveLength(20);
    expect(adventurerCount(s)).toBeGreaterThan(85);
    expect(adventurerCount(s)).toBeLessThan(120);
    expect(s.rank).toBe('D');
    const lb = leaderboard(s);
    expect(lb.at(-1)!.isPlayer).toBe(true);
    expect(lb.filter((e) => e.rank === 'A')).toHaveLength(1);
  });

  it('stays near 100 adventurers and 20 parties over two years, with wipes and newcomers', () => {
    for (const seed of [1, 2, 3]) {
      const s = start(seed);
      const rng = makeRng(seed * 31);
      const counts: number[] = [];
      const parties: number[] = [];
      for (let d = 0; d < 730; d++) {
        s.day += 1;
        simulateGuildDay(s, rng);
        counts.push(adventurerCount(s));
        parties.push(s.guild.rivals.length);
      }
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(counts)).toBeGreaterThan(85);
      expect(mean(counts)).toBeLessThan(120);
      expect(mean(parties)).toBeGreaterThan(16);
      expect(mean(parties)).toBeLessThan(25);
      expect(s.guild.news.some((n) => /registered|joined|arrived|wiped|lost|disbanded/.test(n.text))).toBe(true);
    }
  });

  it('renown unlocks a promotion quest; passing it promotes the party', () => {
    const s = start(4);
    const rng = makeRng(9);
    let promoQuests = 0;
    for (let i = 0; i < 30 && s.rank === 'D'; i++) {
      const promo = s.guild.board.find((x) => x.promotion);
      if (promo) {
        expect(promo.rank).toBe('C');
        expect(s.renown).toBeGreaterThanOrEqual(GUILD.ranks.renown.C);
        promoQuests += 1;
      }
      const q = promo ?? s.guild.board.find((x) => canTakeQuest(s, x))!;
      expect(acceptQuest(s, q.id)).toBeNull();
      resolveQuest(s, 'victory', rng);
      stayAtInn(s, 'standard', 1, rng);
    }
    expect(promoQuests).toBe(1);
    expect(s.rank).toBe('C');
    expect(s.log.some((n) => /now C rank/.test(n.text))).toBe(true);
  });

  it('renown doesn\'t fade; failing and deaths cost renown; a full week below the threshold drops a rank', () => {
    const s = start();
    s.rank = 'C';
    s.renown = 120;
    s.gold = 10000;
    stayAtInn(s, 'standard', 3, makeRng(1));
    expect(s.renown).toBe(120);
    const q = s.guild.board.find((x) => canTakeQuest(s, x) && x.rank === 'C')!;
    acceptQuest(s, q.id);
    s.quest!.days = 1;
    resolveQuest(s, 'defeat', makeRng(1));
    expect(s.renown).toBe(Math.max(0, 120 - q.renown * GUILD.ranks.failedQuestRenown));
    s.renown = 90; // below C's 100
    for (let i = 0; i < GUILD.ranks.demotionDays; i++) {
      expect(s.rank).toBe('C');
      stayAtInn(s, 'standard', 1, makeRng(1));
    }
    expect(s.rank).toBe('D');
    // Climbing back above the line in time resets the clock.
    s.rank = 'C';
    s.belowRankSince = 0;
    stayAtInn(s, 'standard', 3, makeRng(1));
    s.renown = 150;
    stayAtInn(s, 'standard', GUILD.ranks.demotionDays, makeRng(1));
    expect(s.rank).toBe('C');
  });

  it('high-level adventurers die less often, so A-rank parties keep their strength', () => {
    expect(deathFactor(1)).toBe(1);
    expect(deathFactor(18)).toBeLessThan(deathFactor(8));
    expect(deathFactor(8)).toBeLessThan(deathFactor(3));
    const levels: number[] = [];
    for (const seed of [1, 2, 3]) {
      const s = start(seed);
      const rng = makeRng(seed * 31);
      for (let d = 1; d <= 730; d++) {
        s.day += 1;
        simulateGuildDay(s, rng);
        if (d % 30 === 0) for (const p of s.guild.rivals.filter((x) => x.rank === 'A')) levels.push(p.members.reduce((a, m) => a + m.level, 0) / p.members.length);
      }
    }
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.reduce((a, b) => a + b, 0) / levels.length).toBeGreaterThanOrEqual(15);
  });

  it('adventurer ranks follow level; quests and new rival parties match them', () => {
    expect([1, 5, 6, 10, 11, 15, 16, 20, 21, 30].map(adventurerRank)).toEqual(['D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'S', 'S']);
    const s = start();
    for (const p of s.guild.rivals) {
      const avgLevel = p.members.reduce((a, m) => a + m.level, 0) / p.members.length;
      expect(adventurerRank(Math.round(avgLevel))).toBe(p.rank);
    }
    for (const r of ['D', 'C', 'B', 'A'] as const) {
      const q = makeQuest(r, 1, makeRng(5));
      expect(adventurerRank(q.stage)).toBe(r);
    }
  });

  it('a quest rolls its enemy level and group size; together they make its total threat, which sets gold, renown and difficulty', () => {
    const t = GUILD.threat;
    const q = (stage: number, count: number) => ({ stage, count });
    // Strength grows by strengthGrowth per level; total threat = count x strength.
    expect(strength(1)).toBeCloseTo(t.strengthAtLevel1);
    expect(strength(11) / strength(10)).toBeCloseTo(t.strengthGrowth);
    expect(totalThreat(q(8, 5))).toBeCloseTo(5 * strength(8));
    // Gold and renown follow total threat.
    expect(fairReward(q(8, 5))).toBeCloseTo(totalThreat(q(8, 5)) * t.goldPerThreat);
    expect(questRenown(q(8, 5))).toBe(Math.round(totalThreat(q(8, 5)) * t.renownPerThreat));
    // Difficulty: a standard-sized group at level L is about L - 1; more enemies or higher levels make it harder.
    expect(questDifficulty(q(8, t.standardCount))).toBeCloseTo(7);
    expect(questDifficulty(q(8, t.standardCount * t.strengthGrowth))).toBeCloseTo(8); // a level's worth of extra threat
    expect(questDifficulty(q(8, 6))).toBeGreaterThan(questDifficulty(q(8, 3)));
    expect(questDifficulty(q(9, 4))).toBeGreaterThan(questDifficulty(q(8, 4)));
    // Ranks get harder in order.
    expect(rankDifficulty('D')).toBeLessThan(rankDifficulty('C'));
    expect(rankDifficulty('C')).toBeLessThan(rankDifficulty('B'));
    expect(rankDifficulty('B')).toBeLessThan(rankDifficulty('A'));
    // Posted quests: level and group size within their rank's ranges, rolled independently (both vary), fair pay x luck.
    for (const r of ['D', 'C', 'B', 'A'] as const) {
      const quests = Array.from({ length: 60 }, (_, seed) => makeQuest(r, 1, makeRng(seed)));
      const tier = GUILD.quests[r];
      for (const quest of quests) {
        expect(quest.count).toBeGreaterThanOrEqual(tier.count[0]);
        expect(quest.count).toBeLessThanOrEqual(tier.count[1]);
        expect(quest.renown).toBe(questRenown(quest));
        expect(payRatio(quest)).toBeGreaterThan(GUILD.board.pay[0] - 0.05);
        expect(payRatio(quest)).toBeLessThan(GUILD.board.pay[1] + 0.05);
      }
      expect(new Set(quests.map((x) => x.count)).size).toBeGreaterThan(1);
      expect(new Set(quests.map((x) => x.stage)).size).toBeGreaterThan(1);
    }
  });

  it('quest XP: a day of training each, plus an equal share of the pool, then +-25% per level of difference', () => {
    const train = GUILD.schedule.trainingXp;
    const pool = GUILD.xp.pool;
    const q = { stage: 8 };
    // At the enemies' level: training + pool / party size.
    expect(questXpShares(q, [{ level: 8 }])).toEqual([train + pool]);
    expect(questXpShares(q, [{ level: 8 }, { level: 8 }, { level: 8 }, { level: 8 }])).toEqual(Array(4).fill(train + pool / 4));
    // Level difference: +25% per level below the enemies, -25% per level above, nothing at 4 or more above.
    expect(xpLevelFactor(8, 6)).toBe(1.5);
    expect(xpLevelFactor(8, 9)).toBe(0.75);
    expect(xpLevelFactor(8, 12)).toBe(0);
    expect(xpLevelFactor(8, 14)).toBe(0);
    const [vet, mid, rookie] = questXpShares(q, [{ level: 12 }, { level: 8 }, { level: 1 }]);
    const each = train + pool / 3;
    expect([vet, mid, rookie]).toEqual([0, Math.round(each), Math.round(each * (1 + 0.25 * 7))]);
    expect(questXpShares(q, [])).toEqual([]);
  });

  it('a failed quest: no pay, but training XP plus quest XP for the share of enemies defeated, and bounties for kills', () => {
    const s = start();
    const q = { ...makeQuest('D', s.day, makeRng(5)), days: 1 }; // back the same day: no upkeep on the road
    s.guild.board.push(q);
    expect(acceptQuest(s, q.id)).toBeNull();
    const main = s.party[0];
    main.level = q.stage; // no level modifier
    main.xp = 0;
    const gold = s.gold;
    const foe = (level: number) => makeEnemy('bandit', level, makeRng(level));
    const killed = [foe(q.stage), foe(q.stage)];
    // 2 of 4 enemies killed, 1 surrendered (counts as defeated, not captured on a loss): 75% of the pool.
    const lines = resolveQuest(s, 'defeat', makeRng(1), [{ id: main.id, lowestHp: 0.5, fell: false }], [foe(q.stage)], { killed, total: 4 });
    const xp = Math.round(GUILD.schedule.trainingXp + GUILD.xp.pool * 0.75);
    expect(lines.join(' ')).toContain(`75% of the enemies defeated`);
    expect(main.level * 1000 + main.xp).toBeGreaterThan(q.stage * 1000); // gained XP
    const bounties = killed.reduce((sum, f) => sum + killBounty(f.level), 0);
    expect(killBounty(5)).toBe(bounty(5)); // the same as turning in a prisoner
    expect(lines.join(' ')).toContain(`Bounties: ${bounties} gold for 2 enemies slain`);
    expect(s.gold).toBe(gold + bounties); // bounties paid, no quest pay
    expect(s.prisoners).toHaveLength(0);
    expect(questXpShares(q, [{ level: q.stage }], 0.75)).toEqual([xp]);
    expect(questXpShares(q, [{ level: q.stage }], 0)).toEqual([GUILD.schedule.trainingXp]); // nothing defeated: training only
  });

  it('quest cards: about how many foes to expect, and skulls (0.5-10 in halves) on one scale for the whole game', () => {
    // A group of 4 threat points: 4 bandits (threat 1), 8 rats (0.5), 7 goblins (0.6).
    expect(expectedEnemies({ count: 4, foes: ['bandit'] })).toBe(4);
    expect(expectedEnemies({ count: 4, foes: ['rat'] })).toBe(8);
    expect(expectedEnemies({ count: 4, foes: ['goblin'] })).toBe(7);
    expect(expectedEnemies({ count: 20, foes: ['rat'] })).toBe(12); // at most the field's cap
    // Skulls follow actual difficulty, not rank: half a skull at skulls.from, ten at skulls.to, evenly between.
    const { from, to } = GUILD.threat.skulls;
    // A level-1 group sized so its difficulty is exactly `d` (questDifficulty = log(count / standardCount) / log(growth)).
    const at = (d: number) => dangerRating({ stage: 1, count: GUILD.threat.standardCount * GUILD.threat.strengthGrowth ** d });
    expect(at(from)).toBe(0.5);
    expect(at(to)).toBe(10);
    expect(at((from + to) / 2)).toBe(5.5); // 0.5 + 9.5 / 2 = 5.25, rounded to the nearest half
    expect(at(from + (to - from) / 19)).toBe(1); // each nineteenth of the scale is another half skull
    for (const q of Array.from({ length: 200 }, (_, i) => makeQuest((['D', 'C', 'B', 'A'] as const)[i % 4], 1, makeRng(i)))) {
      expect((dangerRating(q) * 2) % 1).toBe(0); // whole or half skulls
    }
    // Harder ranks show more skulls on average; within a rank, a bigger group or higher level never shows fewer.
    const mean = (r: 'D' | 'C' | 'B' | 'A') => Array.from({ length: 100 }, (_, i) => dangerRating(makeQuest(r, 1, makeRng(i)))).reduce((a, b) => a + b, 0) / 100;
    expect(mean('D')).toBeLessThan(mean('C'));
    expect(mean('C')).toBeLessThan(mean('B'));
    expect(mean('B')).toBeLessThan(mean('A'));
    expect(dangerRating({ stage: 8, count: 6 })).toBeGreaterThanOrEqual(dangerRating({ stage: 8, count: 3 }));
  });

  it('the board is shared and busy: plenty of quests across the ranks, always some at the party\'s rank', () => {
    const s = start();
    expect(s.guild.board.length).toBeGreaterThanOrEqual(GUILD.boardSize);
    expect(s.guild.board.filter((q) => q.rank === s.rank).length).toBeGreaterThanOrEqual(GUILD.board.minAtPartyRank);
    expect(new Set(s.guild.board.map((q) => q.rank)).size).toBeGreaterThan(2);
    for (const q of s.guild.board) {
      expect(q.count).toBeGreaterThanOrEqual(GUILD.quests[q.rank].count[0]);
      expect(q.count).toBeLessThanOrEqual(GUILD.quests[q.rank].count[1]);
      const r = payRatio(q);
      expect(r).toBeGreaterThan(GUILD.board.pay[0] - 0.05);
      expect(r).toBeLessThan(GUILD.board.pay[1] + 0.05);
    }
    // Rival parties take quests off the board (not just expiry).
    const rng = makeRng(2);
    let taken = 0;
    for (let d = 0; d < 20; d++) {
      const before = s.guild.board.filter((q) => q.expires > s.day);
      advanceDay(s, rng);
      taken += before.filter((q) => !s.guild.board.includes(q)).length;
    }
    expect(taken).toBeGreaterThan(20);
    expect(s.guild.board.filter((q) => q.rank === s.rank).length).toBeGreaterThanOrEqual(GUILD.board.minAtPartyRank);
    expect(s.guild.news.some((n) => /completed "|failed "/.test(n.text)) || s.guild.rivals.some((p) => /completed "|failed "/.test(p.last))).toBe(true);
  });

  it('rivals take the best deal they can handle: good pay for the risk, never above their rank or too dangerous', () => {
    const s = start();
    const p = s.guild.rivals.find((r) => r.rank === 'C')!;
    p.members.forEach((m) => (m.level = 8));
    const q = (o: Partial<Quest>): Quest => ({ ...makeQuest('C', s.day, makeRng(1)), stage: 7, count: 4, ...o });
    const cheap = q({ reward: 150 });
    const rich = q({ reward: 300 });
    const tooHard = q({ stage: 10, count: 6, reward: 900 });
    const aboveRank = { ...makeQuest('B', s.day, makeRng(1)), stage: 11, reward: 2000 };
    expect(rivalPickQuest(p, [cheap, rich, tooHard, aboveRank])).toBe(rich);
    expect(rivalQuestChance(p, tooHard)).toBeLessThan(0.55);
    expect(rivalPickQuest(p, [tooHard, aboveRank])).toBeNull();
    // A safer quest can beat a slightly richer risky one.
    const safe = q({ stage: 6, count: 3, reward: 250 });
    const risky = q({ stage: 9, count: 5, reward: 270 });
    expect(rivalPickQuest(p, [risky, safe])).toBe(safe);
  });

  it('quests above the party rank are locked', () => {
    const s = start();
    s.guild.board.push({ id: 'q_hi', title: 'Hard', rank: 'B', stage: 5, count: 4, reward: 400, renown: 70, days: 2, expires: 99, description: '' });
    expect(acceptQuest(s, 'q_hi')).toMatch(/must be B rank/);
  });
});

describe('contracts', () => {
  const companion = (s: GameState, level = 2): Character => {
    const a = s.guild.pool[0];
    a.character.level = level;
    a.character.skillIds = [];
    delete a.character.body;
    return joinParty(s, a, companionContract(openingTerms(level, 1, 'D'), s.day, 1, GUILD.companion.startingRelationship));
  };

  it('companions want more at higher levels, less for long terms, and less from friends', () => {
    expect(companionDemand(5, 1, 4)).toBeGreaterThan(companionDemand(1, 1, 4));
    expect(companionDemand(3, 1, 12)).toBeLessThan(companionDemand(3, 1, 2));
    expect(companionDemand(3, 1, 4, 100)).toBeCloseTo(companionDemand(3, 1, 4) * (1 - GUILD.companion.renewalDiscountAtMax));
  });

  it('a fair offer is accepted, a close one countered, a low one rejected, and patience runs out', () => {
    const who = { name: 'Wren', level: 3, greed: 1, patience: 3 };
    const fair = { basePay: Math.ceil(companionDemand(3, 1, 4)), lootPct: 0, foodLodging: false, termWeeks: 4 };
    expect(evaluateOffer(who, fair, 'D').verdict).toBe('accept');
    const close = { ...fair, basePay: Math.round(fair.basePay * 0.9) };
    const r = evaluateOffer(who, close, 'D');
    expect(r.verdict).toBe('counter');
    expect(evaluateOffer(who, { ...close, basePay: r.counterPay! }, 'D').verdict).toBe('accept');
    expect(evaluateOffer(who, { ...fair, basePay: 5 }, 'D').verdict).toBe('reject');
    expect(evaluateOffer({ ...who, patience: 1 }, close, 'D').verdict).toBe('walkout');
  });

  it('a loot cut is worth more to a candidate when the party is higher ranked', () => {
    const t = { basePay: 0, lootPct: 10, foodLodging: false, termWeeks: 4 };
    expect(offerValue(t, 'B')).toBeGreaterThan(offerValue(t, 'D'));
  });

  it('wages are paid every 7th day; unpaid companions sour and quit', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.basePay = 50;
    s.gold = 1000;
    advanceDays(s, 6 - s.day + 1, makeRng(1)); // to day 7
    expect(s.day).toBe(7);
    expect(s.log.some((n) => /Payday: 50 gold/.test(n.text))).toBe(true);
    c.contract.relationship = 15;
    c.contract.endDay = 100;
    s.gold = 0;
    advanceDays(s, 7, makeRng(1));
    expect(s.party.find((m) => m.id === c.id)).toBeUndefined();
    expect(s.guild.pool.some((a) => a.character.id === c.id)).toBe(true);
  });

  it('a lapsed contract benches the companion, then they leave after the grace days', () => {
    const s = start();
    const c = companion(s);
    s.gold = 5000;
    toggleLineup(s, c.id);
    expect(lineupMembers(s).map((m) => m.id)).toContain(c.id);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = s.day + 1;
    advanceDay(s, makeRng(1));
    expect(lineupMembers(s).map((m) => m.id)).not.toContain(c.id);
    advanceDays(s, GUILD.companion.graceDays - 1, makeRng(1));
    expect(s.party.some((m) => m.id === c.id)).toBe(true);
    advanceDays(s, 2, makeRng(1));
    expect(s.party.some((m) => m.id === c.id)).toBe(false);
  });

  it('food and lodging: the main character, slaves, and companions whose contract includes it', () => {
    const s = start();
    const meal = GUILD.food[GUILD.food.default].pricePerPerson;
    expect(dailyUpkeep(s)).toBe(meal); // a night on the road is free: food only
    s.gold = 10000;
    expect(buySlave(s, s.market.slaves[0].character.id)).toBeNull();
    expect(dailyUpkeep(s)).toBe(2 * meal);
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = false;
    s.food[c.id] = 'luxury'; // not fed by the party: finds their own
    expect(dailyUpkeep(s)).toBe(2 * meal);
  });

  it('food: each fed member eats at their own quality, which costs gold and moves relationship like lodging', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.contract.relationship = 50;
    c.level = 12; // B rank: expects fine food and a high-end inn
    c.morale = 100;
    s.gold = 1000;
    s.food[s.mainId] = 'poor';
    s.food[c.id] = 'luxury';
    expect(foodCost(s)).toBe(GUILD.food.poor.pricePerPerson + GUILD.food.luxury.pricePerPerson);
    expect(foodRelationship(c, 'luxury')).toBe(GUILD.food.relationshipAbove);
    expect(foodRelationship(c, 'fine')).toBe(0);
    expect(foodRelationship(c, 'poor')).toBe(-2 * GUILD.food.relationshipBelowPerStep);
    stayAtInn(s, 'highEnd', 1, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.highEnd.pricePerPerson - foodCost(s));
    expect(c.contract.relationship).toBe(50 + GUILD.food.relationshipAbove);
    s.food[c.id] = 'poor';
    stayAtInn(s, 'highEnd', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 + GUILD.food.relationshipAbove - 2 * GUILD.food.relationshipBelowPerStep);
    // Food choices survive a save; members who leave are forgotten.
    const r = parseSave(serializeSave(s));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.food).toEqual({ [s.mainId]: 'poor', [c.id]: 'poor' });
  });

  it('a night at an inn costs its price per person; housed companions compare it with what their rank expects', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.level = 7; // C rank: expects an inn
    neutralFood(s);
    s.schedule[c.id] = 'training';
    s.schedule[s.mainId] = 'training';
    s.gold = 1000;
    const food = foodCost(s);
    const rel = c.contract.relationship;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson - food);
    expect(c.contract.relationship).toBe(rel);
    stayAtInn(s, 'luxury', 2, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson - 4 * GUILD.inns.luxury.pricePerPerson - 3 * food);
    expect(c.contract.relationship).toBe(rel + 2 * GUILD.lodging.relationshipAbove);
    expect(s.day).toBe(4);
  });

  it('expectations by rank: D is fine outside, C wants an inn, B a high-end inn, A and S a luxury inn', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    s.gold = 100000;
    const B = GUILD.lodging.relationshipBelowPerStep;
    const A = GUILD.lodging.relationshipAbove;
    expect([3, 8, 12, 18, 22].map((level) => expectedQuality({ ...c, level }))).toEqual([0, 1, 2, 3, 3]);
    const night = (level: number, go: () => void) => {
      c.level = level;
      neutralFood(s);
      (c.contract as { relationship: number }).relationship = 50;
      go();
      return (c.contract as { relationship: number }).relationship - 50;
    };
    expect(night(3, () => sleepOutside(s, makeRng(1)))).toBe(0);
    expect(night(8, () => sleepOutside(s, makeRng(1)))).toBe(-B);
    expect(night(8, () => stayAtInn(s, 'standard', 1, makeRng(1)))).toBe(0);
    expect(night(12, () => stayAtInn(s, 'standard', 1, makeRng(1)))).toBe(-B);
    expect(night(12, () => stayAtInn(s, 'highEnd', 1, makeRng(1)))).toBe(0);
    expect(night(18, () => stayAtInn(s, 'highEnd', 1, makeRng(1)))).toBe(-B);
    expect(night(22, () => sleepOutside(s, makeRng(1)))).toBe(-3 * B);
    expect(night(18, () => stayAtInn(s, 'luxury', 1, makeRng(1)))).toBe(0);
    expect(night(12, () => stayAtInn(s, 'luxury', 1, makeRng(1)))).toBe(A);
  });

  it('residences: bought per ring, free nights that count like that ring\'s inn', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.contract.relationship = 50;
    s.schedule[c.id] = 'training';
    s.schedule[s.mainId] = 'training';
    s.gold = 1999;
    expect(buyResidence(s, 'outer')).toMatch(/Not enough gold/);
    s.gold = 2000 + 10000;
    expect(buyResidence(s, 'outer')).toBeNull();
    expect(buyResidence(s, 'outer')).toMatch(/already own/);
    expect(buyResidence(s, 'middle')).toBeNull();
    expect(s.gold).toBe(0);
    expect(() => stayAtHome(s, 'inner', 1, makeRng(1))).toThrow();
    c.level = 12; // B rank: the Inner City Townhouse is as good as a high-end inn
    neutralFood(s);
    s.gold = 100;
    stayAtHome(s, 'middle', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50);
    stayAtHome(s, 'outer', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - GUILD.lodging.relationshipBelowPerStep);
    expect(s.gold).toBe(100 - 2 * foodCost(s)); // free nights, but food still costs
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.residences).toEqual(['outer', 'middle']);
    // The Estate Office buys them back for part of the price.
    expect(sellResidence(s, 'outer')).toBe(Math.round(2000 * GUILD.residences.sellShare));
    expect(s.residences).toEqual(['middle']);
    expect(sellResidence(s, 'outer')).toBe(0);
    expect(() => stayAtHome(s, 'outer', 1, makeRng(1))).toThrow();
  });

  it('quests do not end the day, and only one quest a day', () => {
    const s = start();
    const q = s.guild.board.find((x) => canTakeQuest(s, x))!;
    q.days = 1;
    acceptQuest(s, q.id);
    expect(departBlock(s)).toBeNull();
    const day = s.day;
    const lines = resolveQuest(s, 'victory', makeRng(3));
    expect(s.day).toBe(day);
    expect(lines.some((l) => /sleep outside/.test(l))).toBe(true);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    expect(departBlock(s)).toMatch(/One quest a day/);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(departBlock(s)).toBeNull();
    // A 3-day trip: two nights on the road, back on the evening of the third day.
    s.quest!.days = 3;
    resolveQuest(s, 'victory', makeRng(3));
    expect(s.day).toBe(day + 3);
    expect(s.lastQuestDay).toBe(s.day);
  });

  it('battle injuries lower Health; the injured still fight, with every stat down by 1/3 of the missing Health', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    s.gold = 1000;
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'victory', makeRng(3), [{ id: s.mainId, lowestHp: 1, fell: false }, { id: c.id, lowestHp: 0.5, fell: false }]);
    expect(healthOf(c)).toBe(100 - GUILD.condition.maxHealthLoss / 2); // 70
    expect(healthOf(mainCharacter(s))).toBe(100);
    expect(isInjured(c)).toBe(true);
    expect(lineupMembers(s).map((m) => m.id)).toEqual([s.mainId, c.id]);
    // Health 70: 30 missing, so -10% to every stat in battle.
    c.morale = 100; // only the injury here (Morale has its own test)
    const full = deriveStats(c);
    const unit = makeUnit(c, 'player', { x: 0, y: 0 });
    expect(unit.stats.health).toBe(Math.round(full.health * 0.9));
    expect(unit.stats.pAtk).toBe(Math.round(full.pAtk * 0.9));
    expect(unit.hp).toBe(unit.stats.health);
    // Everyone recovers each night; Recover doubles it (not on the quest day itself, which they spent on the quest).
    s.schedule[c.id] = 'recover';
    const h = healthOf(c);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(healthOf(c)).toBe(h + GUILD.condition.healthPerDay);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(healthOf(c)).toBe(Math.min(100, h + 3 * GUILD.condition.healthPerDay));
    // An injured leader can still set out.
    mainCharacter(s).health = 90;
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    expect(departBlock(s)).toBeNull();
  });

  it('an injured member who falls again can reach 0 Health and die', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    c.health = GUILD.condition.maxHealthLoss;
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    const renown = s.renown = 50;
    const q = s.quest!;
    resolveQuest(s, 'victory', makeRng(1), [{ id: c.id, lowestHp: 0, fell: true }]);
    expect(s.party.includes(c)).toBe(false);
    expect(s.renown).toBeCloseTo(renown + q.renown - q.renown * GUILD.ranks.deathRenown);
  });

  it('morale: quests, failures, injuries and deaths lower it; drinks and days off raise it', () => {
    const s = start();
    const C = GUILD.condition;
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    s.gold = 1000;
    const main = mainCharacter(s);
    expect(moraleOf(main)).toBe(C.startingMorale);
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'defeat', makeRng(3), [{ id: main.id, lowestHp: 0.5, fell: false }, { id: c.id, lowestHp: 1, fell: false }]);
    const loss = C.maxHealthLoss / 2;
    expect(moraleOf(c)).toBe(C.startingMorale - C.moralePerQuest - C.moraleFailedQuest);
    expect(moraleOf(main)).toBe(C.startingMorale - C.moralePerQuest - C.moraleFailedQuest - Math.round(loss * C.moralePerHealthLost));
    const before = moraleOf(main);
    const cBefore = moraleOf(c);
    expect(buyDrinks(s, 'standard')).toBeNull();
    expect(moraleOf(c)).toBe(cBefore + GUILD.inns.standard.drinksMorale);
    expect(moraleOf(main)).toBe(before + 2 * GUILD.inns.standard.drinksMorale); // Protagonist: double gains
    expect(buyDrinks(s, 'standard')).toMatch(/already/);
    // Day off the next day (the quest day itself doesn't count for those who went).
    stayAtInn(s, 'standard', 1, makeRng(1));
    s.schedule[c.id] = 'dayOff';
    const m = moraleOf(c);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(moraleOf(c)).toBe(m + GUILD.schedule.dayOffMorale);
  });

  it('a member whose Health reaches 0 dies; everyone else loses morale. The main character pulls through at 1', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    const other = companion(s);
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    // With maxHealthLoss at 100, falling takes a fully healthy member to 0 Health.
    const max = GUILD.condition.maxHealthLoss;
    GUILD.condition.maxHealthLoss = 100;
    const lines = resolveQuest(s, 'defeat', makeRng(1), [{ id: s.mainId, lowestHp: 0, fell: true }, { id: c.id, lowestHp: 0, fell: true }]);
    GUILD.condition.maxHealthLoss = max;
    expect(s.party.some((m) => m.id === c.id)).toBe(false);
    expect(lines.some((l) => /did not survive/.test(l))).toBe(true);
    expect(healthOf(mainCharacter(s))).toBe(1);
    expect(moraleOf(other)).toBe(GUILD.condition.startingMorale - GUILD.condition.moraleMemberDied);
  });

  it('a fall from full Health costs maxHealthLoss but is not fatal while that is below 100', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'victory', makeRng(1), [{ id: c.id, lowestHp: 0, fell: true }]);
    expect(healthOf(c)).toBe(Math.max(0, 100 - GUILD.condition.maxHealthLoss));
    expect(s.party.includes(c)).toBe(GUILD.condition.maxHealthLoss < 100);
  });

  it('below 50 morale companions lose relationship daily; at 0 morale members leave (not the main character)', () => {
    const s = start();
    const C = GUILD.condition;
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    c.contract.relationship = 50;
    neutralFood(s);
    s.gold = 1000;
    s.schedule[c.id] = 'training';
    c.morale = C.lowMorale - 1;
    sleepOutside(s, makeRng(1));
    expect(c.contract.relationship).toBe(50 - C.lowMoraleRelationshipPerDay);
    c.morale = C.lowMorale;
    sleepOutside(s, makeRng(1));
    expect(c.contract.relationship).toBe(50 - C.lowMoraleRelationshipPerDay);
    c.morale = 0;
    mainCharacter(s).morale = 0;
    const msgs = sleepOutside(s, makeRng(1));
    expect(s.party.some((m) => m.id === c.id)).toBe(false);
    expect(s.guild.pool.some((a) => a.character.id === c.id)).toBe(true);
    expect(msgs.some((m) => /left the party/.test(m))).toBe(true);
    expect(s.party.some((m) => m.id === s.mainId)).toBe(true);
  });

  it('schedule: training gives XP, odd jobs gold; members on the quest skip it that day', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    c.contract.foodLodging = false;
    s.schedule[c.id] = 'training';
    s.schedule[s.mainId] = 'oddJobs';
    s.gold = 1000;
    const xp = c.xp;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(c.xp).toBe(xp + GUILD.schedule.trainingXp);
    expect(s.gold).toBe(1000 + GUILD.schedule.oddJobsGold - GUILD.inns.standard.pricePerPerson - foodCost(s));
    // The main character goes on a quest: no odd jobs for them that day, but the companion still trains.
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    s.quest!.reward = 0;
    resolveQuest(s, 'victory', makeRng(3));
    const gold = s.gold;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(s.gold).toBe(gold - GUILD.inns.standard.pricePerPerson - foodCost(s));
    expect(c.xp).toBe(xp + 2 * GUILD.schedule.trainingXp);
    expect(activityOf(s, mainCharacter(s))).toBe('oddJobs');
  });

  it("quests keep their group size through a save; older saves' threat multiplier becomes a group size", () => {
    const s = start();
    const r = parseSave(serializeSave(s));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.guild.board.map((q) => q.count)).toEqual(s.guild.board.map((q) => q.count));
    // An old quest: no count, a threat multiplier on its rank's usual group.
    const raw = JSON.parse(serializeSave(s));
    const old = raw.state?.guild?.board?.[0] ?? raw.guild.board[0];
    const rank = old.rank as 'D' | 'C' | 'B' | 'A';
    delete old.count;
    old.threat = 1.3;
    const back = parseSave(JSON.stringify(raw));
    if (!back.ok) throw new Error(back.error);
    expect(back.state.guild.board[0].count).toBe(Math.round(usualCount(rank) * 1.3));
  });

  it('health, morale and the schedule survive a save', () => {
    const s = start();
    const c = companion(s);
    c.health = 70;
    c.morale = 40;
    s.schedule[c.id] = 'recover';
    s.lastQuestDay = s.day;
    s.questMembers = [s.mainId];
    const r = parseSave(serializeSave(s));
    if (!r.ok) throw new Error(r.error);
    const back = r.state.party.find((m) => m.id === c.id)!;
    expect([back.health, back.morale]).toEqual([70, 40]);
    expect(r.state.schedule[c.id]).toBe('recover');
    expect(r.state.lastQuestDay).toBe(s.day);
  });

  it('mercenaries get the larger of their fee (up front) and their cut: they take what the cut is worth beyond the fee', () => {
    const s = start();
    const merc = joinParty(s, s.guild.pool[0], { type: 'mercenary', fee: 30, cutPct: 20 });
    expect(rewardShares([merc], 100)).toEqual([]); // 20% of 100 = 20 < the 30 already paid
    expect(rewardShares([merc], 150)).toEqual([]); // 30 = 30
    expect(rewardShares([merc], 300)).toEqual([{ name: merc.name, amount: 30 }]); // 60 in all
    // Older saves' fixed-fee or cut-only mercenaries load as one or the other.
    merc.contract = { pay: 'cut', amount: 15 } as never;
    (merc.contract as unknown as Record<string, unknown>).type = 'mercenary';
    const r = parseSave(serializeSave(s));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.party.find((m) => m.id === merc.id)!.contract).toEqual({ type: 'mercenary', fee: 0, cutPct: 15 });
  });

  it('rewards are split with mercenaries on a cut and companions with a loot cut; mercenaries leave after the quest', () => {
    const s = start();
    const merc = joinParty(s, s.guild.pool[0], { type: 'mercenary', fee: 0, cutPct: 20 });
    const comp = companion(s);
    if (comp.contract?.type !== 'companion') throw new Error('not a companion');
    comp.contract.lootPct = 10;
    toggleLineup(s, merc.id);
    toggleLineup(s, comp.id);
    expect(rewardShares(lineupMembers(s), 100)).toEqual([{ name: merc.name, amount: 20 }, { name: comp.name, amount: 10 }]);
    const q = s.guild.board.find((x) => canTakeQuest(s, x))!;
    const gold = s.gold;
    acceptQuest(s, q.id);
    s.quest!.days = 1; // no nights on the road (food moves relationship too)
    const relBefore = comp.contract.relationship;
    resolveQuest(s, 'victory', makeRng(3));
    expect(s.party.some((m) => m.id === merc.id)).toBe(false);
    expect(comp.contract.relationship).toBe(relBefore + GUILD.companion.relationshipPerQuest);
    expect(s.gold).toBeGreaterThan(gold);
  });

  it('mercenary rates grow with level', () => {
    expect(mercenaryRates(5, 1).fee).toBeGreaterThan(mercenaryRates(1, 1).fee);
    expect(mercenaryRates(5, 1).cutPct).toBeGreaterThan(mercenaryRates(1, 1).cutPct);
  });

  it('enemies who surrendered are taken prisoner after a win (keeping their level and weapon)', () => {
    const s = start();
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    const foe = makeEnemy('sellsword', 9, makeRng(3));
    const lines = resolveQuest(s, 'victory', makeRng(3), [], [foe]);
    expect(s.prisoners).toHaveLength(1);
    expect(lines.some((l) => /city gate/.test(l))).toBe(true);
    expect(s.prisoners[0].character).toMatchObject({ level: 9, weaponId: foe.weaponId });
    expect(s.prisoners[0].character.enemyType).toBeUndefined();
    expect(lines.some((l) => /surrendered and was taken prisoner/.test(l))).toBe(true);
    // No prisoners from a lost battle.
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'defeat', makeRng(3), [], [makeEnemy('bandit', 5, makeRng(4))]);
    expect(s.prisoners).toHaveLength(1);
  });

  it('the slave market holds 10-30 slaves, sells a few daily, gets shipments twice a week, and prices follow supply', () => {
    const s = start();
    const rng = makeRng(7);
    const M = GUILD.market;
    const low: number[] = [];
    const high: number[] = [];
    let shipments = 0;
    for (let d = 0; d < 365; d++) {
      s.day += 1;
      const before = s.market.slaves.length;
      marketDay(s, rng);
      const n = s.market.slaves.length;
      expect(n).toBeGreaterThanOrEqual(M.stock[0]);
      expect(n).toBeLessThanOrEqual(M.stock[1]);
      if (n > before) {
        expect(isShipmentDay(s.day)).toBe(true);
        shipments++;
      }
      expect(s.market.priceIndex).toBeGreaterThanOrEqual(M.priceIndex[0]);
      expect(s.market.priceIndex).toBeLessThanOrEqual(M.priceIndex[1]);
      (n <= 15 ? low : n >= 25 ? high : []).push(s.market.priceIndex);
    }
    expect(shipments).toBeGreaterThan(80); // about twice a week
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(low.length && high.length).toBeTruthy();
    expect(mean(low)).toBeGreaterThan(mean(high)); // scarce slaves cost more
    // Asking prices follow the index.
    const o = s.market.slaves[0];
    s.market.priceIndex = 1.2;
    expect(askingPrice(s, o)).toBe(Math.max(5, Math.round((o.price * 1.2) / 5) * 5));
  });

  it('there is no limit on prisoners; each is turned in for the bounty or registered as a slave', () => {
    const s = start();
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    const foes = Array.from({ length: 10 }, (_, i) => makeEnemy('bandit', 5, makeRng(10 + i)));
    resolveQuest(s, 'victory', makeRng(3), [], foes);
    expect(s.prisoners).toHaveLength(10);
    const gold = s.gold;
    const p = s.prisoners[0];
    expect(turnInPrisoner(s, p.character.id)).toBe(p.price);
    expect(p.price).toBe(GUILD.slave.bountyPerLevel * 5);
    expect(s.gold).toBe(gold + p.price);
    expect(s.prisoners).toHaveLength(9);
  });

  it('the slave market buys your slaves for 80% of the current price', () => {
    const s = start();
    s.gold = 10000;
    expect(buySlave(s, s.market.slaves[0].character.id)).toBeNull();
    const slave = s.party.at(-1)!;
    const stock = s.market.slaves.length;
    const gold = s.gold;
    const pay = marketBuyPrice(s, slave);
    expect(GUILD.slave.sellBackShare).toBe(0.8);
    expect(sellSlave(s, slave.id, makeRng(1))).toBe(pay);
    expect(s.gold).toBe(gold + pay);
    expect(s.market.slaves).toHaveLength(stock + 1);
  });

  it('prisoners can be registered as slaves for a fee: market value minus bounty', () => {
    const s = start();
    const c = s.guild.pool[0].character;
    const p = { character: c, price: bounty(c.level) };
    s.prisoners.push(p);
    const fee = registrationFee(p);
    // Enslaving (worth its normal market value) and turning in come to the same, give or take rounding.
    expect(Math.abs(slaveValue(c) - fee - bounty(c.level))).toBeLessThanOrEqual(2.5);
    s.gold = fee - 1;
    expect(registerPrisoner(s, c.id)).toMatch(/fee/);
    s.gold = fee;
    expect(registerPrisoner(s, c.id)).toBeNull();
    const k = s.party.at(-1)!.contract;
    expect(k).toMatchObject({ type: 'slave', price: fee, origin: 'prisoner', relationship: GUILD.slave.startingRelationship });
    if (k?.type !== 'slave') throw new Error('not a slave');
    expect(k.obedience).toBeGreaterThanOrEqual(GUILD.slave.obedienceCaptive[0]);
    expect(k.obedience).toBeLessThanOrEqual(GUILD.slave.obedienceCaptive[1]);
    expect(s.gold).toBe(0);
  });

  it('slaves are taxed every payday; one whose tax goes unpaid is seized for the market', () => {
    const s = start();
    s.day = 6; // tomorrow is payday
    const c = s.guild.pool[0].character;
    s.party.push({ ...c, contract: slaveContract('market', 100, makeRng(1)) });
    const tax = slaveTax(c);
    expect(tax).toBe(Math.round(slaveValue(c) * GUILD.slave.weeklyTaxShare));
    expect(weeklyTaxes(s)).toBe(tax);
    s.gold = 10000;
    const stock = s.market.slaves.length;
    const msgs = advanceDay(s, makeRng(2));
    expect(msgs.join(' ')).toContain(`Slave property tax: ${tax} gold`);
    expect(s.party.some((m) => m.id === c.id)).toBe(true);
    // Broke on the next payday: the city takes the slave.
    for (let d = 0; d < 6; d++) advanceDay(s, makeRng(3 + d));
    s.gold = 0;
    advanceDay(s, makeRng(10));
    expect(s.party.some((m) => m.id === c.id)).toBe(false);
    expect(s.market.slaves.some((o) => o.character.id === c.id)).toBe(true);
    expect(s.market.slaves.length).toBeGreaterThanOrEqual(Math.min(stock, GUILD.market.stock[0]));
  });

  it('market slaves start fairly obedient (40-80), captives much less (0-40)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const m = slaveContract('market', 100, makeRng(seed));
      const p = slaveContract('prisoner', 60, makeRng(seed));
      expect(m.obedience).toBeGreaterThanOrEqual(40);
      expect(m.obedience).toBeLessThanOrEqual(80);
      expect(p.obedience).toBeGreaterThanOrEqual(0);
      expect(p.obedience).toBeLessThanOrEqual(40);
    }
  });

  it('battle stats drop 1% per 5 Morale below 100 and, for slaves, 1% per 5 Obedience below 100; all multiply', () => {
    const c = createCharacter('M', '#3d7be0', 'sword_shield');
    c.morale = 100;
    expect(combatPenalty(c)).toBe(0);
    c.morale = 50;
    expect(moralePenalty(c)).toBeCloseTo(0.1);
    c.morale = 52; // only full steps of 5 count
    expect(moralePenalty(c)).toBeCloseTo(0.09);
    c.morale = 50;
    c.health = 70; // injury -10%
    expect(combatPenalty(c)).toBeCloseTo(1 - 0.9 * 0.9);
    expect(obediencePenalty(c)).toBe(0); // not a slave
    c.contract = { type: 'slave', price: 1, origin: 'market', relationship: 40, obedience: 60 };
    expect(obediencePenalty(c)).toBeCloseTo(0.08);
    expect(combatPenalty(c)).toBeCloseTo(1 - 0.9 * 0.9 * 0.92);
    const full = deriveStats(c);
    const unit = makeUnit(c, 'player', { x: 0, y: 0 });
    expect(unit.stats.pAtk).toBe(Math.round(full.pAtk * 0.9 * 0.9 * 0.92));
  });

  it('obedience follows the relationship; punishing trades relationship for a quick boost', () => {
    const s = start();
    s.gold = 10000;
    const a = s.guild.pool[0];
    a.character.level = 2; // D rank: fine sleeping outside, so nights don't move relationship
    s.market.slaves.push({ character: a.character, price: 10 });
    expect(buySlave(s, a.character.id, makeRng(1))).toBeNull();
    const slave = s.party.at(-1)!;
    if (slave.contract?.type !== 'slave') throw new Error('not a slave');
    neutralFood(s);
    const k = slave.contract;
    slave.morale = 100;
    k.obedience = 50;
    k.relationship = GUILD.slave.obedienceRiseFrom;
    sleepOutside(s, makeRng(1));
    expect(k.obedience).toBe(51);
    k.relationship = 50; // in between: steady
    sleepOutside(s, makeRng(1));
    expect(k.obedience).toBe(51);
    // Punishing: +20 Obedience, -20 relationship (to 30), once a day...
    expect(punishSlave(slave, s.day)).toBeNull();
    expect([k.obedience, k.relationship]).toEqual([71, 30]);
    expect(punishSlave(slave, s.day)).toMatch(/already/);
    // ...and with relationship below 40, Obedience drains away again.
    for (let i = 0; i < 25; i++) sleepOutside(s, makeRng(1));
    expect(k.obedience).toBe(46);
    expect(k.relationship).toBe(30);
  });

  it('slaves have a relationship that moves like a companion\'s (quests, lodging)', () => {
    const s = start();
    s.gold = 10000;
    const a = s.guild.pool[0];
    a.character.level = 8; // C rank: expects an inn
    s.market.slaves.push({ character: a.character, price: 10 });
    buySlave(s, a.character.id, makeRng(1));
    const slave = s.party.at(-1)!;
    if (slave.contract?.type !== 'slave') throw new Error('not a slave');
    neutralFood(s);
    slave.morale = 100;
    const rel = slave.contract.relationship;
    sleepOutside(s, makeRng(1));
    expect(slave.contract.relationship).toBe(rel - GUILD.lodging.relationshipBelowPerStep);
    toggleLineup(s, slave.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'victory', makeRng(1));
    expect(slave.contract.relationship).toBe(rel - GUILD.lodging.relationshipBelowPerStep + GUILD.companion.relationshipPerQuest);
  });

  it('the main character is the Protagonist: double injury recovery and double Morale gains', () => {
    const s = start();
    const main = mainCharacter(s);
    expect(main.traits).toEqual(['protagonist']);
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    expect(c.traits).toBeUndefined();
    s.gold = 1000;
    for (const m of [main, c]) {
      m.health = 50;
      m.morale = 50;
      s.schedule[m.id] = 'dayOff';
    }
    sleepOutside(s, makeRng(1));
    expect(main.health).toBe(50 + 2 * GUILD.condition.healthPerDay);
    expect(c.health).toBe(50 + GUILD.condition.healthPerDay);
    expect(main.morale).toBe(50 + 2 * GUILD.schedule.dayOffMorale);
    expect(c.morale).toBe(50 + GUILD.schedule.dayOffMorale);
    // Losses aren't doubled.
    const before = main.morale!;
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'victory', makeRng(3));
    expect(main.morale).toBe(before - GUILD.condition.moralePerQuest);
    // Saves keep it, and older saves give it to the main character.
    delete main.traits;
    const r = parseSave(serializeSave(s));
    if (!r.ok) throw new Error(r.error);
    expect(r.state.party.find((m) => m.id === s.mainId)!.traits).toEqual(['protagonist']);
    expect(r.state.party.find((m) => m.id === c.id)!.traits).toBeUndefined();
  });

  it('the main character can be benched to recover while the others go on quests', () => {
    const s = start();
    const main = mainCharacter(s);
    const c = companion(s);
    if (c.contract?.type === 'companion') c.contract.endDay = 100;
    expect(toggleLineup(s, c.id)).toBeNull();
    expect(toggleLineup(s, s.mainId)).toBeNull();
    expect(lineupMembers(s).map((m) => m.id)).toEqual([c.id]);
    main.health = 40;
    s.schedule[main.id] = 'recover';
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 2;
    expect(departBlock(s)).toBeNull();
    const before = moraleOf(main);
    const xp = main.xp;
    resolveQuest(s, 'victory', makeRng(3));
    // The main character stayed home: no quest Morale loss or XP, and the night on the road was spent recovering.
    expect(moraleOf(main)).toBeGreaterThanOrEqual(before);
    expect(main.xp).toBe(xp);
    expect(healthOf(main)).toBeGreaterThan(40);
    expect(s.questMembers).toEqual([c.id]);
    // The lineup stays as it was: the main character is still benched.
    expect(lineupMembers(s).map((m) => m.id)).toEqual([c.id]);
  });

  it('a party cannot set out with nobody in the lineup', () => {
    const s = start();
    toggleLineup(s, s.mainId);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    expect(departBlock(s)).toMatch(/Nobody is in the lineup/);
    expect(toggleLineup(s, s.mainId)).toBeNull();
    expect(departBlock(s)).toBeNull();
  });

  it('moving a member reorders the party and the lineup with it', () => {
    const s = start();
    const a = companion(s);
    const b = companion(s);
    for (const m of [a, b]) if (m.contract?.type === 'companion') m.contract.endDay = 100;
    toggleLineup(s, a.id);
    toggleLineup(s, b.id);
    expect(lineupMembers(s).map((m) => m.id)).toEqual([s.mainId, a.id, b.id]);
    moveMember(s, b.id, 0);
    expect(s.party.map((m) => m.id)).toEqual([b.id, s.mainId, a.id]);
    expect(lineupMembers(s).map((m) => m.id)).toEqual([b.id, s.mainId, a.id]);
    expect(s.lineup).toEqual([b.id, s.mainId, a.id]);
    moveMember(s, b.id, 99);
    expect(s.party.map((m) => m.id)).toEqual([s.mainId, a.id, b.id]);
  });
});

describe('quick battle (demo)', () => {
  it('runs 5 stages: each victory is worth a level, and stage 5 completes the demo', () => {
    const d = newDemo();
    d.party.push(createCharacter('A'));
    resolveDemoBattle(d, 'defeat');
    expect(d.stage).toBe(1);
    for (let i = 0; i < DEMO_STAGES; i++) resolveDemoBattle(d, 'victory');
    expect(d.complete).toBe(true);
    expect(d.stage).toBe(DEMO_STAGES);
    expect(d.party[0].level).toBe(1 + DEMO_STAGES);
    expect(d).toMatchObject({ victories: DEMO_STAGES, defeats: 1 });
  });
});
