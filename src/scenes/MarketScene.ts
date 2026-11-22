import Phaser from 'phaser';
import { SKILLS, WEAPONS } from '../data/content';
import { GUILD } from '../data/guild';
import type { Offer } from '../data/types';
import { buySlave, registerPrisoner, turnInPrisoner } from '../game/city';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';

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
    text(this, 20, 96, `New stock on day ${state.market.restockDay} · Food & lodging ${GUILD.upkeep.foodLodgingPerDay} gold a day each · Party ${state.party.length}/${GUILD.maxRoster}`, {
      fontSize: '12px', color: COLORS.dim,
    });

    panel(this, 16, 118, 560, HEIGHT - 134);
    text(this, 28, 126, 'For sale', { fontSize: '16px', color: COLORS.gold });
    const list = new ScrollList(this, 24, 150, 544, HEIGHT - 174, 4);
    list.setItems(state.market.slaves.map((o) => this.row(o, 544, [
      { label: `Buy: ${o.price} gold`, enabled: state.gold >= o.price, act: () => this.buy(o) },
    ])), 'top');
    if (state.market.slaves.length === 0) text(this, 296, 300, 'Sold out until the next delivery.', { color: COLORS.dim }).setOrigin(0.5);

    panel(this, 588, 118, 356, HEIGHT - 134);
    text(this, 600, 126, "Magistrate's office", { fontSize: '16px', color: COLORS.gold });
    text(this, 600, 150, `Bandits captured on quests are judged here. Turn them in for the bounty, or pay a ${GUILD.slave.registrationFee} gold fee to register them as your slave.`, {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: 332 },
    });
    const plist = new ScrollList(this, 596, 206, 340, HEIGHT - 230, 4);
    plist.setItems(state.prisoners.map((o) => this.row(o, 340, [
      { label: `Bounty ${o.price}g`, enabled: true, act: () => this.turnIn(o) },
      { label: `Register ${GUILD.slave.registrationFee}g`, enabled: state.gold >= GUILD.slave.registrationFee, act: () => this.register(o) },
    ], true)), 'top');
    if (state.prisoners.length === 0) text(this, 766, 300, 'No prisoners.\nBandit quests sometimes\nend with a capture.', { color: COLORS.dim, align: 'center' }).setOrigin(0.5);
  }

  private row(o: Offer, w: number, actions: { label: string; enabled: boolean; act: () => void }[], compact = false): ScrollItem {
    const c = o.character;
    const row = this.add.container(0, 0);
    const h = compact ? 104 : 72;
    row.add(this.add.rectangle(0, 0, w - 10, h, COLORS.panelLight, 0.5).setOrigin(0));
    row.add(figure(this, 30, 66, 60, c.appearance, c.weaponId, { base: false }));
    row.add(text(this, 64, 6, c.name, { fontSize: '16px' }));
    row.add(text(this, 64, 26, `Level ${c.level} · ${WEAPONS[c.weaponId].name}`, { fontSize: '13px', color: COLORS.gold }));
    row.add(text(this, 64, 46, c.skillIds.map((s) => SKILLS[s].name).join(', ') || 'No tree skills yet', {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: compact ? 260 : 270 },
    }));
    actions.forEach((a, i) => {
      const bx = compact ? 64 + i * 134 : w - 150;
      const by = compact ? 66 : 18;
      row.add(button(this, bx, by, compact ? 126 : 130, 32, a.label, a.act, { fontSize: 13, enabled: a.enabled }));
    });
    return { obj: row, height: h };
  }

  private buy(o: Offer): void {
    const state = requireState();
    confirmDialog(this, `Buy ${o.character.name} (Lv ${o.character.level}) for ${o.price} gold?`, () => {
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
