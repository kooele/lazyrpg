import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import { isGearItem, type Item } from '../data/types';
import { activityOf } from '../game/condition';
import { scheduledMembers } from '../game/city';
import { itemName, itemValue, sortedInventory, stacks } from '../game/inventory';
import { canSell, listItems, moveGroup, saleGroups, salesPerDay, unlistItems } from '../game/marketplace';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, clearScene, panel, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';

/** Name colour: junk grey, gear by quality. */
const QUALITY_COLOR: Record<string, string> = { crude: '#a8adb8', common: COLORS.text, fine: '#6fdc8c', masterwork: '#e0b44c' };
const colorOf = (i: Item) => (isGearItem(i) ? QUALITY_COLOR[i.quality] ?? COLORS.text : '#a8adb8');
const kindName = (i: Item) => (i.kind === 'weapon' ? 'Weapon' : i.kind === 'armor' ? 'Armor' : 'Junk');

/**
 * The Marketplace: the party's stall. Move junk and spare gear from the stash onto the sale list and put it in order;
 * members on Marketplace duty (Manage Party > Schedule) sell it from the top, a few items each a day, at full value.
 */
export class MarketplaceScene extends Phaser.Scene {
  constructor() {
    super('Marketplace');
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
    cityHeader(this, state, 'Marketplace');
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    // Who minds the stall, and how fast the list goes.
    const sellers = scheduledMembers(state).filter((c) => activityOf(state, c) === 'marketplace');
    const all = state.party.filter((c) => state.schedule[c.id] === 'marketplace' && activityOf(state, c) === 'marketplace');
    const perDay = salesPerDay(all.length);
    const days = perDay ? Math.ceil(state.marketplace.length / perDay) : 0;
    const who = all.length ? `On Marketplace duty: ${all.map((c) => `${c.name}${sellers.includes(c) ? '' : ' (away)'}`).join(', ')}` : 'Nobody is on Marketplace duty';
    text(this, 20, 78, `${who} · sells ${perDay} item${perDay === 1 ? '' : 's'} a day${state.marketplace.length && perDay ? ` · about ${days} day${days === 1 ? '' : 's'} to sell the list` : ''}`, {
      fontSize: '12px', color: all.length ? COLORS.text : COLORS.bad, wordWrap: { width: WIDTH - 220 },
    });
    text(this, 20, 94, `Companions and slaves can be put on Marketplace duty in Manage Party (Schedule). Each sells ${GUILD.schedule.marketplaceItemsPerDay} items a day, at full value.`, {
      fontSize: '11px', color: COLORS.dim, wordWrap: { width: WIDTH - 220 },
    });
    this.stash();
    this.saleList();
  }

  // ---- left: the stash (what can be put up for sale) ---------------------------------------------

  private stash(): void {
    const state = requireState();
    panel(this, 16, 118, 456, HEIGHT - 134);
    const sellable = sortedInventory(state).filter(canSell);
    text(this, 28, 126, `Stash (${sellable.length} to Sell)`, { fontSize: '16px', color: COLORS.gold });
    const list = new ScrollList(this, 22, 152, 444, HEIGHT - 174, 4);
    list.setItems(stacks(sellable).map((st): ScrollItem => ({
      height: 46,
      make: () => {
        const row = this.add.container(0, 0);
        row.add(this.add.rectangle(0, 0, 434, 46, COLORS.panelLight, 0.4).setOrigin(0));
        row.add(text(this, 10, 5, `${itemName(st.item)}${st.count > 1 ? `  ×${st.count}` : ''}`, { fontSize: '14px', color: colorOf(st.item) }));
        row.add(text(this, 10, 26, `${kindName(st.item)} · ${itemValue(st.item)}g${st.count > 1 ? ' each' : ''}`, { fontSize: '11px', color: COLORS.dim }));
        const sell = (ids: string[]) => {
          const err = listItems(state, ids);
          if (err) return toast(this, err, COLORS.bad);
          markDirty();
          this.render();
        };
        if (st.count > 1) row.add(button(this, 272, 9, 76, 28, 'List All', () => sell(st.ids), { fontSize: 12 }));
        row.add(button(this, 354, 9, 72, 28, 'List 1', () => sell([st.ids[0]]), { fontSize: 12 }));
        return row;
      },
    })), 'keep');
    if (!sellable.length) {
      text(this, 244, 320, 'Nothing to sell.\nJunk and spare gear from the stash\ncan be put up for sale here.', { color: COLORS.dim, align: 'center', fontSize: '13px' }).setOrigin(0.5);
    }
  }

  // ---- right: the sale list, top sells first ---------------------------------------------------------

  private saleList(): void {
    const state = requireState();
    const X = 480;
    panel(this, X, 118, 464, HEIGHT - 134);
    const total = state.marketplace.reduce((s, i) => s + itemValue(i), 0);
    text(this, X + 12, 126, `For Sale (${state.marketplace.length}) · ${total} Gold`, { fontSize: '16px', color: COLORS.gold });
    text(this, X + 452, 129, 'top sells first', { fontSize: '11px', color: COLORS.dim }).setOrigin(1, 0);
    const groups = saleGroups(state);
    const list = new ScrollList(this, X + 6, 152, 452, HEIGHT - 174, 4);
    const move = (i: number, to: -1 | 1 | 'top' | 'bottom') => {
      moveGroup(state, i, to);
      markDirty();
      this.render();
    };
    list.setItems(groups.map((g, i): ScrollItem => ({
      height: 46,
      make: () => {
        const row = this.add.container(0, 0);
        row.add(this.add.rectangle(0, 0, 442, 46, COLORS.panelLight, 0.5).setOrigin(0));
        row.add(text(this, 8, 5, `${i + 1}. ${itemName(g.item)}${g.ids.length > 1 ? `  ×${g.ids.length}` : ''}`, { fontSize: '14px', color: colorOf(g.item) }));
        row.add(text(this, 8, 26, `${kindName(g.item)} · ${itemValue(g.item) * g.ids.length}g`, { fontSize: '11px', color: COLORS.dim }));
        const bx = 236;
        row.add(button(this, bx, 9, 30, 28, '⤒', () => move(i, 'top'), { fontSize: 14, enabled: i > 0 }));
        row.add(button(this, bx + 34, 9, 30, 28, '▲', () => move(i, -1), { fontSize: 12, enabled: i > 0 }));
        row.add(button(this, bx + 68, 9, 30, 28, '▼', () => move(i, 1), { fontSize: 12, enabled: i < groups.length - 1 }));
        row.add(button(this, bx + 106, 9, 92, 28, 'Take Back', () => {
          unlistItems(state, g.ids);
          markDirty();
          this.render();
        }, { fontSize: 12 }));
        return row;
      },
    })), 'keep');
    if (!groups.length) {
      text(this, X + 232, 320, 'Nothing on sale.\nPut items up for sale from the stash.', { color: COLORS.dim, align: 'center', fontSize: '13px' }).setOrigin(0.5);
    }
  }
}
