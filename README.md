# L RPG

A small turn-based tactical RPG that runs in the browser, built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## How the game works

1. **Main menu**: New Game, Continue, Save Game, Load Game.
2. **Adventurers**: There are no fixed classes. Every party member is an Adventurer, and you build them by mixing a weapon with picks from the skill trees (up to 4 in the party).
3. **Camp**: the hub between battles. Recruit, customize or dismiss Adventurers, then start the next battle.
4. **Tactical battle**: XCOM-style alternating turns. On your turn, every Adventurer can move once and act once, in any order (click a unit or press Tab). Hover a skill to see its range box; any tile in range can be targeted. The map is 18×13 tiles (set in `stats.json`). Terrain: grass costs 4 Movement, forest 6 (and gives +20 Defense), river 8. Rock and deep water block movement, and rock blocks line of sight.

### Editing the game data

Everything gameplay-related lives in plain JSON files in `src/data/`. Each file is checked when the game loads, and a mistake fails with a message naming the exact field (e.g. `skills.json: "skills.kick.tags[3]" "flying" is not defined in "tags"`).

| File | What's in it |
|---|---|
| `stats.json` | Base stats and per-level growth, Defense scaling, terrain movement costs, forest bonus, map size, hit-chance and vision switches |
| `skills.json` | Every skill (numbers and descriptions), tags, status effects (Burn, Slow), skill trees |
| `weapons.json` | Weapons: stat multipliers and granted skills |
| `enemies.json` | Enemy types: level range, stats, skills, art, and how big encounters are |

Tooltips show a formula line generated from the numbers (e.g. "80% P.Atk, then 40% P.Atk + 100% Def"), so it stays correct even if a description is out of date.

### Stats

| Stat | Default | Meaning |
|---|---|---|
| Health | 500 (+50/level) | Max health |
| P.Atk | 100 (+10) | Physical power; skills deal a % of it |
| M.Atk | 100 (+10) | Magic power and healing |
| Defense | 50 (+5) | Damage taken × 100 / (100 + Defense) |
| Movement | 16 | Movement points per turn: grass costs 4, forest 6, river 8 (so 16 = 4 grass tiles) |

Stats grow automatically on level up (100 XP per level). Each won battle gives every Adventurer 100 XP (`xpPerVictory` in `stats.json`), so a party that keeps winning is level N at stage N.

Weapons **multiply** these stats:

| Weapon | Multipliers | Skills (the first is the basic attack) |
|---|---|---|
| Sword & Shield | x1 P.Atk, x0.8 M.Atk, x1.5 Def | Sword Slash, Slash and Smash, Shield Up |
| Spear | x1 P.Atk, x0.8 M.Atk | Spear Thrust, Circle Swing, Intercept |
| Bow | x0.8 P.Atk, x0.8 M.Atk | Direct Shot, Indirect Shot, Overwatch |
| Staff | x0.5 P.Atk, x1.2 M.Atk | Empowered Strike, Magic Bolt |

### Skill trees (mix freely; 2 slots, 3 at Lv 3, 4 at Lv 6)

- **Mage**: Arcanist (Arcane Bolt, Arcane Pulse, Arcane Shift), Elementalist (Fireball, Freeze), Cleric (Heal, Cleanse)
- **Warrior**: Vanguard (Charge), Infighter (Kick), Assassin (Execute)

### Tags

Every skill has tags that explain how it behaves. These four change the rules:

- **Movement**: range in tiles = rangeScale × Movement ÷ 4 (the grass cost), rounded down. Charge uses 100% (4 tiles at Movement 16), and Slow (−4 Movement) shortens it. Arcane Shift has a fixed range of 2.
- **Weapon**: uses your weapon's basic-attack range and line rules (Execute with a Bow reaches 5 tiles). Unusable while the weapon is disabled (nothing disables weapons yet).
- **Engage**: see below. Sword Slash, Slash and Smash, Empowered Strike, Kick, Charge.
- **Free Action**: doesn't use your action, and can be used before or after it (Kick). The turn doesn't end automatically while a unit still has a free action with a target in reach; press **End Turn** when done.

Descriptive tags: Melee, Projectile, Indirect, Area, Knockback, Reaction, Teleport, Debuff, Support.

### Enemies

Each enemy type has a fixed level range and its own stats and skills (`src/data/enemies.json`). A battle at stage N uses the types whose range contains N, at level N.

| Type | Levels | Skills |
|---|---|---|
| Giant Rat | 1–2 | Gnaw. Fast and weak; comes in packs. |
| Green Slime | 2–3 | Slam (Engage); Sticky Spit at level 3 (ranged, applies Slow and Corrode: -25% Defense, 2-turn cooldown). Slow-moving and tough. |
| Grey Wolf | 3–4 | Bite (Engage) and Pounce (leaps in, Engage); Howl at level 4 (Frenzy: +20 P.Atk to nearby allies). Very fast. |
| Bandit | 4–5 | Carries a random weapon but only uses its basic attack (no Slash and Smash, Circle Swing...). Thugs also have Shield Up, Hexers Fireball, Archers Execute; all learn Kick at level 5. |

**Enemy AI** weighs how dangerous a tile is (how much the party could hit it for next turn) against what it can do from there. Healthy enemies take small risks freely. Danger it can't avoid anyway doesn't hold it back, so a unit that's already in the thick of the fight keeps fighting. Below 35% health, an enemy that can reach the edge of the map this turn **flees the battle** and is removed. Otherwise it falls back to regroup with healthy allies (and may disengage to do it), or, if it's on its own, makes a last stand. Wounded enemies may hold back from walking into a deadly spot, but never for more than two turns in a row.

Encounter size is a threat budget: 1 per Adventurer. Rats cost 0.5 (two per Adventurer), slimes 0.75, wolves and bandits 1. Past stage 5, bandits keep coming at level 5, and the budget grows 25% per stage. Bandits have their own looks (hoods, masks, an eye patch, ragged leather, round wooden shields). Hover an enemy in battle to see its skills.

### Engagement

Hitting a unit with an **Engage** skill locks you both together, unless the target is already engaged with someone else. While engaged:
- You can't move, you can only attack your opponent, and you can only heal or cleanse yourself.
  - Attacks are fine as long as they hit your opponent: Spear Thrust aimed through them (diagonals included), Circle Swing (even if it also catches others), and Charge on the opponent itself (no dash, just the strike).
- **Disengage** (button in the battle sidebar) breaks free, but your opponent gets a free basic attack on you (an opportunity attack). You can then move and act normally.
- **Arcane Shift** (Teleport) slips out of an engagement with no opportunity attack.
- Engagement also ends if either unit falls, or if either one is successfully pushed by a knockback (Circle Swing, Arcane Pulse), even if they still end up next to each other. The pushed unit takes a free basic attack from its old opponent, just like disengaging. A push that's blocked doesn't break it.

Heal and Cleanse work on any unit, enemies included. An attack aimed straight at an ally hits them normally (lines like Spear Thrust pass by allies they aren't aimed at). In battle, the game asks for confirmation before you attack an empty tile or an ally, or heal or cleanse an enemy. The battle log keeps the whole fight: scroll it with the mouse wheel or the bar on its right.

### Lines, cooldowns, and prepared systems

- *Line of sight* (no rock in between): Direct Shot, Magic Bolt, Arcane Bolt, Arcane Pulse, Fireball, Overwatch.
- *Line of fire* (no rock **or unit** in between): no skill uses it right now; set `"los": "fire"` on a skill to use it.
- No line needed: melee skills, Spear Thrust (it stops at the first enemy in the way), Indirect Shot, Freeze, Heal, Cleanse, Arcane Shift.
- **Ranges** use Euclidean distance. Ranges of 2 or more round the distance to the nearest tile, so range 2 also reaches 2-over-1-up and shapes are rounder. Ranges 1 and 1.5 stay exact: 1 is the 4 neighbours, 1.5 adds the diagonals. Set `rangeRounding.fromRange` in `stats.json` to change the cut-off.
- Skill tooltips and the weapon panel show a **tile diagram** of what each skill covers, with you in gold, rather than describing range in words.
- A cooldown of N means the skill can't be used during your next N turns.
- `hitChance` and `vision` (fog of war) are built but switched off in `stats.json`.

### Art

Adventurers are drawn in a storybook style (no outlines, simple dot eyes, muted watercolour colours, light paper texture, about 5 heads tall). There are 8 adventurer body models (4 male, 4 female) and 4 bandit models (`b1`–`b4`), each drawn holding each weapon since the pose depends on the weapon: `public/art/units/<model>_<weapon>.svg`, 48 SVGs that stay sharp at 4K. Monsters are `public/art/monsters/<kind>.svg` (rat, slime, wolf) on a wider 96×80 canvas, coloured from `art.color` in `enemies.json`; enemy types choose their body models with `art.models`. They're generated by `node tools/generate-art.mjs`: edit the colours, hair, outfits or proportions there and re-run it, or replace the SVGs with your own art (same 64×80 canvas, or 96×80 for monsters, feet at y = 76).

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
      "appearance": { "color": "#3d7be0", "emblem": "circle", "model": "f2" }
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
  data/       stats.json, skills.json, weapons.json (editable game data) + loaders/validation
public/art/   unit SVGs (one per body model and weapon) and monster SVGs (tools/generate-art.mjs regenerates them)
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
