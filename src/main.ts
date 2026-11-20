import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { CampScene } from './scenes/CampScene';
import { CharacterCreatorScene } from './scenes/CharacterCreatorScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { SaveLoadScene } from './scenes/SaveLoadScene';
import { COLORS, HEIGHT, WIDTH } from './ui/widgets';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: COLORS.bg,
  // Needed for the HTML <input> used to type character names.
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MainMenuScene, CampScene, CharacterCreatorScene, SaveLoadScene, BattleScene],
});

// Handy for debugging from the browser console: `lazyrpg.scene.getScenes(true)`.
(window as unknown as { lazyrpg: Phaser.Game }).lazyrpg = game;
