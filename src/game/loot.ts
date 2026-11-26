// What enemies leave behind: humans their gear (often broken), everyone else a trophy and a junk item.
import { WEAPONS } from '../data/content';
import { ENEMIES, LOOT } from '../data/enemies';
import { GEAR_KINDS, type Character, type Item } from '../data/types';
import type { Rng } from './character';
import { gearName } from './gear';
import { itemValue, makeItem, makeLoot } from './inventory';

/**
 * The loot from one defeated enemy (killed, or taken prisoner).
 *  - Humans: each piece of gear they carried, broken (junk: "Broken Crude Longbow", worth brokenValueShare of its
 *    value) with brokenChance.
 *  - Everyone else: their trophy and their junk item, each worth goldPerLevel x level ("{weapon}" in the junk name
 *    is their weapon: Goblin Spear). Enemy-made gear never drops as gear.
 */
export function enemyLoot(foe: Character, rng: Rng): Item[] {
  const def = foe.enemyType ? ENEMIES[foe.enemyType] : undefined;
  if (!def) return [];
  const type = def.id;
  if (def.ai === 'human') {
    const out: Item[] = [];
    for (const kind of GEAR_KINDS) {
      const g = foe[kind];
      if (!g) continue;
      if (rng() < LOOT.brokenChance) out.push(makeLoot('junk', `Broken ${gearName(g, kind)}`, itemValue(g) * LOOT.brokenValueShare, 'broken'));
      else out.push(makeItem(kind, g));
    }
    return out;
  }
  if (!def.drops) return [];
  const weapon = foe.weapon ? WEAPONS[foe.weapon.type]?.name ?? '' : '';
  return [
    makeLoot('trophy', def.drops.trophy, LOOT.trophyGoldPerLevel * foe.level, type),
    makeLoot('junk', def.drops.junk.replace('{weapon}', weapon).trim(), LOOT.junkGoldPerLevel * foe.level, type),
  ];
}

/**
 * Everything the party brings home from a battle: from a win, all loot of the enemies killed and taken prisoner;
 * from a defeat, only the trophies of the enemies killed (the rest stays on the battlefield).
 */
export function battleLoot(killed: Character[], captured: Character[], outcome: 'victory' | 'defeat', rng: Rng): Item[] {
  const all = [...killed, ...(outcome === 'victory' ? captured : [])].flatMap((f) => enemyLoot(f, rng));
  return outcome === 'victory' ? all : all.filter((i) => i.kind === 'trophy');
}
