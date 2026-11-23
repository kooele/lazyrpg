import Phaser from 'phaser';
import { GUILD, LODGING_QUALITY, isResidence, type InnTier, type Ring } from '../data/guild';
import { boarders, buyDrinks, dailyUpkeep, drinksCost, foodCost, isPayday, lodgingCost, stayAtHome, stayAtInn, weeklyWages } from '../game/city';
import { QUALITY_TEXT, foodOf, foodRelationship, lodgingName, lodgingRelationship, moraleOf } from '../game/condition';
import { bondOf, isHoused } from '../game/contracts';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, figure, panel, setupCamera, text } from '../ui/widgets';

type Place = InnTier | Ring;

const BLURB: Record<Place, string> = {
  standard: 'A busy common-room inn by the outer wall: stew, ale and a straw mattress. It does the job.',
  highEnd: 'A respectable Middle Ring inn: clean sheets, a private room each and a decent wine list.',
  luxury: 'The finest house in the Inner Ring: feather beds, hot baths and a cellar to match. Seasoned adventurers expect nothing less.',
  outer: 'A sturdy townhouse inside the outer wall. Your own roof: nights here cost nothing.',
  middle: 'A handsome house in the Middle Ring, among merchants and guild masters. Nights here cost nothing.',
  inner: 'A mansion in the Inner Ring, a street away from the Lord\'s Manor. Nights here cost nothing.',
};

/** An inn or one of the party's residences: end the day with a night's lodging (or several). Inns also sell drinks. */
export class InnScene extends Phaser.Scene {
  private place: Place = 'standard';
  private report: string[] = [];

  constructor() {
    super('Inn');
  }

  init(data: { tier?: InnTier; ring?: Ring }): void {
    this.place = data.ring ?? data.tier ?? 'standard';
    this.report = [];
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('City'));
    this.render();
  }

  private render(): void {
    this.children.removeAll(true);
    const state = requireState();
    const home = isResidence(this.place) ? this.place : null;
    const inn = home ? null : GUILD.inns[this.place as InnTier];
    const owned = !!home && state.residences.includes(home);
    cityHeader(this, state, home ? GUILD.residences[home].name : inn!.name);
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });

    panel(this, 16, 116, 560, HEIGHT - 132);
    text(this, 30, 126, BLURB[this.place], { fontSize: '14px', wordWrap: { width: 532 }, lineSpacing: 3 });
    const guests = boarders(state);
    const perNight = dailyUpkeep(state, this.place);
    const price = home ? (owned ? 'Yours: free nights (food still costs)' : `For sale: ${GUILD.residences[home].price} gold`) : `${inn!.pricePerPerson} gold per person a night`;
    text(this, 30, 184, price, { fontSize: '18px', color: COLORS.gold });
    const quality = LODGING_QUALITY[this.place];
    const perks = [
      `Counts as ${QUALITY_TEXT[quality]} (quality ${quality} of 3). D-rank adventurers are fine outside; C-rank expect an inn, B-rank a high-end inn, A and S-rank a luxury one (or a residence in that ring).`,
      `The party houses ${guests.length}: you, your slaves, and companions whose contract includes food & lodging. Those companions, and slaves, like a better night than they expect and resent a worse one.`,
    ];
    text(this, 30, 214, perks.join('\n'), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 532 }, lineSpacing: 3 });
    guests.forEach((c, i) => figure(this, 52 + i * 52, 372, 62, c.appearance, c.weaponId));
    text(this, 30, 378, guests.map((c) => c.name).join(', '), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 532 } });

    const toPay = (7 - (state.day % 7)) % 7;
    text(this, 30, 408, `Tonight: ${perNight} gold (lodging ${lodgingCost(state, this.place)} + food ${foodCost(state)}).   Gold: ${state.gold}.\nNext payday ${isPayday(state.day) ? 'is today' : `in ${toPay} day${toPay === 1 ? '' : 's'}`}: ${weeklyWages(state)} gold in wages.`, {
      fontSize: '13px', lineSpacing: 4,
    });
    if (home && !owned) {
      button(this, 30, 452, 530, 46, `For sale at the Estate Office (Middle Ring): ${GUILD.residences[home].price} gold`, () => this.scene.start('Estate'), { fontSize: 15 });
    } else {
      const stays: [number, string][] = [[1, 'Stay the night'], [3, 'Stay 3 nights'], [7, 'Stay a week']];
      stays.forEach(([n, label], i) => button(this, 30 + i * 180, 452, 170, 46, `${label}\n${perNight * n} gold${home ? ' (food)' : ''}`, () => this.stay(n), {
        fontSize: 14, enabled: state.gold >= perNight * n, fill: 0x2c4a2f,
      }));
      if (state.gold < perNight) text(this, 30, 502, 'You can\'t afford a night here.', { fontSize: '13px', color: COLORS.bad });
    }
    const housed = state.party.filter((c) => bondOf(c) && isHoused(c));
    if (housed.length) {
      const mood = housed.map((c) => {
        const d = lodgingRelationship(c, this.place) + foodRelationship(c, foodOf(state, c));
        const rel = Math.round(bondOf(c)?.relationship ?? 0);
        return `${c.name} ${rel}${d ? ` (${d > 0 ? '+' : ''}${d}/night)` : ''}`;
      });
      text(this, 30, 520, `Relationship here (lodging + food): ${mood.join(', ')}`, { fontSize: '12px', color: '#e05a9b', wordWrap: { width: 532 } });
    }
    if (inn) {
      const tier = this.place as InnTier;
      const drinks = drinksCost(state, tier);
      const hadRound = state.drinksDay === state.day;
      button(this, 30, HEIGHT - 76, 250, 44, hadRound ? 'Drinks: already had a round today' : `Buy a round of drinks · ${drinks} gold`, () => {
        if (buyDrinks(state, tier)) return;
        this.report.push(`Day ${state.day}: a round of drinks for everyone (${drinks} gold). Morale +${inn.drinksMorale}.`);
        markDirty();
        this.render();
      }, { fontSize: 12, enabled: !hadRound && state.gold >= drinks });
      text(this, 292, HEIGHT - 76, `Morale +${inn.drinksMorale} for the whole party (once a day).\n${state.party.map((c) => `${c.name} ${moraleOf(c)}`).join(', ')}`, {
        fontSize: '11px', color: COLORS.dim, wordWrap: { width: 276 }, lineSpacing: 2,
      });
    }

    panel(this, 588, 116, 356, HEIGHT - 132);
    text(this, 600, 124, 'During your stay', { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, 598, 146, 338, HEIGHT - 170, 6);
    list.setItems(this.report.map((line) => {
      const t = text(this, 0, 0, line, { fontSize: '12px', wordWrap: { width: 324 }, lineSpacing: 1 });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    }), 'end');
    if (!this.report.length) text(this, 766, 300, 'Nothing yet.', { color: COLORS.dim }).setOrigin(0.5);
  }

  private stay(nights: number): void {
    const state = requireState();
    const from = state.day;
    const msgs = isResidence(this.place) ? stayAtHome(state, this.place, nights, Math.random) : stayAtInn(state, this.place, nights, Math.random);
    this.report.push(`Day ${from} to day ${state.day}: ${nights} night${nights > 1 ? 's' : ''} at ${lodgingName(this.place)}.`, ...msgs.map((m) => `• ${m}`));
    markDirty();
    this.render();
  }
}
