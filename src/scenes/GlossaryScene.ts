import Phaser from 'phaser';
import { GLOSSARY_TOPICS, glossaryEntries, type GlossaryEntry, type GlossaryTopic } from '../game/glossary';
import { COLORS, HEIGHT, WIDTH, ScrollList, button, panel, setupCamera, text, clearScene } from '../ui/widgets';

/**
 * The Guide: explanations of the game's less obvious rules, by topic. Opened from the main menu and the city;
 * `returnTo` is the scene to go back to.
 */
export class GlossaryScene extends Phaser.Scene {
  private returnTo = 'MainMenu';
  private topic: GlossaryTopic = GLOSSARY_TOPICS[0];
  private selected = '';
  private entries: GlossaryEntry[] = [];

  constructor() {
    super('Glossary');
  }

  init(data: { returnTo?: string; topic?: GlossaryTopic }): void {
    this.returnTo = data.returnTo ?? 'MainMenu';
    if (data.topic) this.topic = data.topic;
  }

  create(): void {
    setupCamera(this);
    this.entries = glossaryEntries();
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(this.returnTo));
    this.render();
  }

  private render(): void {
    clearScene(this);
    text(this, 24, 14, 'Guide', { fontSize: '30px', color: COLORS.gold });
    text(this, 128, 26, 'How the less obvious rules work. Numbers are the game\'s current settings.', { fontSize: '14px', color: COLORS.dim });

    // Topic tabs.
    const tabW = (WIDTH - 48 - (GLOSSARY_TOPICS.length - 1) * 6) / GLOSSARY_TOPICS.length;
    GLOSSARY_TOPICS.forEach((t, i) => button(this, 24 + i * (tabW + 6), 62, tabW, 32, t, () => {
      this.topic = t;
      this.selected = '';
      this.render();
    }, { selected: this.topic === t, fontSize: 14 }));

    const inTopic = this.entries.filter((e) => e.topic === this.topic);
    const entry = inTopic.find((e) => e.term === this.selected) ?? inTopic[0];
    this.selected = entry?.term ?? '';

    // Left: the topic's terms.
    const TOP = 106;
    const H = HEIGHT - TOP - 70;
    panel(this, 24, TOP, 268, H);
    const list = new ScrollList(this, 32, TOP + 8, 252, H - 16, 4);
    list.setItems(inTopic.map((e) => ({
      obj: this.add.container(0, 0, [button(this, 0, 0, 240, 32, e.term, () => {
        this.selected = e.term;
        this.render();
      }, { selected: e.term === this.selected, fontSize: e.term.length > 26 ? 12 : 14 })]),
      height: 32,
    })), 'top');

    // Right: the selected entry.
    const RX = 304;
    const RW = WIDTH - RX - 24;
    panel(this, RX, TOP, RW, H);
    if (entry) {
      text(this, RX + 20, TOP + 14, entry.term, { fontSize: '22px', color: COLORS.gold });
      text(this, RX + 20, TOP + 54, entry.body, { fontSize: '15px', wordWrap: { width: RW - 40 }, lineSpacing: 4 });
    }

    button(this, 24, HEIGHT - 54, 180, 40, 'Back', () => this.scene.start(this.returnTo), { fontSize: 16 });
    text(this, 220, HEIGHT - 42, 'Esc also goes back.', { fontSize: '13px', color: COLORS.dim });
  }
}
