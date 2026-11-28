# Balance tools

Headless AI-vs-AI battles for tuning enemies against the strength model (`src/game/power.ts`). Nothing here ships
with the game. Reports go to `tools/balance/out/` (gitignored).

## The model

- A fighter's **value** is `sqrt(effective HP × damage per turn)`: Health stretched by Defense, and the best attack
  stat cut by the other side's Defense after penetration. Enemy types multiply it by their `power` (in
  `enemies.json`, fitted here) for what their stats don't show.
- A group's **power** is the square of its summed values (Lanchester), so a **power ratio** of 1 is an even match by
  the stats, and twice the fighters is four times the power.
- The **reference party** (`src/game/reference.ts`) is four Adventurers (Guardian, Caster, Archer, Cleric) with a
  talent spread averaging B, Body points by build, and the gear expected at their level (`POWER.referenceGear`:
  Crude through 5, Common at 8, Fine at 13, Masterwork at 20, blended in between).
- A quest's **par level** is the level at which the reference party, played by the AI, wins `strength.parWinRate`
  (33%) of its battles. The AI win curve `strength.winCurve` (in `guild.json`) maps a power ratio to a win chance;
  it's fitted here.
- A quest's **strength** (what gold and renown are proportional to) is the power of its expected enemies,
  `(value / 100)²`. Skulls are linear in par level.

## Running

```bash
npm run balance -- --name grid --seeds 40 --level 4,8,12 --stageOffset -2,0,2 --count 3,5,7
```

Every list flag is a comma list and the job is their cross product (`jobs.ts`); `--workers` defaults to the CPU
count. Presets: `--plan types` (each enemy type alone, at the bottom, middle and top of its levels, in groups sized for
the power ratios in `--ratio`) and `--plan board` (real board quests from `makeQuest`, `--count` per rank, fought at
their enemy level). Each report records the model's prediction per cell (`meta.ts`).

- `python3 tools/balance/validate.py <report> [--by rank|foes|level]`: model against battles, and battle lengths.
- `python3 tools/balance/lengths.py <report>`: battle length per enemy type.
- `node tools/balance/fit.mjs <report> [--group party.level]`: refit the win curve.

## Rebalancing enemies

`tools/balance/iterate.sh <first> <iterations> [seeds]` loops: simulate each type alone (`--plan types`), fit the
curve, a power factor per type and per level, and a tempo per type and level (`fitfac.py`), then rescale the stats
(`rebalance.sim.ts`). The rescale solves every level of each type's range so the AI-played reference party wins a
usual-sized group (`usualCountAt`, counted smoothly) `TARGET_WIN` of the time (50% at level 3, 40% at 8, 33% from
13), then fits base stats, `growthPerLevel` and a `growthBend` (× levels²) by least squares. It also trades Health
against attack (same value) so fights average about 10 rounds. Limits and leanings:

- extra strength goes half to Health and half to attack up to level 5, and three quarters to attack from level 20
  (`attackShare`), since the party's skills outscale the enemies' late on;
- M.Atk that only heals (Troll's Regenerate) stays at its original value;
- the tempo stays within ×0.4–×2.5 of each type's original Health-to-attack balance (`enemies.orig.json`, the stats
  before the balance pass);
- one basic hit takes at most 35% of the frailest reference Adventurer's effective Health;
- corrections are damped (`BALANCE_GAIN`, 0.6).

After the loop, copy the last fit's `a`, `b` into `strength.winCurve`. `tune.py` tries per-rank targets on the model
alone (fast); `solo.sim.ts` finds the half-skull anchor (the rat group a lone level-1 Adventurer beats half the time).

Other probes (`npx vitest run --config tools/balance/vitest.config.ts tools/balance/<name>.sim.ts`): `economy`
(strength, par, skulls, gold and renown per rank, against the old formulas), `burst` (one hit's share of each
reference Adventurer's Health), `rivals` (the rival parties over a year).

## Last calibration

Group sizes doubled from the original game (D 1–8, C 6–12, B 8–14, A 10–16, S 12–18 threat points; up to 24 enemies),
enemies rebalanced from their original stats (`enemies.orig.json`), 7 iterations of `iterate.sh` (24 seeds a cell).
Check on 80 real board quests (16 per rank, 24 battles each), reference party at the quest's enemy level:

| Rank | AI wins | Model | Target | Rounds (mean, p90) | Over 20 rounds |
|---|---|---|---|---|---|
| D | 56% | 59% | 50% | 8.4, 12 | 0% |
| C | 38% | 37% | 40% | 9.6, 12 | 0% |
| B | 38% | 41% | 33% | 9.8, 13 | 0% |
| A | 27% | 28% | 33% | 10.8, 15 | 1% |
| S | 26% | 31% | 33% | 10.4, 14 | 1% |

Solo, level 1, Crude gear, against 2 giant rats (the half-skull quest): Archer 100%, Sword and Shield with Kick 75%;
against 3 rats 22% and 0%. Win curve: a 3.508, b 6.684. Each type alone: 9.6–11.6 rounds on average.
