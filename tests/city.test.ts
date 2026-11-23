import { describe, expect, it } from 'vitest';
import guildJson from '../src/data/guild.json';
import { GUILD, parseGuildConfig } from '../src/data/guild';
import type { Character, GameState } from '../src/data/types';
import { createCharacter, deriveStats, makeRng } from '../src/game/character';
import { makeEnemy, makeUnit } from '../src/game/battle';
import {
  acceptQuest, advanceDay, advanceDays, buyDrinks, buyResidence, buySlave, makeQuest, sellResidence, stayAtHome, stayAtInn, canTakeQuest, dailyUpkeep, departBlock, lineupMembers, mainCharacter,
  newCampaign, registerPrisoner, resolveQuest, rewardShares, sleepOutside, toggleLineup,
} from '../src/game/city';
import { activityOf, combatPenalty, expectedQuality, healthOf, isInjured, moraleOf, moralePenalty, obediencePenalty } from '../src/game/condition';
import { parseSave, serializeSave } from '../src/game/save';
import {
  companionContract, companionDemand, evaluateOffer, joinParty, mercenaryRates, offerValue, openingTerms, punishSlave, slaveContract,
} from '../src/game/contracts';
import { DEMO_STAGES, newDemo, resolveDemoBattle } from '../src/game/demo';
import { adventurerCount, adventurerRank, deathFactor, leaderboard, rankCounts, simulateGuildDay } from '../src/game/guild';

const start = (seed = 1): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(seed));

describe('guild.json', () => {
  it('names the field when a number is wrong', () => {
    const bad = JSON.parse(JSON.stringify(guildJson));
    bad.quests.C.reward = [300, 100];
    expect(() => parseGuildConfig(bad)).toThrow(/quests\.C\.reward\[1\]/);
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

  it('quests above the party rank are locked', () => {
    const s = start();
    s.guild.board.push({ id: 'q_hi', title: 'Hard', rank: 'B', stage: 5, reward: 400, renown: 70, days: 2, expires: 99, description: '' });
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
    expect(dailyUpkeep(s)).toBe(GUILD.upkeep.foodLodgingPerDay);
    s.gold = 10000;
    expect(buySlave(s, s.market.slaves[0].character.id)).toBeNull();
    expect(dailyUpkeep(s)).toBe(2 * GUILD.upkeep.foodLodgingPerDay);
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = false;
    expect(dailyUpkeep(s)).toBe(2 * GUILD.upkeep.foodLodgingPerDay);
  });

  it('a night at an inn costs its price per person; housed companions compare it with what their rank expects', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.level = 7; // C rank: expects an inn
    s.schedule[c.id] = 'training';
    s.schedule[s.mainId] = 'training';
    s.gold = 1000;
    const rel = c.contract.relationship;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson);
    expect(c.contract.relationship).toBe(rel);
    stayAtInn(s, 'luxury', 2, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson - 4 * GUILD.inns.luxury.pricePerPerson);
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
    c.level = 12; // B rank: a Middle Ring residence is as good as a high-end inn
    stayAtHome(s, 'middle', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50);
    stayAtHome(s, 'outer', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - GUILD.lodging.relationshipBelowPerStep);
    expect(s.gold).toBe(0); // free
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
    expect(buyDrinks(s, 'standard')).toBeNull();
    expect(moraleOf(main)).toBe(before + GUILD.inns.standard.drinksMorale);
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
    expect(s.gold).toBe(1000 + GUILD.schedule.oddJobsGold - GUILD.inns.standard.pricePerPerson);
    // The main character goes on a quest: no odd jobs for them that day, but the companion still trains.
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    s.quest!.reward = 0;
    resolveQuest(s, 'victory', makeRng(3));
    const gold = s.gold;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(s.gold).toBe(gold - GUILD.inns.standard.pricePerPerson);
    expect(c.xp).toBe(xp + 2 * GUILD.schedule.trainingXp);
    expect(activityOf(s, mainCharacter(s))).toBe('oddJobs');
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

  it('rewards are split with mercenaries on a cut and companions with a loot cut; mercenaries leave after the quest', () => {
    const s = start();
    const merc = joinParty(s, s.guild.pool[0], { type: 'mercenary', pay: 'cut', amount: 20 });
    const comp = companion(s);
    if (comp.contract?.type !== 'companion') throw new Error('not a companion');
    comp.contract.lootPct = 10;
    toggleLineup(s, merc.id);
    toggleLineup(s, comp.id);
    expect(rewardShares(lineupMembers(s), 100)).toEqual([{ name: merc.name, amount: 20 }, { name: comp.name, amount: 10 }]);
    const q = s.guild.board.find((x) => canTakeQuest(s, x))!;
    const gold = s.gold;
    acceptQuest(s, q.id);
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
    expect(s.prisoners[0].character).toMatchObject({ level: 9, weaponId: foe.weaponId });
    expect(s.prisoners[0].character.enemyType).toBeUndefined();
    expect(lines.some((l) => /surrendered and was taken prisoner/.test(l))).toBe(true);
    // No prisoners from a lost battle.
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'defeat', makeRng(3), [], [makeEnemy('bandit', 5, makeRng(4))]);
    expect(s.prisoners).toHaveLength(1);
  });

  it('prisoners can be registered as slaves for a fee', () => {
    const s = start();
    s.prisoners.push({ character: s.guild.pool[0].character, price: 50 });
    s.gold = GUILD.slave.registrationFee;
    expect(registerPrisoner(s, s.prisoners[0].character.id)).toBeNull();
    const k = s.party.at(-1)!.contract;
    expect(k).toMatchObject({ type: 'slave', price: GUILD.slave.registrationFee, origin: 'prisoner', relationship: GUILD.slave.startingRelationship });
    if (k?.type !== 'slave') throw new Error('not a slave');
    expect(k.obedience).toBeGreaterThanOrEqual(GUILD.slave.obedienceCaptive[0]);
    expect(k.obedience).toBeLessThanOrEqual(GUILD.slave.obedienceCaptive[1]);
    expect(s.gold).toBe(0);
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

  it('the main character always goes and cannot be benched', () => {
    const s = start();
    expect(toggleLineup(s, s.mainId)).toMatch(/always goes/);
    expect(lineupMembers(s)[0].id).toBe(s.mainId);
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
