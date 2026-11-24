// The in-game Guide: short explanations of the rules that aren't obvious from the screens.
// Pure (no Phaser). Numbers are read from the game data, so entries stay right when the balance changes.
import { MAX_PARTY_SIZE, STATUSES, xpToNext } from '../data/content';
import { FOOD_TIERS, GUILD, INN_TIERS, trainingXp } from '../data/guild';
import { STAT_CONFIG } from '../data/stats';
import { RANKS, type Rank } from '../data/types';

export const GLOSSARY_TOPICS = ['City life', 'Quests & ranks', 'Experience', 'Party members', 'Slaves', 'Battle'] as const;
export type GlossaryTopic = (typeof GLOSSARY_TOPICS)[number];

export interface GlossaryEntry {
  term: string;
  topic: GlossaryTopic;
  body: string;
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const quad = ({ a, b, c }: { a: number; b: number; c: number }, x: string) => `${a} × ${x}² + ${b} × ${x} + ${c}`;
const at = (f: { a: number; b: number; c: number }, x: number) => f.a * x * x + f.b * x + f.c;

/** Every Guide entry, grouped by topic in display order. */
export function glossaryEntries(): GlossaryEntry[] {
  const G = GUILD;
  const C = G.condition;
  const S = G.slave;
  const K = G.companion;
  const L = G.lodging;
  const T = G.threat;
  const food = (q: number) => G.food[FOOD_TIERS[q]].pricePerPerson;
  const night = (q: number) => (q === 0 ? L.stablesPerPerson : G.inns[INN_TIERS[q - 1]].pricePerPerson);
  const adventurerQ = L.expectedQuality.D;
  const promoRanks = RANKS.filter((r) => r !== 'D' && RANKS.indexOf(r) >= RANKS.indexOf(G.ranks.highestPromotion)).reverse() as Exclude<Rank, 'D'>[];
  const thresholds = promoRanks.map((r) => `${r} ${n(G.ranks.renown[r])}`).join(', ');
  const [payLo, payHi] = G.board.pay;
  const xp = G.xp.pool;
  const growth = STAT_CONFIG.talent.growthRate;
  const burn = STATUSES.burn;
  const slow = STATUSES.slow;
  const out: GlossaryEntry[] = [];
  const add = (topic: GlossaryTopic, term: string, body: string) => out.push({ topic, term, body });

  // ---- City life -------------------------------------------------------------------------------
  add('City life', 'Days and End Day',
    `Time only passes when you press End Day. Everyone the party houses eats and sleeps where you lodge them, and the schedule runs for members who didn't quest that day.\n\n`
    + `You can go on one quest a day: coming back from one doesn't end the day, but the next one has to wait until tomorrow. Multi-day quests spend the nights before the last one on the road (free lodging, food still paid).\n\n`
    + `Every 7th day is payday: companion wages and slave taxes are due.`);
  add('City life', 'Health (not battle HP)',
    `Health is a member's condition between battles, out of 100. It isn't their HP in battle.\n\n`
    + `After a battle each member loses up to ${C.maxHealthLoss} Health, depending on how low their HP got (falling costs the full ${C.maxHealthLoss}). Below 100 a member is injured: every battle stat drops by a third of their missing Health (Health 70 = −10%).\n\n`
    + `Everyone recovers ${C.healthPerDay} Health a night (${C.healthPerDay * G.schedule.recoverMultiplier} on Recover). At 0 Health a member dies, so an injured member who falls again can die. The main character pulls through at 1 instead.`);
  add('City life', 'Morale',
    `Morale (out of 100) drops by ${C.moralePerTurn} per battle turn for everyone who fought, by ${C.moraleFailedQuest} more for a failed quest, with injuries, and by ${C.moraleMemberDied} for everyone when a member dies. New members start at ${C.startingMorale}.\n\n`
    + `It comes back with a round of drinks at an inn (once a day) and with days off.\n\n`
    + `Below ${C.lowMorale}, companions and slaves lose ${C.lowMoraleRelationshipPerDay} relationship a day. At 0 a member leaves the party (the main character stays).`);
  add('City life', 'Battle penalties',
    `Injury, Morale and Obedience all weaken a member in battle, and the penalties multiply:\n\n`
    + `• Injury: −1/3 of missing Health.\n• Morale: −${G.combat.percentPer5}% per 5 Morale below 100.\n• Obedience (slaves): −${G.combat.percentPer5}% per 5 Obedience below 100.\n\n`
    + `Health 70, Morale 50 and Obedience 60 give 0.9 × 0.9 × 0.92: about −25%. Manage Party shows each member's total.`);
  add('City life', 'Schedule',
    `Members who aren't on a quest follow their schedule when the day ends (set in Manage Party):\n\n`
    + `• Recover: ${G.schedule.recoverMultiplier}× Health recovery.\n• Training: ${G.schedule.trainingXp.perLevel} XP per level + ${G.schedule.trainingXp.flat} (${trainingXp(1)} at level 1, ${trainingXp(20)} at level 20).\n• Odd Jobs: +${G.schedule.oddJobsGold} gold.\n• Day Off: +${G.schedule.dayOffMorale} Morale.\n\n`
    + `Unscheduled members recover when injured and take a day off otherwise. Benched members (not in the lineup) follow it too.`);
  add('City life', 'Food and lodging expectations',
    `Each member you house eats at a food tier and sleeps at a lodging you pick in Manage Party. Each has a quality from 0 to 3.\n\n`
    + `Adventurers of every rank expect quality ${adventurerQ}: ${FOOD_TIERS[adventurerQ]} food (${food(adventurerQ)} gold a day) and an inn (${night(adventurerQ)} gold a night). Slaves expect quality ${L.slaveExpectedQuality}: ${FOOD_TIERS[L.slaveExpectedQuality]} food and the stables.\n\n`
    + `Each night, companions and slaves gain ${L.relationshipAbovePerStep} relationship per step of lodging better than they expect and lose ${L.relationshipBelowPerStep} per step worse. Food works the same way: +${G.food.relationshipAbovePerStep} per step better, −${G.food.relationshipBelowPerStep} per step worse. Food is paid on the road too.`);
  add('City life', 'Stables',
    `Everyone's default lodging: ${L.stablesPerPerson} gold a night per person, quality 0. Slaves are content there; adventurers lose ${L.relationshipBelowPerStep} relationship per night in it.\n\n`
    + `Members also end up in the stables when you sell the residence they live in.`);
  add('City life', 'Residences',
    `Bought at the Estate Office: the ${G.residences.outer.name} (${n(G.residences.outer.price)} gold), the ${G.residences.middle.name} (${n(G.residences.middle.price)}) and the ${G.residences.inner.name} (${n(G.residences.inner.price)}).\n\n`
    + `Nights there are free and count as quality 1, 2 and 3, as good as the matching inn. Each houses at most ${G.residences.capacity} residents, whatever its tier. Food still costs.\n\n`
    + `The office buys a residence back for ${pct(G.residences.sellShare)} of its price.`);

  // ---- Quests & ranks ---------------------------------------------------------------------------
  add('Quests & ranks', 'Skulls (danger)',
    `A quest's skulls (½ to 10, in halves) rate how hard it is on one fixed scale for the whole game. ½–5 fill white skulls; 5½–10 lay red skulls over them.\n\n`
    + `Skulls follow the quest's difficulty: the average party level it calls for. Half a skull is difficulty ${T.skulls.from}, ten is ${T.skulls.to}. A bigger group or higher-level enemies both raise it.\n\n`
    + `Skulls also set the quest's XP and renown (see those entries).`);
  add('Quests & ranks', 'Total threat',
    `Total threat = group size × the strength of one enemy at the quest's level. Strength is ${T.strengthAtLevel1} at level 1 and grows ${pct(T.strengthGrowth - 1)} a level.\n\n`
    + `Group size is in threat points: each enemy type has its own (a bandit is 1, a rat 0.5), so weak types come in bigger packs.\n\n`
    + `Encounter size comes from the quest, never from your party: a lone adventurer meets as many enemies as a full lineup.`);
  add('Quests & ranks', 'Pay roll',
    `On top of its threat, each quest rolls its pay: ${payLo}–${payHi}× the usual gold (total threat × ${T.goldPerThreat}). Cards flag Generous pay and Poor pay.\n\n`
    + `Pay works against renown: a poorly paid quest earns more renown, a generous one less (see Renown). Promotion quests always pay the usual rate.`);
  add('Quests & ranks', 'Renown',
    `Renown is what moves your party up the ranks. A quest's renown comes from its skulls (D): ${quad(T.renown, 'D')}, then × (1 + ${T.renownPayFactor} × (1 − pay)).\n\n`
    + `So a quest paying ${payLo}× gives ${n((1 + T.renownPayFactor * (1 - payLo)) * 100)}% of the usual renown, and one paying ${payHi}× gives ${n((1 + T.renownPayFactor * (1 - payHi)) * 100)}%. Low-paying jobs are how a party makes its name.\n\n`
    + `Renown doesn't fade over time, but failing and losing members cost it (see Failure).`);
  add('Quests & ranks', 'Party rank and promotion',
    `Your party's rank (D to S) comes from renown: ${thresholds}. Reaching the next rank's renown posts its promotion quest on the board (gold frame). Completing it promotes the party.\n\n`
    + `${G.ranks.highestPromotion === 'S' ? '' : `There is no promotion past ${G.ranks.highestPromotion} for now. `}`
    + `You can take quests at your rank or below. Promotion quests use the easier half of their rank's enemy levels and a middle-sized group.`);
  add('Quests & ranks', 'Demotion',
    `A party whose renown stays below its own rank's threshold for ${G.ranks.demotionDays} days in a row drops a rank. The status bar turns red while you're below the line.\n\n`
    + `Climbing back above it in time resets the clock.`);
  add('Quests & ranks', 'Failure and deaths',
    `A failed quest pays nothing and loses ${G.ranks.failedQuestRenown === 1 ? 'that quest\'s renown' : `${G.ranks.failedQuestRenown}× that quest's renown`}. Each member who dies loses another ${pct(G.ranks.deathRenown)} of it, whether the quest succeeded or not.\n\n`
    + `A member who quits on you (unpaid wages, or Morale 0) costs ${G.ranks.quitRenownPerLevel} renown per level. Releasing someone yourself doesn't.\n\n`
    + `A failed quest still gives XP for the share of enemies you defeated, and bounties for every kill.`);
  add('Quests & ranks', 'Shared quest board',
    `The Quest Board is shared with every rival party, and they take quests from it every day, the best deals first. Nothing is held back for you: in a slow week the rivals may take every quest at your rank.\n\n`
    + `Up to ${G.board.maxPostsPerDay} new quests are posted a day, and each stays up for a few days.`);
  add('Quests & ranks', 'Bounties',
    `Every enemy the party kills is worth ${S.bountyPerLevel} gold per level, paid when the party gets back to the city, whether the quest succeeded or not. Turning in a prisoner pays the same.`);

  // ---- Experience -------------------------------------------------------------------------------
  add('Experience', 'Quest XP',
    `A won quest has an XP pool set by its skulls (D): ${quad(xp, 'D')}. That's ${n(at(xp, 0.5))} at half a skull and ${n(at(xp, 10))} at ten.\n\n`
    + `The pool is split evenly among the members who come back, so smaller parties level faster. Each also gets a day of training XP on top.\n\n`
    + `There's no bonus or penalty for being above or below the enemies' level: the level-up cost already makes easy quests worth little to veterans.`);
  add('Experience', 'Level-up cost',
    `Going from level L to L + 1 costs ${quad(STAT_CONFIG.xpPerLevel, 'L')} XP: ${n(xpToNext(1))} at level 1, ${n(xpToNext(10))} at level 10, ${n(xpToNext(20))} at level 20.\n\n`
    + `Each level raises stats by their growth (times talent) and gives a skill point.`);
  add('Experience', 'Training XP',
    `A day of Training gives ${G.schedule.trainingXp.perLevel} XP per level + ${G.schedule.trainingXp.flat}: ${trainingXp(1)} at level 1, ${trainingXp(10)} at level 10.\n\n`
    + `Members who come back from a quest get a day's training XP too, on top of their share of the quest's pool.`);
  add('Experience', 'Failed quests and XP',
    `A failed quest still pays XP: the training XP, plus the pool's share for the fraction of enemies defeated (killed or surrendered). Beating 3 of 4 before falling back is worth 75% of the pool.`);
  add('Experience', 'Adventurer rank',
    `An adventurer's own rank comes from their level: D 1–${G.adventurerRanks.C - 1}, C ${G.adventurerRanks.C}–${G.adventurerRanks.B - 1}, B ${G.adventurerRanks.B}–${G.adventurerRanks.A - 1}, A ${G.adventurerRanks.A}–${G.adventurerRanks.S - 1}, S ${G.adventurerRanks.S}+.\n\n`
    + `It's separate from your party's rank, which comes from renown. A quest of a rank has enemies of that rank's levels.`);
  add('Experience', 'Skill points and the Body tab',
    `Adventurers have 2 skill points at level 1 and gain 1 a level. Each point learns a skill-tree skill or goes into the Body tab, where it adds twice a stat's base growth per level (talent doesn't change it).\n\n`
    + `Each Body stat takes at most level ÷ 3 points (rounded up). Points can be moved freely in Loadout.`);
  add('Experience', 'Talent',
    `Each growing stat has a talent grade that multiplies its growth per level: ${(['S', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => `${g} ${pct(growth[g])}`).join(', ')}. Talent doesn't change level-1 stats, so it shows more the higher an adventurer levels.\n\n`
    + `An adventurer's overall talent is the grade nearest the average of their grades, with + or − when it leans toward the next one.`);
  add('Experience', 'Talent and price',
    `Talented adventurers cost more in proportion to how fast they grow: the price modifier is their average growth rate (all C = ×1, all S = ×${growth.S}, all F = ×${growth.F}).\n\n`
    + `It scales the per-level part of companion wages and slave prices, and mercenary fees and cuts.`);

  // ---- Party members ----------------------------------------------------------------------------
  add('Party members', 'Lineup and roster',
    `The party holds up to ${G.maxRoster} members, and up to ${MAX_PARTY_SIZE} go on a quest: the lineup. In Manage Party, drag members into the ${MAX_PARTY_SIZE} lineup slots at the top; the slot order is who deploys first. Drag a member out of the slots to bench them.\n\n`
    + `Anyone can be benched, the main character too, as long as one member goes. Benched members stay in the city and follow their schedule, so you can rest an injured leader while the others work.`);
  add('Party members', 'Mercenaries',
    `A mercenary goes on one quest, win or lose, then leaves. They're paid the larger of two amounts: their fee (${G.mercenary.feePerLevel} × level, paid up front) or their cut (${G.mercenary.cutBase} + ${G.mercenary.cutPerLevel} × level % of a won quest's reward).\n\n`
    + `If their cut of a win is worth more than the fee, they take the difference from the reward. Both go up with greed and talent.`);
  add('Party members', 'Companion expectations',
    `A companion candidate wants a total of about ${K.wageBase} + ${K.wagePerLevel} × level × talent gold a week, raised by greed and a little more for short contracts.\n\n`
    + `Everything in your offer counts toward that total: base pay, the loot cut and food & lodging. Food & lodging is worth what their expected food and inn would cost you (${n((food(adventurerQ) + night(adventurerQ)) * 7)} a week), and a loot cut is worth that share of what a party of your rank usually earns. So a loot cut or food & lodging lowers the base pay they need.`);
  add('Party members', 'Negotiation',
    `An offer close to what a candidate wants gets a counter-offer; a low one offends them. Each rejected offer uses up patience (counters cost 1, insults 2). Once it runs out they walk away and won't talk to you for a week.`);
  add('Party members', 'Contracts and renewal',
    `Contracts run ${K.terms.join(', ')} weeks. Base pay is due every payday. When a contract ends, the companion sits out of quests and you have ${K.graceDays} days to renew it in Manage Party before they leave.\n\n`
    + `A good relationship lowers their demands on renewal, by up to ${pct(K.renewalDiscountAtMax)} at 100. Walking out of a renewal ends the contract on the spot.\n\n`
    + `Releasing a companion before their term ends breaks the contract: you pay them ${pct(K.releaseShareOfRemaining)} of what the rest of the term is worth (base pay, loot cut and food & lodging), but never more than ${K.releaseMinWeeks} week${K.releaseMinWeeks === 1 ? '' : 's'} of it. Once the term has ended, it's free.`);
  add('Party members', 'Relationship',
    `Companions and slaves have a relationship from 0 to 100. It rises by ${K.relationshipPerQuest} for every quest completed together, and moves with food and lodging, low Morale and missed pay.\n\n`
    + `Unpaid companions lose ${-K.relationshipUnpaid} relationship each payday. They quit at 0, which costs the party renown (see Failure and deaths). Slaves' relationship drives their Obedience.`);
  add('Party members', 'Protagonist',
    `Your main character's trait: they recover Health twice as fast and gain Morale twice as fast (drinks, days off). Morale losses aren't doubled.\n\n`
    + `The main character can't be dismissed or die from 0 Health (they pull through at 1), and they don't complain about food or lodging.`);

  // ---- Slaves -----------------------------------------------------------------------------------
  add('Slaves', 'Slave value and tax',
    `A slave's normal market value is ${n(S.priceBase)} + ${S.pricePerLevel} × level × talent gold.\n\n`
    + `Every slave you own is taxed ${pct(S.weeklyTaxShare)} of that value each payday. If you can't pay a slave's tax, the city seizes them and sells them at the slave market.\n\n`
    + `Slaves have no wage and expect only ${FOOD_TIERS[L.slaveExpectedQuality]} food and the stables.`);
  add('Slaves', 'Obedience and punishment',
    `Slaves have Obedience (0–100) besides relationship. Bought slaves start at ${S.obedienceMarket[0]}–${S.obedienceMarket[1]}, registered captives at ${S.obedienceCaptive[0]}–${S.obedienceCaptive[1]}.\n\n`
    + `Obedience rises ${S.obedienceChangePerDay} a day while relationship is ${S.obedienceRiseFrom} or more, and falls ${S.obedienceChangePerDay} a day while it's below ${S.obedienceFallBelow}. Low Obedience weakens a slave in battle.\n\n`
    + `Punish (once a day) gives +${S.punishObedience} Obedience for −${S.punishRelationship} relationship: a quick boost that drains away again unless the relationship is repaired.`);
  add('Slaves', 'Prisoners and the city gate',
    `Human enemies who surrender are taken prisoner if you win. The city gate won't let them in until each one is registered:\n\n`
    + `• Turned in for a bounty (${S.bountyPerLevel} gold per level), or\n• Registered as your slave (if the party has room) for a fee of their market value minus the bounty.\n\n`
    + `So enslaving a prisoner costs what buying them at a normal market would, minus the bounty you give up.`);
  add('Slaves', 'The slave market',
    `Prices are each slave's value times a price index that drifts daily and follows supply: short stock raises it, a glut lowers it (${pct(G.market.priceIndex[0])}–${pct(G.market.priceIndex[1])} of usual). Shipments arrive twice a week; the screen shows the next one.\n\n`
    + `The market buys your slaves for ${pct(S.sellBackShare)} of the current price. It doesn't buy prisoners.`);

  // ---- Battle -----------------------------------------------------------------------------------
  add('Battle', 'Action points',
    `Every unit gets 2 AP a turn: a movement AP and an action AP.\n\n`
    + `• Free skills cost nothing and work until the turn ends.\n• 1 AP skills use the movement AP if it's unspent, otherwise the action AP.\n• 2 AP skills use both, so they can't follow a move.\n• Ends-turn skills (most attacks) use whatever is left.\n\n`
    + `Undo move works until that unit acts or another unit on your team moves.`);
  add('Battle', 'Mana',
    `Mana is spent by skills and doesn't come back during a battle. Units start each battle with full mana.`);
  add('Battle', 'Defense and Resist',
    `Every attack hits. Defense reduces damage taken to 100 ÷ (100 + Defense): 100 Defense halves it.\n\n`
    + `Resist is a chance to shrug off a debuff: Resist ÷ (100 + Resist), so 100 Resist is 50%. A resisted debuff doesn't apply, but the hit's damage still lands.`);
  add('Battle', 'Engagement',
    `Hitting a unit with an Engage skill locks you both together, unless it's already engaged with someone else. While engaged you can't move, and you can only attack your opponent (and heal or cleanse yourself).\n\n`
    + `Disengage breaks free, but your opponent gets a free basic attack. Disengage skills (like Shadow Step) slip out with no free attack. Knockbacks and falling also end it.`);
  add('Battle', 'Overwatch',
    `Overwatch ends the turn and watches a 60° arc as far as your weapon reaches. The first enemy to move into it takes your basic attack and keeps moving.`);
  add('Battle', 'Burn and Slow stacks',
    `${burn?.name ?? 'Burn'}: ${burn?.description ?? ''}\n\n${slow?.name ?? 'Slow'}: ${slow?.description ?? ''}\n\nStacks don't last a set number of turns: the unit loses one each turn.`);
  add('Battle', 'Enemy temperaments',
    `• Beasts act alone, go for the nearest target and flee when badly hurt.\n• Tribal enemies fight as a group, and the whole group runs once half of it is gone.\n• Humans use cover and pick off the weak; when cornered and badly hurt they may surrender, and you take them prisoner if you win.\n• Evil enemies never flee and go for kills.\n\n`
    + `Click an enemy to see where it can move and hit next turn.`);
  add('Battle', 'Ranges',
    `Ranges use straight-line distance. Ranges of 2 or more round to the nearest tile, so shapes are roundish. Range 1 is the 4 neighbours; 1.5 adds the diagonals.\n\n`
    + `A cooldown of N means the skill can't be used during your next N turns.`);

  return out;
}
