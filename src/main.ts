import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { CharacterCreatorScene } from './scenes/CharacterCreatorScene';
import { DemoCampScene } from './scenes/DemoCampScene';
import { EstateScene } from './scenes/EstateScene';
import { CityScene } from './scenes/CityScene';
import { GuildScene } from './scenes/GuildScene';
import { InnScene } from './scenes/InnScene';
import { MarketScene } from './scenes/MarketScene';
import { NegotiateScene } from './scenes/NegotiateScene';
import { PartyScene } from './scenes/PartyScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { SaveLoadScene } from './scenes/SaveLoadScene';
import { GlossaryScene } from './scenes/GlossaryScene';
import { EquipmentScene } from './scenes/EquipmentScene';
import { SmithyScene } from './scenes/SmithyScene';
import { MarketplaceScene } from './scenes/MarketplaceScene';
import { session } from './game/session';
import { STARTUP_GRAPHICS } from './game/settings';
import { SettingsScene } from './scenes/SettingsScene';
import { COLORS, HEIGHT, UI_SCALE, WIDTH } from './ui/widgets';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // Render at the Resolution setting; scenes zoom their camera by UI_SCALE.
  width: Math.round(WIDTH * UI_SCALE),
  height: Math.round(HEIGHT * UI_SCALE),
  backgroundColor: COLORS.bg,
  antialias: true,
  // A turn-based game gains little past 60 frames a second; the player picks the cap in Settings.
  fps: { limit: STARTUP_GRAPHICS.frameCap },
  // Which graphics chip to ask for on computers with two (Settings).
  render: { powerPreference: STARTUP_GRAPHICS.gpu },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MainMenuScene, CityScene, GuildScene, MarketScene, InnScene, EstateScene, NegotiateScene, PartyScene, EquipmentScene, SmithyScene, MarketplaceScene, DemoCampScene, CharacterCreatorScene, SaveLoadScene, GlossaryScene, SettingsScene, BattleScene],
});

// Handy for debugging from the browser console: `lazyrpg.scene.getScenes(true)`,
// `lazyrpgSession.state.gold = 5000`.
Object.assign(window as unknown as Record<string, unknown>, { lazyrpg: game, lazyrpgSession: session });
