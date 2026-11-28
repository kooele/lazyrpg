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
  Crude at 1, Common at 6, Fine at 12, Masterwork at 20, blended in between).
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
(`rebalance.sim.ts`). The rescale puts a usual-sized group of each type (`usualCountAt`) at par for the reference
party of the same level, and trades Health against attack (same value) so fights average about 10 rounds. Limits:
the tempo stays within ×0.4–×2.5 of each type's original Health-to-attack balance (`enemies.orig.json`, the
stats before this pass), one basic hit takes at most 35% of the frailest reference Adventurer's effective Health, and
corrections are damped (`BALANCE_GAIN`, 0.6). After the loop, copy the last fit's `a`, `b` into
`strength.winCurve`.

Other probes (`npx vitest run --config tools/balance/vitest.config.ts tools/balance/<name>.sim.ts`): `economy`
(strength, par, skulls, gold and renown per rank, against the old formulas), `burst` (one hit's share of each
reference Adventurer's Health), `rivals` (the rival parties over a year).

## Last calibration

11 iterations of `iterate.sh` (24–32 seeds a cell), then a check on 60 real board quests (12 per rank, 24 battles
each) fought by the reference party at the quest's enemy level:

| Rank | AI wins | Model | Rounds (mean, p90) | Over 20 rounds |
|---|---|---|---|---|
| D | 66% | 61% | 9.7, 13 | 0% |
| C | 52% | 45% | 9.4, 13 | 0% |
| B | 47% | 45% | 9.5, 12 | 0% |
| A | 23% | 24% | 11.2, 15 | 1% |
| S | 49% | 53% | 10.5, 14 | 1% |

Win curve: a 2.734, b 7.248 (par, 33%, at a power ratio of 0.62). Each type alone at par: 9.8–11.4 rounds on
average, at most 1% over 20. A quests run harder than their level (par about 1.7 levels above the enemy level), as
their groups are the biggest; S quests a level easier.
