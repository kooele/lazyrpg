// Generates the static unit art in public/art/units as SVG files (crisp at any resolution).
//   node tools/generate-art.mjs
//
// The drawing code lives in src/art/unitArt.js, which the game also uses to draw
// adventurers with a custom look (sex, skin, face, hair) at runtime.
//
// Each body model (adventurers m1-m4/f1-f4, used by human enemies; bandits b1-b4) is drawn once
// per weapon (the pose depends on the weapon), as units/<model>_<weapon art>.svg on a 64x80 canvas
// with the feet at y = 76. Monsters (rat, slime, wolf) are monsters/<kind>.svg on a wider
// 96x80 canvas, facing right, feet at y = 76; their colours come from src/data/enemies.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_WEAPONS, BANDITS, MODELS, figureSvg, monsterSvg } from '../src/art/unitArt.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repo, 'public', 'art', 'units');
const monsterRoot = join(repo, 'public', 'art', 'monsters');

mkdirSync(root, { recursive: true });
let count = 0;
for (const [id, model] of Object.entries({ ...MODELS, ...BANDITS })) {
  for (const weapon of ART_WEAPONS) {
    writeFileSync(join(root, `${id}_${weapon}.svg`), figureSvg(id, model, weapon));
    count++;
  }
}
console.log(`Wrote ${count} unit sprites to ${root}`);

mkdirSync(monsterRoot, { recursive: true });
const enemies = JSON.parse(readFileSync(join(repo, 'src', 'data', 'enemies.json'), 'utf8')).enemies;
const kinds = new Map();
for (const def of Object.values(enemies)) if (def.art?.kind && def.art.kind !== 'human') kinds.set(def.art.kind, def.art.color ?? '#888888');
for (const [kind, color] of kinds) writeFileSync(join(monsterRoot, `${kind}.svg`), monsterSvg(kind, color));
console.log(`Wrote ${kinds.size} monster sprites to ${monsterRoot}`);
