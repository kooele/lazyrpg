import Phaser from 'phaser';
import { newGameState } from '../game/save';
import { session } from '../game/session';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, figure, text, setupCamera } from '../ui/widgets';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    setupCamera(this);
    this.drawBackdrop();

    text(this, WIDTH / 2, 120, 'LAZYRPG', { fontSize: '64px', color: COLORS.gold, fontStyle: 'bold' }).setOrigin(0.5);
    text(this, WIDTH / 2, 180, 'T A C T I C S', { fontSize: '20px', color: COLORS.dim }).setOrigin(0.5);

    const inGame = session.state !== null;
    const items: [string, () => void, boolean][] = [
      ['Continue', () => this.scene.start('Camp'), inGame],
      ['New Game', () => this.newGame(), true],
      ['Save Game', () => this.scene.start('SaveLoad', { mode: 'save' }), inGame],
      ['Load Game', () => this.scene.start('SaveLoad', { mode: 'load' }), true],
    ];
    let y = 250;
    for (const [label, action, enabled] of items) {
      button(this, WIDTH / 2 - 130, y, 260, 50, label, action, { enabled, fontSize: 20 });
      y += 66;
    }

    if (inGame && session.dirty) {
      text(this, WIDTH / 2, y + 10, 'You have unsaved progress.', { color: COLORS.dim, fontSize: '14px' }).setOrigin(0.5);
    }
    text(this, WIDTH / 2, HEIGHT - 24, 'Saves are plain JSON: export one, read it, tweak it, import it back.', {
      fontSize: '13px', color: COLORS.dim,
    }).setOrigin(0.5);
  }

  private newGame(): void {
    const start = () => {
      session.state = newGameState();
      session.dirty = true;
      this.scene.start('CharacterCreator', { mode: 'create', firstCharacter: true });
    };
    if (session.state && session.dirty) {
      confirmDialog(this, 'Start a new game?\nUnsaved progress will be lost.', start, 'New Game');
    } else {
      start();
    }
  }

  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x1d2338, 1);
    for (let x = 0; x <= WIDTH; x += 48) g.lineBetween(x, 0, x, HEIGHT);
    for (let y = 0; y <= HEIGHT; y += 48) g.lineBetween(0, y, WIDTH, y);
    // A little standoff: two adventurers facing two bandits.
    figure(this, 140, 470, 120, { color: '#3d7be0', emblem: 'square', model: 'm1' }, 'sword_shield');
    figure(this, 230, 560, 110, { color: '#36b37e', emblem: 'diamond', model: 'f2' }, 'staff');
    figure(this, 820, 470, 120, { color: '#c0392b', emblem: 'triangle', model: 'm3' }, 'spear', { enemy: true });
    figure(this, 730, 560, 110, { color: '#c0392b', emblem: 'triangle', model: 'f3' }, 'bow', { enemy: true });
  }
}
