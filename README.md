# LazyRPG Tactics

A small turn-based tactical RPG that runs in the browser, built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## How the game works

1. **Main menu**: New Game, Continue, Save Game and Load Game.
2. **Character creation**: name, class (Knight, Ranger, Mage, Cleric), color and emblem. You also spend attribute points, pick a weapon and equip skills. Up to 4 heroes per party.
3. **Camp**: the hub between battles. Recruit, customize (spend level-up points, swap weapons and skills) or dismiss heroes, then start the next battle.
4. **Tactical battle**: grid combat with terrain (forest gives +2 defense and costs 2 move; rock and water block movement). Turn order follows Speed. On your turn, move (blue tiles), then Attack, use a skill, or Wait. Right-click or Esc cancels targeting. Winning gives XP and moves you up a stage; enemies get stronger each stage.

### Build system
| Attribute | Effect |
|---|---|
| Strength | Physical damage |
| Dexterity | Hit chance and critical chance |
| Intellect | Magic damage, healing, resistance |
| Vitality | Max HP, defense, resistance |
| Speed | Turn order and evasion. 9+ gives +1 move |

- New heroes get 8 points to spend. Each level gives 3 more (100 XP per level).
- Weapons change range and damage type, and some change attributes (e.g. the Greataxe hits hard but gives -2 Speed).
- Skill slots: 2 at level 1, 3 at level 3, 4 at level 6.

## Save files

Saves are **pretty-printed JSON**. You can save to 3 browser slots (localStorage), or **Export** a `.json` file and **Import** it later or on another device. You can open a save and edit it by hand. The game checks it on load and tells you exactly which field is wrong (e.g. `party[0].weaponId "longbow" cannot be used by a Cleric`).

```json
{
  "format": "lazyrpg-save",
  "version": 1,
  "savedAt": "2026-11-20T21:15:44.230Z",
  "progress": { "stage": 2, "victories": 1, "defeats": 0 },
  "party": [
    {
      "id": "c_3268ddub",
      "name": "Brienne",
      "classId": "cleric",
      "level": 2,
      "xp": 75,
      "attributes": { "str": 4, "dex": 3, "int": 11, "vit": 8, "spd": 3 },
      "unspentPoints": 3,
      "weaponId": "mace",
      "skillIds": ["heal", "smite"],
      "appearance": { "color": "#3d7be0", "emblem": "circle" }
    }
  ]
}
```

IDs for classes, weapons and skills are listed in `src/data/content.ts`.

## Development

```bash
npm install
npm run dev      # local dev server with hot reload
npm test         # rules, save-file and AI tests (Vitest)
npm run build    # type-check + production build into dist/
```

## Project layout

```
src/
  data/       types.ts (save-file shapes), content.ts (classes, weapons, skills, balance numbers)
  game/       pure game logic, no Phaser: character stats, battle rules, AI, map generation, save/load
  scenes/     Phaser scenes: MainMenu, SaveLoad, CharacterCreator, Camp, Battle
  ui/         small UI helpers (buttons, panels, tokens, dialogs)
tests/        Vitest tests for the game logic
```

The rules in `src/game/` don't depend on Phaser. That keeps them easy to test, and the AI and balance can be simulated quickly.

## Publishing on GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys the game on every push to `main`.
One-time setup: open the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The game will then be live at `https://<your-username>.github.io/<repo-name>/`.
