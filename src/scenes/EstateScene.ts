import Phaser from 'phaser';
import { GUILD, LODGING_QUALITY, RINGS, type Ring } from '../data/guild';
import { buyResidence, residenceSellPrice, residents, sellResidence } from '../game/city';
import { QUALITY_TEXT } from '../game/condition';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, panel, setupCamera, text, toast, clearScene } from '../ui/widgets';

/** Which part of the city each residence is in (the townhouse and the mansion are both in the Inner City). */
const DISTRICT: Record<Ring, string> = { outer: 'Outer City', middle: 'Inner City', inner: 'Inner City' };
const BLURB: Record<Ring, string> = {
  outer: 'A sturdy townhouse inside the outer wall, a short walk from the guild.',
  middle: 'A handsome townhouse inside the inner wall, among merchants and guild masters.',
  inner: 'A mansion in the heart of the Inner City, a street away from the Lord\'s Manor.',
};

/** The Estate Office (Inner City): buy and sell the party's residences. */
export class EstateScene extends Phaser.Scene {
  constructor() {
    super('Estate');
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
    cityHeader(this, state, 'Estate Office');
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    text(this, 20, 82, `Free nights for up to ${GUILD.residences.capacity} residents each, as good as an inn of the same standing.\nThe office buys one back for ${Math.round(GUILD.residences.sellShare * 100)}% of its price. Choose residents in Manage Party.`, {
      fontSize: '13px', color: COLORS.dim, wordWrap: { width: WIDTH - 220 }, lineSpacing: 3,
    });

    RINGS.forEach((ring, i) => {
      const home = GUILD.residences[ring];
      const owned = state.residences.includes(ring);
      const x = 16 + i * 312;
      const y = 130;
      const w = 300;
      panel(this, x, y, w, HEIGHT - 146, owned ? 0x1f2a1f : COLORS.panel);
      text(this, x + 14, y + 12, home.name, { fontSize: '19px', color: owned ? '#6fdc8c' : COLORS.text, wordWrap: { width: w - 28 } });
      text(this, x + 14, y + 40, DISTRICT[ring], { fontSize: '13px', color: COLORS.dim });
      text(this, x + 14, y + 70, BLURB[ring], { fontSize: '13px', wordWrap: { width: w - 28 }, lineSpacing: 3 });
      const q = LODGING_QUALITY[ring];
      text(this, x + 14, y + 140, `Night quality ${q} of 3: counts as ${QUALITY_TEXT[q]}.`, { fontSize: '12px', color: COLORS.dim, wordWrap: { width: w - 28 } });
      text(this, x + 14, y + 190, `Price: ${home.price} gold`, { fontSize: '18px', color: COLORS.gold });
      text(this, x + 14, y + 216, `Sells back for ${residenceSellPrice(ring)} gold`, { fontSize: '12px', color: COLORS.dim });
      if (owned) {
        text(this, x + 14, y + 250, 'You own this residence.', { fontSize: '14px', color: '#6fdc8c' });
        const people = residents(state, ring);
        text(this, x + 14, y + 274, `Residents ${people.length}/${GUILD.residences.capacity}: ${people.map((c) => c.name).join(', ') || 'nobody yet'}`, {
          fontSize: '12px', color: COLORS.dim, wordWrap: { width: w - 28 }, lineSpacing: 2,
        });
        button(this, x + 14, HEIGHT - 120, w - 28, 40, 'Go there', () => this.scene.start('Inn', { ring }), { fontSize: 14, fill: 0x2c4a2f });
        button(this, x + 14, HEIGHT - 72, w - 28, 40, `Sell for ${residenceSellPrice(ring)} gold`, () => confirmDialog(this,
          `Sell the ${home.name} for ${residenceSellPrice(ring)} gold?${residents(state, ring).length ? '\nIts residents will sleep in the stables until you move them.' : ''}`, () => {
            const gold = sellResidence(state, ring);
            markDirty();
            this.render();
            toast(this, `Sold for ${gold} gold.`);
          }, 'Sell'), { fontSize: 14 });
      } else {
        button(this, x + 14, HEIGHT - 72, w - 28, 40, `Buy for ${home.price} gold`, () => confirmDialog(this, `Buy the ${home.name} for ${home.price} gold?`, () => {
          const err = buyResidence(state, ring);
          if (err) return toast(this, err, COLORS.bad);
          markDirty();
          this.render();
          toast(this, 'The keys are yours. Move members in from Manage Party.');
        }, 'Buy'), { fontSize: 14, enabled: state.gold >= home.price, fill: 0x2c4a2f });
        if (state.gold < home.price) text(this, x + 14, HEIGHT - 96, `You need ${home.price - state.gold} more gold.`, { fontSize: '12px', color: COLORS.bad });
      }
    });
  }
}
