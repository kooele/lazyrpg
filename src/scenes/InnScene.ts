import Phaser from 'phaser';
import { GUILD, LODGING_QUALITY, isResidence, type InnTier, type Ring } from '../data/guild';
import { buyDrinks, drinkers, drinksCost, residents } from '../game/city';
import { QUALITY_TEXT, moraleOf } from '../game/condition';
import { titleCase } from '../game/titleCase';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, WIDTH, button, figure, panel, setupCamera, text, clearScene } from '../ui/widgets';
import { figureKit } from '../game/gear';

type Place = InnTier | Ring;

const BLURB: Record<Place, string> = {
  standard: 'A busy common-room inn by the outer wall: stew, ale and a roaring fire.',
  highEnd: 'A respectable Inner City inn just inside the inner wall, with a decent wine list.',
  luxury: 'The finest house in the Inner City: a cellar to match its feather beds and hot baths.',
  outer: 'A sturdy townhouse inside the outer wall. Your own roof: nights here cost nothing.',
  middle: 'A handsome townhouse inside the inner wall, among merchants and guild masters. Nights here cost nothing.',
  inner: 'A mansion in the heart of the Inner City, a street away from the Lord\'s Manor. Nights here cost nothing.',
};

/**
 * An inn (drinks for the party; more to come) or one of the city's residences (who lives there).
 * Where members sleep is set per member in Manage Party; the day ends with End Day on the city screen.
 */
export class InnScene extends Phaser.Scene {
  private place: Place = 'standard';

  constructor() {
    super('Inn');
  }

  init(data: { tier?: InnTier; ring?: Ring }): void {
    this.place = data.ring ?? data.tier ?? 'standard';
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
    clearScene(this);
    const state = requireState();
    const place = this.place;
    cityHeader(this, state, isResidence(place) ? GUILD.residences[place].name : GUILD.inns[place].name);
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    text(this, 20, 82, BLURB[place], { fontSize: '14px', wordWrap: { width: WIDTH - 220 }, lineSpacing: 3 });
    if (isResidence(place)) this.residence(place);
    else this.inn(place);
  }

  /** An inn: a round of drinks for the members back from today's quest. The rest of the room is kept free for what the inn will offer later. */
  private inn(tier: InnTier): void {
    const state = requireState();
    const inn = GUILD.inns[tier];
    panel(this, 16, 130, WIDTH - 32, 104);
    text(this, 30, 140, 'Drinks', { fontSize: '16px', color: COLORS.gold });
    const drinks = drinksCost(state, tier);
    const who = drinkers(state);
    const backToday = state.lastQuestDay === state.day;
    const label = who.length ? `Buy a Round of Drinks · ${drinks} Gold`
      : backToday ? 'Already Had a Round Today' : 'Drinks Only After a Quest';
    button(this, 30, 166, 280, 44, label, () => {
      if (buyDrinks(state, tier)) return;
      markDirty();
      this.render();
    }, { fontSize: 13, enabled: who.length > 0 && state.gold >= drinks });
    const detail = who.length ? `For the members back from today's quest: ${who.map((c) => `${c.name} ${moraleOf(c)}`).join(', ')}`
      : 'A round celebrates a quest: come back the day the party returns from one.';
    text(this, 326, 166, `${inn.drinksPerPerson} gold a head. Morale +${inn.drinksMorale} for each member who went on the quest, once, the day they come back.\n${detail}`, {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: WIDTH - 370 }, lineSpacing: 3,
    });
  }

  /** A residence: who lives there (set in Manage Party), or where to buy it. */
  private residence(ring: Ring): void {
    const state = requireState();
    const home = GUILD.residences[ring];
    const owned = state.residences.includes(ring);
    const q = LODGING_QUALITY[ring];
    panel(this, 16, 130, WIDTH - 32, HEIGHT - 146);
    text(this, 30, 140, owned ? 'Yours: nights here are free (food still costs).' : `For Sale at the Estate Office: ${home.price} Gold`, {
      fontSize: '16px', color: owned ? '#6fdc8c' : COLORS.gold,
    });
    text(this, 30, 164, titleCase(`Night quality ${q} of 3: counts as ${QUALITY_TEXT[q]} · room for ${GUILD.residences.capacity} residents`), { fontSize: '12px', color: COLORS.dim });
    if (!owned) {
      button(this, 30, 196, 300, 44, 'Go to the Estate Office', () => this.scene.start('Estate'), { fontSize: 14 });
      return;
    }
    const people = residents(state, ring);
    text(this, 30, 196, `Residents ${people.length}/${GUILD.residences.capacity}`, { fontSize: '15px', color: COLORS.gold });
    people.forEach((c, i) => {
      const x = 70 + i * 140;
      figure(this, x, 350, 110, c.appearance, figureKit(c));
      text(this, x, 362, c.name, { fontSize: '13px', align: 'center', wordWrap: { width: 130 } }).setOrigin(0.5, 0);
    });
    if (!people.length) text(this, 30, 226, 'Nobody lives here yet.', { fontSize: '13px', color: COLORS.dim });
    text(this, 30, 404, 'Choose where each member lodges in Manage Party.', { fontSize: '12px', color: COLORS.dim });
    button(this, 30, 426, 200, 40, 'Manage Party', () => this.scene.start('Party'), { fontSize: 14 });
  }
}
