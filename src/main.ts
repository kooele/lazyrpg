import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { CharacterCreatorScene } from './scenes/CharacterCreatorScene';
import { DemoCampScene } from './scenes/DemoCampScene';
import { CityScene } from './scenes/CityScene';
import { GuildScene } from './scenes/GuildScene';
import { InnScene } from './scenes/InnScene';
import { MarketScene } from './scenes/MarketScene';
import { NegotiateScene } from './scenes/NegotiateScene';
import { PartyScene } from './scenes/PartyScene';
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
  scene: [BootScene, MainMenuScene, CityScene, GuildScene, MarketScene, InnScene, NegotiateScene, PartyScene, DemoCampScene, CharacterCreatorScene, SaveLoadScene, BattleScene],
});

// Handy for debugging from the browser console: `lazyrpg.scene.getScenes(true)`,
// `lazyrpgSession.state.gold = 5000`.
Object.assign(window as unknown as Record<string, unknown>, { lazyrpg: game, lazyrpgSession: session });
