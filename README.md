# LazyRPG Tactics

A small turn-based tactical RPG that runs in the browser, built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## How the game works

1. **Main menu**: New Game, Continue, Save Game, Load Game.
2. **Adventurers**: There are no fixed classes. Every party member is an Adventurer, and you build them by mixing a weapon with picks from the skill trees (up to 4 in the party).
3. **Camp**: the hub between battles. Recruit, customize or dismiss Adventurers, then start the next battle.
4. **Tactical battle**: XCOM-style alternating turns. On your turn, every Adventurer can move once and act once, in any order (click a unit or press Tab). Hover a skill to see its range box; any tile in range can be targeted. Forest gives +20 Defense and costs 2 movement; rock and water block movement, and rock blocks line of sight.

### Stats

Base stats and per-level growth are in **`src/data/stats.json`**. Edit that file to rebalance.

| Stat | Default | Meaning |
|---|---|---|
| Health | 600 (+60/level) | Max health |
| P.Atk | 100 | Physical power; skills deal a % of it |
| M.Atk | 100 | Magic power and healing |
| Defense | 0 | Damage taken × 100 / (100 + Defense): 100 Defense = 2× effective health |
| Movement | 4 | Movement points per turn |

Stats grow automatically on level up (100 XP per level). Range is Euclidean: 1 = the 4 neighbours, 1.5 includes diagonals.

**Line of sight vs line of fire.** Projectile skills need a clear line to the target:
- *Line of sight*: no rock in between. Used by Magic Bolt, Arcane Bolt, Fireball and Overwatch.
- *Line of fire*: no rock **and no unit** in between. Used by Direct Shot.

Melee skills, Indirect Shot (lobbed), Heal, Cleanse and Arcane Shift need neither. When targeting, tiles in range but blocked are greyed out with an ✕.

**Prepared but switched off** (in `stats.json`):
- `hitChance`: hit% = base + Accuracy + skill accuracy − Evasion (overwatch gets a reaction modifier), clamped to a min/max. Misses show as MISS.
- `vision`: fog of war based on each unit's Vision range plus line of sight.

Set `"enabled": true` to try either one. Accuracy, Evasion and Vision then appear in the stat panels.

### Weapons (each grants its skills; the first is the basic attack)

| Weapon | Stats | Skills |
|---|---|---|
| Sword & Shield | +40 P.Atk, +20 Def | Sword Slash, Slash and Smash, Shield Up |
| Spear | +50 P.Atk | Spear Thrust, Circle Swing, Intercept |
| Bow | +40 P.Atk | Direct Shot, Indirect Shot, Overwatch |
| Staff | +10 P.Atk, +50 M.Atk | Empowered Strike, Magic Bolt |

### Skill trees (pick freely across trees; 2 slots, 3 at Lv 3, 4 at Lv 6)

- **Mage**: Arcanist (Arcane Bolt, Arcane Shift), Elementalist (Fireball), Cleric (Heal, Cleanse)
- **Warrior**: Vanguard (Charge), Infighter (Kick, a free action), Assassin (Execute)

A cooldown of N means the skill can't be used during your next N turns.

Weapons, skills and trees are defined in `src/data/content.ts`.

## Save files

Saves are **pretty-printed JSON**. You can save to 3 browser slots, or Export a `.json` file and Import it later. Hand edits are validated, with errors that name the exact field. Saves from the old class-based version (v1) are upgraded automatically.

```json
{
  "format": "lazyrpg-save",
  "version": 2,
  "savedAt": "2026-11-21T10:00:00.000Z",
  "progress": { "stage": 2, "victories": 1, "defeats": 0 },
  "party": [
    {
      "id": "c_3268ddub",
      "name": "Brienne",
      "level": 2,
      "xp": 75,
      "weaponId": "staff",
      "skillIds": ["fireball", "heal"],
      "appearance": { "color": "#3d7be0", "emblem": "circle" }
    }
  ]
}
```

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
  data/       stats.json (base stats + growth), content.ts (weapons, skills, skill trees), types.ts
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
