import Phaser from 'phaser';
import { ARMORS, SKILLS, WEAPONS } from '../data/content';
import { STAT_INFO, type Character, type Gear, type Item, type ItemKind } from '../data/types';
import { penLine, statText } from '../game/battle';
import { deriveStats } from '../game/character';
import { armorName, armorOf, figureKit, gearStatLines, weaponName, weaponOf } from '../game/gear';
import { equipBlock, equipItem, itemName, itemValue, sortedInventory, statChanges, unequip } from '../game/inventory';
import { markDirty, requireState, session } from '../game/session';
import { MEMBER_COLOR, MEMBER_LABEL, cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, Tooltip, WIDTH, button, clearScene, figure, panel, setupCamera, text, toast, type ScrollItem } from '../ui/widgets';

/** Name colour by quality: Crude grey, Common white, Fine green, Masterwork gold. */
const QUALITY_COLOR: Record<string, string> = { crude: '#a8adb8', common: COLORS.text, fine: '#6fdc8c', masterwork: '#e0b44c' };
const qualityColor = (q: string) => QUALITY_COLOR[q] ?? COLORS.text;

const FILTERS: { id: ItemKind | 'all'; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'weapon', name: 'Weapons' },
  { id: 'armor', name: 'Armor' },
];

/** What a piece is: "Bow · Range 6" for weapons, "Body Armor" for armor. */
function kindLine(kind: ItemKind, type: string): string {
  const w = WEAPONS[type];
  return kind === 'weapon' && w ? `${w.class} · Range ${w.range}` : 'Body Armor';
}

/** A piece's full description: kind, value, base stats (at its quality), modifiers and (weapons) skills. */
function gearLines(kind: ItemKind, g: Pick<Gear, 'type' | 'quality'>): string[] {
  const def = kind === 'weapon' ? WEAPONS[g.type] : ARMORS[g.type];
  if (!def) return [];
  const lines = [`${kindLine(kind, g.type)} · Value: ${itemValue(g)} Gold`, ...gearStatLines(def, g.quality)];
  if (kind === 'weapon') lines.push(`Skills: ${WEAPONS[g.type].skills.map((s) => SKILLS[s].name).join(', ')}`);
  return lines;
}

/**
 * Equipment: who wears what, and the party's stash. Pick a member on the left, equip from the stash on the right
 * (what they had goes back to the stash), or take a piece off.
 */
export class EquipmentScene extends Phaser.Scene {
  private selected = '';
  private filter: ItemKind | 'all' = 'all';
  private tip!: Tooltip;

  constructor() {
    super('Equipment');
  }

  init(data: { selected?: string }): void {
    if (data.selected) this.selected = data.selected;
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.back());
    this.render();
  }

  private back(): void {
    this.scene.start('Party', { selected: this.selected });
  }

  private member(): Character {
    const state = requireState();
    const c = state.party.find((m) => m.id === this.selected) ?? state.party.find((m) => m.id === state.mainId) ?? state.party[0];
    this.selected = c.id;
    return c;
  }

  private render(): void {
    clearScene(this);
    const state = requireState();
    cityHeader(this, state, 'Equipment');
    this.tip = new Tooltip(this, 360);
    button(this, WIDTH - 176, 74, 160, 34, 'Back to Party', () => this.back(), { fontSize: 14 });
    text(this, 20, 82, 'Pick a member, then equip gear from the stash · hover an item to compare', { fontSize: '12px', color: COLORS.dim });
    const c = this.member();
    this.members();
    this.loadout(c);
    this.stash(c);
  }

  // ---- left: members ------------------------------------------------------------------

  private members(): void {
    const state = requireState();
    panel(this, 16, 110, 220, HEIGHT - 126);
    text(this, 28, 118, 'Members', { fontSize: '16px', color: COLORS.gold });
    const list = new ScrollList(this, 22, 142, 210, HEIGHT - 164, 4);
    list.setItems(state.party.map((m): ScrollItem => ({
      height: 58,
      make: () => {
        const row = this.add.container(0, 0);
        const sel = m.id === this.selected;
        const bg = this.add.rectangle(0, 0, 200, 58, sel ? COLORS.accent : COLORS.panelLight, sel ? 0.35 : 0.5).setOrigin(0);
        bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
          this.selected = m.id;
          this.render();
        });
        row.add(bg);
        row.add(figure(this, 22, 54, 50, m.appearance, figureKit(m), { base: false }));
        row.add(text(this, 46, 4, m.name, { fontSize: '14px' }));
        row.add(text(this, 196, 6, MEMBER_LABEL[m.contract?.type ?? 'main'], { fontSize: '10px', color: MEMBER_COLOR[m.contract?.type ?? 'main'] }).setOrigin(1, 0));
        row.add(text(this, 46, 23, weaponName(m), { fontSize: '11px', color: qualityColor(m.weapon?.quality ?? 'crude') }));
        row.add(text(this, 46, 38, armorName(m), { fontSize: '11px', color: qualityColor(m.armor?.quality ?? 'crude') }));
        return row;
      },
    })), 'keep');
  }

  // ---- middle: the member's gear and stats ---------------------------------------------------

  private loadout(c: Character): void {
    const X = 244;
    panel(this, X, 110, 340, HEIGHT - 126);
    figure(this, X + 54, 236, 110, c.appearance, figureKit(c));
    text(this, X + 110, 120, c.name, { fontSize: '20px' });
    text(this, X + 110, 146, `Level ${c.level} · ${MEMBER_LABEL[c.contract?.type ?? 'main']}`, { fontSize: '12px', color: COLORS.dim });
    const st = deriveStats(c);
    const pen = penLine(st, '\n');
    text(this, X + 110, 166, [
      `HP ${st.health}   MP ${st.mana}`,
      `P.Atk ${st.pAtk}   M.Atk ${st.mAtk}`,
      `Def ${statText('defense', st.defense)}   Move ${st.movement}`,
      ...(pen ? [pen] : []),
    ].join('\n'), { fontSize: '13px', lineSpacing: 3 });
    const block = equipBlock(c);
    this.slot(c, 'weapon', X + 12, 262, !block);
    this.slot(c, 'armor', X + 12, 262 + 170, !block);
    if (block) text(this, X + 170, HEIGHT - 34, block, { fontSize: '11px', color: COLORS.dim, wordWrap: { width: 316 }, align: 'center' }).setOrigin(0.5, 1);
  }

  /** One equipment slot: what's in it and what it gives, with an Unequip button. */
  private slot(c: Character, kind: ItemKind, x: number, y: number, canChange: boolean): void {
    const g = c[kind];
    panel(this, x, y, 316, 160, COLORS.panelLight);
    text(this, x + 10, y + 6, kind === 'weapon' ? 'Weapon' : 'Armor', { fontSize: '12px', color: COLORS.dim });
    if (!g) {
      const def = kind === 'weapon' ? weaponOf(c) : armorOf(c);
      text(this, x + 10, y + 24, def?.name ?? '', { fontSize: '16px', color: COLORS.dim });
      text(this, x + 10, y + 48, [...(def ? gearStatLines(def).slice(1) : []), kind === 'weapon' ? 'Skills: Basic Attack' : ''].filter(Boolean).join('\n'), {
        fontSize: '12px', color: COLORS.dim, lineSpacing: 2, wordWrap: { width: 296 },
      });
      text(this, x + 10, y + 132, 'Equip one from the stash.', { fontSize: '11px', color: COLORS.dim });
      return;
    }
    text(this, x + 10, y + 24, kind === 'weapon' ? weaponName(c) : armorName(c), { fontSize: '16px', color: qualityColor(g.quality) });
    text(this, x + 10, y + 48, gearLines(kind, g).join('\n'), { fontSize: '12px', lineSpacing: 2, wordWrap: { width: 296 } });
    // A companion leaves with what they brought; once it's in the stash, it's the party's.
    if (!g.issued && c.contract?.type === 'companion') {
      text(this, x + 10, y + 140, 'Their own (once taken off, it stays in the stash).', { fontSize: '10px', color: COLORS.dim });
    }
    button(this, x + 216, y + 4, 92, 26, 'Unequip', () => {
      const err = unequip(requireState(), c.id, kind);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.render();
    }, { fontSize: 12, enabled: canChange });
  }

  // ---- right: the stash -------------------------------------------------------------------

  private stash(c: Character): void {
    const state = requireState();
    const X = 592;
    panel(this, X, 110, 352, HEIGHT - 126);
    text(this, X + 12, 118, `Stash (${state.inventory.length})`, { fontSize: '16px', color: COLORS.gold });
    FILTERS.forEach((f, i) => {
      button(this, X + 130 + i * 72, 116, 68, 24, f.name, () => {
        this.filter = f.id;
        this.render();
      }, { selected: this.filter === f.id, fontSize: 11 });
    });
    const items = sortedInventory(state, this.filter === 'all' ? undefined : this.filter);
    const canChange = !equipBlock(c);
    const list = new ScrollList(this, X + 6, 148, 340, HEIGHT - 170, 4);
    list.setItems(items.map((item): ScrollItem => ({ height: 56, make: () => this.itemRow(item, c, canChange) })), 'keep');
    if (items.length === 0) {
      text(this, X + 176, 300, state.inventory.length ? 'Nothing of this kind.' : 'The stash is empty.\nGear you take off ends up here.', {
        color: COLORS.dim, align: 'center', fontSize: '13px',
      }).setOrigin(0.5);
    }
  }

  private itemRow(item: Item, c: Character, canChange: boolean): Phaser.GameObjects.Container {
    const row = this.add.container(0, 0);
    const bg = this.add.rectangle(0, 0, 330, 56, COLORS.panelLight, 0.5).setOrigin(0).setInteractive();
    bg.on('pointerover', () => this.tip.show(this.itemTip(item, c))).on('pointerout', () => this.tip.hide());
    row.add(bg);
    row.add(text(this, 10, 6, itemName(item), { fontSize: '14px', color: qualityColor(item.quality) }));
    row.add(text(this, 10, 26, `${kindLine(item.kind, item.type)} · ${itemValue(item)}g`, { fontSize: '11px', color: COLORS.dim }));
    // The biggest changes, each green (up) or red (down).
    const changes = statChanges(c, item).filter((s) => !['pPenPct', 'mPenPct', 'pPen', 'mPen'].includes(s.key)).slice(0, 4);
    if (!changes.length) row.add(text(this, 10, 40, 'No Stat Change', { fontSize: '10px', color: COLORS.dim }));
    let cx = 10;
    for (const s of changes) {
      const d = s.after - s.before;
      const t = text(this, cx, 40, `${STAT_INFO[s.key].short} ${d > 0 ? '+' : ''}${d}`, { fontSize: '10px', color: d > 0 ? COLORS.good : COLORS.bad });
      row.add(t);
      cx += t.width + 8;
    }
    row.add(button(this, 250, 14, 70, 28, 'Equip', () => {
      const err = equipItem(requireState(), c.id, item.id);
      if (err) return toast(this, err, COLORS.bad);
      markDirty();
      this.tip.hide();
      this.render();
    }, { fontSize: 13, enabled: canChange, onHover: () => this.tip.show(this.itemTip(item, c)), onOut: () => this.tip.hide() }));
    return row;
  }

  /** Tooltip: the item in full, and what it would change for the selected member. */
  private itemTip(item: Item, c: Character): string {
    const changes = statChanges(c, item);
    const current = item.kind === 'weapon' ? weaponName(c) : armorName(c);
    return [
      itemName(item),
      ...gearLines(item.kind, item),
      '',
      `On ${c.name} (in place of ${current}):`,
      ...(changes.length ? changes.map((s) => `• ${STAT_INFO[s.key].short} ${s.before} → ${s.after}`) : ['• No stat changes']),
    ].join('\n');
  }
}
