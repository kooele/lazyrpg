import Phaser from 'phaser';
import { SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import type { Character, Offer } from '../data/types';
import { askingPrice, buySlave, marketBuyPrice, nextShipmentDay, sellSlave } from '../game/city';
import { isSlave } from '../game/contracts';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { PEOPLE_SORTS, nextSort, sortPeople, type PeopleSort, type SortDir } from '../game/sorting';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, sortBar, talentTag, text, toast, type ScrollItem } from '../ui/widgets';

/** The slave market: buy slaves, and sell your own back. It doesn't take prisoners (they're registered at the city gate). */
export class MarketScene extends Phaser.Scene {
  /** Order of the slaves for sale (highest level first by default). */
  private sort: { key: PeopleSort; dir: SortDir } = { key: 'level', dir: 'desc' };

  constructor() {
    super('Market');
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
    cityHeader(this, state, 'Slave Market');
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    text(this, 20, 76, 'Slaves fight for no pay, but the party must feed and house them every day.', { fontSize: '13px' });
    const idx = state.market.priceIndex;
    const mood = idx >= 1.15 ? 'high' : idx <= 0.87 ? 'low' : 'usual';
    const next = nextShipmentDay(state.day + 1);
    text(this, 20, 96, `${state.market.slaves.length} for sale · Prices ${Math.round(idx * 100)}% of usual (${mood}) · Next shipment day ${next} · Party ${state.party.length}/${GUILD.maxRoster}`, {
      fontSize: '12px', color: mood === 'high' ? '#e08a5a' : mood === 'low' ? '#6fdc8c' : COLORS.dim,
    });

    panel(this, 16, 118, 560, HEIGHT - 134);
    text(this, 28, 126, 'For sale', { fontSize: '16px', color: COLORS.gold });
    sortBar(this, 252, 123, PEOPLE_SORTS, this.sort, (key) => {
      this.sort = nextSort(this.sort, key);
      this.render();
    }, { h: 24, fontSize: 11, widths: { level: 66, talent: 68, name: 60, cost: 56 } });
    const list = new ScrollList(this, 24, 150, 544, HEIGHT - 174, 4);
    const stock = sortPeople(state.market.slaves, (o) => o.character, (o) => askingPrice(state, o), this.sort.key, this.sort.dir);
    list.setItems(stock.map((o) => this.row(o, 544, [
      { label: `Buy: ${askingPrice(state, o)} gold`, enabled: state.gold >= askingPrice(state, o), act: () => this.buy(o) },
    ])), 'keep');
    if (state.market.slaves.length === 0) text(this, 296, 300, 'Sold out until the next delivery.', { color: COLORS.dim }).setOrigin(0.5);

    panel(this, 588, 118, 356, HEIGHT - 134);
    text(this, 600, 126, 'Sell your slaves', { fontSize: '16px', color: COLORS.gold });
    text(this, 600, 150, `The market buys slaves for ${Math.round(GUILD.slave.sellBackShare * 100)}% of its current price. It doesn't buy prisoners: register them at the city gate when you come back from a quest.`, {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: 332 },
    });
    const mine = state.party.filter(isSlave);
    const slist = new ScrollList(this, 596, 206, 340, HEIGHT - 230, 4);
    slist.setItems(mine.map((c) => this.row({ character: c, price: 0 }, 340, [
      { label: `Sell ${marketBuyPrice(state, c)}g`, enabled: true, act: () => this.sell(c) },
    ], true)), 'top');
    if (mine.length === 0) text(this, 766, 300, 'You have no slaves to sell.', { color: COLORS.dim, align: 'center' }).setOrigin(0.5);
  }

  private row(o: Offer, w: number, actions: { label: string; enabled: boolean; act: () => void }[], compact = false): ScrollItem {
    const c = o.character;
    const row = this.add.container(0, 0);
    const h = compact ? 104 : 86;
    row.add(this.add.rectangle(0, 0, w - 10, h, COLORS.panelLight, 0.5).setOrigin(0));
    row.add(figure(this, 30, compact ? 66 : 74, 60, c.appearance, c.weaponId, { base: false }));
    const name = text(this, 64, 6, c.name, { fontSize: '16px' });
    row.add(name);
    row.add(talentTag(this, 64 + name.width + 12, 9, c, { fontSize: 12, detail: false }));
    row.add(text(this, 64, 26, `Level ${c.level} (${adventurerRank(c.level)}-rank) · ${WEAPONS[c.weaponId].name}`, { fontSize: '13px', color: COLORS.gold }));
    if (!compact) row.add(talentTag(this, 64, 45, c, { fontSize: 11, overall: false, sep: '   ' }));
    const skills = c.skillIds.map((s) => SKILLS[s].name);
    const shown = compact && skills.length > 3 ? `${skills.slice(0, 3).join(', ')} +${skills.length - 3} more` : skills.join(', ');
    row.add(text(this, 64, compact ? 46 : 62, shown || 'No tree skills yet', {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: compact ? 260 : 270 },
    }));
    actions.forEach((a, i) => {
      const bx = compact ? 64 + i * 88 : w - 150;
      const by = compact ? 66 : 26;
      row.add(button(this, bx, by, compact ? 84 : 130, 32, a.label, a.act, { fontSize: compact ? 11 : 13, enabled: a.enabled }));
    });
    return { obj: row, height: h };
  }

  private buy(o: Offer): void {
    const state = requireState();
    confirmDialog(this, `Buy ${o.character.name} (Lv ${o.character.level}) for ${askingPrice(state, o)} gold?`, () => {
      const err = buySlave(state, o.character.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `${o.character.name} joined your party. Set their lineup and loadout in Manage Party.`);
    }, 'Buy');
  }

  private sell(c: Character): void {
    const state = requireState();
    confirmDialog(this, `Sell ${c.name} (Lv ${c.level}) to the slave market for ${marketBuyPrice(state, c)} gold?`, () => {
      const gold = sellSlave(state, c.id, Math.random);
      markDirty();
      this.render();
      toast(this, `${c.name} goes on the market. You get ${gold} gold.`);
    }, 'Sell');
  }
}
