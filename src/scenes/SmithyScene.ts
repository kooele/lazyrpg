import Phaser from 'phaser';
import { ARMORS, ARMOR_TYPES, QUALITIES, SKILLS, SMITHY, WEAPONS, WEAPON_TYPES } from '../data/content';
import { GUILD } from '../data/guild';
import type { GearKind } from '../data/types';
import { gearName, gearStatLines } from '../game/gear';
import { markDirty, requireState, session } from '../game/session';
import { buyGear, buyPrice, cancelOrder, inProgress, orderDays, orderEtas, orderGear, orderOptions } from '../game/smithy';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, clearScene, confirmDialog, panel, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';

/** The Smithy: buy Common weapons and armor on the spot, or order Fine and Masterwork pieces (paid up front, made in turn). */
export class SmithyScene extends Phaser.Scene {
  private pick: { kind: GearKind; type: string } = { kind: 'weapon', type: WEAPON_TYPES[0] };

  constructor() {
    super('Smithy');
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
    cityHeader(this, state, 'Smithy');
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    text(this, 20, 82, `${QUALITIES[SMITHY.buyQuality].name} gear on the spot, or better made to order · works on ${SMITHY.workers} orders at a time`, { fontSize: '12px', color: COLORS.dim });
    this.catalog();
    this.details();
    this.orders();
  }

  // ---- left: what the Smithy makes ----------------------------------------------------------

  private catalog(): void {
    panel(this, 16, 110, 290, HEIGHT - 126);
    text(this, 28, 118, 'Weapons', { fontSize: '15px', color: COLORS.gold });
    const pickButton = (kind: GearKind, type: string, name: string, x: number, y: number) => button(this, x, y, 132, 28, name, () => {
      this.pick = { kind, type };
      this.render();
    }, { selected: this.pick.kind === kind && this.pick.type === type, fontSize: 12 });
    WEAPON_TYPES.forEach((id, i) => pickButton('weapon', id, WEAPONS[id].name, 28 + (i % 2) * 138, 142 + Math.floor(i / 2) * 32));
    const ay = 142 + Math.ceil(WEAPON_TYPES.length / 2) * 32 + 12;
    text(this, 28, ay, 'Armor', { fontSize: '15px', color: COLORS.gold });
    ARMOR_TYPES.forEach((id, i) => pickButton('armor', id, ARMORS[id].name, 28 + (i % 2) * 138, ay + 24 + Math.floor(i / 2) * 32));
  }

  // ---- middle: the selected piece, and buying or ordering it -------------------------------------

  private details(): void {
    const state = requireState();
    const { kind, type } = this.pick;
    const def = kind === 'weapon' ? WEAPONS[type] : ARMORS[type];
    const X = 314;
    panel(this, X, 110, 320, HEIGHT - 126);
    text(this, X + 12, 120, def.name, { fontSize: '20px', color: COLORS.gold });
    const w = kind === 'weapon' ? WEAPONS[type] : null;
    const info = text(this, X + 12, 150, [
      w ? `${w.class} · Range ${w.range}` : 'Body Armor',
      def.description,
      ...(w ? [`Skills: ${w.skills.map((s) => SKILLS[s].name).join(', ')}`] : []),
    ].join('\n'), { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 296 }, lineSpacing: 2 });
    // Stats at each quality the Smithy offers (base stats grow with quality; modifiers don't).
    let y = 150 + info.height + 10;
    const mods = gearStatLines(def)[1];
    text(this, X + 12, y, mods, { fontSize: '12px', wordWrap: { width: 296 } });
    y += 22;
    const rows = [{ quality: SMITHY.buyQuality, price: buyPrice(), days: 0 }, ...orderOptions()];
    for (const r of rows) {
      const q = QUALITIES[r.quality];
      const base = gearStatLines(def, r.quality)[0].replace(/^Base: /, '');
      panel(this, X + 8, y, 304, 74, COLORS.panelLight);
      text(this, X + 16, y + 6, `${q.name} ${def.name}`, { fontSize: '14px', color: r.days ? '#6fdc8c' : COLORS.text });
      text(this, X + 16, y + 26, base, { fontSize: '11px', color: COLORS.dim, wordWrap: { width: 170 } });
      const label = r.days ? `Order: ${r.price}g\n${r.days} Days` : `Buy: ${r.price}g`;
      button(this, X + 196, y + 14, 108, 44, label, () => this.buy(kind, type, r.quality, r.price, r.days), {
        fontSize: 13, enabled: state.gold >= r.price, fill: r.days ? 0x2a3348 : 0x2c4a2f,
      });
      y += 80;
    }
    if (rows.some((r) => state.gold < r.price)) text(this, X + 12, y + 2, `Gold: ${state.gold}.`, { fontSize: '12px', color: COLORS.dim });
  }

  private buy(kind: GearKind, type: string, quality: string, price: number, days: number): void {
    const state = requireState();
    const name = gearName({ type, quality }, kind);
    if (!days) {
      const err = buyGear(state, kind, type);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `Bought a ${name} for ${price} gold. It's in the stash (Manage Party > Equipment).`);
      return;
    }
    const busy = state.smithyOrders.length >= SMITHY.workers;
    confirmDialog(this, `Order a ${name} for ${price} gold, paid now?\nIt takes ${days} days of work${busy ? `, after the ${state.smithyOrders.length - SMITHY.workers + 1} order(s) ahead of it in the queue` : ''}.`, () => {
      const err = orderGear(state, kind, type, quality);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
      toast(this, `Ordered a ${name}. It goes to the stash when it's done.`);
    }, 'Order');
  }

  // ---- right: the order queue -----------------------------------------------------------------

  private orders(): void {
    const state = requireState();
    const X = 642;
    panel(this, X, 110, 302, HEIGHT - 126);
    text(this, X + 12, 118, `Your Orders (${state.smithyOrders.length})`, { fontSize: '15px', color: COLORS.gold });
    const etas = orderEtas(state);
    const list = new ScrollList(this, X + 6, 144, 290, HEIGHT - 166, 4);
    list.setItems(state.smithyOrders.map((o, i): ScrollItem => ({
      height: 62,
      make: () => {
        const row = this.add.container(0, 0);
        const working = inProgress(state, o);
        row.add(this.add.rectangle(0, 0, 280, 62, COLORS.panelLight, working ? 0.6 : 0.3).setOrigin(0));
        row.add(text(this, 8, 5, gearName(o, o.kind), { fontSize: '13px', color: '#6fdc8c' }));
        const eta = etas[o.id];
        row.add(text(this, 8, 24, working ? `In Progress: ${o.worked}/${orderDays(o)} Days` : `Queued (#${i + 1 - SMITHY.workers} in Line)`, { fontSize: '11px', color: working ? COLORS.text : COLORS.dim }));
        row.add(text(this, 8, 40, `Ready Day ${state.day + eta} (in ${eta} day${eta === 1 ? '' : 's'})`, { fontSize: '11px', color: COLORS.dim }));
        if (o.worked === 0) {
          row.add(button(this, 196, 16, 76, 28, 'Cancel', () => confirmDialog(this, `Cancel the ${gearName(o, o.kind)}?\nYou get the ${o.paid} gold back.`, () => {
            const err = cancelOrder(state, o.id);
            if (err) return toast(this, err, COLORS.bad);
            markDirty();
            this.render();
          }, 'Cancel Order'), { fontSize: 12 }));
        }
        return row;
      },
    })), 'keep');
    if (!state.smithyOrders.length) {
      text(this, X + 151, 300, 'No orders.\nFine and Masterwork gear\nis made to order.', { color: COLORS.dim, align: 'center', fontSize: '13px' }).setOrigin(0.5);
    }
  }
}
