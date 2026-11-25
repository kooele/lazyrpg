# Notes for Claude

## UI text: Title Case

Always use **Title Case** for UI text that isn't a sentence or inside parentheses. Ask the user about genuinely
ambiguous cases before converting them.

- **Style:** Chicago. Capitalize the first and last word and every major word. Lowercase articles (a, an, the),
  coordinating conjunctions (and, but, or, nor, for, so, yet) and prepositions (at, by, for, from, in, of, off, on,
  to, up, with, per, ...) unless they're first or last. Example: "Set Out from the City Gate".
- **Title Case:** buttons (including disabled buttons showing a status, e.g. "No Adventurers in the Lineup"), headings,
  tabs, section titles, short tags ("Unsaved", "Starts Tomorrow", "⚔ Slot 2"), and entire "Label: value" lines
  ("Night Quality 2 of 3: Counts as an Inn", "In Battle: -10% All Stats"). In battle: floating combat text
  ("Breaks Away") and attack preview lines ("→ Dash In, Then Strike").
- **Units:** whole words are Title Cased ("Price: 4000 Gold", "2 Days"); abbreviations stay as they are
  ("18g/day", "4 wk", "30 dmg", "Lv 5", "P.Atk").
- **Leave as is:** sentences (they end in . ? ! or read as one, e.g. toasts, dialogs, descriptions, the battle log),
  anything inside parentheses, instructions/hints (e.g. after "·": "Lineup 2/4 · drag members into the slots",
  "click a tile to dash to"), and bullet lines in tooltips and the Guide ("• +5 each night").
