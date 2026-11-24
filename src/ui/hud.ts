// Shared bits for the Arch City screens: the status bar, rank badges, member labels.
import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import type { Character, GameState, Rank } from '../data/types';
import { boarders, dailyUpkeep, foodCost, isPayday, lodgingCost, weeklyTaxes, weeklyWages } from '../game/city';
import { daysLeft, isCompanion, slaveTax, slaveValue } from '../game/contracts';
import { nextRank, rankThreshold } from '../game/guild';
import { session } from '../game/session';
import { COLORS, WIDTH, panel, text } from './widgets';

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
  if (k.type === 'mercenary') return `Mercenary · ${k.fee}g or ${k.cutPct}% · 1 quest`;
  if (isCompanion(c)) {
    const left = daysLeft(c.contract, state.day);
    return `Companion · ${left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'contract ended!'}`;
  }
  if (k.type === 'slave') return `Slave · value ${Math.round(slaveValue(c))}g · tax ${slaveTax(c)}g/wk`;
  return 'Leader · permanent';
}

/** The status bar along the top of every city screen. */
export function cityHeader(scene: Phaser.Scene, state: GameState, title: string): void {
  panel(scene, 0, 0, WIDTH, 64, 0x131726);
  text(scene, 20, title.length > 18 ? 14 : 10, title, { fontSize: title.length > 18 ? '22px' : '28px', color: COLORS.gold });
  const sub = `${GUILD.city}  ·  Day ${state.day} (week ${Math.ceil(state.day / 7)})`;
  text(scene, 22, 42, sub, { fontSize: '13px', color: COLORS.dim });
  const toPay = (7 - (state.day % 7)) % 7;
  // Right: gold, then upkeep on two short lines (so they stay clear of the party's renown in the middle).
  text(scene, WIDTH - 20, 6, `${state.gold} gold`, { fontSize: '20px', color: COLORS.gold }).setOrigin(1, 0);
  const feeding = text(scene, WIDTH - 20, 32, `Housing ${boarders(state).length}: ${dailyUpkeep(state, 'city')}g/day (food ${foodCost(state)}, lodging ${lodgingCost(state, 'city')})`, { fontSize: '11px', color: COLORS.dim }).setOrigin(1, 0);
  const wages = text(scene, WIDTH - 20, 46,
    `Wages ${weeklyWages(state)}${weeklyTaxes(state) ? ` + slave tax ${weeklyTaxes(state)}` : ''}/week ${isPayday(state.day) ? '(paid today)' : `(payday in ${toPay}d)`}`,
    { fontSize: '11px', color: COLORS.dim }).setOrigin(1, 0);
  // Middle: the party, with an "unsaved" tag beside its name, and its rank and renown underneath.
  rankBadge(scene, 330, 16, state.rank, 32);
  const name = text(scene, 372, 12, state.partyName, { fontSize: '15px' });
  if (session.dirty) text(scene, name.x + name.width + 8, 15, 'unsaved', { fontSize: '11px', color: COLORS.dim, fontStyle: 'italic' });
  const up = nextRank(state.rank);
  const below = state.renown < rankThreshold(state.rank);
  const renown = `Renown ${Math.round(state.renown)}${up ? `/${rankThreshold(up)}` : ''}${below ? ` · below ${state.rank} (${rankThreshold(state.rank)})!` : ''}`;
  const room = WIDTH - 20 - Math.max(feeding.width, wages.width) - 16 - 372;
  text(scene, 372, 34, `${state.rank}-rank party · ${renown}`, { fontSize: '12px', color: below ? COLORS.bad : COLORS.dim, wordWrap: { width: Math.max(120, room) } });
}
