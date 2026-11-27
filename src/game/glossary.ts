// The in-game Guide: short explanations of the rules that aren't obvious from the screens.
// Pure (no Phaser). Numbers are read from the game data, so entries stay right when the balance changes.
import { MAX_PARTY_SIZE, STATUSES, xpToNext } from '../data/content';
import { CHURCHES, FOOD_TIERS, GUILD, INN_TIERS, trainingXp } from '../data/guild';
import { STAT_CONFIG } from '../data/stats';
import { TRAITS } from '../data/traits';
import { LOOT } from '../data/enemies';
import { RANKS, type Rank } from '../data/types';
import { lodgingName } from './condition';
import { UNDO_LIMIT, UNDO_REVEAL_TILES } from './battle';

export const GLOSSARY_TOPICS = ['City Life', 'Quests & Ranks', 'Experience', 'Party Members', 'Slaves', 'Battle'] as const;
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
  const adventurerQ = L.expectedQuality;
  const drinks = INN_TIERS.map((t) => G.inns[t].drinksMorale);
  const promoRanks = RANKS.filter((r) => r !== 'D' && RANKS.indexOf(r) >= RANKS.indexOf(G.ranks.highestPromotion)).reverse() as Exclude<Rank, 'D'>[];
  const thresholds = promoRanks.map((r) => `${r} ${n(G.ranks.renown[r])}`).join(', ');
  const [payLo, payHi] = G.board.pay;
  const xp = G.xp.pool;
  const growth = STAT_CONFIG.talent.growthRate;
  const burn = STATUSES.burn;
  const chilled = STATUSES.chilled;
  const shocked = STATUSES.shocked;
  const slow = STATUSES.slow;
  const out: GlossaryEntry[] = [];
  const add = (topic: GlossaryTopic, term: string, body: string) => out.push({ topic, term, body });

  // ---- City life -------------------------------------------------------------------------------
  add('City Life', 'Days and End Day',
    `Time only passes when you press End Day. Everyone the party houses eats and sleeps where you lodge them, and the schedule runs for members who didn't quest that day.\n\n`
    + `One quest a day: coming back doesn't end the day, but the next quest waits until tomorrow. Multi-day quests spend their nights on the road (free lodging for those on the quest); members at home live those days as usual.\n\n`
    + `Every 7th day is payday and tax day: companion wages and slave tax are due.\n\n`
    + `Nothing is paid on the road. It goes on tabs settled at the next End Day: the Food and Lodging Tab (the quest's nights), the Owed Wages Tab (payday on the quest) and the Slave Tax Tab (tax day on the quest). Releasing or selling a member pays their tab. Contracts only lapse at End Day in the city.\n\n`
    + `End Day warns you when you can't pay everything due, and what will happen.`);
  add('City Life', 'Health (not battle HP)',
    `A member's condition between battles, out of 100. It isn't their HP in battle.\n\n`
    + `Below 100: all battle stats −1% per 3 missing (Health 70 = −10%). At 0: the member dies (the main character pulls through at 1).\n\n`
    + `Rises (×${TRAITS.protagonist.healthRecovery} for the Protagonist):\n• +${C.healthPerDay} each night\n• +${C.healthPerDay * G.schedule.recoverMultiplier} for a day on Recover (instead of +${C.healthPerDay})\n\n`
    + `Falls:\n• Up to −${C.maxHealthLoss} after each battle, the lower their HP fell (−${C.maxHealthLoss} if they fell)`);
  add('City Life', 'Morale',
    `A member's spirits, out of 100. Below 100: all battle stats −${G.combat.percentPer5}% per 5 missing. Above ${C.highMorale}: companions and slaves gain ${C.highMoraleRelationshipPerDay} relationship a day; below ${C.lowMorale}: they lose ${C.lowMoraleRelationshipPerDay}. At 0: the member leaves the party (the main character stays). New members start at ${C.startingMorale}.\n\n`
    + `Rises (×${TRAITS.protagonist.moraleGain} for the Protagonist):\n• +${G.schedule.dayOffMorale} for taking a Day Off\n• +${Math.min(...drinks)} to +${Math.max(...drinks)} for a round of drinks at an inn (once a day)\n• +${G.food.moraleAbovePerStep} a day per level of quality above expected food\n• +${L.moraleAbovePerStep} a night per level of quality above expected lodging\n\n`
    + `Falls:\n• −${C.moralePerTurn} per turn in battle\n• −${C.moraleFailedQuest} for failing a quest\n• −1 per ${Math.round(1 / C.moralePerHealthLost)} Health lost\n• −${C.moraleMemberDied} when a party member dies\n• −${G.food.moraleBelowPerStep} a day per level of quality below expected food\n• −${L.moraleBelowPerStep} a night per level of quality below expected lodging`);
  add('City Life', 'Churches',
    `The Church (Outer City) and the Central Church (Inner City).\n\n`
    + `Donate for a blessing: every battle stat of everyone on the next quest goes up, and the blessing fades when that quest ends. One blessing at a time: a bigger donation replaces a smaller one.\n`
    + CHURCHES.map((id) => G.churches[id].donations.map((d) => `• ${G.churches[id].name}: ${d.gold} gold for +${d.blessingPct}%`).join('\n')).join('\n')
    + `\n\nOr pay for healing, Health restored at once:\n`
    + CHURCHES.map((id) => `• ${G.churches[id].name}: +${G.churches[id].heal.health} Health for ${G.churches[id].heal.gold} gold`).join('\n')
    + `\n\nA healed member can't be healed again at either church for ${G.churches.healCooldownDays} days.`);
  add('City Life', 'Battle Penalties',
    `Injury, Morale and Obedience all weaken a member in battle, and the penalties multiply:\n\n`
    + `• Injury: −1/3 of missing Health.\n• Morale: −${G.combat.percentPer5}% per 5 Morale below 100.\n• Obedience (slaves): −${G.combat.percentPer5}% per 5 Obedience below 100.\n\n`
    + `Health 70, Morale 50 and Obedience 60 give 0.9 × 0.9 × 0.92: about −25%. Manage Party shows each member's total.`);
  add('City Life', 'Schedule',
    `Members who aren't on a quest follow their schedule when the day ends (set in Manage Party):\n\n`
    + `• Recover: ${G.schedule.recoverMultiplier}× Health recovery.\n• Training: ${G.schedule.trainingXp.perLevel} XP per level + ${G.schedule.trainingXp.flat} (${trainingXp(1)} at level 1, ${trainingXp(20)} at level 20).\n• Odd Jobs: +${G.schedule.oddJobsGold} gold.\n• Day Off: +${G.schedule.dayOffMorale} Morale.\n\n`
    + `A schedule you set stays until you change it, except Recover: once Health is full they go back to Day Off. Unscheduled members take a Day Off, unless their Health would take longer to heal than their Morale takes to fill on Day Off: then they Recover. Benched members (not in the lineup) follow it too.`);
  add('City Life', 'Food and Lodging Expectations',
    `Each member you house eats at a food tier and sleeps at a lodging you pick in Manage Party. Each has a quality from 0 to 3. Until you pick, adventurers lodge at ${lodgingName(L.adventurerDefault)} and slaves at ${lodgingName(L.slaveDefault)}.\n\n`
    + `Adventurers expect quality ${adventurerQ}: ${FOOD_TIERS[adventurerQ]} food (${food(adventurerQ)} gold a day) and an inn (${night(adventurerQ)} gold a night). Slaves expect quality ${L.slaveExpectedQuality}: ${FOOD_TIERS[L.slaveExpectedQuality]} food and the stables.\n\n`
    + `Each night in the city, everyone you house (the main character included) gains ${L.moraleAbovePerStep} Morale per level of quality their lodging is above what they expect and loses ${L.moraleBelowPerStep} per level below. Food works the same way every day: +${G.food.moraleAbovePerStep} per level of quality above, −${G.food.moraleBelowPerStep} per level below. Food is paid on the road too.`);
  add('City Life', 'Stables',
    `The cheapest lodging: ${L.stablesPerPerson} gold a night per person, quality 0. Slaves are content there, and sleep there until you move them; adventurers, the main character included, lose ${L.moraleBelowPerStep} Morale per night in it.\n\n`
    + `When you sell a residence, the members living there go back to their default lodging until you move them.`);
  add('City Life', 'Residences',
    `Bought at the Estate Office: the ${G.residences.outer.name} (${n(G.residences.outer.price)} gold), the ${G.residences.middle.name} (${n(G.residences.middle.price)}) and the ${G.residences.inner.name} (${n(G.residences.inner.price)}).\n\n`
    + `Nights there are free and count as quality 1, 2 and 3, as good as the matching inn. Each houses at most ${G.residences.capacity} residents, whatever its tier. Food still costs.\n\n`
    + `The office buys a residence back for ${pct(G.residences.sellShare)} of its price.`);

  // ---- Quests & ranks ---------------------------------------------------------------------------
  add('Quests & Ranks', 'Skulls (danger)',
    `A quest's skulls (½ to 10, in halves) rate how hard it is on one fixed scale for the whole game. ½–5 fill white skulls; 5½–10 lay red skulls over them.\n\n`
    + `Skulls follow the quest's difficulty: the average party level it calls for. Half a skull is difficulty ${T.skulls.from}, ten is ${T.skulls.to}. A bigger group or higher-level enemies both raise it.\n\n`
    + `Skulls also set the quest's XP and renown (see those entries).`);
  add('Quests & Ranks', 'Total Threat',
    `Total threat = group size × the strength of one enemy at the quest's level. Strength is ${T.strengthAtLevel1} at level 1 and grows ${pct(T.strengthGrowth - 1)} a level.\n\n`
    + `Group size is in threat points: each enemy type has its own (a bandit is 1, a rat 0.5), so weak types come in bigger packs.\n\n`
    + `Encounter size comes from the quest, never from your party: a lone adventurer meets as many enemies as a full lineup.`);
  add('Quests & Ranks', 'Pay Roll',
    `On top of its threat, each quest rolls its pay: ${payLo}–${payHi}× the usual gold (total threat × ${T.goldPerThreat}). Cards flag Generous pay and Poor pay.\n\n`
    + `Pay works against renown: a poorly paid quest earns more renown, a generous one less (see Renown). Promotion quests always pay the usual rate.`);
  add('Quests & Ranks', 'Renown',
    `Renown is what moves your party up the ranks. A quest's renown comes from its skulls (D): ${quad(T.renown, 'D')}, then × (1 + ${T.renownPayFactor} × (1 − pay)).\n\n`
    + `So a quest paying ${payLo}× gives ${n((1 + T.renownPayFactor * (1 - payLo)) * 100)}% of the usual renown, and one paying ${payHi}× gives ${n((1 + T.renownPayFactor * (1 - payHi)) * 100)}%. Low-paying jobs are how a party makes its name.\n\n`
    + `Renown doesn't fade over time, but failing and losing members cost it (see Failure).`);
  add('Quests & Ranks', 'Party Rank and Promotion',
    `Your party's rank (D to S) comes from renown: ${thresholds}. Reaching the next rank's renown posts its promotion quest on the board (gold frame). Completing it promotes the party.\n\n`
    + `${G.ranks.highestPromotion === 'S' ? '' : `There is no promotion past ${G.ranks.highestPromotion} for now. `}`
    + `You can take quests at your rank or below. Promotion quests use the easier half of their rank's enemy levels and a middle-sized group.`);
  add('Quests & Ranks', 'Demotion',
    `A party whose renown stays below its own rank's threshold for ${G.ranks.demotionDays} days in a row drops a rank. The status bar turns red while you're below the line.\n\n`
    + `Climbing back above it in time resets the clock.`);
  add('Quests & Ranks', 'Failure and Deaths',
    `A failed quest pays nothing and loses ${G.ranks.failedQuestRenown === 1 ? 'that quest\'s renown' : `${G.ranks.failedQuestRenown}× that quest's renown`}. Each member who dies loses another ${pct(G.ranks.deathRenown)} of it, whether the quest succeeded or not.\n\n`
    + `A member who quits on you (Morale 0, or a companion's relationship 0) costs ${G.ranks.quitRenownPerLevel} renown per level. Releasing someone yourself doesn't.\n\n`
    + `A failed quest still gives XP for the share of enemies you defeated, but no loot.`);
  add('Quests & Ranks', 'Shared Quest Board',
    `The Quest Board is shared with every rival party, and they take quests from it every day, the best deals first. Nothing is held back for you: in a slow week the rivals may take every quest at your rank.\n\n`
    + `Up to ${G.board.maxPostsPerDay} new quests are posted a day, and each stays up for a few days.`);
  add('Quests & Ranks', 'Loot, Trophies and Bounties',
    `Enemies pay no gold themselves: they drop loot.\n\n`
    + `• Humans drop the gear they carried, killed or captured. Each piece has a ${Math.round(LOOT.brokenChance * 100)}% chance to be broken: junk worth ${Math.round(LOOT.brokenValueShare * 100)}% of its value.\n`
    + `• Every other enemy drops a trophy (an ear, a fang...) and a junk item (a pelt, its goblin-made weapon...), each worth ${LOOT.trophyGoldPerLevel} gold per level.\n`
    + `• Trophies are turned in at the city gate for their value.\n`
    + `• Junk (and spare gear) sells at the Marketplace: put it on the sale list there, and put members on Marketplace duty (Schedule). Each sells ${G.schedule.marketplaceItemsPerDay} items a day from the top of the list, at full value.\n`
    + `• Loot only comes home from a won quest: the battlefield can't be looted until the enemy is driven off. A failed quest still gives XP for the enemies you defeated.\n\n`
    + `A human taken prisoner is worth more than one killed: the bounty for turning them in is ${S.bountyPerLevel} gold per level.`);

  // ---- Experience -------------------------------------------------------------------------------
  add('Experience', 'Quest XP',
    `A won quest has an XP pool set by its skulls (D): ${quad(xp, 'D')}. That's ${n(at(xp, 0.5))} at half a skull and ${n(at(xp, 10))} at ten.\n\n`
    + `The pool is split evenly among the members who come back, so smaller parties level faster. Each also gets a day of training XP on top.\n\n`
    + `There's no bonus or penalty for being above or below the enemies' level: the level-up cost already makes easy quests worth little to veterans.`);
  add('Experience', 'Level-Up Cost',
    `Going from level L to L + 1 costs ${quad(STAT_CONFIG.xpPerLevel, 'L')} XP: ${n(xpToNext(1))} at level 1, ${n(xpToNext(10))} at level 10, ${n(xpToNext(20))} at level 20.\n\n`
    + `Each level raises stats by their growth (times talent) and gives a skill point.`);
  add('Experience', 'Training XP',
    `A day of Training gives ${G.schedule.trainingXp.perLevel} XP per level + ${G.schedule.trainingXp.flat}: ${trainingXp(1)} at level 1, ${trainingXp(10)} at level 10.\n\n`
    + `Members who come back from a quest get a day's training XP too, on top of their share of the quest's pool.`);
  add('Experience', 'Failed Quests and XP',
    `A failed quest still pays XP: the training XP, plus the pool's share for the fraction of enemies defeated (killed or surrendered). Beating 3 of 4 before falling back is worth 75% of the pool.`);
  add('Experience', 'Adventurer Rank',
    `An adventurer's own rank comes from their level: D 1–${G.adventurerRanks.C - 1}, C ${G.adventurerRanks.C}–${G.adventurerRanks.B - 1}, B ${G.adventurerRanks.B}–${G.adventurerRanks.A - 1}, A ${G.adventurerRanks.A}–${G.adventurerRanks.S - 1}, S ${G.adventurerRanks.S}+.\n\n`
    + `It's separate from your party's rank, which comes from renown. A quest of a rank has enemies of that rank's levels.`);
  add('Experience', 'Skill Points and the Body Tab',
    `Adventurers have 2 skill points at level 1 and gain 1 a level. Each point learns a skill-tree skill or goes into the Body tab, where it adds twice a stat's base growth per level (talent doesn't change it).\n\n`
    + `Each Body stat takes at most level ÷ 3 points (rounded up). Points can be moved freely in Skills (Manage Party).`);
  add('Experience', 'Talent',
    `Each growing stat has a talent grade that multiplies its growth per level: ${(['S', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => `${g} ${pct(growth[g])}`).join(', ')}. Talent doesn't change level-1 stats, so it shows more the higher an adventurer levels.\n\n`
    + `An adventurer's overall talent is the grade nearest the average of their grades, with + or − when it leans toward the next one.`);
  add('Experience', 'Talent and Price',
    `Talented adventurers cost more in proportion to how fast they grow: the price modifier is their average growth rate (all C = ×1, all S = ×${growth.S}, all F = ×${growth.F}).\n\n`
    + `It scales the per-level part of companion wages and slave prices, and mercenary fees and cuts.`);

  // ---- Party members ----------------------------------------------------------------------------
  add('Party Members', 'Lineup and Roster',
    `The party holds up to ${G.maxRoster} members, and up to ${MAX_PARTY_SIZE} go on a quest: the lineup. In Manage Party, drag members into the ${MAX_PARTY_SIZE} lineup slots at the top; the slot order is who deploys first. Drag a member out of the slots to bench them.\n\n`
    + `Anyone can be benched, the main character too, as long as one member goes. Benched members stay in the city and follow their schedule, so you can rest an injured leader while the others work.`);
  add('Party Members', 'Mercenaries',
    `A mercenary goes on one quest, win or lose, then leaves. They're paid the larger of two amounts: their fee (${G.mercenary.feePerLevel} × level, paid up front) or their cut (${G.mercenary.cutBase} + ${G.mercenary.cutPerLevel} × level % of a won quest's reward).\n\n`
    + `If their cut of a win is worth more than the fee, they take the difference from the reward. Both go up with greed and talent.`);
  add('Party Members', 'Companion Expectations',
    `A companion candidate wants a total of about ${K.wageBase} + ${K.wagePerLevel} × level × talent gold a week, raised by greed and a little more for short contracts.\n\n`
    + `Everything in your offer counts toward that total: base pay, the loot cut and food & lodging. Food & lodging is worth what their expected food and inn would cost you (${n((food(adventurerQ) + night(adventurerQ)) * 7)} a week), and a loot cut is worth that share of what a party of your rank usually earns. So a loot cut or food & lodging lowers the base pay they need.`);
  add('Party Members', 'Negotiation',
    `An offer close to what a candidate wants gets a counter-offer; a low one offends them. Each rejected offer uses up patience (counters cost 1, insults 2); a companion renewing has 1 more patience for every ${G.companion.patiencePerRelationship} relationship. Once it runs out they walk away and won't talk to you for a week.`);
  add('Party Members', 'Contracts and Renewal',
    `Contracts run ${K.terms.join(', ')} weeks. Base pay is due every payday, by the day: a companion hired midweek gets only the days they've worked, and so does one whose term ends midweek. Renewing carries the wages earned under the old terms over to the next payday. When a contract ends, the companion sits out of quests and you have ${K.graceDays} days to renew it in Manage Party; if you don't, they leave at the End Day after, paid the days of their term since payday. If you can't pay those final wages, they leave without them and it costs renown, as if they'd quit.\n\n`
    + `A good relationship lowers their demands on renewal, by up to ${pct(K.renewalDiscountAtMax)} at 100. Walking out of a renewal ends the contract on the spot.\n\n`
    + `Releasing a companion before their term ends breaks the contract: you pay them ${pct(K.releaseShareOfRemaining)} of what the rest of the term is worth (base pay, loot cut and food & lodging), but never more than ${K.releaseMinWeeks} week${K.releaseMinWeeks === 1 ? '' : 's'} of it. Once the term has ended, there's no buyout.\n\n`
    + `Either way, you also pay the base pay they've earned since the last payday, by the day (3 days in: 3/7 of a week's pay).`);
  add('Party Members', 'Relationship',
    `Companions and slaves only, out of 100. Companions: lowers their demands when you renew (up to −${pct(K.renewalDiscountAtMax)} at 100); at 0 they quit at the end of the day (see Failure and deaths). Slaves: drives Obedience.\n\n`
    + `Rises:\n• +${K.relationshipPerQuest} per quest completed together\n• +${C.highMoraleRelationshipPerDay} a day while Morale is above ${C.highMorale}\n\n`
    + `Falls:\n• −2 per failed quest together\n• −${C.lowMoraleRelationshipPerDay} a day while Morale is below ${C.lowMorale}\n• −5 a day the party can't pay food and lodging\n• −${-K.relationshipUnpaid} per missed payday (companions)\n• −${S.punishRelationship} per Punish (slaves)`);
  add('Party Members', 'Protagonist',
    `Your main character's trait: they recover Health ${TRAITS.protagonist.healthRecovery}x as fast and gain ${TRAITS.protagonist.moraleGain}x as much Morale (drinks, days off). Morale losses are unchanged.\n\n`
    + `The main character can't be dismissed or die from 0 Health (they pull through at 1), and they don't complain about food or lodging.`);

  // ---- Slaves -----------------------------------------------------------------------------------
  add('Slaves', 'Slave Value and Tax',
    `A slave's normal market value is ${n(S.priceBase)} + ${S.pricePerLevel} × level × talent gold.\n\n`
    + `Every slave you own is taxed ${pct(S.weeklyTaxShare)} of that value each payday. If you can't pay a slave's tax, the city seizes them and sells them at the slave market.\n\n`
    + `Slaves have no wage and expect only ${FOOD_TIERS[L.slaveExpectedQuality]} food and the stables.`);
  add('Slaves', 'Obedience and Punishment',
    `Slaves only, out of 100. Below 100: all battle stats −${G.combat.percentPer5}% per 5 missing. Bought slaves start at ${S.obedienceMarket[0]}–${S.obedienceMarket[1]}, registered prisoners at ${S.obedienceCaptive[0]}–${S.obedienceCaptive[1]}.\n\n`
    + `Rises:\n• +${S.obedienceChangePerDay} a day while relationship is ${S.obedienceRiseFrom}+\n• +${S.punishObedience} per Punish (once a day; costs ${S.punishRelationship} relationship)\n\n`
    + `Falls:\n• −${S.obedienceChangePerDay} a day while relationship is below ${S.obedienceFallBelow}\n\n`
    + `Punishing is a quick boost that drains away again unless the relationship recovers.`);
  add('Slaves', 'Prisoners and the City Gate',
    `Human enemies who surrender are taken prisoner if you win. The city gate won't let them in until each one is registered:\n\n`
    + `• Turned in for a bounty (${S.bountyPerLevel} gold per level), or\n• Registered as your slave (if the party has room) for a fee of their market value minus the bounty.\n\n`
    + `So enslaving a prisoner costs what buying them at a normal market would, minus the bounty you give up.`);
  add('Slaves', 'The Slave Market',
    `Prices are each slave's value times a price index that drifts daily and follows supply: short stock raises it, a glut lowers it (${pct(G.market.priceIndex[0])}–${pct(G.market.priceIndex[1])} of usual). Shipments arrive twice a week; the screen shows the next one.\n\n`
    + `The market buys your slaves for ${pct(S.sellBackShare)} of the current price. It doesn't buy prisoners.`);

  // ---- Battle -----------------------------------------------------------------------------------
  add('Battle', 'Action Points',
    `Every unit gets 2 AP a turn: a movement AP and an action AP.\n\n`
    + `• Free skills cost nothing and work until the turn ends.\n• 1 AP skills use the movement AP if it's unspent, otherwise the action AP.\n• 2 AP skills use both, so they can't follow a move.\n• Ends-turn skills (most attacks) use whatever is left.\n• Quick Cast makes your next 2 AP or Ends-turn Mage spell this turn cost 1 AP (use it again to cancel for a refund); In the Zone makes two basic attacks free.\n\n`
    + `Undo Move takes back a regular move (see Undo Move).`);
  add('Battle', 'Moving',
    `Clicking a tile in a unit's move range only previews the move: a faded copy of the unit shows where it would stand, and nothing happens yet (no AP spent, no overwatch, no fog lifted).\n\n`
    + `While previewing, hover or pick the unit's skills to see what they would reach from the planned tile. Click the tile again, press Confirm Move or Enter to make the move; right-click or Esc cancels it.\n\n`
    + `Aiming a skill from the planned tile and clicking a target makes the move and then uses the skill, if it can still reach from where the unit ends up (overwatch or a hidden enemy can stop it short). Skills that need both AP (and Dash) can't follow a move, so they can't be picked while previewing. Toggles and Switch Mode are used on the spot without moving.`);
  add('Battle', 'Undo Move',
    `Undo Move takes back a unit's regular move this turn, giving back its movement AP. You have ${UNDO_LIMIT} undos per battle; the button shows how many are left.\n\n`
    + `A move is locked in (it can't be undone) once:\n• that unit uses a skill or another unit on your team moves or acts,\n• it was shot by overwatch, caught in a zone or bumped into a hidden enemy on the way,\n• it spotted an enemy you couldn't see before, or\n• it revealed more than ${UNDO_REVEAL_TILES} new tiles of fog.\n\n`
    + `So moving to scout and stepping back doesn't work. Dash and movement skills can never be undone. Hover the button to see why a move is locked.`);
  add('Battle', 'Mana',
    `Mana is spent by skills and doesn't come back during a battle. Units start each battle with full mana.`);
  add('Battle', 'Defense and Resist',
    `Every attack hits. Defense reduces damage taken: each point of Defense is +1% effective health.\n\n`
    + `Resist shrugs off debuffs: each point of Resist is +1% effective resistance to debuffs. A resisted debuff doesn't apply, but the hit's damage still lands.`);
  add('Battle', 'Penetration',
    `P.Pen and M.Pen (from gear and some skills) make the target's Defense count for less against your Physical or Magical damage: the percent first, then the flat amount. 50% and 10 P.Pen make 100 Defense count as 40 against Physical damage.\n\n`
    + `Percents from different sources multiply rather than add: a 50% weapon and Backstab's 25% make 62.5%, not 75%.\n\n`
    + `Penetration never takes Defense below 0, and does nothing to Defense that is already 0 or less.`);
  add('Battle', 'Fog of War',
    `Each side sees only the tiles within its units' Vision (${STAT_CONFIG.base.vision} tiles) that they have line of sight to: rocks block it. Enemies outside that are hidden, and the map shows those tiles darkened.\n\n`
    + `• You can't aim at a unit you can't see, but area attacks and zones still hit it.\n• Overwatch only fires on units its side can see.\n• Walking into an unseen enemy stops you in front of it.\n• The battle log shows units you can't see as ???. A hidden enemy's skill is named only when it lands where you can see.\n• Enemies play by the same rules: they go where they last saw you, and each turn they learn where your units stood at the start of your last turn (not Stealthed ones).\n\n`
    + `Revelation (Cleric) reveals every enemy within 15 tiles for a turn.`);
  add('Battle', 'Stealth',
    `A Stealthed unit can't be targeted directly or set off overwatch; area attacks still hit it. It stays hidden until it attacks.\n\n`
    + `• Enemies don't know it's there: they may try to walk through it, and bumping into it breaks its Stealth.\n• Being knocked back or pushed breaks it too.\n• Revealed units can't be Stealthed.\n\n`
    + `Shadow Step stealths you for a turn; Scout (passive) starts every battle Stealthed.`);
  add('Battle', 'Fire, Ice and Rain on the Ground',
    `Firestorm, Blizzard and Rain cover the ground for a few turns, and an Explosion (Burn's 3rd stack) leaves 2 turns of Burning Ground under its target.\n\n`
    + `• A tile holds one of these at a time: a new one replaces the old there.\n• Firestorm, Blizzard and Burning Ground hit anyone who enters or ends a turn on them.\n• Rain acts on everyone: −25% P.Atk and M.Atk while standing in it (not after leaving), and walking in adds a Chilled stack (if chilled) and removes a Burn stack.\n• Draft fans the flames: fire on the tiles it hits spreads 1.5 tiles around, with the same turns left.`);
  add('Battle', 'Passive Skills',
    `Passive skills are always in effect once learned and never go on the skill bar.\n\n`
    + `• Spellblade: your weapon's M.Atk penalty doesn't apply.\n• Fighting Spirit: whenever you become engaged, a free basic attack at 50%.\n• Tooth for Tooth: when your engaged opponent attacks you, a free basic attack back at 50%.\n• Scout: Stealthed from the start of each battle until you attack.\n\n`
    + `These free attacks never set off another free attack.`);
  add('Battle', 'Forest',
    `Forest costs 6 Movement to enter. A unit standing in forest takes ${Math.round(STAT_CONFIG.forestProjectileReduction * 100)}% less damage from projectiles: arrows and shots (Direct and Indirect) and thrown spells like Magic Bolt and Fireball. Melee attacks, area spells and zones hit it as usual.`);
  add('Battle', 'Equipment',
    `Every Adventurer has a weapon and a body armor. Each piece adds base stats, then multiplies the total by its modifiers. Quality multiplies the base stats: Crude x1, Common x2, Fine x4, Masterwork x7.\n\n`
    + `• Weapons set the Basic Attack's range and add one skill: Magic Bolt (Staff, Crystal), Circle Swing (Greatsword, Spear), Shield Slam (shields), Switch Mode (bows), Quick Attack or Swap to Crossbow (daggers).\n• Heavier armor is tougher but cuts max mana.\n• Unarmed: x0.6 P.Atk. No Armor: x0.8 Defense and Health.\n\n`
    + `The Smithy (Outer City) sells Common gear and makes Fine (5 days) and Masterwork (25 days) gear to order, up to 3 orders at a time.\n\n`
    + `Manage Party > Equipment swaps gear with the party's stash. Mercenaries use their own. A companion keeps the gear they brought: swapped out, it goes into their own pack (the party can't take it), and they put it back on when they leave, handing back what the party gave them; a slave who is sold leaves everything with the party.`);
  add('Battle', 'Engagement',
    `Hitting a unit with an Engage skill locks you both together, unless it's already engaged with someone else. While engaged you can't move, and you can only attack your opponent (and heal or cleanse yourself).\n\n`
    + `Disengage breaks free, but your opponent gets a free basic attack. Disengage skills (like Shadow Step) slip out with no free attack. Knockbacks, pushes (Sonic Boom) and falling also end it.\n\n`
    + `An engaged unit has its back to the 3 tiles on the far side from its opponent: Backstab strikes from there.`);
  add('Battle', 'Overwatch',
    `Overwatch ends the turn and watches a 60° arc as far as your weapon reaches. The first enemy to move into it takes your basic attack and keeps moving.\n\n`
    + `Walking, Dash and movement skills that run to their target (Charge, Blitz) can all be caught, on any tile of the way, and so can a unit knocked back or pushed (Sonic Boom) through the arc. Leaps (Heroic Leap, and monsters' Pounce, Dive and Infernal Leap) fly over terrain and units, but are still shot at as they pass over the arc; a watch can't stop a leap in the air. Teleports (Arcane Shift, Shadow Step, Flicker Strike) skip the tiles in between, so they can't be caught.`);
  add('Battle', 'Wind-Ups',
    `Brutal Strike, Lightning Strike and Explosion! mark tiles in red. At the start of your next turn the blow lands on anyone still standing there, allies included. Walking across is safe; it's where a unit is when the blow comes that counts. Enemies step off, even breaking away from an engagement to do it.\n\n`
    + `Explosion! falls off from full at the center to a third at the edge, and spends all your mana: the more, the bigger the blast.`);
  add('Battle', 'Burn, Chilled and Shocked Stacks',
    `${burn?.name ?? 'Burn'}: ${burn?.description ?? ''}\n\n${chilled?.name ?? 'Chilled'} (ice skills): ${chilled?.description ?? ''}\n\n${shocked?.name ?? 'Shocked'} (Lightning Strike): ${shocked?.description ?? ''}\n\n`
    + `Stacks don't last a set number of turns: the unit loses one each turn. A unit with 2 stacks is affected just as much as with 1, for one more turn; a status shows its stacks as Burn (2).\n\n`
    + `${slow?.name ?? 'Slow'} (webs, goo and other non-ice effects): ${slow?.description ?? ''} Slow and Chilled are separate: a unit with both moves at 75% × 75% = 56%.`);
  add('Battle', 'Enemy Temperaments',
    `• Beasts act alone, go for the nearest target and flee when badly hurt.\n• Tribal enemies fight as a group, and the whole group runs once only a third of it is left (or the survivors are badly hurt).\n• Humans use cover and pick off the weak. The more hurt they are and the more of your units could kill them next turn, the better their side's odds must be for them to stay in the fight; past that they run for the edge, and if they're cornered with nowhere safe to go they surrender (you take them prisoner if you win).\n• Evil enemies never flee and go for kills.\n• Humans and tribal enemies steer around your overwatch when they can; beasts and evil run and leap straight through it.\n\n`
    + `Click an enemy to see where it can move and hit next turn.`);
  add('Battle', 'Ranges',
    `Ranges use straight-line distance. Ranges of 2 or more round to the nearest tile, so shapes are roundish. Range 1 is the 4 neighbours; 1.5 adds the diagonals.`);
  add('Battle', 'Cooldowns',
    `Cooldowns count from the turn a skill is used. A cooldown of 1 means the skill can't be used again that turn, but it's ready on your next turn; a cooldown of 2 means it skips your next turn and is ready the turn after.`);

  return out;
}
