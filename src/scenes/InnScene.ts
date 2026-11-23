import Phaser from 'phaser';
import { GUILD, type InnTier } from '../data/guild';
import { boarders, buyDrinks, dailyUpkeep, drinksCost, isPayday, stayAtInn, weeklyWages } from '../game/city';
import { expectedInn, lodgingRelationship, moraleOf } from '../game/condition';
import { isCompanion } from '../game/contracts';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, figure, panel, setupCamera, text } from '../ui/widgets';

const BLURB: Record<InnTier, string> = {
  standard: 'A busy common-room inn by the outer wall: stew, ale and a straw mattress. It does the job.',
  luxury: 'The finest house in the Inner Ring: feather beds, hot baths and a cellar to match. Seasoned adventurers expect nothing less.',
};

/** An inn: end the day with a night's lodging (or several), and buy the party a round of drinks. */
export class InnScene extends Phaser.Scene {
  private tier: InnTier = 'standard';
  private report: string[] = [];

  constructor() {
    super('Inn');
  }

  init(data: { tier?: InnTier }): void {
    this.tier = data.tier ?? 'standard';
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
    const inn = GUILD.inns[this.tier];
    cityHeader(this, state, inn.name);
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });

    panel(this, 16, 116, 560, HEIGHT - 132);
    text(this, 30, 126, BLURB[this.tier], { fontSize: '14px', wordWrap: { width: 532 }, lineSpacing: 3 });
    const guests = boarders(state);
    const perNight = dailyUpkeep(state, this.tier);
    text(this, 30, 184, `${inn.pricePerPerson} gold per person a night`, { fontSize: '18px', color: COLORS.gold });
    const perks = [
      `The party pays for ${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}: you, your slaves, and companions whose contract includes food & lodging.`,
      `Others find their own beds. Below level ${GUILD.lodging.luxuryFromLevel} adventurers expect a regular inn, from ${GUILD.lodging.luxuryFromLevel} a high-end one: housed companions like a better night and resent a worse one.`,
    ];
    text(this, 30, 214, perks.join('\n'), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 532 }, lineSpacing: 3 });
    guests.forEach((c, i) => figure(this, 52 + i * 62, 372, 66, c.appearance, c.weaponId));
    text(this, 30, 378, guests.map((c) => c.name).join(', '), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 532 } });

    const toPay = (7 - (state.day % 7)) % 7;
    text(this, 30, 408, `Tonight: ${perNight} gold for the party.   Gold: ${state.gold}.\nNext payday ${isPayday(state.day) ? 'is today' : `in ${toPay} day${toPay === 1 ? '' : 's'}`}: ${weeklyWages(state)} gold in wages.`, {
      fontSize: '13px', lineSpacing: 4,
    });
    const stays: [number, string][] = [[1, 'Stay the night'], [3, 'Stay 3 nights'], [7, 'Stay a week']];
    stays.forEach(([n, label], i) => button(this, 30 + i * 180, 452, 170, 46, `${label}\n${perNight * n} gold`, () => this.stay(n), {
      fontSize: 14, enabled: state.gold >= perNight * n, fill: 0x2c4a2f,
    }));
    if (state.gold < perNight) text(this, 30, 502, 'You can\'t afford a night here.', { fontSize: '13px', color: COLORS.bad });
    const happy = state.party.filter((c) => isCompanion(c) && c.contract.foodLodging);
    if (happy.length) {
      const mood = happy.map((c) => {
        const d = lodgingRelationship(c, this.tier);
        const rel = Math.round(isCompanion(c) ? c.contract.relationship : 0);
        return `${c.name} ${rel}${d ? ` (${d > 0 ? '+' : ''}${d}/night)` : ''}${expectedInn(c) === 'luxury' ? ' · expects high-end' : ''}`;
      });
      text(this, 30, 520, `Relationship: ${mood.join(', ')}`, { fontSize: '12px', color: '#e05a9b', wordWrap: { width: 532 } });
    }
    const drinks = drinksCost(state, this.tier);
    const hadRound = state.drinksDay === state.day;
    button(this, 30, HEIGHT - 76, 250, 44, hadRound ? 'Drinks: already had a round today' : `Buy a round of drinks · ${drinks} gold`, () => {
      const err = buyDrinks(state, this.tier);
      if (err) return;
      this.report.push(`Day ${state.day}: a round of drinks for everyone (${drinks} gold). Morale +${inn.drinksMorale}.`);
      markDirty();
      this.render();
    }, { fontSize: 12, enabled: !hadRound && state.gold >= drinks });
    text(this, 292, HEIGHT - 76, `Morale +${inn.drinksMorale} for the whole party (once a day).\n${state.party.map((c) => `${c.name} ${moraleOf(c)}`).join(', ')}`, {
      fontSize: '11px', color: COLORS.dim, wordWrap: { width: 276 }, lineSpacing: 2,
    });

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
    const msgs = stayAtInn(state, this.tier, nights, Math.random);
    this.report.push(`Day ${from} to day ${state.day}: ${nights} night${nights > 1 ? 's' : ''} at ${GUILD.inns[this.tier].name}.`, ...msgs.map((m) => `• ${m}`));
    markDirty();
    this.render();
  }
}
