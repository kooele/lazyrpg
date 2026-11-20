import Phaser from 'phaser';
import { CLASSES } from '../data/content';
import { planTurn } from '../game/ai';
import {
  ATTACK_ID, Battle, deploymentTiles, generateEnemies, getAction, makeUnit, victoryXp,
  type ActionSpec, type BattleEvent, type Unit,
} from '../game/battle';
import { grantXp, makeRng } from '../game/character';
import { TERRAIN, generateMap, key, type Point } from '../game/grid';
import { markDirty, requireState } from '../game/session';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, drawToken, panel, text, toast } from '../ui/widgets';

const TILE = 56;
const MAP_X = 16;
const MAP_Y = 72;
const SIDE_X = 704;
const SIDE_W = 240;

type Phase = 'busy' | 'move' | 'target' | 'over';

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
}

export class BattleScene extends Phaser.Scene {
  private battle!: Battle;
  private views = new Map<string, UnitView>();
  private overlay!: Phaser.GameObjects.Graphics;
  private activeRing!: Phaser.GameObjects.Graphics;
  private sidebar!: Phaser.GameObjects.Container;
  private turnBar!: Phaser.GameObjects.Container;
  private hoverText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private log: string[] = [];
  private phase: Phase = 'busy';
  private reach = new Map<string, { cost: number; prev: string | null }>();
  private selected: ActionSpec | null = null;
  private targets = new Set<string>();
  private hoverTile: Point | null = null;

  constructor() {
    super('Battle');
  }

  create(): void {
    this.views.clear();
    this.log = [];
    this.phase = 'busy';
    this.selected = null;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    const state = requireState();
    const rng = makeRng(Date.now() & 0xffffffff);
    const map = generateMap(rng);
    const party = state.party;
    const foes = generateEnemies(state.progress.stage, party.length, rng);
    const pSpots = deploymentTiles(map, 'player', party.length);
    const eSpots = deploymentTiles(map, 'enemy', foes.length);
    const units = [
      ...party.map((c, i) => makeUnit(c, 'player', pSpots[i])),
      ...foes.map((c, i) => makeUnit(c, 'enemy', eSpots[i])),
    ];
    this.battle = new Battle(map, units, rng);

    this.drawMap();
    this.overlay = this.add.graphics();
    this.activeRing = this.add.graphics();
    for (const u of units) this.createUnitView(u);

    this.turnBar = this.add.container(0, 0);
    this.sidebar = this.add.container(0, 0);
    panel(this, SIDE_X, 488, SIDE_W, 88);
    this.hoverText = text(this, SIDE_X + 10, 496, '', { fontSize: '13px', wordWrap: { width: SIDE_W - 20 } });
    panel(this, MAP_X, 584, TILE * map.width, 48);
    this.logText = text(this, MAP_X + 10, 588, '', { fontSize: '13px', color: COLORS.dim, lineSpacing: 2 });
    button(this, SIDE_X, 590, SIDE_W, 40, 'Retreat to camp', () => this.retreat(), { fontSize: 14 });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(this.tileAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.cancel();
      else this.onClick(this.tileAt(p));
    });
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on('keydown-ESC', () => this.cancel());

    this.addLog(`Stage ${state.progress.stage}: ${foes.length} foes approach!`);
    this.startTurn();
  }

  // ---- drawing --------------------------------------------------------------------

  private tileCenter(p: Point): Point {
    return { x: MAP_X + p.x * TILE + TILE / 2, y: MAP_Y + p.y * TILE + TILE / 2 };
  }

  private tileAt(p: Phaser.Input.Pointer): Point | null {
    const x = Math.floor((p.x - MAP_X) / TILE);
    const y = Math.floor((p.y - MAP_Y) / TILE);
    return x >= 0 && y >= 0 && x < this.battle.map.width && y < this.battle.map.height ? { x, y } : null;
  }

  private drawMap(): void {
    const { map } = this.battle;
    const g = this.add.graphics();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = map.tiles[y][x];
        const px = MAP_X + x * TILE;
        const py = MAP_Y + y * TILE;
        g.fillStyle(TERRAIN[t].color).fillRect(px, py, TILE, TILE);
        if ((x + y) % 2 === 0) g.fillStyle(0xffffff, 0.03).fillRect(px, py, TILE, TILE);
        if (t === 'forest') {
          g.fillStyle(0x1f3f1d);
          g.fillTriangle(px + 14, py + 40, px + 24, py + 14, px + 34, py + 40);
          g.fillTriangle(px + 26, py + 46, px + 38, py + 18, px + 48, py + 46);
        } else if (t === 'rock') {
          g.fillStyle(0x8a8a93).fillCircle(px + 22, py + 32, 13).fillCircle(px + 36, py + 26, 10);
          g.fillStyle(0x55555c).fillCircle(px + 30, py + 38, 8);
        } else if (t === 'water') {
          g.lineStyle(2, 0x5b8fcf, 0.8);
          g.lineBetween(px + 10, py + 22, px + 26, py + 22);
          g.lineBetween(px + 28, py + 36, px + 46, py + 36);
        }
      }
    }
    g.lineStyle(1, 0x000000, 0.25);
    for (let x = 0; x <= map.width; x++) g.lineBetween(MAP_X + x * TILE, MAP_Y, MAP_X + x * TILE, MAP_Y + map.height * TILE);
    for (let y = 0; y <= map.height; y++) g.lineBetween(MAP_X, MAP_Y + y * TILE, MAP_X + map.width * TILE, MAP_Y + y * TILE);
  }

  private createUnitView(u: Unit): void {
    const c = this.tileCenter(u);
    const g = this.add.graphics();
    drawToken(g, 0, -4, 19, u.character.appearance.color, u.character.appearance.emblem, u.team === 'player' ? 0xffffff : 0x2a0a0a);
    const cls = text(this, 13, -27, CLASSES[u.character.classId].name[0], {
      fontSize: '12px', fontStyle: 'bold', color: '#ffffff', backgroundColor: u.team === 'player' ? '#2a3a66' : '#661a1a', padding: { x: 3, y: 0 },
    });
    const hpBar = this.add.graphics();
    const container = this.add.container(c.x, c.y, [g, cls, hpBar]);
    this.views.set(u.uid, { container, hpBar });
    this.drawHp(u);
  }

  private drawHp(u: Unit): void {
    const view = this.views.get(u.uid);
    if (!view) return;
    const pct = u.hp / u.base.maxHp;
    view.hpBar.clear();
    view.hpBar.fillStyle(0x000000, 0.7).fillRect(-21, 18, 42, 6);
    view.hpBar.fillStyle(pct > 0.5 ? 0x6fdc8c : pct > 0.25 ? 0xe0b44c : 0xff6b6b).fillRect(-20, 19, 40 * pct, 4);
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const fill = (p: Point, color: number, alpha: number) => {
      g.fillStyle(color, alpha).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
    };
    const u = this.battle.active;
    if (this.phase === 'move' && !this.battle.hasMoved && u.team === 'player') {
      for (const k of this.reach.keys()) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, 0x4aa3ff, 0.32);
      }
    }
    if (this.phase === 'target' && this.selected) {
      const isHelp = this.selected.target === 'ally';
      for (const p of this.battle.rangeTiles(this.selected, u)) fill(p, isHelp ? 0x6fdc8c : 0xff6b6b, 0.18);
      for (const k of this.targets) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, isHelp ? 0x6fdc8c : 0xff6b6b, 0.42);
      }
      if (this.hoverTile && this.targets.has(key(this.hoverTile.x, this.hoverTile.y))) {
        const r = this.selected.radius;
        for (let y = 0; y < this.battle.map.height; y++) {
          for (let x = 0; x < this.battle.map.width; x++) {
            if (Math.abs(x - this.hoverTile.x) + Math.abs(y - this.hoverTile.y) <= r) fill({ x, y }, 0xffd166, 0.45);
          }
        }
      }
    }
    if (this.hoverTile) {
      g.lineStyle(2, 0xffffff, 0.7).strokeRect(MAP_X + this.hoverTile.x * TILE + 1, MAP_Y + this.hoverTile.y * TILE + 1, TILE - 2, TILE - 2);
    }
    // Active unit ring
    this.activeRing.clear();
    if (u.alive) {
      const c = this.tileCenter(u);
      this.activeRing.lineStyle(3, 0xffd166, 1).strokeCircle(c.x, c.y - 4, 25);
    }
  }

  private renderTurnBar(): void {
    this.turnBar.removeAll(true);
    this.turnBar.add(text(this, MAP_X, 10, `Round ${this.battle.round}`, { color: COLORS.dim, fontSize: '13px' }));
    const g = this.add.graphics();
    this.turnBar.add(g);
    this.battle.upcoming().slice(0, 12).forEach((u, i) => {
      const x = MAP_X + 100 + i * 48;
      drawToken(g, x, 40, i === 0 ? 18 : 14, u.character.appearance.color, u.character.appearance.emblem,
        i === 0 ? 0xffd166 : u.team === 'player' ? 0xffffff : 0x2a0a0a);
    });
    this.turnBar.add(text(this, MAP_X, 30, 'Turn order →', { fontSize: '13px' }));
  }

  private renderSidebar(): void {
    this.sidebar.removeAll(true);
    const S = this.sidebar;
    const u = this.battle.active;
    S.add(panel(this, SIDE_X, 16, SIDE_W, 200));
    const g = this.add.graphics();
    drawToken(g, SIDE_X + 30, 46, 18, u.character.appearance.color, u.character.appearance.emblem);
    S.add(g);
    S.add(text(this, SIDE_X + 58, 26, u.character.name, { fontSize: '18px' }));
    S.add(text(this, SIDE_X + 58, 50, `Lv ${u.character.level} ${CLASSES[u.character.classId].name}${u.team === 'enemy' ? ' (enemy)' : ''}`, {
      color: u.team === 'enemy' ? COLORS.bad : COLORS.dim, fontSize: '13px',
    }));
    S.add(text(this, SIDE_X + 12, 78, this.unitSummary(u), { fontSize: '13px', lineSpacing: 4 }));

    if (u.team !== 'player' || this.phase === 'over') {
      S.add(text(this, SIDE_X + SIDE_W / 2, 250, u.team === 'enemy' ? 'Enemy turn…' : '', { color: COLORS.dim }).setOrigin(0.5));
      return;
    }
    const busy = this.phase === 'busy';
    this.battle.actionIds(u).forEach((id, i) => {
      const a = getAction(u, id);
      const cd = u.cooldowns[id] ?? 0;
      const label = cd > 0 ? `${a.name} (${cd})` : a.name;
      S.add(button(this, SIDE_X, 226 + i * 42, SIDE_W, 36, label, () => this.selectAction(id), {
        enabled: !busy && cd <= 0,
        selected: this.selected?.id === id,
        fontSize: 15,
        onHover: () => this.hoverText.setText(`${a.name}: ${a.description}${a.cooldown ? ` Cooldown ${a.cooldown}.` : ''}`),
      }));
    });
    const y = 226 + this.battle.actionIds(u).length * 42;
    S.add(button(this, SIDE_X, y, 116, 36, 'Wait', () => this.finishTurn(), { enabled: !busy, fontSize: 15 }));
    S.add(button(this, SIDE_X + 124, y, 116, 36, 'Undo move', () => this.undoMove(), {
      enabled: !busy && this.battle.hasMoved, fontSize: 15,
    }));
  }

  private unitSummary(u: Unit): string {
    const b = this.battle;
    const statuses = u.statuses.map((s) => `${s.name} (${s.amount > 0 ? '+' : ''}${s.amount} ${s.stat}, ${s.turns}t)`).join('\n');
    return [
      `HP ${u.hp}/${u.base.maxHp}   Move ${b.stat(u, 'move')}   Spd ${b.stat(u, 'speed')}`,
      `Phys ${b.stat(u, 'physPower')}   Mag ${b.stat(u, 'magPower')}`,
      `Def ${b.stat(u, 'defense')}   Res ${b.stat(u, 'resistance')}`,
      statuses,
    ].filter(Boolean).join('\n');
  }

  private addLog(line: string): void {
    this.log.push(line);
    this.logText.setText(this.log.slice(-2).join('\n'));
  }

  // ---- turn flow -----------------------------------------------------------------

  private startTurn(): void {
    const u = this.battle.active;
    this.selected = null;
    this.targets.clear();
    this.renderTurnBar();
    if (u.team === 'player') {
      this.phase = 'move';
      this.reach = this.battle.reachable(u);
      this.renderSidebar();
      this.drawOverlay();
    } else {
      this.phase = 'busy';
      this.renderSidebar();
      this.drawOverlay();
      void this.runEnemyTurn(u);
    }
  }

  private async runEnemyTurn(u: Unit): Promise<void> {
    await this.wait(350);
    const plan = planTurn(this.battle, u);
    if (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y) {
      const path = this.battle.move(u, plan.moveTo);
      await this.animatePath(u, path);
    }
    if (plan.action) {
      const action = getAction(u, plan.action.id);
      this.selected = action;
      this.phase = 'target';
      this.targets = new Set([key(plan.action.target.x, plan.action.target.y)]);
      this.hoverTile = plan.action.target;
      this.drawOverlay();
      await this.wait(400);
      this.hoverTile = null;
      this.phase = 'busy';
      await this.resolve(u, action, plan.action.target);
    }
    this.finishTurn();
  }

  private finishTurn(): void {
    if (this.phase === 'over') return;
    const outcome = this.battle.outcome();
    if (outcome) return this.endBattle(outcome);
    this.battle.endTurn();
    this.startTurn();
  }

  private selectAction(id: string): void {
    if (this.phase === 'busy' || this.phase === 'over') return;
    const u = this.battle.active;
    const action = getAction(u, id);
    const targets = this.battle.validTargets(u, action);
    if (targets.length === 0) {
      toast(this, `${action.name}: no valid targets in range${this.battle.hasMoved ? '' : ' — move first?'}`, COLORS.bad);
      return;
    }
    this.selected = action;
    this.targets = new Set(targets.map((t) => key(t.x, t.y)));
    this.phase = 'target';
    this.renderSidebar();
    this.drawOverlay();
  }

  private cancel(): void {
    if (this.phase !== 'target' || this.battle.active.team !== 'player') return;
    this.selected = null;
    this.targets.clear();
    this.phase = 'move';
    this.renderSidebar();
    this.drawOverlay();
  }

  private undoMove(): void {
    const u = this.battle.active;
    this.battle.undoMove(u);
    const c = this.tileCenter(u);
    this.views.get(u.uid)!.container.setPosition(c.x, c.y);
    this.reach = this.battle.reachable(u);
    this.cancel();
    this.phase = 'move';
    this.renderSidebar();
    this.drawOverlay();
  }

  private async onClick(tile: Point | null): Promise<void> {
    if (!tile || this.battle.active.team !== 'player') return;
    const u = this.battle.active;
    const k = key(tile.x, tile.y);
    if (this.phase === 'move' && !this.battle.hasMoved && this.reach.has(k) && (tile.x !== u.x || tile.y !== u.y)) {
      this.phase = 'busy';
      this.renderSidebar();
      const path = this.battle.move(u, tile);
      this.drawOverlay();
      await this.animatePath(u, path);
      this.phase = 'move';
      this.renderSidebar();
      this.drawOverlay();
    } else if (this.phase === 'target' && this.selected) {
      if (!this.targets.has(k)) return this.cancel();
      const action = this.selected;
      this.phase = 'busy';
      this.selected = null;
      this.targets.clear();
      this.renderSidebar();
      this.drawOverlay();
      await this.resolve(u, action, tile);
      this.finishTurn();
    }
  }

  private onHover(tile: Point | null): void {
    const changed = tile?.x !== this.hoverTile?.x || tile?.y !== this.hoverTile?.y;
    if (!changed) return;
    this.hoverTile = tile;
    if (this.phase !== 'busy') this.drawOverlay();
    if (!tile) return;
    const b = this.battle;
    const target = b.unitAt(tile.x, tile.y);
    const terrain = TERRAIN[b.map.tiles[tile.y][tile.x]];
    let info = `${terrain.name}${terrain.moveCost === null ? ' (impassable)' : terrain.moveCost > 1 ? ` (move cost ${terrain.moveCost}, +${terrain.defense} def/res)` : ''}`;
    if (target) {
      info = `${target.character.name} — Lv ${target.character.level} ${CLASSES[target.character.classId].name}\n${this.unitSummary(target)}`;
      if (this.phase === 'target' && this.selected && this.targets.has(key(tile.x, tile.y))) {
        info = `${this.preview(b.active, this.selected, tile)}\n${info}`;
      }
    }
    this.hoverText.setText(info);
  }

  private preview(u: Unit, action: ActionSpec, tile: Point): string {
    const hits = this.battle.affected(u, action, tile);
    return hits.map((t) => {
      if (action.kind === 'damage') return `→ ${t.character.name}: ${this.battle.damage(u, t, action)} dmg, ${this.battle.hitChance(u, t, action)}% hit`;
      if (action.kind === 'heal') return `→ ${t.character.name}: +${Math.min(this.battle.healAmount(u, action), t.base.maxHp - t.hp)} HP`;
      return `→ ${t.character.name}: ${action.status?.name}`;
    }).join('\n');
  }

  // ---- animation -----------------------------------------------------------------

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private async animatePath(u: Unit, path: Point[]): Promise<void> {
    const view = this.views.get(u.uid)!;
    for (const step of path) {
      const c = this.tileCenter(step);
      await new Promise<void>((resolve) => {
        this.tweens.add({ targets: view.container, x: c.x, y: c.y, duration: 110, onComplete: () => resolve() });
      });
    }
    this.drawOverlay();
  }

  private floatText(u: Unit, value: string, color: string): void {
    const c = this.tileCenter(u);
    const t = text(this, c.x, c.y - 20, value, { fontSize: '20px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(500);
    this.tweens.add({ targets: t, y: c.y - 56, alpha: 0, duration: 1000, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private async resolve(u: Unit, action: ActionSpec, target: Point): Promise<void> {
    const events = this.battle.perform(u, action.id, target);
    const name = (uid: string) => this.battle.unit(uid).character.name;
    const view = this.views.get(u.uid)!;
    // little lunge toward the target
    const from = this.tileCenter(u);
    const to = this.tileCenter(target);
    if (action.id === ATTACK_ID || action.kind === 'damage') {
      await new Promise<void>((resolve) => this.tweens.add({
        targets: view.container, x: from.x + (to.x - from.x) * 0.2, y: from.y + (to.y - from.y) * 0.2,
        duration: 90, yoyo: true, onComplete: () => resolve(),
      }));
    }
    const summary: string[] = [];
    for (const e of events) this.showEvent(e, summary, name);
    this.addLog(`${u.character.name} uses ${action.name}${summary.length ? ': ' + summary.join(', ') : ''}`);
    this.renderTurnBar();
    await this.wait(750);
  }

  private showEvent(e: BattleEvent, summary: string[], name: (uid: string) => string): void {
    const t = this.battle.unit(e.target);
    switch (e.type) {
      case 'damage':
        this.floatText(t, `${e.crit ? 'CRIT ' : ''}-${e.amount}`, e.crit ? '#ffd166' : '#ff6b6b');
        this.drawHp(t);
        this.cameras.main.shake(80, 0.003);
        summary.push(`${name(e.target)} -${e.amount}${e.crit ? ' (crit)' : ''}${e.killed ? ' ☠' : ''}`);
        if (e.killed) {
          const v = this.views.get(t.uid)!;
          this.tweens.add({ targets: v.container, alpha: 0, scale: 0.5, duration: 500, onComplete: () => v.container.setVisible(false) });
        }
        break;
      case 'miss':
        this.floatText(t, 'MISS', '#c9ced8');
        summary.push(`${name(e.target)} dodged`);
        break;
      case 'heal':
        this.floatText(t, `+${e.amount}`, '#6fdc8c');
        this.drawHp(t);
        summary.push(`${name(e.target)} +${e.amount} HP`);
        break;
      case 'status':
        this.time.delayedCall(250, () => this.floatText(t, e.status.name, '#8ecbff'));
        summary.push(`${name(e.target)} ${e.status.name}`);
        break;
    }
  }

  // ---- end of battle -------------------------------------------------------------

  private retreat(): void {
    if (this.phase === 'over' || this.battle.active.team !== 'player' || this.phase === 'busy') return;
    confirmDialog(this, 'Retreat to camp?\nThis counts as a defeat (no XP).', () => this.endBattle('defeat'), 'Retreat');
  }

  private endBattle(outcome: 'victory' | 'defeat'): void {
    this.phase = 'over';
    this.overlay.clear();
    this.activeRing.clear();
    this.renderSidebar();
    const state = requireState();
    const lines: string[] = [];
    if (outcome === 'victory') {
      const xp = victoryXp(state.progress.stage);
      state.progress.victories += 1;
      state.progress.stage += 1;
      lines.push(`Each hero gains ${xp} XP.`);
      for (const c of state.party) {
        const levels = grantXp(c, xp);
        if (levels > 0) lines.push(`${c.name} reached level ${c.level}! (+${levels * 3} attribute points)`);
      }
      lines.push('', `Next up: stage ${state.progress.stage}.`);
    } else {
      state.progress.defeats += 1;
      lines.push('Your party falls back to camp to recover.', 'Rebuild, re-equip and try again.');
    }
    markDirty();

    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.65).setOrigin(0).setInteractive());
    layer.add(panel(this, WIDTH / 2 - 260, HEIGHT / 2 - 150, 520, 300));
    layer.add(text(this, WIDTH / 2, HEIGHT / 2 - 110, outcome === 'victory' ? 'Victory!' : 'Defeat', {
      fontSize: '40px', color: outcome === 'victory' ? COLORS.gold : COLORS.bad,
    }).setOrigin(0.5));
    layer.add(text(this, WIDTH / 2, HEIGHT / 2 - 60, lines.join('\n'), { align: 'center', wordWrap: { width: 480 }, lineSpacing: 4 }).setOrigin(0.5, 0));
    layer.add(button(this, WIDTH / 2 - 110, HEIGHT / 2 + 84, 220, 50, 'Return to camp', () => this.scene.start('Camp'), { fontSize: 18 }));
  }
}
