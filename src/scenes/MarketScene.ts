import Phaser from 'phaser';
import { SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import type { Offer } from '../data/types';
import { askingPrice, buySlave, marketBuyPrice, nextShipmentDay, registerPrisoner, sellCaptive, turnInPrisoner } from '../game/city';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast, type ScrollItem } from '../ui/widgets';

/** The slave market, and the magistrate who judges captured prisoners. */
export class MarketScene extends Phaser.Scene {
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
    const list = new ScrollList(this, 24, 150, 544, HEIGHT - 174, 4);
    const stock = [...state.market.slaves].sort((a, b) => a.character.level - b.character.level || a.price - b.price);
    list.setItems(stock.map((o) => this.row(o, 544, [
      { label: `Buy: ${askingPrice(state, o)} gold`, enabled: state.gold >= askingPrice(state, o), act: () => this.buy(o) },
    ])), 'keep');
    if (state.market.slaves.length === 0) text(this, 296, 300, 'Sold out until the next delivery.', { color: COLORS.dim }).setOrigin(0.5);

    panel(this, 588, 118, 356, HEIGHT - 134);
    text(this, 600, 126, "Magistrate's office", { fontSize: '16px', color: COLORS.gold });
    text(this, 600, 150, `Captives are judged here: turn them in for the bounty, register them as your slave (${GUILD.slave.registrationFee} gold fee), or sell them to the market.`, {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: 332 },
    });
    const plist = new ScrollList(this, 596, 206, 340, HEIGHT - 230, 4);
    plist.setItems(state.prisoners.map((o) => this.row(o, 340, [
      { label: `Bounty ${o.price}g`, enabled: true, act: () => this.turnIn(o) },
      { label: `Register ${GUILD.slave.registrationFee}g`, enabled: state.gold >= GUILD.slave.registrationFee, act: () => this.register(o) },
      { label: `Sell ${marketBuyPrice(state, o.character, true)}g`, enabled: true, act: () => this.sellCaptive(o) },
    ], true)), 'top');
    if (state.prisoners.length === 0) text(this, 766, 300, 'No prisoners.\nHuman foes who surrender\nare taken prisoner.', { color: COLORS.dim, align: 'center' }).setOrigin(0.5);
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

  private turnIn(o: Offer): void {
    const state = requireState();
    const gold = turnInPrisoner(state, o.character.id);
    markDirty();
    this.render();
    toast(this, `${o.character.name} is taken away. Bounty: ${gold} gold.`);
  }

  private sellCaptive(o: Offer): void {
    const state = requireState();
    confirmDialog(this, `Sell ${o.character.name} (Lv ${o.character.level}) to the slave market for ${marketBuyPrice(state, o.character, true)} gold?`, () => {
      const gold = sellCaptive(state, o.character.id);
      markDirty();
      this.render();
      toast(this, `${o.character.name} goes on the market. You get ${gold} gold.`);
    }, 'Sell');
  }

  private register(o: Offer): void {
    const state = requireState();
    confirmDialog(this, `Register ${o.character.name} (Lv ${o.character.level}) as your slave for ${GUILD.slave.registrationFee} gold?`, () => {
      const err = registerPrisoner(state, o.character.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `${o.character.name} now serves your party.`);
    }, 'Register');
  }
}
