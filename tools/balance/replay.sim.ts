// Replay one balance battle with a turn-by-turn log: BALANCE_ARGS = {"party":{...},"quest":{...},"seed":n}.
import { test } from 'vitest';
import { runAiTurn } from '../../src/game/ai';
import { Battle, deploymentTiles, generateEnemies, makeUnit, type BattleEvent, type Unit } from '../../src/game/battle';
import { makeRng } from '../../src/game/character';
import { generateMap } from '../../src/game/grid';
import { buildParty } from './sim';

test('replay', () => {
  const a = JSON.parse(process.env.BALANCE_ARGS ?? '{}');
  const out: string[] = [];
  const rng = makeRng(a.seed ?? 7);
  const map = generateMap(rng);
  const members = buildParty(a.party);
  const enemies = generateEnemies(a.quest.stage, rng, a.quest.count, a.quest.foes);
  const p = deploymentTiles(map, 'player', members.length);
  const e = deploymentTiles(map, 'enemy', enemies.length);
  const units = [...members.map((c, i) => makeUnit(c, 'player', p[i])), ...enemies.slice(0, e.length).map((c, i) => makeUnit(c, 'enemy', e[i]))];
  const names = new Map<string, string>();
  const count: Record<string, number> = {};
  for (const u of units) {
    const base = u.team === 'player' ? u.character.name.split(' ')[0] : u.character.name;
    count[base] = (count[base] ?? 0) + 1;
    names.set(u.uid, `${base}${u.team === 'enemy' ? ' ' + count[base] : ''}`);
  }
  const nm = (uid?: string) => (uid ? names.get(uid) ?? uid : '?');
  for (const u of units) {
    const s = u.stats;
    out.push(`${nm(u.uid).padEnd(12)} ${u.team.padEnd(6)} HP ${s.health} Mana ${s.mana} P.Atk ${s.pAtk} M.Atk ${s.mAtk} Def ${s.defense} Move ${s.movement} skills ${u.character.skillIds.join(',') || '-'} ${u.character.weapon?.type ?? ''}`);
  }
  const b = new Battle(map, units, rng);
  const fmt = (ev: BattleEvent) => {
    switch (ev.type) {
      case 'damage': return `${nm(ev.target)} -${ev.amount}${ev.killed ? ' DIES' : ''}`;
      case 'heal': return `${nm(ev.target)} +${ev.amount}`;
      case 'shield': return `${nm(ev.target)} shield ${ev.amount}`;
      case 'status': return `${nm(ev.target)} ${ev.name}`;
      default: return '';
    }
  };
  const origPerform = b.perform.bind(b);
  let actor: Unit | null = null;
  b.perform = (u, id, tile, aim2) => {
    const evs = origPerform(u, id, tile, aim2);
    const hits = evs.map(fmt).filter(Boolean);
    out.push(`  ${nm(u.uid)} uses ${id}${hits.length ? ': ' + hits.join(', ') : ''}`);
    return evs;
  };
  const hp = (team: string) => b.units.filter((u) => u.team === team).map((u) => `${nm(u.uid)} ${u.alive ? u.hp : 'X'}`).join(' | ');
  while (!b.outcome() && b.round <= 40) {
    out.push(`--- Round ${b.round} ${b.phase} --- party: ${hp('player')}`);
    if (b.phase === 'enemy') out.push(`    enemies: ${hp('enemy')}`);
    for (const u of [...b.readyUnits()]) {
      if (!u.alive || b.outcome()) continue;
      actor = u;
      runAiTurn(b, u);
    }
    if (b.outcome()) break;
    b.endPhase();
  }
  void actor;
  out.push(`RESULT ${b.outcome()} after ${b.round} rounds. party: ${hp('player')}  enemies: ${hp('enemy')}`);
  process.stdout.write(out.join('\n') + '\n');
});
