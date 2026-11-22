import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import { advanceDay, dailyUpkeep, lineupMembers } from '../game/city';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, button, confirmDialog, panel, setupCamera, text, toast } from '../ui/widgets';

interface Place {
  id: string;
  name: string;
  blurb: string;
  x: number;
  y: number;
  w: number;
  h: number;
  draw: (g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) => void;
  go: () => void;
}

/** Arch City: the hub. Pick a location, rest, or set out on an accepted quest. */
export class CityScene extends Phaser.Scene {
  private tip!: Phaser.GameObjects.Text;

  constructor() {
    super('City');
  }

  create(): void {
    if (!session.state) {
      this.scene.start('MainMenu');
      return;
    }
    setupCamera(this);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MainMenu'));
    this.render();
  }

  private render(): void {
    this.children.removeAll(true);
    const state = requireState();
    cityHeader(this, state, GUILD.city);

    // ---- the map -------------------------------------------------------------------------
    const MX = 16;
    const MY = 76;
    const MW = 604;
    const MH = 488;
    const g = this.add.graphics();
    g.fillStyle(0x3a4a34).fillRect(MX, MY, MW, MH);
    g.fillStyle(0x45573d);
    for (let i = 0; i < 40; i++) {
      const r = 10 + (i % 5) * 4;
      g.fillCircle(MX + r + ((i * 137) % (MW - 2 * r)), MY + r + ((i * 89) % (MH - 2 * r)), r);
    }
    // Cobbled roads: a ring around the square and the road out through the gate.
    g.fillStyle(0x8a7d68).fillRoundedRect(MX + 30, MY + 196, MW - 60, 30, 8);
    g.fillRoundedRect(MX + 287, MY + 60, 30, MH - 60, 8);
    g.fillStyle(0x9a8c74).fillCircle(MX + 302, MY + 211, 46);
    g.fillStyle(0x6a8fb0).fillCircle(MX + 302, MY + 211, 16);
    g.fillStyle(0xb9d4e8).fillCircle(MX + 298, MY + 207, 5);
    this.add.rectangle(MX, MY, MW, MH).setOrigin(0).setStrokeStyle(2, COLORS.border);

    const places: Place[] = [
      {
        id: 'guild', name: 'Adventurer Guild', blurb: 'Quest board, hire mercenaries and companions, the party leaderboard.',
        x: MX + 200, y: MY + 22, w: 204, h: 160, draw: drawGuild, go: () => this.scene.start('Guild'),
      },
      {
        id: 'market', name: 'Slave Market', blurb: 'Buy slaves, and the magistrate: turn in or register captured prisoners.',
        x: MX + 26, y: MY + 250, w: 190, h: 130, draw: drawMarket, go: () => this.scene.start('Market'),
      },
      {
        id: 'quarters', name: 'Party Quarters', blurb: 'Your members: lineup, loadouts, contracts and renewals.',
        x: MX + 240, y: MY + 254, w: 124, h: 102, draw: drawHouse, go: () => this.scene.start('Party'),
      },
      {
        id: 'inn', name: 'The Sleeping Griffin', blurb: `Inn: rest until tomorrow (food & lodging ${dailyUpkeep(state)} gold a day).`,
        x: MX + 388, y: MY + 250, w: 190, h: 130, draw: drawInn, go: () => this.rest(),
      },
      {
        id: 'gate', name: 'City Gate', blurb: state.quest ? `Set out: ${state.quest.title}.` : 'Accept a quest at the guild, then leave from here.',
        x: MX + 242, y: MY + 394, w: 120, h: 74, draw: drawGate, go: () => this.depart(),
      },
    ];
    for (const p of places) this.place(p);
    this.tip = text(this, MX + 12, MY + MH - 26, 'Click a location.', {
      fontSize: '13px', color: COLORS.text, backgroundColor: '#000000a0', padding: { x: 8, y: 4 },
    }).setDepth(10);

    // ---- right: the quest at hand, and recent events -----------------------------------------
    const RX = 636;
    panel(this, RX, 76, 308, 160);
    text(this, RX + 12, 84, 'Current quest', { fontSize: '13px', color: COLORS.dim });
    if (state.quest) {
      const q = state.quest;
      rankBadge(this, RX + 12, 106, q.rank, 24);
      text(this, RX + 44, 106, q.title, { fontSize: '15px', wordWrap: { width: 252 } });
      text(this, RX + 12, 150, `${q.reward} gold · ${q.days} day${q.days > 1 ? 's' : ''} · stage ${q.stage}`, { fontSize: '13px', color: COLORS.gold });
      text(this, RX + 12, 170, `Lineup: ${lineupMembers(state).map((c) => c.name).join(', ')}`, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: 284 } });
      button(this, RX + 12, 196, 284, 32, 'Set out from the City Gate', () => this.depart(), { fill: 0x4a2a22, fontSize: 14 });
    } else {
      text(this, RX + 12, 106, 'None. Visit the Adventurer Guild\'s quest board.', { fontSize: '14px', wordWrap: { width: 284 } });
      button(this, RX + 12, 196, 284, 32, 'Go to the Adventurer Guild', () => this.scene.start('Guild'), { fontSize: 14 });
    }

    panel(this, RX, 246, 308, 318);
    text(this, RX + 12, 254, 'Recent events', { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, RX + 10, 276, 292, 282, 6);
    const entries = [...state.log].reverse();
    list.setItems(entries.map((n) => {
      const t = text(this, 0, 0, `Day ${n.day}: ${n.text}`, { fontSize: '12px', wordWrap: { width: 278 }, lineSpacing: 1 });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    }), 'top');

    // ---- bottom ---------------------------------------------------------------------------------
    button(this, 16, HEIGHT - 64, 190, 48, 'Main Menu', () => this.scene.start('MainMenu'));
    button(this, 216, HEIGHT - 64, 190, 48, 'Save Game', () => this.scene.start('SaveLoad', { mode: 'save', returnTo: 'City' }));
    button(this, 416, HEIGHT - 64, 204, 48, 'Rest until tomorrow', () => this.rest(), { fontSize: 15 });
    button(this, 636, HEIGHT - 64, 308, 48, 'Party Quarters', () => this.scene.start('Party'), { fontSize: 16 });
  }

  private place(p: Place): void {
    const g = this.add.graphics();
    p.draw(g, p.x, p.y, p.w, p.h);
    const label = text(this, p.x + p.w / 2, p.y + p.h + 2, p.name, {
      fontSize: '13px', color: '#f4ecd8', backgroundColor: '#1a1d2bd0', padding: { x: 6, y: 2 },
    }).setOrigin(0.5, 0);
    const zone = this.add.rectangle(p.x, p.y, p.w, p.h + 20, 0xffffff, 0).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      g.setAlpha(0.85);
      label.setColor(COLORS.gold);
      this.tip.setText(`${p.name}: ${p.blurb}`);
    });
    zone.on('pointerout', () => {
      g.setAlpha(1);
      label.setColor('#f4ecd8');
      this.tip.setText('Click a location.');
    });
    zone.on('pointerup', p.go);
  }

  private rest(): void {
    const state = requireState();
    confirmDialog(this, `Rest until tomorrow?\nFood and lodging costs ${dailyUpkeep(state)} gold.`, () => {
      const msgs = advanceDay(state, Math.random);
      markDirty();
      this.render();
      toast(this, msgs.length ? msgs[msgs.length - 1] : `Day ${state.day} begins.`);
    }, 'Rest');
  }

  private depart(): void {
    const state = requireState();
    const q = state.quest;
    if (!q) return toast(this, 'Accept a quest at the Adventurer Guild first.', COLORS.bad);
    const members = lineupMembers(state);
    confirmDialog(this, `Set out: ${q.title}?\n${members.map((c) => `${c.name} (Lv ${c.level})`).join(', ')}`, () => this.scene.start('Battle'), 'Set out');
  }
}

// ---- buildings (storybook-ish, flat shapes) ----------------------------------------------------

function roof(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.fillStyle(color).fillTriangle(x - 8, y + h, x + w / 2, y, x + w + 8, y + h);
  g.fillStyle(0x000000, 0.15).fillTriangle(x + w / 2, y, x + w + 8, y + h, x + w / 2, y + h);
}

function windows(g: Phaser.GameObjects.Graphics, x: number, y: number, n: number, gap: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle(0x3a2a20).fillRect(x + i * gap, y, 14, 16);
    g.fillStyle(0xf0d080, 0.85).fillRect(x + i * gap + 2, y + 2, 10, 12);
  }
}

function drawGuild(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(x + w / 2, y + h - 2, w + 10, 18);
  g.fillStyle(0xcdb89a).fillRect(x + 10, y + 58, w - 20, h - 62);
  g.fillStyle(0xb8a283).fillRect(x + w / 2 - 34, y + 28, 68, 40);
  roof(g, x + 10, y + 30, w - 20, 34, 0x7a3b2e);
  roof(g, x + w / 2 - 34, y, 68, 32, 0x8a4434);
  windows(g, x + 24, y + 84, 3, 22);
  windows(g, x + w - 90, y + 84, 3, 22);
  g.fillStyle(0x5a3a22).fillRoundedRect(x + w / 2 - 16, y + h - 46, 32, 42, { tl: 14, tr: 14, bl: 0, br: 0 });
  // Banner with a crossed-swords emblem.
  g.fillStyle(0x2f4f8a).fillRect(x + w / 2 - 12, y + 40, 24, 30);
  g.fillTriangle(x + w / 2 - 12, y + 70, x + w / 2 + 12, y + 70, x + w / 2, y + 78);
  g.lineStyle(2, 0xe0c070).lineBetween(x + w / 2 - 7, y + 46, x + w / 2 + 7, y + 64).lineBetween(x + w / 2 + 7, y + 46, x + w / 2 - 7, y + 64);
}

function drawMarket(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(x + w / 2, y + h - 4, w, 16);
  const tents = [[x + 6, y + 40, 0xa8443a], [x + 66, y + 24, 0xc9a050], [x + 126, y + 44, 0x5a7a9a]] as const;
  for (const [tx, ty, col] of tents) {
    g.fillStyle(0xd8c8a8).fillRect(tx + 6, ty + 34, 46, h - (ty - y) - 40);
    g.fillStyle(col).fillTriangle(tx, ty + 36, tx + 29, ty, tx + 58, ty + 36);
    g.fillStyle(0xffffff, 0.25).fillTriangle(tx + 29, ty, tx + 20, ty + 36, tx + 29, ty + 36);
    g.fillStyle(0x3a2a20).fillRect(tx + 20, ty + 54, 18, h - (ty - y) - 60);
  }
  // A wooden stage with a post.
  g.fillStyle(0x7a5a3a).fillRect(x + 56, y + h - 26, 78, 16);
  g.fillStyle(0x5a3a22).fillRect(x + 92, y + h - 64, 5, 40);
}

function drawHouse(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(x + w / 2, y + h - 2, w + 6, 14);
  g.fillStyle(0xd8c4a0).fillRect(x + 12, y + 44, w - 24, h - 46);
  roof(g, x + 12, y + 6, w - 24, 40, 0x4a5a7a);
  windows(g, x + 24, y + 58, 1, 0);
  windows(g, x + w - 38, y + 58, 1, 0);
  g.fillStyle(0x5a3a22).fillRect(x + w / 2 - 11, y + h - 34, 22, 32);
  g.fillStyle(0xe0b44c).fillCircle(x + w / 2 + 6, y + h - 18, 2);
}

function drawInn(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(x + w / 2, y + h - 2, w + 6, 16);
  g.fillStyle(0xc9b08a).fillRect(x + 10, y + 46, w - 20, h - 48);
  g.fillStyle(0x6a4a32);
  for (let i = 0; i < 5; i++) g.fillRect(x + 10, y + 52 + i * 16, w - 20, 2);
  roof(g, x + 10, y + 8, w - 20, 40, 0x6a7a3a);
  windows(g, x + 26, y + 64, 2, 26);
  windows(g, x + w - 76, y + 64, 2, 26);
  g.fillStyle(0x5a3a22).fillRect(x + w / 2 - 12, y + h - 38, 24, 36);
  // Hanging sign.
  g.lineStyle(2, 0x3a2a20).lineBetween(x + w - 14, y + 50, x + w + 6, y + 50);
  g.fillStyle(0xe0c070).fillRoundedRect(x + w - 4, y + 54, 18, 14, 3);
}

function drawGate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(x + w / 2, y + h - 2, w + 6, 12);
  g.fillStyle(0x9a9488).fillRect(x, y + 12, 30, h - 12).fillRect(x + w - 30, y + 12, 30, h - 12);
  g.fillStyle(0x8a8478).fillRect(x + 20, y + 18, w - 40, 22);
  for (let i = 0; i < 4; i++) g.fillStyle(0x9a9488).fillRect(x + i * 9, y, 6, 14).fillRect(x + w - 30 + i * 9, y, 6, 14);
  g.fillStyle(0x2a2420).fillRoundedRect(x + 30, y + 40, w - 60, h - 40, { tl: 20, tr: 20, bl: 0, br: 0 });
  g.fillStyle(0x6a8a4a, 0.6).fillRect(x + 36, y + h - 14, w - 72, 14);
}
