import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import { advanceDay, dailyUpkeep, lineupMembers } from '../game/city';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, button, confirmDialog, panel, setupCamera, text, toast } from '../ui/widgets';

export const CITY_MAP_KEY = 'city-map';

type Ring = 'outer' | 'middle' | 'inner';
const RINGS: [Ring, string][] = [['outer', 'Outer Ring'], ['middle', 'Middle Ring'], ['inner', 'Inner Ring']];

interface Place {
  name: string;
  blurb: string;
  /** Pin position in the map image (1536x1024 pixels). */
  at: [number, number];
  /** Scene to open; places without one aren't open yet. */
  scene?: string;
}

const PLACES: Record<Ring, Place[]> = {
  outer: [
    { name: 'Adventurer Guild', blurb: 'Quest board, hire mercenaries and companions, the party leaderboard.', at: [1162, 378], scene: 'Guild' },
    { name: 'Docks', blurb: 'Ships from across the sea.', at: [1330, 760] },
    { name: 'Marketplace', blurb: 'Stalls and traders.', at: [1250, 270] },
    { name: 'Slave Market', blurb: 'Buy slaves, and the magistrate: turn in or register captured prisoners.', at: [1266, 585], scene: 'Market' },
    { name: 'Slums', blurb: 'The poorest quarter, inside the outer wall.', at: [330, 650] },
    { name: 'Customs Office', blurb: 'Duties on everything that comes through the harbour.', at: [1352, 455] },
  ],
  middle: [
    { name: 'Tailor', blurb: 'Clothes and fittings.', at: [520, 380] },
    { name: 'Auction House', blurb: 'Rare goods to the highest bidder.', at: [1010, 420] },
    { name: 'Library', blurb: 'Books, maps and old records.', at: [640, 650] },
    { name: 'Church', blurb: 'Prayer and healing.', at: [905, 640] },
  ],
  inner: [
    { name: "Lord's Manor", blurb: 'Seat of the Lord of Arch City.', at: [765, 392] },
    { name: 'Central Government Office', blurb: 'Permits, taxes and the city\'s business.', at: [650, 470] },
    { name: 'Central Church', blurb: 'The great church at the heart of the city.', at: [885, 470] },
  ],
};

/** Part of the map image each tab shows (x, y, width; height follows the frame), and the ring's wall as an ellipse. */
const VIEWS: Record<Ring, { x: number; y: number; w: number; ring: [number, number, number, number] }> = {
  outer: { x: 0, y: 0, w: 1536, ring: [700, 470, 495, 415] },
  middle: { x: 280, y: 150, w: 960, ring: [760, 472, 352, 300] },
  inner: { x: 495, y: 252, w: 540, ring: [765, 432, 195, 152] },
};

/** Arch City: the hub. Pick a ring and a location, rest, or set out on an accepted quest. */
export class CityScene extends Phaser.Scene {
  private tip!: Phaser.GameObjects.Text;
  private ring: Ring = 'outer';

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

    // ---- ring tabs and the map -------------------------------------------------------------
    RINGS.forEach(([id, label], i) => button(this, 16 + i * 204, 72, 196, 30, label, () => {
      this.ring = id;
      this.render();
    }, { selected: this.ring === id, fontSize: 15 }));
    const MX = 16;
    const MY = 108;
    const MW = 604;
    const MH = Math.round((MW * 1024) / 1536);
    const view = VIEWS[this.ring];
    const k = MW / view.w;
    const toMap = (x: number, y: number): [number, number] => [MX + (x - view.x) * k, MY + (y - view.y) * k];
    if (this.textures.exists(CITY_MAP_KEY)) {
      this.add.image(MX - view.x * k, MY - view.y * k, CITY_MAP_KEY).setOrigin(0).setScale(k)
        .setCrop(view.x, view.y, view.w, view.w * (MH / MW));
    }
    const [rx, ry, rw, rh] = view.ring;
    const [cx, cy] = toMap(rx, ry);
    this.add.graphics().lineStyle(3, COLORS.accent, 0.75).strokeEllipse(cx, cy, rw * 2 * k, rh * 2 * k);
    this.add.rectangle(MX, MY, MW, MH).setOrigin(0).setStrokeStyle(2, COLORS.border);

    const places = PLACES[this.ring];
    for (const p of places) this.pin(p, ...toMap(...p.at));
    this.tip = text(this, MX + 8, MY + MH - 30, 'Click a location.', {
      fontSize: '13px', color: COLORS.text, backgroundColor: '#000000b0', padding: { x: 8, y: 4 }, wordWrap: { width: MW - 40 },
    }).setDepth(10);

    // Every location in the ring as a button too (greyed out until it opens).
    places.forEach((p, i) => button(this, MX + (i % 3) * 204, MY + MH + 6 + Math.floor(i / 3) * 28, 196, 24, p.name,
      () => this.visit(p), { fontSize: 12, enabled: !!p.scene }));

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
      button(this, RX + 12, 196, 284, 32, 'Set out from the city gate', () => this.depart(), { fill: 0x4a2a22, fontSize: 14 });
    } else {
      text(this, RX + 12, 106, 'None. Visit the Adventurer Guild\'s quest board (Outer Ring).', { fontSize: '14px', wordWrap: { width: 284 } });
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
    button(this, 16, HEIGHT - 60, 190, 46, 'Main Menu', () => this.scene.start('MainMenu'));
    button(this, 216, HEIGHT - 60, 190, 46, 'Save Game', () => this.scene.start('SaveLoad', { mode: 'save', returnTo: 'City' }));
    button(this, 416, HEIGHT - 60, 204, 46, 'Rest until tomorrow', () => this.rest(), { fontSize: 15 });
    button(this, 636, HEIGHT - 60, 308, 46, 'Party Quarters', () => this.scene.start('Party'), { fontSize: 16 });
  }

  /** A map pin: gold for open locations, grey for ones that aren't open yet. */
  private pin(p: Place, x: number, y: number): void {
    const open = !!p.scene;
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(0x000000, 0.4).fillCircle(x + 1, y + 2, 9);
      g.fillStyle(open ? (hover ? 0xffd77a : COLORS.accent) : (hover ? 0xb0b6c8 : 0x7a8296), 1).fillCircle(x, y, 8);
      g.lineStyle(2, 0x1a1410, 1).strokeCircle(x, y, 8);
      g.fillStyle(0x1a1410, 1).fillCircle(x, y, 2.5);
    };
    draw(false);
    const label = text(this, x, y - 12, p.name, {
      fontSize: '12px', color: open ? '#f4ecd8' : '#b8bccb', backgroundColor: '#14182acc', padding: { x: 5, y: 2 },
    }).setOrigin(0.5, 1);
    const hit = this.add.circle(x, y, 14, 0xffffff, 0).setInteractive({ useHandCursor: true });
    for (const o of [hit, label.setInteractive({ useHandCursor: true })]) {
      o.on('pointerover', () => {
        draw(true);
        this.tip.setText(`${p.name}${open ? '' : ' (not open yet)'}: ${p.blurb}`);
      });
      o.on('pointerout', () => {
        draw(false);
        this.tip.setText('Click a location.');
      });
      o.on('pointerup', () => this.visit(p));
    }
  }

  private visit(p: Place): void {
    if (p.scene) this.scene.start(p.scene);
    else toast(this, `${p.name} is not open yet.`, COLORS.dim);
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
