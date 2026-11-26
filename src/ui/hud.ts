// Shared bits for the Arch City screens: the status bar, rank badges, member labels.
import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import type { Character, GameState, Rank } from '../data/types';
import { finances, isPayday, tabTotal, type FinanceLine } from '../game/city';
import { daysLeft, isCompanion, slaveTax, slaveValue } from '../game/contracts';
import { nextRank, rankThreshold } from '../game/guild';
import { session } from '../game/session';
import { COLORS, WIDTH, button, panel, text } from './widgets';

export const RANK_COLORS: Record<Rank, number> = { S: 0xb87fe0, A: 0xe0b44c, B: 0x9fb7d8, C: 0xc08a5a, D: 0x7a8296 };

/** A small square badge with the rank letter. (x, y) is the top-left corner. */
export function rankBadge(scene: Phaser.Scene, x: number, y: number, rank: Rank, size = 26): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, size, size, RANK_COLORS[rank]).setOrigin(0).setStrokeStyle(2, 0x0e1018);
  const t = text(scene, size / 2, size / 2, rank, { fontSize: `${Math.round(size * 0.62)}px`, color: '#1a1410', fontStyle: 'bold' }).setOrigin(0.5);
  return scene.add.container(x, y, [bg, t]);
}

export const MEMBER_LABEL: Record<string, string> = { main: 'Leader', mercenary: 'Mercenary', companion: 'Companion', slave: 'Slave' };
export const MEMBER_COLOR: Record<string, string> = { main: '#e0b44c', mercenary: '#ff9f6b', companion: '#6fdc8c', slave: '#b9a3e3' };

/** "Companion · 12 days left" etc. */
export function memberStatus(state: GameState, c: Character): string {
  const k = c.contract;
  if (!k) return '';
  if (k.type === 'mercenary') return `Mercenary · ${k.fee}g or ${k.cutPct}% · 1 Quest`;
  if (isCompanion(c)) {
    const left = daysLeft(c.contract, state.day);
    return `Companion · ${left > 0 ? `${left} Day${left === 1 ? '' : 's'} Left` : 'Contract Ended!'}`;
  }
  if (k.type === 'slave') return `Slave · Value ${Math.round(slaveValue(c))}g · Tax ${slaveTax(c)}g/wk`;
  return 'Leader · Permanent';
}

/** The status bar along the top of every city screen. With `onMenu`, a ☰ menu button sits at its left. */
export function cityHeader(scene: Phaser.Scene, state: GameState, title: string, onMenu?: () => void): void {
  panel(scene, 0, 0, WIDTH, 64, 0x131726);
  const left = onMenu ? 64 : 20;
  if (onMenu) button(scene, 12, 12, 40, 40, '☰', onMenu, { fontSize: 22 });
  text(scene, left, title.length > 18 ? 14 : 10, title, { fontSize: title.length > 18 ? '22px' : '28px', color: COLORS.gold });
  const sub = `${GUILD.city}  ·  Day ${state.day} (week ${Math.ceil(state.day / 7)})`;
  text(scene, left + 2, 42, sub, { fontSize: '13px', color: COLORS.dim });
  // Right: gold, and a Finances button (the day's net) that opens the full breakdown.
  const gold = text(scene, WIDTH - 20, 6, `${state.gold} Gold`, { fontSize: '20px', color: COLORS.gold }).setOrigin(1, 0);
  // What a multi-day quest ran up, due at the next End Day.
  const tab = tabTotal(state);
  if (tab) text(scene, WIDTH - 30 - gold.width, 12, `Tabs: ${tab}g Due at End Day`, { fontSize: '12px', color: tab > state.gold ? COLORS.bad : COLORS.dim }).setOrigin(1, 0);
  const f = finances(state);
  const FW = 190;
  button(scene, WIDTH - 20 - FW, 34, FW, 24, `Finances: ${f.net >= 0 ? '+' : '−'}${Math.abs(f.net)}g/day ▾`, () => financesPanel(scene, state), {
    fontSize: 12, fill: 0x1c2234,
  });
  // Middle: the party, with an "unsaved" tag beside its name, and its rank and renown underneath.
  rankBadge(scene, 330, 16, state.rank, 32);
  const name = text(scene, 372, 12, state.partyName, { fontSize: '15px' });
  if (session.dirty) text(scene, name.x + name.width + 8, 15, 'Unsaved', { fontSize: '11px', color: COLORS.dim, fontStyle: 'italic' });
  const up = nextRank(state.rank);
  const below = state.renown < rankThreshold(state.rank);
  const renown = `Renown ${Math.round(state.renown)}${up ? `/${rankThreshold(up)}` : ''}${below ? ` · Below ${state.rank} (${rankThreshold(state.rank)})!` : ''}`;
  const room = WIDTH - 20 - Math.max(FW, gold.width) - 16 - 372;
  text(scene, 372, 34, `${state.rank}-Rank Party · ${renown}`, { fontSize: '12px', color: below ? COLORS.bad : COLORS.dim, wordWrap: { width: Math.max(120, room) } });
}

/**
 * The Finances panel (from the header's Finances button): the next End Day's income (odd jobs, Marketplace sales) and
 * expenses (food, lodging), the daily net, payday's wages and slave tax, and the quest tab. Click anywhere to close.
 */
export function financesPanel(scene: Phaser.Scene, state: GameState): void {
  const f = finances(state);
  const layer = scene.add.container(0, 0).setDepth(4000);
  const shade = scene.add.rectangle(0, 0, WIDTH, 2000, 0x000000, 0.35).setOrigin(0).setInteractive();
  shade.on('pointerup', () => layer.destroy());
  layer.add(shade);
  const W = 380;
  const X = WIDTH - W - 12;
  const box = panel(scene, X, 66, W, 100).setInteractive();
  layer.add(box);
  let y = 76;
  const add = (o: Phaser.GameObjects.GameObject) => layer.add(o);
  const heading = (t: string, note = '') => {
    add(text(scene, X + 14, y, t, { fontSize: '14px', color: COLORS.gold }));
    if (note) add(text(scene, X + W - 14, y + 2, note, { fontSize: '11px', color: COLORS.dim }).setOrigin(1, 0));
    y += 22;
  };
  const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}g`;
  const row = (l: FinanceLine) => {
    add(text(scene, X + 22, y, l.label, { fontSize: '13px' }));
    add(text(scene, X + 120, y + 1, l.detail, { fontSize: '11px', color: COLORS.dim, wordWrap: { width: 190 } }));
    add(text(scene, X + W - 14, y, money(l.amount), { fontSize: '13px', color: l.amount > 0 ? COLORS.good : l.amount < 0 ? COLORS.bad : COLORS.dim }).setOrigin(1, 0));
    y += 20;
  };
  const total = (label: string, n: number) => {
    const g = scene.add.graphics().lineStyle(1, COLORS.border, 1).lineBetween(X + 14, y + 1, X + W - 14, y + 1);
    add(g);
    y += 5;
    add(text(scene, X + 22, y, label, { fontSize: '13px', fontStyle: 'bold' }));
    add(text(scene, X + W - 14, y, money(n), { fontSize: '13px', fontStyle: 'bold', color: n > 0 ? COLORS.good : n < 0 ? COLORS.bad : COLORS.text }).setOrigin(1, 0));
    y += 26;
  };
  add(text(scene, X + 14, y, 'Finances', { fontSize: '18px', color: COLORS.gold }));
  add(text(scene, X + W - 14, y + 4, `${state.gold} Gold`, { fontSize: '13px', color: COLORS.gold }).setOrigin(1, 0));
  y += 30;
  heading('Income', 'at the next End Day');
  f.income.forEach(row);
  heading('Expenses', 'every day');
  f.expenses.forEach(row);
  total('Net per Day', f.net);
  heading('Payday', isPayday(state.day) ? 'paid tonight' : `in ${f.paydayIn} day${f.paydayIn === 1 ? '' : 's'}`);
  f.weekly.forEach(row);
  total('Due on Payday', f.weekly.reduce((s, l) => s + l.amount, 0));
  if (f.tab) {
    heading('Quest Tab', 'due at the next End Day');
    row({ label: 'On the Road', detail: 'food, lodging and paydays on the trip', amount: -f.tab });
    y += 4;
  }
  if (f.stall.items) {
    add(text(scene, X + 14, y, `On sale at the Marketplace: ${f.stall.items} item${f.stall.items === 1 ? '' : 's'} worth ${f.stall.gold} gold.`, { fontSize: '11px', color: COLORS.dim, wordWrap: { width: W - 28 } }));
    y += 20;
  }
  add(text(scene, X + 14, y, 'Click anywhere to close.', { fontSize: '11px', color: COLORS.dim }));
  y += 18;
  box.setSize(W, y - 66 + 6);
}
