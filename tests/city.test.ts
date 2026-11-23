import { describe, expect, it } from 'vitest';
import guildJson from '../src/data/guild.json';
import { GUILD, parseGuildConfig } from '../src/data/guild';
import type { Character, GameState } from '../src/data/types';
import { createCharacter, makeRng } from '../src/game/character';
import {
  acceptQuest, advanceDay, advanceDays, buyDrinks, buySlave, stayAtInn, canTakeQuest, dailyUpkeep, departBlock, lineupMembers, mainCharacter,
  newCampaign, registerPrisoner, resolveQuest, rewardShares, sleepOutside, toggleLineup,
} from '../src/game/city';
import { activityOf, expectedInn, healthOf, isInjured, moraleOf } from '../src/game/condition';
import { parseSave, serializeSave } from '../src/game/save';
import {
  companionContract, companionDemand, evaluateOffer, joinParty, mercenaryRates, offerValue, openingTerms,
} from '../src/game/contracts';
import { DEMO_STAGES, newDemo, resolveDemoBattle } from '../src/game/demo';
import { adventurerCount, leaderboard, rankCounts, simulateGuildDay } from '../src/game/guild';

const start = (seed = 1): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(seed));

describe('guild.json', () => {
  it('names the field when a number is wrong', () => {
    const bad = JSON.parse(JSON.stringify(guildJson));
    bad.quests.C.reward = [300, 100];
    expect(() => parseGuildConfig(bad)).toThrow(/quests\.C\.reward\[1\]/);
    const shares = JSON.parse(JSON.stringify(guildJson));
    shares.rankShares.A = 0.5;
    expect(() => parseGuildConfig(shares)).toThrow(/rankShares.*add up to 1/);
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

  it('completing quests moves the player up the ranks', () => {
    const s = start(4);
    const rng = makeRng(9);
    for (let i = 0; i < 15 && s.rank === 'D'; i++) {
      const q = s.guild.board.find((x) => canTakeQuest(s, x))!;
      expect(acceptQuest(s, q.id)).toBeNull();
      resolveQuest(s, 'victory', rng);
      stayAtInn(s, 'standard', 1, rng);
    }
    expect(s.rank).toBe('C');
    expect(s.log.some((n) => /promoted to C rank/.test(n.text))).toBe(true);
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

  it('a night at an inn costs its price per person; housed companions compare it with what their level expects', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.level = 3;
    s.schedule[c.id] = 'training'; // not Day Off, so gold is the only thing that changes besides XP
    s.schedule[s.mainId] = 'training';
    s.gold = 1000;
    const rel = c.contract.relationship;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson);
    expect(c.contract.relationship).toBe(rel); // level 3 expects a regular inn
    stayAtInn(s, 'luxury', 2, makeRng(1));
    expect(s.gold).toBe(1000 - 2 * GUILD.inns.standard.pricePerPerson - 4 * GUILD.inns.luxury.pricePerPerson);
    expect(c.contract.relationship).toBe(rel + 2 * GUILD.lodging.relationshipAbove);
    expect(s.day).toBe(4);
  });

  it('level 6+ adventurers expect the high-end inn; sleeping outside upsets everyone housed', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.foodLodging = true;
    c.contract.endDay = 100;
    c.contract.relationship = 50;
    s.gold = 1000;
    c.level = GUILD.lodging.luxuryFromLevel;
    expect(expectedInn(c)).toBe('luxury');
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - GUILD.lodging.relationshipBelowPerStep);
    stayAtInn(s, 'luxury', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - GUILD.lodging.relationshipBelowPerStep); // as expected: no change
    const gold = s.gold;
    sleepOutside(s, makeRng(1));
    expect(c.contract.relationship).toBe(50 - 3 * GUILD.lodging.relationshipBelowPerStep); // two steps below
    c.level = 2;
    sleepOutside(s, makeRng(1));
    expect(c.contract.relationship).toBe(50 - 4 * GUILD.lodging.relationshipBelowPerStep);
    expect(s.gold).toBeGreaterThanOrEqual(gold); // free (odd jobs aside)
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

  it('battle injuries lower Health; the injured sit out until they recover', () => {
    const s = start();
    const c = companion(s);
    if (c.contract?.type !== 'companion') throw new Error('not a companion');
    c.contract.endDay = 100;
    s.gold = 1000;
    toggleLineup(s, c.id);
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    s.quest!.days = 1;
    resolveQuest(s, 'victory', makeRng(3), [{ id: s.mainId, lowestHp: 1, fell: false }, { id: c.id, lowestHp: 0.5, fell: false }]);
    expect(healthOf(c)).toBe(100 - GUILD.condition.maxHealthLoss / 2);
    expect(healthOf(mainCharacter(s))).toBe(100);
    expect(isInjured(c)).toBe(true);
    expect(lineupMembers(s).map((m) => m.id)).toEqual([s.mainId]);
    expect(toggleLineup(s, c.id)).toMatch(/injured/);
    // Everyone recovers each night; Recover doubles it (not on the quest day itself, which they spent on the quest).
    s.schedule[c.id] = 'recover';
    const h = healthOf(c);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(healthOf(c)).toBe(h + GUILD.condition.healthPerDay);
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(healthOf(c)).toBe(Math.min(100, h + 3 * GUILD.condition.healthPerDay));
    while (isInjured(c)) stayAtInn(s, 'standard', 1, makeRng(1));
    expect(toggleLineup(s, c.id)).toBeNull();
    // An injured leader can't set out at all.
    mainCharacter(s).health = 90;
    acceptQuest(s, s.guild.board.find((x) => canTakeQuest(s, x))!.id);
    expect(departBlock(s)).toMatch(/injured/);
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
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - C.lowMoraleRelationshipPerDay);
    c.morale = C.lowMorale;
    stayAtInn(s, 'standard', 1, makeRng(1));
    expect(c.contract.relationship).toBe(50 - C.lowMoraleRelationshipPerDay);
    c.morale = 0;
    mainCharacter(s).morale = 0;
    const msgs = stayAtInn(s, 'standard', 1, makeRng(1));
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

  it('prisoners can be registered as slaves for a fee', () => {
    const s = start();
    s.prisoners.push({ character: s.guild.pool[0].character, price: 50 });
    s.gold = GUILD.slave.registrationFee;
    expect(registerPrisoner(s, s.prisoners[0].character.id)).toBeNull();
    expect(s.party.at(-1)!.contract).toEqual({ type: 'slave', price: GUILD.slave.registrationFee, origin: 'prisoner' });
    expect(s.gold).toBe(0);
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
