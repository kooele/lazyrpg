import Phaser from 'phaser';
import { GUILD, type ChurchId } from '../data/guild';
import { donate, heal, healBlock, healCooldown } from '../game/church';
import { MAX_HEALTH, healthOf } from '../game/condition';
import { figureKit } from '../game/gear';
import { markDirty, requireState, session } from '../game/session';
import { cityHeader } from '../ui/hud';
import { COLORS, HEIGHT, ScrollList, WIDTH, button, clearScene, figure, panel, setupCamera, text, toast } from '../ui/widgets';

const BLURB: Record<ChurchId, string> = {
  church: 'A modest stone church near the outer wall. Donate for a blessing on your next quest, or pay the priests to tend a wounded member.',
  central: 'The great cathedral at the heart of the city. Its blessings are stronger and its healers more skilled, for those who can afford them.',
};

/** A church: donate for a blessing on the next quest, or buy healing for a member (one cooldown shared by both churches). */
export class ChurchScene extends Phaser.Scene {
  private church: ChurchId = 'church';

  constructor() {
    super('Church');
  }

  init(data: { church?: ChurchId }): void {
    this.church = data.church ?? 'church';
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
    const cfg = GUILD.churches[this.church];
    cityHeader(this, state, cfg.name);
    button(this, WIDTH - 176, 74, 160, 34, `Back to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 14 });
    text(this, 20, 82, BLURB[this.church], { fontSize: '14px', wordWrap: { width: WIDTH - 220 }, lineSpacing: 3 });

    // ---- Blessing: donations ---------------------------------------------------------------------
    panel(this, 16, 130, WIDTH - 32, 112);
    text(this, 30, 140, 'Blessing', { fontSize: '16px', color: COLORS.gold });
    const now = state.blessing ?? 0;
    text(this, 120, 143, now ? `Blessed: +${now}% All Stats on the Next Quest` : 'No Blessing Yet', { fontSize: '13px', color: now ? COLORS.good : COLORS.dim });
    const n = cfg.donations.length;
    const bw = (WIDTH - 60 - (n - 1) * 12) / n;
    cfg.donations.forEach((d, i) => {
      const covered = now >= d.blessingPct;
      button(this, 30 + i * (bw + 12), 168, bw, 40, covered ? `Already Blessed: +${now}%` : `Donate ${d.gold} Gold: +${d.blessingPct}% All Stats`, () => {
        const err = donate(state, this.church, i);
        if (err) return toast(this, err, COLORS.bad);
        markDirty();
        this.render();
        toast(this, `The party is blessed: +${d.blessingPct}% to every stat on the next quest.`);
      }, { fontSize: 13, enabled: !covered && state.gold >= d.gold, fill: 0x2c3a4a });
    });
    text(this, 30, 216, 'Raises every battle stat of everyone who goes on the next quest, and fades when it ends. A bigger donation replaces a smaller blessing.', {
      fontSize: '12px', color: COLORS.dim, wordWrap: { width: WIDTH - 60 },
    });

    // ---- Healing: one row per member -------------------------------------------------------------
    const h = cfg.heal;
    const top = 252;
    panel(this, 16, top, WIDTH - 32, HEIGHT - top - 16);
    text(this, 30, top + 10, 'Healing', { fontSize: '16px', color: COLORS.gold });
    text(this, 120, top + 13, `+${h.health} Health at once for ${h.gold} gold. Each member once every ${GUILD.churches.healCooldownDays} days, at either church.`, { fontSize: '12px', color: COLORS.dim });
    const list = new ScrollList(this, 26, top + 40, WIDTH - 52, HEIGHT - top - 66, 6);
    const RW = WIDTH - 70;
    list.setItems(state.party.map((c) => {
      const row = this.add.container(0, 0);
      row.add(this.add.rectangle(0, 0, RW, 64, COLORS.panelLight, 0.5).setOrigin(0));
      row.add(figure(this, 30, 58, 52, c.appearance, figureKit(c), { base: false }));
      row.add(text(this, 64, 8, c.name, { fontSize: '15px' }));
      const hp = healthOf(c);
      row.add(text(this, 64, 32, `Health ${hp}/${MAX_HEALTH}`, { fontSize: '13px', color: hp < MAX_HEALTH ? COLORS.bad : COLORS.good }));
      const wait = healCooldown(state, c);
      const block = healBlock(state, this.church, c);
      const label = hp >= MAX_HEALTH ? 'Full Health' : wait > 0 ? `Healed Recently: Again in ${wait} Day${wait === 1 ? '' : 's'}` : `Heal +${Math.min(h.health, MAX_HEALTH - hp)} Health · ${h.gold} Gold`;
      row.add(button(this, RW - 320, 12, 308, 40, label, () => {
        const err = heal(state, this.church, c.id);
        if (err) return toast(this, err, COLORS.bad);
        markDirty();
        this.render();
        toast(this, `${c.name} is healed: Health ${healthOf(c)}/${MAX_HEALTH}.`);
      }, { fontSize: 13, enabled: !block, fill: 0x2c4a2f }));
      return { obj: row, height: 64 };
    }), 'top');
  }
}
