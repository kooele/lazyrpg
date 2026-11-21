import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { CampScene } from './scenes/CampScene';
import { CharacterCreatorScene } from './scenes/CharacterCreatorScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { SaveLoadScene } from './scenes/SaveLoadScene';
import { session } from './game/session';
import { COLORS, HEIGHT, UI_SCALE, WIDTH } from './ui/widgets';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // Render at the screen's real resolution; scenes zoom their camera by UI_SCALE.
  width: Math.round(WIDTH * UI_SCALE),
  height: Math.round(HEIGHT * UI_SCALE),
  backgroundColor: COLORS.bg,
  antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MainMenuScene, CampScene, CharacterCreatorScene, SaveLoadScene, BattleScene],
});

// Handy for debugging from the browser console: `lazyrpg.scene.getScenes(true)`,
// `lazyrpgSession.state.progress.stage = 4`.
Object.assign(window as unknown as Record<string, unknown>, { lazyrpg: game, lazyrpgSession: session });
