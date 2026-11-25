import Phaser from 'phaser';
import { GUILD } from '../data/guild';
import { WEAPONS } from '../data/content';
import { departBlock, endDay, foodCost, forecastNight, lineupMembers, lodgingCost, prisonersAtGate, registerPrisoner, turnInPrisoner, type NightForecast } from '../game/city';
import { adventurerRank } from '../game/guild';
import { moraleOf } from '../game/condition';
import { bondOf, registrationFee, slaveTax } from '../game/contracts';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader, rankBadge } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, UI_SCALE, WIDTH, bakeGraphics, button, confirmDialog, figure, panel, setupCamera, talentTag, text, toast, clearScene } from '../ui/widgets';

export const CITY_MAP_KEY = 'city-map';

/** The two parts of the city, split by the inner wall (each is a map tab). */
type District = 'outer' | 'inner';
const DISTRICTS: [District, string][] = [['outer', 'Outer City'], ['inner', 'Inner City']];

interface Place {
  name: string;
  blurb: string;
  /** Pin position in the map image (1536x1024 pixels). */
  at: [number, number];
  /** Scene to open (and its data); places without one aren't open yet. */
  scene?: string;
  data?: object;
}

/**
 * Locations by district. Outer City: between the outer and inner walls, plus the harbour to the east
 * (the Adventurer Guild is the domed hall on the plaza in the south-west). Inner City: inside the inner wall,
 * with the cathedral, the manor and a triumphal arch (a monument, not a location) at its centre.
 */
const PLACES: Record<District, Place[]> = {
  outer: [
    { name: 'Adventurer Guild', blurb: 'Quest board, hire mercenaries and companions, the party leaderboard.', at: [350, 628], scene: 'Guild' },
    { name: 'Docks', blurb: 'Ships from across the sea.', at: [1360, 660] },
    { name: 'Marketplace', blurb: 'Stalls and traders by the harbour warehouses.', at: [1240, 235] },
    { name: 'Slave Market', blurb: 'Buy slaves, or sell your own.', at: [1160, 613], scene: 'Market' },
    { name: 'Slums', blurb: 'The poorest quarter, crowded against the outer wall.', at: [470, 765] },
    { name: 'Customs Office', blurb: 'Duties on everything that comes through the harbour.', at: [1335, 525] },
    { name: 'Tailor', blurb: 'Clothes and fittings.', at: [497, 167] },
    { name: 'Auction House', blurb: 'Rare goods to the highest bidder.', at: [1010, 173] },
    { name: 'Church', blurb: 'Prayer and healing.', at: [277, 343] },
    { name: GUILD.inns.standard.name, blurb: `Inn: drinks for the party. Members can lodge here for ${GUILD.inns.standard.pricePerPerson} gold a night (Manage Party); what adventurers expect.`, at: [255, 480], scene: 'Inn', data: { tier: 'standard' } },
    { name: GUILD.residences.outer.name, blurb: `A home of your own (${GUILD.residences.outer.price} gold at the Estate Office): free nights for up to ${GUILD.residences.capacity}, as good as an inn.`, at: [900, 805], scene: 'Inn', data: { ring: 'outer' } },
  ],
  inner: [
    { name: "Lord's Manor", blurb: 'Seat of the Lord of Arch City.', at: [860, 378] },
    { name: 'Central Church', blurb: 'The great cathedral at the heart of the city.', at: [655, 375] },
    { name: 'Central Government Office', blurb: 'Permits, taxes and the city\'s business, in the long hall beside the Lord\'s Manor.', at: [890, 425] },
    { name: 'Library', blurb: 'Books, maps and old records.', at: [530, 300] },
    { name: 'Estate Office', blurb: 'Buy and sell residences across the city.', at: [990, 330], scene: 'Estate' },
    { name: GUILD.inns.highEnd.name, blurb: `High-end inn: drinks for the party. Lodging ${GUILD.inns.highEnd.pricePerPerson} gold a night (Manage Party); better than adventurers expect.`, at: [995, 570], scene: 'Inn', data: { tier: 'highEnd' } },
    { name: GUILD.inns.luxury.name, blurb: `Luxury inn: drinks for the party. Lodging ${GUILD.inns.luxury.pricePerPerson} gold a night (Manage Party); far better than adventurers expect.`, at: [880, 500], scene: 'Inn', data: { tier: 'luxury' } },
    { name: GUILD.residences.middle.name, blurb: `A townhouse inside the inner wall (${GUILD.residences.middle.price} gold at the Estate Office): free nights for up to ${GUILD.residences.capacity}, as good as a high-end inn.`, at: [520, 585], scene: 'Inn', data: { ring: 'middle' } },
    { name: GUILD.residences.inner.name, blurb: `A mansion by the cathedral (${GUILD.residences.inner.price} gold at the Estate Office): free nights for up to ${GUILD.residences.capacity}, as good as a luxury inn.`, at: [640, 505], scene: 'Inn', data: { ring: 'inner' } },
  ],
};

/** Part of the map image each tab shows (x, y, width; height follows the frame). */
const VIEWS: Record<District, { x: number; y: number; w: number }> = {
  outer: { x: 0, y: 0, w: 1536 },
  inner: { x: 380, y: 190, w: 760 },
};

/** Arch City: the hub. Pick a district and a location, end the day, or set out on an accepted quest. */
export class CityScene extends Phaser.Scene {
  private tip!: Phaser.GameObjects.Text;
  private district: District = 'outer';

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
    clearScene(this);
    const state = requireState();
    cityHeader(this, state, GUILD.city, () => this.menu());

    // ---- district tabs and the map -------------------------------------------------------------
    DISTRICTS.forEach(([id, label], i) => button(this, 16 + i * 294, 72, 286, 30, label, () => {
      this.district = id;
      this.render();
    }, { selected: this.district === id, fontSize: 15 }));
    const MX = 16;
    const MY = 108;
    const MW = 580;
    const MH = Math.round((MW * 1024) / 1536);
    const view = VIEWS[this.district];
    const k = MW / view.w;
    const toMap = (x: number, y: number): [number, number] => [MX + (x - view.x) * k, MY + (y - view.y) * k];
    if (this.textures.exists(CITY_MAP_KEY)) {
      this.add.image(MX - view.x * k, MY - view.y * k, CITY_MAP_KEY).setOrigin(0).setScale(k)
        .setCrop(view.x, view.y, view.w, view.w * (MH / MW));
    }
    this.add.rectangle(MX, MY, MW, MH).setOrigin(0).setStrokeStyle(2, COLORS.border);

    const places = PLACES[this.district];
    for (const p of places) this.pin(p, ...toMap(...p.at));
    this.tip = text(this, MX + 8, MY + MH - 30, 'Click a location.', {
      fontSize: '13px', color: COLORS.text, backgroundColor: '#000000b0', padding: { x: 8, y: 4 }, wordWrap: { width: MW - 40 },
    }).setDepth(10);

    // Every location in the district as a button too (greyed out until it opens).
    places.forEach((p, i) => button(this, MX + (i % 4) * 145, MY + MH + 6 + Math.floor(i / 4) * 25, 140, 23, p.name,
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
      button(this, RX + 12, 196, 284, 32, !block ? 'Set out from the city gate' : state.lastQuestDay === state.day ? 'Back from a quest today: rest first' : 'No adventurers in the lineup', () => this.depart(), {
        fill: 0x4a2a22, fontSize: 14, enabled: !block,
      });
    } else {
      const done = state.lastQuestDay === state.day;
      text(this, RX + 12, 106, done ? 'Back from a quest today. Accept the next one any time; you can set out tomorrow.' : 'None. Visit the Adventurer Guild\'s quest board (Outer City).', { fontSize: '14px', wordWrap: { width: 284 } });
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
    button(this, 16, HEIGHT - 60, 296, 46, 'Manage Party', () => this.scene.start('Party'), { fontSize: 16 });
    button(this, 324, HEIGHT - 60, 296, 46, `End Day (${forecastNight(requireState()).total} gold)`, () => this.endDay(), { fontSize: 16, fill: 0x2a3348 });

    if (prisonersAtGate(state)) this.gate();
  }

  /**
   * The city gate: prisoners brought back from a quest must each be registered before the party goes on,
   * turned in for the bounty or registered as the party's slave for a fee (its market value minus its bounty). The party never keeps prisoners.
   */
  private gate(): void {
    const state = requireState();
    const full = state.party.length >= GUILD.maxRoster;
    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.7).setOrigin(0).setInteractive());
    const X = WIDTH / 2 - 330;
    layer.add(panel(this, X, 40, 660, HEIGHT - 80));
    layer.add(text(this, WIDTH / 2, 54, 'City gate: register your prisoners', { fontSize: '22px', color: COLORS.gold }).setOrigin(0.5, 0));
    layer.add(text(this, X + 20, 88, `The guards won't let prisoners into ${GUILD.city} unregistered. Turn each one in for the bounty, or register them as your slave: the fee is their market value minus the bounty, and slaves are taxed weekly.${full ? ` Your party is full (${GUILD.maxRoster}), so you can only turn them in.` : ''}  Gold: ${state.gold}.`, {
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
      const fee = registrationFee(o);
      row.add(button(this, 488, 22, 120, 36, `Slave: ${fee}g\n(tax ${slaveTax(c)}g/wk)`, () => {
        const err = registerPrisoner(state, c.id);
        if (err) return toast(this, err, COLORS.bad);
        markDirty();
        this.render();
        toast(this, `${c.name} is registered as your slave. Set their food and loadout in Manage Party.`);
      }, { fontSize: 12, enabled: !full && state.gold >= fee }));
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

  /** The ☰ menu under the header's menu button: save, load, the guide, settings, or back to the title screen. Click outside to close. */
  private menu(): void {
    const items: [string, () => void][] = [
      ['Save Game', () => this.scene.start('SaveLoad', { mode: 'save', returnTo: 'City' })],
      ['Load Game', () => this.scene.start('SaveLoad', { mode: 'load', returnTo: 'City' })],
      ['Guide', () => this.scene.start('Glossary', { returnTo: 'City' })],
      ['Settings', () => this.scene.start('Settings', { returnTo: 'City' })],
      ['Main Menu', () => this.scene.start('MainMenu')],
    ];
    const layer = this.add.container(0, 0).setDepth(900);
    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.35).setOrigin(0).setInteractive();
    shade.on('pointerup', () => layer.destroy());
    layer.add([shade, panel(this, 12, 58, 200, items.length * 44 + 12)]);
    items.forEach(([label, go], i) => layer.add(button(this, 18, 64 + i * 44, 188, 38, label, () => {
      layer.destroy();
      go();
    }, { fontSize: 15 })));
  }

  /** End the day: everyone the party houses sleeps where they lodge (set in Manage Party), and the next day begins. */
  private endDay(): void {
    this.endDayDialog(forecastNight(requireState()));
  }

  /**
   * Confirm End Day with its bill: tonight's food and lodging, the quest tab, payday, and contracts that lapse. When
   * the party can't pay it all, what goes unpaid and what that will cost, with a way to Manage Party (cheaper
   * lodging, sell slaves) before going ahead.
   */
  private endDayDialog(f: NightForecast): void {
    const state = requireState();
    const short = f.shortfall > 0;
    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.7).setOrigin(0).setInteractive());
    const W = 560;
    const X = WIDTH / 2 - W / 2;
    const sum = (r: Record<string, number> = {}) => Object.values(r).reduce((t, g) => t + g, 0);
    const tabWages = sum(state.tab?.wages);
    const tabTaxes = sum(state.tab?.taxes);
    const lines = [`Tonight: ${f.upkeep} gold (lodging ${lodgingCost(state, 'city')} + food ${foodCost(state)}).`];
    if (f.tab) {
      const parts = [`food and lodging ${state.tab?.upkeep ?? 0}`, tabWages ? `wages ${tabWages}` : '', tabTaxes ? `slave tax ${tabTaxes}` : ''].filter(Boolean);
      lines.push(`Accumulated tab: ${f.tab} gold (${parts.join(', ')}).`);
    }
    const payWages = f.wages - tabWages;
    const payTaxes = f.taxes - tabTaxes;
    if (f.payday && payWages + payTaxes) lines.push(`Tomorrow is payday: wages ${payWages}${payTaxes ? ` + slave tax ${payTaxes}` : ''} gold.`);
    for (const l of f.lapses) lines.push(`${l.name}'s contract lapses tonight${l.owed ? `: final wages ${l.owed} gold` : ''}.`);
    if (f.income) lines.push(`Odd jobs bring in ${f.income} gold first.`);
    lines.push(short ? `You have ${f.gold} gold of the ${f.total} needed: ${f.shortfall} short.` : `In all: ${f.total} gold of your ${f.gold}.`);
    const effects: string[] = [];
    if (f.unfed) effects.push(`• No food or lodging: your gold goes to 0 and everyone you house loses 5 relationship.`);
    for (const u of f.unpaid) {
      effects.push(`• ${u.name} goes unpaid (${u.due} gold): relationship ${GUILD.companion.relationshipUnpaid}${u.quits ? `, and they will quit${u.renown >= 1 ? ` (renown -${Math.round(u.renown)})` : ''}` : ''}.`);
    }
    for (const s of f.seized) effects.push(`• The city seizes ${s.name} for the slave market (tax ${s.tax} gold).`);
    for (const u of f.unpaidFinal) effects.push(`• ${u.name} leaves without their final wages (${u.owed} gold)${u.renown >= 1 ? `: renown -${Math.round(u.renown)}` : ''}.`);
    const wrap = { wordWrap: { width: W - 48 } };
    const body = text(this, X + 24, 0, lines.join('\n'), { fontSize: '14px', lineSpacing: 3, ...wrap });
    const warn = short ? text(this, X + 24, 0, `If you end the day now:\n${effects.join('\n')}`, { fontSize: '14px', color: COLORS.bad, lineSpacing: 3, ...wrap }) : null;
    const hint = text(this, X + 24, 0, short
      ? 'In Manage Party you can move members to cheaper lodging or sell slaves to raise gold.'
      : 'Set where each member lodges in Manage Party.', { fontSize: '13px', color: COLORS.dim, ...wrap });
    const H = 60 + body.height + 14 + (warn ? warn.height + 14 : 0) + hint.height + 20 + 46 + 20;
    const Y = Math.max(20, HEIGHT / 2 - H / 2);
    layer.add(panel(this, X, Y, W, H));
    layer.add(text(this, WIDTH / 2, Y + 16, short ? 'You can\'t pay everything that\'s due' : 'End the day?', { fontSize: '20px', color: COLORS.gold }).setOrigin(0.5, 0));
    body.setY(Y + 60);
    if (warn) warn.setY(body.y + body.height + 14);
    hint.setY((warn ?? body).y + (warn ?? body).height + 14);
    layer.add([body, ...(warn ? [warn] : []), hint]);
    const by = Y + H - 66;
    const bw = (W - 48 - 24) / 3;
    layer.add(button(this, X + 24, by, bw, 46, 'Manage Party', () => this.scene.start('Party'), { fontSize: 15 }));
    layer.add(button(this, X + 24 + bw + 12, by, bw, 46, 'Cancel', () => layer.destroy(), { fontSize: 15 }));
    layer.add(button(this, X + 24 + (bw + 12) * 2, by, bw, 46, short ? 'End Day anyway' : 'End Day', () => {
      layer.destroy();
      this.runEndDay();
    }, { fontSize: 15, fill: short ? 0x4a2a22 : 0x2a3348 }));
  }

  private runEndDay(): void {
    const state = requireState();
    // Before the night: gold, everyone's Morale and companions' and slaves' relationship, for the summary.
    const gold = state.gold;
    const before = state.party.map((c) => ({ id: c.id, name: c.name, morale: moraleOf(c), rel: bondOf(c)?.relationship }));
    const msgs = endDay(state, Math.random);
    markDirty();
    this.render();
    this.daySummary(gold, before, msgs);
  }

  /**
   * The summary after End Day: gold spent or earned, each member's Morale and each companion's and slave's
   * relationship change over the night (or that they left), and everything that happened.
   */
  private daySummary(gold: number, before: { id: string; name: string; morale: number; rel?: number }[], msgs: string[]): void {
    const state = requireState();
    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.7).setOrigin(0).setInteractive());
    const W = 600;
    const X = WIDTH / 2 - W / 2;
    layer.add(panel(this, X, 40, W, HEIGHT - 80));
    layer.add(text(this, WIDTH / 2, 54, `Day ${state.day} begins`, { fontSize: '24px', color: COLORS.gold }).setOrigin(0.5, 0));
    const dGold = state.gold - gold;
    layer.add(text(this, WIDTH / 2, 88, `Gold: ${gold} → ${state.gold} (${dGold >= 0 ? '+' : ''}${dGold})`, {
      fontSize: '14px', color: dGold < 0 ? COLORS.text : COLORS.good,
    }).setOrigin(0.5, 0));

    const items: { obj: Phaser.GameObjects.Container; height: number }[] = [];
    const add = (t: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const obj = text(this, 0, 0, t, { fontSize: '13px', wordWrap: { width: W - 60 }, lineSpacing: 2, ...style });
      items.push({ obj: this.add.container(0, 0, [obj]), height: obj.height });
    };
    const change = (name: string, from: number, to: number) => {
      const d = Math.round(to) - Math.round(from);
      add(`  ${name}: ${Math.round(from)} → ${Math.round(to)}  (${d > 0 ? '+' : ''}${d})`, { color: d > 0 ? COLORS.good : d < 0 ? COLORS.bad : COLORS.dim });
    };
    // Morale: one line per member (food, lodging and the schedule move it every day).
    add('Morale', { fontSize: '15px', color: COLORS.gold });
    for (const b of before) {
      const now = state.party.find((c) => c.id === b.id);
      if (now) change(b.name, b.morale, moraleOf(now));
      else add(`  ${b.name}: left the party`, { color: COLORS.bad });
    }
    // Relationship: one line per companion and slave.
    const bonds = before.filter((b) => b.rel !== undefined);
    if (bonds.length) {
      add('Relationships', { fontSize: '15px', color: COLORS.gold });
      for (const b of bonds) {
        const now = state.party.find((c) => c.id === b.id);
        const bond = now && bondOf(now);
        if (!bond) {
          add(`  ${b.name}: left the party`, { color: COLORS.bad });
          continue;
        }
        change(b.name, b.rel!, bond.relationship);
      }
    }
    add('What happened', { fontSize: '15px', color: COLORS.gold });
    if (!msgs.length) add('  A quiet night.', { color: COLORS.dim });
    for (const m of msgs) add(`• ${m}`);

    const list = new ScrollList(this, X + 20, 116, W - 30, HEIGHT - 226, 4);
    list.root.setDepth(1001);
    list.setItems(items, 'top');
    layer.add(button(this, WIDTH / 2 - 80, HEIGHT - 94, 160, 40, 'Continue', () => {
      list.destroy();
      layer.destroy();
    }, { fontSize: 15 }));
  }

  /** A map pin: gold for open locations, grey for ones that aren't open yet. */
  private pin(p: Place, x: number, y: number): void {
    const open = !!p.scene;
    // Four looks (open or not, hovered or not), each drawn once into a shared texture.
    const bounds = { x: -10, y: -10, w: 22, h: 23 };
    const look = (hover: boolean) => {
      const key = `city-pin-${open ? 'open' : 'closed'}-${hover ? 'hover' : 'idle'}`;
      const g = this.make.graphics({}, false);
      g.fillStyle(0x000000, 0.4).fillCircle(1, 2, 9);
      g.fillStyle(open ? (hover ? 0xffd77a : COLORS.accent) : (hover ? 0xb0b6c8 : 0x7a8296), 1).fillCircle(0, 0, 8);
      g.lineStyle(2, 0x1a1410, 1).strokeCircle(0, 0, 8);
      g.fillStyle(0x1a1410, 1).fillCircle(0, 0, 2.5);
      const img = bakeGraphics(this, g, bounds, key);
      img.destroy();
      return key;
    };
    const idle = look(false);
    const hovered = look(true);
    const pinImg = this.add.image(x + bounds.x, y + bounds.y, idle).setOrigin(0);
    pinImg.setDisplaySize(Math.ceil(bounds.w * UI_SCALE) / UI_SCALE, Math.ceil(bounds.h * UI_SCALE) / UI_SCALE);
    const draw = (hover: boolean) => {
      if (this.textures.exists(idle)) pinImg.setTexture(hover ? hovered : idle);
    };
    const label = text(this, x, y - 12, p.name, {
      fontSize: '12px', color: open ? '#f4ecd8' : '#b8bccb', backgroundColor: '#14182acc', padding: { x: 5, y: 2 },
    }).setOrigin(0.5, 1);
    // A zone, not an invisible circle: zones aren't drawn.
    const hit = this.add.zone(x, y, 28, 28).setInteractive({ hitArea: new Phaser.Geom.Circle(14, 14, 14), hitAreaCallback: Phaser.Geom.Circle.Contains, useHandCursor: true });
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
