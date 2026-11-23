import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import { WEAPONS } from '../data/content';
import { departBlock, lineupMembers, prisonersAtGate, registerPrisoner, sleepOutside, turnInPrisoner } from '../game/city';
import { adventurerRank } from '../game/guild';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast } from '../ui/widgets';

export const CITY_MAP_KEY = 'city-map';

type Ring = 'outer' | 'middle' | 'inner';
const RINGS: [Ring, string][] = [['outer', 'Outer Ring'], ['middle', 'Middle Ring'], ['inner', 'Inner Ring']];

interface Place {
  name: string;
  blurb: string;
  /** Pin position in the map image (1536x1024 pixels). */
  at: [number, number];
  /** Scene to open (and its data); places without one aren't open yet. */
  scene?: string;
  data?: object;
}

const PLACES: Record<Ring, Place[]> = {
  outer: [
    { name: 'Adventurer Guild', blurb: 'Quest board, hire mercenaries and companions, the party leaderboard.', at: [1162, 378], scene: 'Guild' },
    { name: 'Docks', blurb: 'Ships from across the sea.', at: [1330, 760] },
    { name: 'Marketplace', blurb: 'Stalls and traders.', at: [1250, 270] },
    { name: 'Slave Market', blurb: 'Buy slaves, or sell your own.', at: [1266, 585], scene: 'Market' },
    { name: 'Slums', blurb: 'The poorest quarter, inside the outer wall.', at: [330, 650] },
    { name: 'Customs Office', blurb: 'Duties on everything that comes through the harbour.', at: [1352, 455] },
    { name: GUILD.inns.standard.name, blurb: `Inn: lodging at ${GUILD.inns.standard.pricePerPerson} gold per person a night, and drinks. What C-rank adventurers expect.`, at: [330, 330], scene: 'Inn', data: { tier: 'standard' } },
    { name: GUILD.residences.outer.name, blurb: `A home of your own (${GUILD.residences.outer.price} gold at the Estate Office): free nights, as good as an inn.`, at: [560, 860], scene: 'Inn', data: { ring: 'outer' } },
  ],
  middle: [
    { name: 'Tailor', blurb: 'Clothes and fittings.', at: [520, 380] },
    { name: 'Auction House', blurb: 'Rare goods to the highest bidder.', at: [1010, 420] },
    { name: 'Library', blurb: 'Books, maps and old records.', at: [640, 650] },
    { name: 'Church', blurb: 'Prayer and healing.', at: [905, 640] },
    { name: 'Estate Office', blurb: 'Buy and sell residences in every ring.', at: [1110, 300], scene: 'Estate' },
    { name: GUILD.inns.highEnd.name, blurb: `High-end inn: ${GUILD.inns.highEnd.pricePerPerson} gold per person a night, and drinks. What B-rank adventurers expect.`, at: [1060, 560], scene: 'Inn', data: { tier: 'highEnd' } },
    { name: GUILD.residences.middle.name, blurb: `A Middle Ring home (${GUILD.residences.middle.price} gold at the Estate Office): free nights, as good as a high-end inn.`, at: [470, 560], scene: 'Inn', data: { ring: 'middle' } },
  ],
  inner: [
    { name: "Lord's Manor", blurb: 'Seat of the Lord of Arch City.', at: [765, 392] },
    { name: 'Central Government Office', blurb: 'Permits, taxes and the city\'s business.', at: [650, 470] },
    { name: 'Central Church', blurb: 'The great church at the heart of the city.', at: [885, 470] },
    { name: GUILD.inns.luxury.name, blurb: `Luxury inn: ${GUILD.inns.luxury.pricePerPerson} gold per person a night, and drinks. What A and S-rank adventurers expect.`, at: [765, 548], scene: 'Inn', data: { tier: 'luxury' } },
    { name: GUILD.residences.inner.name, blurb: `An Inner Ring mansion (${GUILD.residences.inner.price} gold at the Estate Office): free nights, as good as a luxury inn.`, at: [600, 560], scene: 'Inn', data: { ring: 'inner' } },
  ],
};

/** Part of the map image each tab shows (x, y, width; height follows the frame). */
const VIEWS: Record<Ring, { x: number; y: number; w: number }> = {
  outer: { x: 0, y: 0, w: 1536 },
  middle: { x: 280, y: 150, w: 960 },
  inner: { x: 495, y: 252, w: 540 },
};

/** Arch City: the hub. Pick a ring and a location (inns to rest), or set out on an accepted quest. */
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
    this.add.rectangle(MX, MY, MW, MH).setOrigin(0).setStrokeStyle(2, COLORS.border);

    const places = PLACES[this.ring];
    for (const p of places) this.pin(p, ...toMap(...p.at));
    this.tip = text(this, MX + 8, MY + MH - 30, 'Click a location.', {
      fontSize: '13px', color: COLORS.text, backgroundColor: '#000000b0', padding: { x: 8, y: 4 }, wordWrap: { width: MW - 40 },
    }).setDepth(10);

    // Every location in the ring as a button too (greyed out until it opens).
    places.forEach((p, i) => button(this, MX + (i % 4) * 152, MY + MH + 6 + Math.floor(i / 4) * 28, 146, 24, p.name,
      () => this.visit(p), { fontSize: p.name.length > 20 ? 10 : 12, enabled: !!p.scene }));

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
      const block = departBlock(state);
      button(this, RX + 12, 196, 284, 32, !block ? 'Set out from the city gate' : state.lastQuestDay === state.day ? 'Back from a quest today: rest first' : 'Leader injured: recover first', () => this.depart(), {
        fill: 0x4a2a22, fontSize: 14, enabled: !block,
      });
    } else {
      const done = state.lastQuestDay === state.day;
      text(this, RX + 12, 106, done ? 'Back from a quest today. Accept the next one any time; you can set out tomorrow.' : 'None. Visit the Adventurer Guild\'s quest board (Outer Ring).', { fontSize: '14px', wordWrap: { width: 284 } });
      button(this, RX + 12, 196, 284, 32, 'Go to the Adventurer Guild', () => this.scene.start('Guild'), { fontSize: 14 });
    }

    panel(this, RX, 246, 308, HEIGHT - 262);
    text(this, RX + 12, 254, 'Recent events', { fontSize: '13px', color: COLORS.dim });
    const list = new ScrollList(this, RX + 10, 276, 292, HEIGHT - 300, 6);
    const entries = [...state.log].reverse();
    list.setItems(entries.map((n) => {
      const t = text(this, 0, 0, `Day ${n.day}: ${n.text}`, { fontSize: '12px', wordWrap: { width: 278 }, lineSpacing: 1 });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    }), 'top');

    // ---- bottom ---------------------------------------------------------------------------------
    button(this, 16, HEIGHT - 60, 136, 46, 'Main Menu', () => this.scene.start('MainMenu'), { fontSize: 15 });
    button(this, 160, HEIGHT - 60, 136, 46, 'Save Game', () => this.scene.start('SaveLoad', { mode: 'save', returnTo: 'City' }), { fontSize: 15 });
    button(this, 304, HEIGHT - 60, 150, 46, 'Manage Party', () => this.scene.start('Party'), { fontSize: 15 });
    button(this, 462, HEIGHT - 60, 158, 46, 'Sleep outside\n(free)', () => this.sleepOut(), { fontSize: 13, fill: 0x2a3348 });

    if (prisonersAtGate(state)) this.gate();
  }

  /**
   * The city gate: prisoners brought back from a quest must each be registered before the party goes on,
   * turned in for the bounty or registered as the party's slave for a fixed fee. The party never keeps prisoners.
   */
  private gate(): void {
    const state = requireState();
    const fee = GUILD.slave.registrationFee;
    const full = state.party.length >= GUILD.maxRoster;
    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.7).setOrigin(0).setInteractive());
    const X = WIDTH / 2 - 330;
    layer.add(panel(this, X, 40, 660, HEIGHT - 80));
    layer.add(text(this, WIDTH / 2, 54, 'City gate: register your prisoners', { fontSize: '22px', color: COLORS.gold }).setOrigin(0.5, 0));
    layer.add(text(this, X + 20, 88, `The guards won't let prisoners into ${GUILD.city} unregistered. Turn each one in for the bounty, or register them as your slave (${fee} gold).${full ? ` Your party is full (${GUILD.maxRoster}), so you can only turn them in.` : ''}  Gold: ${state.gold}.`, {
      fontSize: '13px', wordWrap: { width: 620 }, lineSpacing: 2,
    }));
    const list = new ScrollList(this, X + 14, 140, 632, HEIGHT - 252, 4);
    list.root.setDepth(1001);
    list.setItems(state.prisoners.map((o) => {
      const c = o.character;
      const row = this.add.container(0, 0);
      row.add(this.add.rectangle(0, 0, 620, 80, COLORS.panelLight, 0.5).setOrigin(0));
      row.add(figure(this, 30, 72, 60, c.appearance, c.weaponId, { base: false }));
      const name = text(this, 64, 6, c.name, { fontSize: '16px' });
      row.add(name);
      row.add(talentTag(this, 64 + name.width + 12, 9, c, { fontSize: 12, detail: false }));
      row.add(text(this, 64, 28, `Level ${c.level} (${adventurerRank(c.level)}-rank) · ${WEAPONS[c.weaponId].name}`, { fontSize: '13px', color: COLORS.gold }));
      row.add(talentTag(this, 64, 48, c, { fontSize: 11, overall: false, sep: '   ' }));
      row.add(button(this, 360, 22, 120, 36, `Bounty: ${o.price}g`, () => {
        const gold = turnInPrisoner(state, c.id);
        markDirty();
        this.render();
        toast(this, `${c.name} is taken away. Bounty: ${gold} gold.`);
      }, { fontSize: 13 }));
      row.add(button(this, 488, 22, 120, 36, `Slave: ${fee}g`, () => {
        const err = registerPrisoner(state, c.id);
        if (err) return toast(this, err, COLORS.bad);
        markDirty();
        this.render();
        toast(this, `${c.name} is registered as your slave. Set their food and loadout in Manage Party.`);
      }, { fontSize: 13, enabled: !full && state.gold >= fee }));
      return { obj: row, height: 80 };
    }), 'top');
    const total = state.prisoners.reduce((sum, o) => sum + o.price, 0);
    layer.add(button(this, WIDTH / 2 - 140, HEIGHT - 94, 280, 40, `Turn them all in: ${total} gold`, () => {
      const names = state.prisoners.map((o) => o.character.id);
      let gold = 0;
      for (const id of names) gold += turnInPrisoner(state, id);
      markDirty();
      this.render();
      toast(this, `Bounties: ${gold} gold.`);
    }, { fontSize: 14 }));
  }

  /** End the day without an inn: free, but housed companions resent it. */
  private sleepOut(): void {
    const state = requireState();
    confirmDialog(this, `Sleep outside tonight?\nIt's free, but companions you house lose relationship (more if they expect a high-end inn). Or find an inn (Outer and Inner Ring).`, () => {
      const msgs = sleepOutside(state, Math.random);
      markDirty();
      this.render();
      toast(this, `Day ${state.day}. ${msgs.length ? msgs[msgs.length - 1] : 'A cold night under the stars.'}`);
    }, 'Sleep outside');
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
    if (p.scene) this.scene.start(p.scene, p.data);
    else toast(this, `${p.name} is not open yet.`, COLORS.dim);
  }

  private depart(): void {
    const state = requireState();
    const q = state.quest;
    const block = departBlock(state);
    if (!q || block) return toast(this, block ?? 'Accept a quest at the Adventurer Guild first.', COLORS.bad);
    const members = lineupMembers(state);
    confirmDialog(this, `Set out: ${q.title}?\n${members.map((c) => `${c.name} (Lv ${c.level})`).join(', ')}`, () => this.scene.start('Battle'), 'Set out');
  }
}
