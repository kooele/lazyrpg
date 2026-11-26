// Generates the static monster art in public/art/monsters as SVG files (crisp at any resolution).
//   node tools/generate-art.mjs
//
// People (adventurers and humanoid enemies) aren't pre-generated: the game draws them at runtime with
// src/art/unitArt.js, for each look or body model, weapon and armor. Monsters (rat, slime, wolf...) are
// monsters/<kind>.svg on a 96x80 canvas, facing right, feet at y = 76; their colours come from src/data/enemies.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monsterSvg } from '../src/art/unitArt.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const monsterRoot = join(repo, 'public', 'art', 'monsters');

mkdirSync(monsterRoot, { recursive: true });
const enemies = JSON.parse(readFileSync(join(repo, 'src', 'data', 'enemies.json'), 'utf8')).enemies;
const kinds = new Map();
for (const def of Object.values(enemies)) if (def.art?.kind && def.art.kind !== 'human') kinds.set(def.art.kind, def.art.color ?? '#888888');
for (const [kind, color] of kinds) writeFileSync(join(monsterRoot, `${kind}.svg`), monsterSvg(kind, color));
console.log(`Wrote ${kinds.size} monster sprites to ${monsterRoot}`);
