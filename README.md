# L RPG

A small turn-based tactical RPG that runs in the browser, built with [Phaser 4](https://phaser.io), TypeScript and Vite.

## How the game works

1. **Main menu**: New Game, Continue, Save Game, Load Game, and **Quick Battle (Demo)**: the original game on its own. Recruit up to 4 Adventurers for free at a camp (any look, weapon and skills), then fight stages 1 to 5; every victory is worth a level, and clearing stage 5 completes the demo. The demo is separate from your Arch City campaign and isn't saved.
2. **Your character**: a new game starts by creating your main character (name, sex, skin, face, hair, hair colour, clothes colour, weapon, skills) and naming your party. The main character is permanent: they can't be dismissed and always lead the party on quests.
3. **Arch City**: the hub is a map of the walled city (`public/art/city/arch-city.webp`) with three tabs: **Outer Ring** (Adventurer Guild, Docks, Marketplace, Slave Market, Slums, Customs Office, Sleeping Griffin Inn), **Middle Ring** (Tailor, Auction House, Library, Church) and **Inner Ring** (Lord's Manor, Central Government Office, Central Church, Gilded Crown Inn). Click a pin on the map or a button below it. Open so far: the **Adventurer Guild**, the **Slave Market** and the two **inns**; the rest are greyed out. **Manage Party** (bottom bar) handles your members, and the side panel sets out on an accepted quest. See [Arch City and the guild](#arch-city-and-the-adventurer-guild).
4. **Adventurers**: There are no fixed classes. Every party member is an Adventurer, and you build them by mixing a weapon with picks from the skill trees. Up to 4 go on each quest (the lineup); the party can have up to 8 members.
5. **Tactical battle**: XCOM-style alternating turns. On your turn, every Adventurer has **2 AP** (action points), a movement AP and an action AP, and can spend them in any order (click a unit or press Tab). See [Action points and mana](#action-points-and-mana). Skills sit on the **skill bar** under the map: press **1–0** (or click a slot) to use one. By default slot 1 is the basic attack, 2 Overwatch, 3 Dash, and the rest follow; newly learned skills go after the last used slot. **Drag a slot onto another** to swap them (the layout is saved per character). With more than 10 skills the bar gets more pages: flip with ▲ ▼ or **[ ]**, and while dragging, hover ▲ ▼ to carry a skill to another page (or to a new empty one). The battle log is in the sidebar. Hover a skill to see its range box; any tile in range can be targeted. The map is 18×13 tiles (set in `stats.json`). Terrain: grass costs 4 Movement, forest 6 (and gives +20 Defense), river 8. Rock and deep water block movement, and rock blocks line of sight.

## Arch City and the Adventurer Guild

Time passes in days. To pass time in the city, the party stays at an **inn** (1 night, 3 nights or a week), and a quest takes its listed number of days. The party pays food and lodging for the main character, slaves, and companions whose contract includes it:

| Where | Per person per day | Extra |
|---|---|---|
| Sleeping Griffin Inn (Outer Ring) | 4 gold | |
| Gilded Crown Inn (Inner Ring) | 15 gold | Companions the party houses gain +2 relationship each night |
| Away on a quest | 4 gold | |

Every 7th day is **payday** for companions.

### Ranks, the leaderboard and quests

The guild typically has about **100 active adventurers in 20 parties**. The **Leaderboard** lists every party by renown, and your rank comes from your position: the top 5% are **A** rank, the next 20% **B**, the next 60% **C** and the bottom 15% **D**. Your party starts at D. Completing a quest earns renown, and renown fades a little each day (1.5%), so ranks reflect recent success.

The **Quest Board** always has 6 quests, mostly at your rank, some below and some above. You can take quests at your rank or below; the ones above are shown locked so you can see what's coming. Each quest has an enemy strength (the stage), a gold reward, renown, and how many days it takes.

| Rank | Stages | Reward | Renown |
|---|---|---|---|
| D | 1–2 | 70–110 | 14 |
| C | 2–4 | 170–280 | 32 |
| B | 4–6 | 380–600 | 75 |
| A | 6–8 | 850–1300 | 170 |

XP from a won quest depends on the stage against each member's level: 100 XP at an equal level, up to 200 for punching above it, and as little as 15 for easy work.

### The other parties

The rival parties are simulated day by day. Each day a party has a 25% chance of going on a quest: the hardest rank at or below its own that it's fairly sure of, and now and then one rank up. Success earns renown and sometimes a level. Failure can cost members (they die or quit), and a badly outmatched party can be **wiped out** and removed. Parties of one break up, and the survivor goes back to the guild hall. New adventurers arrive at about the rate adventurers are lost, nudged toward 100. When the hall gets crowded (or there are fewer than usual parties), they band together as a **new D-rank party**. **Guild News** reports all of this.

### Party members

| Type | How you get them | Cost | Notes |
|---|---|---|---|
| **Main character** | Created at the start | Food & lodging | Permanent; always goes on quests |
| **Mercenary** | Guild Hall | A fixed fee up front, **or** a % of the next quest's reward | Leaves after the next quest, win or lose |
| **Companion** | Guild Hall, after negotiating a contract | Base pay every 7th day, a % of each reward, food & lodging if included | Permanent while the contract runs |
| **Slave** | Slave Market, or a captured prisoner registered at the magistrate | Food & lodging only | Permanent; can be sold back to the market |

**Companion contracts** have four terms: **base pay**, **loot cut** (% of each quest reward), **food and lodging included** (worth 28 gold a week to them), and **term length** (2, 4, 8 or 12 weeks). Candidates ask more the higher their level and the greedier they are, a little more for short terms and less for long ones. They value a loot cut by what a party of your rank usually earns (150 gold a week at D, 2000 at A). An offer close to what they want gets a counter-offer; a low one offends them. Each rejected offer uses up patience, and once it runs out they won't talk to you for a week.

Companions have a **relationship** score (0–100). It goes up by 6 for every quest completed together, drops if you can't pay them, and lowers their demands when you renew: by up to 30% at 100. When a contract ends, they sit out of quests and you have 3 days to **renew** it (Manage Party) before they leave. Walking out of a renewal ends the contract on the spot. Unpaid companions lose 20 relationship each payday, and quit when it reaches 0.

**Prisoners**: a won bandit quest sometimes ends with a captured bandit. Take them to the magistrate at the Slave Market to turn them in for a bounty (35 gold per level), or pay a 60 gold fee to register them as your slave.

All of these numbers are in `src/data/guild.json`.

### Editing the game data

Everything gameplay-related lives in plain JSON files in `src/data/`. Each file is checked when the game loads, and a mistake fails with a message naming the exact field (e.g. `skills.json: "skills.kick.tags[3]" "flying" is not defined in "tags"`).

| File | What's in it |
|---|---|
| `stats.json` | Base stats and per-level growth, talent grades (growth rates and roll weights), Defense scaling, terrain movement costs, forest bonus, map size, vision switch |
| `skills.json` | Every skill (numbers and descriptions), tags, status effects (Burn, Slow), skill trees |
| `weapons.json` | Weapons: stat multipliers and granted skills |
| `enemies.json` | Enemy types: level range, stats, skills, art, and how big encounters are |
| `guild.json` | Arch City: starting gold, rank shares, quest rewards, upkeep, mercenary and companion pay, slave prices, and the rival-party simulation |

Tooltips show a formula line generated from the numbers (e.g. "80% P.Atk, then 40% P.Atk + 100% Def"), so it stays correct even if a description is out of date.

### Stats

| Stat | Default | Meaning |
|---|---|---|
| Health | 500 (+50/level) | Max health |
| Mana | 200 (+20) | Spent by skills; doesn't come back during a battle |
| P.Atk | 100 (+10) | Physical power; skills deal a % of it |
| M.Atk | 100 (+10) | Magic power and healing |
| Defense | 50 (+5) | Damage taken × 100 / (100 + Defense) |
| Resist | 50 (+5) | Chance to shrug off a debuff: Resist ÷ (100 + Resist) |
| Movement | 16 | Movement points per turn: grass costs 4, forest 6, river 8 (so 16 = 4 grass tiles) |

Every attack hits. **Resist** gives a chance to shrug off debuffs (Burn, Slow, Corrode...): Resist ÷ (100 + Resist), the same curve as Defense, so 50 Resist = 33% and 100 = 50%. A resisted debuff shows "Resisted" and doesn't apply; the attack's damage still lands. Targeting shows the chance, and the enemy AI weighs it. Enemies' Resist matches their Defense.

Stats grow automatically on level up (100 XP per level), at a speed set by the Adventurer's **talent**. Every growing stat (Health, Mana, P.Atk, M.Atk, Defense, Resist) has its own talent grade, rolled when the Adventurer is created; the grade multiplies that stat's growth per level (the numbers in brackets above):

| Talent | S | A | B | C | D | F |
|---|---|---|---|---|---|---|
| Growth | 160% | 140% | 120% | 100% | 80% | 60% |
| Chance | 5% | 10% | 20% | 40% | 20% | 5% |

An S-talent P.Atk grows +16 a level instead of +10. Talent doesn't change level-1 stats. An Adventurer's overall talent is the grade nearest the average of their six. When you create your main character (or a Quick Battle recruit), **Reroll talent** rolls new grades. Talented Adventurers cost more: mercenary fees and cuts, companion wages and slave prices are multiplied by `1 + 2 × (average growth rate − 1)` (at least ×0.4; `talentPrice` in `guild.json`), so all-S costs ×2.2 and all-F ×0.4. Growth rates and roll weights are in `stats.json` (`talent`): a grade's chance is its weight divided by the total of all weights, so the weights can be any non-negative numbers (a grade with weight 0 never comes up). Enemies always grow at 100%.

A won quest gives each member in the lineup `xpPerVictory` (100, in `stats.json`) when their level equals the quest's stage, more when they're below it and less when above, so a party that keeps winning stays close to the level of the quests it takes.

Weapons **multiply** these stats:

| Weapon | Multipliers | Skills (the first is the basic attack) |
|---|---|---|
| Sword & Shield | x1 P.Atk, x0.8 M.Atk, x1.5 Def | Sword Slash, Shield Up |
| Spear | x1 P.Atk, x0.8 M.Atk | Spear Thrust |
| Bow | x0.8 P.Atk, x0.8 M.Atk | Direct Shot, Indirect Shot |
| Staff | x0.5 P.Atk, x1.2 M.Atk | Empowered Strike, Magic Bolt |

### Action points and mana

Every unit gets **2 AP** each turn: a **movement AP** (the regular move) and an **action AP**. Each skill has an AP cost (`ap` in `skills.json`):

| Cost | Effect |
|---|---|
| 0 (free) | No AP. Usable until the unit's turn ends (Kick). |
| 1 AP | Uses the movement AP if it's still unspent, otherwise the action AP. The turn goes on while AP remain. |
| 2 AP | Uses both AP (so it can't follow a move). The turn goes on: free actions are still allowed. |
| Ends turn | Uses all remaining AP and ends the unit's turn. The default: every weapon and tree skill, and Overwatch. |

Moving after a skill isn't possible once the movement AP is gone. **Undo move** takes back a regular move as long as nothing else happened since.

Skills can cost **mana** (`mana` in `skills.json`), which doesn't come back during a battle: Engage 10, Kick 10, Arcane Bolt 20, Charge 20, Cleanse 20, Double Strike 20, Execute 20, Flicker Strike 20, Pocket Sand 20, Shadow Step 20, Circle Swing 30, Life-Risking Strike 30, Arcane Pulse 40, Arcane Shift 40, Heal 40. Skill buttons show the cost; without enough mana a skill is greyed out.

**Basic abilities** (every Adventurer, listed under the weapon in the creator):

- **Dash** (1 AP, 20 MP, cooldown 1): only after the regular move. Spends the action AP to move again, up to your Movement. Overwatch can still fire on the way; it can't be undone.
- **Overwatch** (ends turn): watch a 60° arc in any direction, as far as your weapon reaches (Bow 5, Spear 2, sword and staff 1.5). The first enemy to move into it takes your basic attack and keeps moving. Bow and Spear no longer have their own Overwatch / Intercept.

### Skill points, skill trees and the Body tab

Adventurers have **skill points**: 2 at level 1 and 1 more every level. Each point either learns a skill-tree skill (mix trees freely) or goes into the **Body** tab, where it trains a stat by twice its base growth per level: +100 Health, +40 Mana, +20 P.Atk or M.Atk, +10 Defense or Resist per point (before weapon multipliers; talent doesn't change it). Points can be moved around freely in Customize / Loadout.


Some skills need a **minimum level** (`level` in `skills.json`; shown as "Lv 3" in the skill tree). Until then they're greyed out and can't be learned. A loaded save with a skill above the character's level unlearns it and refunds the point. Random adventurers only pick skills their level has unlocked.

- **Mage**: Arcanist (Arcane Bolt, Arcane Pulse Lv 3, Arcane Shift Lv 3), Elementalist (Fireball, Freeze), Cleric (Heal, Cleanse)
- **Warrior**: Vanguard (Engage, Charge Lv 3), Infighter (Kick, Pocket Sand Lv 3), Assassin (Shadow Step, Flicker Strike Lv 3, Life-Risking Strike Lv 5), Weapon Master (Double Strike, Execute Lv 3, Circle Swing Lv 5)

Status effects: Burn, Slow, Corrode, Frenzy, **Blinded** (Pocket Sand: −30% P.Atk and M.Atk), **Exposed** (Life-Risking Strike: no Defense until your next turn) and **Stealthed** (Shadow Step: enemies can't target you directly or trigger overwatch on you until your next turn; area attacks still hit, and attacking ends it).

### Tags

Every skill has tags that explain how it behaves. These five change the rules:

- **Movement**: range in tiles = rangeScale × Movement ÷ 4 (the grass cost), rounded down. Charge uses 100% (4 tiles at Movement 16), and Slow (−4 Movement) shortens it. Arcane Shift has a fixed range of 2.
- **Weapon**: uses your weapon's basic-attack range and line rules (Execute with a Bow reaches 5 tiles). Double Strike hits with the basic attack twice, and Circle Swing hits every enemy within the weapon's range with it. Unusable while the weapon is disabled (nothing disables weapons yet).
- **Engage**: see below. Sword Slash, Empowered Strike, Engage, Kick, Charge, Flicker Strike, Life-Risking Strike.
- **Disengage**: usable while engaged, on anyone, and it ends your engagement with no free attack for your opponent. Arcane Pulse, Arcane Shift, Shadow Step.
- **Free Action**: costs 0 AP (Kick). Usable any time until the unit's turn ends, so after a move or a 1/2-AP skill, but not after a turn-ending one. The turn doesn't end automatically while a unit still has a free action with a target in reach; press **End Turn** when done.

Descriptive tags: Melee, Physical, Projectile, Indirect, Area, Knockback, Reaction, Teleport, Stealth, Debuff, Support.

### Enemies

Each enemy type has a fixed level range and its own stats and skills (`src/data/enemies.json`). A battle at stage N uses the types whose range contains N, at level N.

| Type | Levels | Skills |
|---|---|---|
| Giant Rat | 1–2 | Gnaw. Fast and weak; comes in packs. |
| Green Slime | 2–3 | Slam (Engage); Sticky Spit at level 3 (ranged, applies Slow and Corrode: -25% Defense, 2-turn cooldown). Slow-moving and tough. |
| Grey Wolf | 3–4 | Bite (Engage) and Pounce (leaps in, Engage); Howl at level 4 (Frenzy: +20 P.Atk to nearby allies). Very fast. |
| Bandit | 4–5 | Carries a random weapon but only uses its basic attack (no Indirect Shot, Magic Bolt...). Thugs also have Shield Up, Hexers Fireball, Archers Execute; all learn Kick at level 5. |

**Enemy AI** weighs how dangerous a tile is (how much the party could hit it for next turn) against what it can do from there. Healthy enemies take small risks freely. Danger it can't avoid anyway doesn't hold it back, so a unit that's already in the thick of the fight keeps fighting. Below 35% health, an enemy that can reach the edge of the map this turn **flees the battle** and is removed. Otherwise it falls back to regroup with healthy allies (and may disengage to do it), or, if it's on its own, makes a last stand. Wounded enemies may hold back from walking into a deadly spot, but never for more than two turns in a row.

Encounter size is a threat budget: 1 per Adventurer. Rats cost 0.5 (two per Adventurer), slimes 0.75, wolves and bandits 1. Past stage 5, bandits keep coming at level 5, and the budget grows 25% per stage. Bandits have their own looks (hoods, masks, an eye patch, ragged leather, round wooden shields). Hover an enemy in battle to see its skills. **Click an enemy** to see its reach on its next turn: the tiles it can move to (orange) and, around them, every tile its longest-ranged attack that will be off cooldown can hit (red). Click it again, or anywhere else, to hide it.

### Engagement

Hitting a unit with an **Engage** skill locks you both together, unless the target is already engaged with someone else. While engaged:
- You can't move, you can only attack your opponent, and you can only heal or cleanse yourself.
  - Attacks are fine as long as they hit your opponent: Spear Thrust aimed through them (diagonals included), Circle Swing (even if it also catches others), and Charge on the opponent itself (no dash, just the strike).
- **Disengage** (button in the battle sidebar) breaks free, but your opponent gets a free basic attack on you (an opportunity attack). You can then move and act normally.
- **Disengage** skills (Arcane Shift, Shadow Step, Arcane Pulse) slip out of an engagement with no opportunity attack. Other teleports and moves need you to disengage first.
- Engagement also ends if either unit falls, or if either one is successfully pushed by a knockback (Circle Swing, Arcane Pulse), even if they still end up next to each other. The pushed unit takes a free basic attack from its old opponent, just like disengaging. A push that's blocked doesn't break it.

Heal and Cleanse work on any unit, enemies included. An attack aimed straight at an ally hits them normally (lines like Spear Thrust pass by allies they aren't aimed at). In battle, the game asks for confirmation before you attack an empty tile or an ally, or heal or cleanse an enemy. The battle log keeps the whole fight: scroll it with the mouse wheel or the bar on its right.

### Lines, cooldowns, and prepared systems

- *Line of sight* (no rock in between): Direct Shot, Magic Bolt, Arcane Bolt, Arcane Pulse, Fireball, and Overwatch with a weapon that needs it (Bow).
- *Line of fire* (no rock **or unit** in between): no skill uses it right now; set `"los": "fire"` on a skill to use it.
- No line needed: melee skills, Spear Thrust (it stops at the first enemy in the way), Indirect Shot, Freeze, Heal, Cleanse, Arcane Shift.
- **Ranges** use Euclidean distance. Ranges of 2 or more round the distance to the nearest tile, so range 2 also reaches 2-over-1-up and shapes are rounder. Ranges 1 and 1.5 stay exact: 1 is the 4 neighbours, 1.5 adds the diagonals. Set `rangeRounding.fromRange` in `stats.json` to change the cut-off.
- Skill tooltips and the weapon panel show a **tile diagram** of what each skill covers, with you in gold, rather than describing range in words.
- A cooldown of N means the skill can't be used during your next N turns.
- `vision` (fog of war) is built but switched off in `stats.json`.

### Art

Adventurers have a **custom look**: sex (male or female), skin (pale, light, fair, olive, light brown, brown), one of 4 faces per sex, a hairstyle (men: crew cut, bowl cut, permed, tied; women: bob cut, ponytail, crown braid, down with bangs, braided, bun) and a hair colour. Their outfit follows their weapon (armour, tunic or robe) in their chosen colour. Looks are drawn in the browser on first use by `src/art/unitArt.js`, so every combination stays sharp without hundreds of files.

They're drawn in a storybook style (no outlines, simple dot eyes, muted watercolour colours, light paper texture, about 5 heads tall). The static sprites are 8 body models (`m1`–`f4`, available to human enemy types) and 4 bandit models (`b1`–`b4`), each drawn holding each weapon since the pose depends on the weapon: `public/art/units/<model>_<weapon>.svg`, 48 SVGs that stay sharp at 4K. Monsters are `public/art/monsters/<kind>.svg` (rat, slime, wolf) on a wider 96×80 canvas, coloured from `art.color` in `enemies.json`; enemy types choose their body models with `art.models`. They're generated by `node tools/generate-art.mjs` from the shared drawing code in `src/art/unitArt.js`: edit the colours, hair, outfits or proportions there and re-run it, or replace the SVGs with your own art (same 64×80 canvas, or 96×80 for monsters, feet at y = 76).

## Save files

Saves are **pretty-printed JSON**. You can save to 3 browser slots, or Export a `.json` file and Import it later. Hand edits are validated, with errors that name the exact field (e.g. `party[0].appearance.look.hair must be one of: bobCut, ponytail, ...`). Older saves are upgraded automatically: the first party member becomes your main character, the others companions on a 4-week contract, and the party joins the guild with renown and gold for the stages it had cleared.

A version-3 save holds the whole city: the day, gold, renown and rank, your party with each member's contract, the lineup, the accepted quest, the guild (rival parties, free adventurers in the hall, the quest board, news), the slave market and any prisoners. A party member looks like this:

```json
{
  "id": "c_3268ddub",
  "name": "Brienne",
  "level": 2,
  "xp": 75,
  "weaponId": "staff",
  "skillIds": ["fireball", "heal"],
  "appearance": {
    "color": "#3d7be0",
    "look": { "sex": "female", "skin": "fair", "face": 2, "hair": "crownBraid", "hairColor": "auburn" }
  },
  "talents": { "health": "B", "mana": "C", "pAtk": "D", "mAtk": "A", "defense": "C", "resist": "B" },
  "contract": {
    "type": "companion",
    "basePay": 60,
    "lootPct": 5,
    "foodLodging": true,
    "termWeeks": 4,
    "startDay": 3,
    "endDay": 31,
    "relationship": 22,
    "greed": 1.05
  }
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
  data/       stats.json, skills.json, weapons.json, enemies.json, guild.json (editable game data) + loaders/validation
public/art/   unit SVGs (one per body model and weapon) and monster SVGs (tools/generate-art.mjs regenerates them)
  art/        unitArt.js: draws units as SVG (used by the game for custom looks and by tools/generate-art.mjs)
  game/       pure game logic, no Phaser: character stats, battle rules, AI, map generation, save/load,
              Arch City (city.ts), the guild simulation (guild.ts), contracts (contracts.ts), random people (people.ts)
  scenes/     Phaser scenes: MainMenu, SaveLoad, CharacterCreator, City, Guild, Negotiate, Market, Inn, Party, DemoCamp, Battle
  ui/         small UI helpers (buttons, panels, tokens, dialogs)
tests/        Vitest tests for the game logic and the city simulation
```

The rules in `src/game/` don't depend on Phaser. That keeps them easy to test, and the AI and balance can be simulated quickly.

## Publishing on GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys the game on every push to `main`.
One-time setup: open the repo on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The game will then be live at `https://<your-username>.github.io/<repo-name>/`.
