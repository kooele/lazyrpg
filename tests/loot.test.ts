// Enemy drops: humans' gear (often broken), trophies and junk from everyone else, and the city gate.
import { describe, expect, it } from 'vitest';
import enemiesJson from '../src/data/enemies.json';
import { ENEMIES, LOOT, parseEnemies } from '../src/data/enemies';
import type { GameState, LootItem } from '../src/data/types';
import { makeEnemy } from '../src/game/battle';
import { createCharacter, makeRng } from '../src/game/character';
import { acceptQuest, canTakeQuest, newCampaign, resolveQuest } from '../src/game/city';
import { gear } from '../src/game/gear';
import { equipItem, itemName, itemValue, sortedInventory, stacks, trophies, turnInTrophies } from '../src/game/inventory';
import { battleLoot, enemyLoot } from '../src/game/loot';
import { parseSave, serializeSave } from '../src/game/save';

const start = (): GameState => newCampaign(createCharacter('Main', '#3d7be0', 'sword_shield'), 'Testers', makeRng(1));
const always = () => 0; // every roll comes up "yes" (broken)
const never = () => 0.999;

describe('loot data (Enemy Drops sheet)', () => {
  it('every non-human type has a trophy and a junk item; values are 4.5 gold per level', () => {
    expect(LOOT).toMatchObject({ trophyGoldPerLevel: 4.5, junkGoldPerLevel: 4.5, brokenValueShare: 0.25 });
    expect(LOOT.brokenChance).toBeCloseTo(2 / 3, 3);
    for (const e of Object.values(ENEMIES)) expect(!!e.drops, e.id).toBe(e.ai !== 'human');
    expect(ENEMIES.wolf.drops).toEqual({ trophy: 'Wolf Fang', junk: 'Wolf Pelt' });
    expect(ENEMIES.goblin.drops).toEqual({ trophy: 'Goblin Ear', junk: 'Goblin {weapon}' });
  });

  it('is validated: non-human types need drops', () => {
    const bad = JSON.parse(JSON.stringify(enemiesJson));
    delete bad.enemies.wolf.drops;
    expect(() => parseEnemies(bad)).toThrow(/enemies.wolf.drops/);
  });
});

describe('enemy loot', () => {
  it('a beast drops its trophy and its junk, each worth 4.5 gold per level', () => {
    const wolf = makeEnemy('wolf', 6, makeRng(1));
    const loot = enemyLoot(wolf, makeRng(1)) as LootItem[];
    expect(loot.map((i) => [i.kind, i.name, i.value])).toEqual([['trophy', 'Wolf Fang', 27], ['junk', 'Wolf Pelt', 27]]);
  });

  it('goblins, orcs and skeletons drop the weapon they fought with as junk', () => {
    const goblin = makeEnemy('goblin', 5, makeRng(2));
    const junk = enemyLoot(goblin, makeRng(1)).find((i) => i.kind === 'junk')!;
    expect(itemName(junk)).toMatch(/^Goblin (Spear|Shortbow|Staff)$/);
    const skel = makeEnemy('skeleton', 8, makeRng(3));
    expect(itemName(enemyLoot(skel, makeRng(1))[1])).toMatch(/^Rusted /);
    expect(itemName(enemyLoot(skel, makeRng(1))[0])).toBe('Skeleton Skull');
  });

  it('humans drop their gear: whole, or broken (junk worth a quarter) 2/3 of the time', () => {
    const bandit = makeEnemy('bandit', 5, makeRng(4));
    bandit.weapon = gear('dagger', 'common');
    bandit.armor = gear('leather', 'crude');
    expect(enemyLoot(bandit, never).map((i) => [i.kind, itemName(i)])).toEqual([['weapon', 'Common Single Dagger'], ['armor', 'Crude Leather']]);
    const broken = enemyLoot(bandit, always);
    expect(broken.map((i) => [i.kind, itemName(i), itemValue(i)])).toEqual([['junk', 'Broken Common Single Dagger', 25], ['junk', 'Broken Crude Leather', 5]]);
    bandit.armor = null; // a Hexer wears no armor: only the staff drops
    expect(enemyLoot(bandit, never)).toHaveLength(1);
    // Over many drops, about 2 in 3 pieces are broken.
    const rng = makeRng(9);
    const pieces = Array.from({ length: 600 }, () => enemyLoot(bandit, rng)).flat();
    expect(pieces.filter((i) => i.kind === 'junk').length / pieces.length).toBeCloseTo(2 / 3, 1);
  });

  it('a win brings everything from the dead and the captured; a defeat only the trophies of the dead', () => {
    const wolves = [makeEnemy('wolf', 4, makeRng(1)), makeEnemy('wolf', 4, makeRng(2))];
    const captive = makeEnemy('bandit', 5, makeRng(3));
    const win = battleLoot(wolves, [captive], 'victory', never);
    expect(win.filter((i) => i.kind === 'trophy')).toHaveLength(2);
    expect(win.filter((i) => i.kind === 'junk')).toHaveLength(2);
    expect(win.filter((i) => i.kind === 'weapon')).toHaveLength(1);
    const loss = battleLoot(wolves, [captive], 'defeat', never);
    expect(loss.map((i) => i.kind)).toEqual(['trophy', 'trophy']);
  });

  it('kills pay no bounty any more: a won quest puts the loot in the stash instead', () => {
    const s = start();
    acceptQuest(s, s.guild.board.find((q) => canTakeQuest(s, q))!.id);
    s.quest!.days = 1;
    const reward = s.quest!.reward;
    const gold = s.gold;
    const killed = [makeEnemy('wolf', 4, makeRng(1)), makeEnemy('wolf', 4, makeRng(2)), makeEnemy('wolf', 4, makeRng(5))];
    const lines = resolveQuest(s, 'victory', makeRng(3), [], [], { killed, total: 3 });
    expect(s.gold).toBe(gold + reward);
    expect(lines.join(' ')).toContain('Trophies: Wolf Fang ×3. Turn them in at the city gate (54 gold).');
    expect(lines.join(' ')).toContain('Junk: Wolf Pelt ×3 (in the stash, to sell).');
    expect(lines.join(' ')).not.toMatch(/Bount/);
    expect(trophies(s)).toHaveLength(3);
  });
});

describe('the stash with loot', () => {
  it('stacks identical loot; sorts gear, then junk, then trophies', () => {
    const s = start();
    s.inventory.push(...enemyLoot(makeEnemy('wolf', 4, makeRng(1)), never), ...enemyLoot(makeEnemy('wolf', 4, makeRng(2)), never));
    s.inventory.push(...enemyLoot(makeEnemy('wolf', 6, makeRng(3)), never));
    const sorted = sortedInventory(s);
    expect(sorted.map((i) => i.kind)).toEqual(['junk', 'junk', 'junk', 'trophy', 'trophy', 'trophy']);
    expect(stacks(sorted).map((st) => [itemName(st.item), itemValue(st.item), st.count])).toEqual([
      ['Wolf Pelt', 27, 1], ['Wolf Pelt', 18, 2], ['Wolf Fang', 27, 1], ['Wolf Fang', 18, 2],
    ]);
    expect(equipItem(s, s.party[0].id, sorted[0].id)).toMatch(/can't be equipped/);
  });

  it('trophies are turned in at the gate for their value; junk stays', () => {
    const s = start();
    s.inventory.push(...enemyLoot(makeEnemy('wolf', 4, makeRng(1)), never), ...enemyLoot(makeEnemy('demon', 20, makeRng(2)), never));
    const gold = s.gold;
    expect(turnInTrophies(s)).toBe(18 + 90);
    expect(s.gold).toBe(gold + 108);
    expect(trophies(s)).toHaveLength(0);
    expect(s.inventory.map(itemName)).toEqual(['Wolf Pelt', 'Brimstone Shard']);
    expect(turnInTrophies(s)).toBe(0);
  });

  it('loot survives a save and load', () => {
    const s = start();
    s.inventory.push(...enemyLoot(makeEnemy('wolf', 4, makeRng(1)), never));
    const r = parseSave(serializeSave(s));
    expect(r.ok && r.state.inventory).toEqual(s.inventory);
    const file = JSON.parse(serializeSave(s));
    file.inventory[0].value = -3;
    expect(parseSave(JSON.stringify(file)).ok).toBe(false);
  });
});
