import Phaser from 'phaser';
import { CLASSES } from '../data/content';
import { planTurn } from '../game/ai';
import {
  Battle, deploymentTiles, generateEnemies, getAction, makeUnit, victoryXp,
  type ActionSpec, type BattleEvent, type Unit,
} from '../game/battle';
import { grantXp, makeRng } from '../game/character';
import { TERRAIN, generateMap, key, manhattan, type Point } from '../game/grid';
import { markDirty, requireState } from '../game/session';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, drawToken, panel, setupCamera, text } from '../ui/widgets';

const TILE = 56;
const MAP_X = 16;
const MAP_Y = 72;
const SIDE_X = 704;
const SIDE_W = 240;

/**
 * busy   – animating or enemy phase, no input
 * select – player phase: pick a unit, move it, or pick an action
 * target – player picked an action and is choosing a tile
 * over   – battle finished
 */
type Mode = 'busy' | 'select' | 'target' | 'over';

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
}

export class BattleScene extends Phaser.Scene {
  private battle!: Battle;
  private views = new Map<string, UnitView>();
  private overlay!: Phaser.GameObjects.Graphics;
  private rings!: Phaser.GameObjects.Graphics;
  private sidebar!: Phaser.GameObjects.Container;
  private topBar!: Phaser.GameObjects.Container;
  private hoverText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private log: string[] = [];
  private mode: Mode = 'busy';
  /** The player unit currently being commanded. */
  private selectedUid: string | null = null;
  /** The unit whose action is being shown (player or enemy). */
  private casterUid: string | null = null;
  private reach = new Map<string, { cost: number; prev: string | null }>();
  /** Action chosen for targeting. */
  private action: ActionSpec | null = null;
  /** Action whose range is previewed while hovering its button. */
  private previewAction: ActionSpec | null = null;
  private hoverTile: Point | null = null;

  constructor() {
    super('Battle');
  }

  create(): void {
    this.views.clear();
    this.log = [];
    this.mode = 'busy';
    this.selectedUid = null;
    this.casterUid = null;
    this.action = null;
    this.previewAction = null;
    this.hoverTile = null;
    setupCamera(this);

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
    this.rings = this.add.graphics();
    for (const u of units) this.createUnitView(u);

    this.topBar = this.add.container(0, 0);
    this.sidebar = this.add.container(0, 0);
    panel(this, SIDE_X, 488, SIDE_W, 92);
    this.hoverText = text(this, SIDE_X + 10, 496, '', { fontSize: '13px', wordWrap: { width: SIDE_W - 20 } });
    panel(this, MAP_X, 584, TILE * map.width, 48);
    this.logText = text(this, MAP_X + 10, 588, '', { fontSize: '13px', color: COLORS.dim, lineSpacing: 2 });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(this.tileAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.cancel();
      else void this.onClick(this.tileAt(p));
    });
    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on('keydown-ESC', () => this.cancel());
    this.input.keyboard?.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.cycleUnit();
    });

    this.addLog(`Stage ${state.progress.stage}: ${foes.length} foe${foes.length > 1 ? 's' : ''} approach!`);
    void this.startPlayerPhase();
  }

  // ---- helpers ----------------------------------------------------------------------

  private get selected(): Unit | null {
    return this.selectedUid ? this.battle.unit(this.selectedUid) : null;
  }

  private tileCenter(p: Point): Point {
    return { x: MAP_X + p.x * TILE + TILE / 2, y: MAP_Y + p.y * TILE + TILE / 2 };
  }

  private tileAt(p: Phaser.Input.Pointer): Point | null {
    // worldX/Y account for the camera zoom used for high-resolution rendering.
    const x = Math.floor((p.worldX - MAP_X) / TILE);
    const y = Math.floor((p.worldY - MAP_Y) / TILE);
    return x >= 0 && y >= 0 && x < this.battle.map.width && y < this.battle.map.height ? { x, y } : null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  // ---- drawing ------------------------------------------------------------------------

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

  /** Dim units that have already acted this phase. */
  private refreshUnitTint(): void {
    for (const u of this.battle.units) {
      if (!u.alive) continue;
      const done = u.team === this.battle.phase && u.acted;
      this.views.get(u.uid)?.container.setAlpha(done ? 0.5 : 1);
    }
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const fill = (p: Point, color: number, alpha: number) => {
      g.fillStyle(color, alpha).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
    };
    const outline = (p: Point, color: number, alpha: number) => {
      g.lineStyle(2, color, alpha).strokeRect(MAP_X + p.x * TILE + 3, MAP_Y + p.y * TILE + 3, TILE - 6, TILE - 6);
    };
    const sel = this.selected;

    // Movement range for the selected unit.
    if (this.mode === 'select' && sel && this.battle.canMove(sel) && !this.previewAction) {
      for (const k of this.reach.keys()) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, 0x4aa3ff, 0.32);
      }
    }

    // Action range ("attack box"): while targeting, or while hovering an action button.
    const shown = this.mode === 'target' ? this.action : this.mode === 'select' ? this.previewAction : null;
    const caster = this.casterUid ? this.battle.unit(this.casterUid) : sel;
    if (shown && caster) {
      const color = shown.target === 'ally' ? 0x6fdc8c : 0xff6b6b;
      for (const p of this.battle.rangeTiles(shown, caster)) {
        fill(p, color, 0.22);
        outline(p, color, 0.55);
      }
      // Area of effect under the cursor.
      const h = this.hoverTile;
      if (this.mode === 'target' && h && this.battle.inRange(shown, caster, h)) {
        for (let y = 0; y < this.battle.map.height; y++) {
          for (let x = 0; x < this.battle.map.width; x++) {
            if (manhattan({ x, y }, h) <= shown.radius) fill({ x, y }, 0xffd166, 0.5);
          }
        }
      }
    }

    if (this.hoverTile) {
      g.lineStyle(2, 0xffffff, 0.8).strokeRect(MAP_X + this.hoverTile.x * TILE + 1, MAP_Y + this.hoverTile.y * TILE + 1, TILE - 2, TILE - 2);
    }

    // Selection rings: gold for the commanded unit, faint for other ready units.
    this.rings.clear();
    if (this.battle.phase === 'player' && this.mode !== 'over') {
      for (const u of this.battle.readyUnits()) {
        const c = this.tileCenter(u);
        const isSel = u === sel;
        this.rings.lineStyle(isSel ? 3 : 2, 0xffd166, isSel ? 1 : 0.35).strokeCircle(c.x, c.y - 4, 25);
      }
    } else if (this.casterUid && this.mode !== 'over') {
      const c = this.tileCenter(this.battle.unit(this.casterUid));
      this.rings.lineStyle(3, 0xff6b6b, 1).strokeCircle(c.x, c.y - 4, 25);
    }
  }

  private renderTopBar(): void {
    this.topBar.removeAll(true);
    const b = this.battle;
    const mine = b.phase === 'player';
    this.topBar.add(text(this, MAP_X, 8, `Round ${b.round}`, { color: COLORS.dim, fontSize: '13px' }));
    this.topBar.add(text(this, MAP_X, 26, mine ? 'YOUR TURN' : 'ENEMY TURN', {
      fontSize: '22px', fontStyle: 'bold', color: mine ? '#8ecbff' : COLORS.bad,
    }));
    // Party roster: click to select; dimmed once a hero has acted.
    const g = this.add.graphics();
    this.topBar.add(g);
    const heroes = b.living('player');
    heroes.forEach((u, i) => {
      const x = MAP_X + 190 + i * 52;
      const ready = mine && !u.acted;
      drawToken(g, x, 38, 17, u.character.appearance.color, u.character.appearance.emblem, u.uid === this.selectedUid ? 0xffd166 : 0xffffff);
      if (!ready) g.fillStyle(0x0e1018, 0.6).fillCircle(x, 38, 19);
      const hit = this.add.zone(x, 38, 40, 40).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.selectUnit(u));
      this.topBar.add(hit);
    });
    if (mine) {
      this.topBar.add(text(this, MAP_X + 176 + heroes.length * 52, 30, 'Tab: next hero', { color: COLORS.dim, fontSize: '12px' }));
    }
    this.topBar.add(button(this, MAP_X + TILE * b.map.width - 96, 16, 96, 40, 'Retreat', () => this.retreat(), {
      fontSize: 13, enabled: this.mode === 'select' || this.mode === 'target',
    }));
  }

  private renderSidebar(): void {
    this.sidebar.removeAll(true);
    const S = this.sidebar;
    const b = this.battle;
    const u = this.selected ?? (this.casterUid ? b.unit(this.casterUid) : null);
    S.add(panel(this, SIDE_X, 16, SIDE_W, 200));
    if (u) {
      const g = this.add.graphics();
      drawToken(g, SIDE_X + 30, 46, 18, u.character.appearance.color, u.character.appearance.emblem);
      S.add(g);
      S.add(text(this, SIDE_X + 58, 26, u.character.name, { fontSize: '18px' }));
      S.add(text(this, SIDE_X + 58, 50, `Lv ${u.character.level} ${CLASSES[u.character.classId].name}${u.team === 'enemy' ? ' (enemy)' : ''}`, {
        color: u.team === 'enemy' ? COLORS.bad : COLORS.dim, fontSize: '13px',
      }));
      S.add(text(this, SIDE_X + 12, 78, this.unitSummary(u), { fontSize: '13px', lineSpacing: 4 }));
      if (u.team === 'player' && b.phase === 'player') {
        const status = u.acted ? 'Done this turn' : u.moved ? 'Moved — can still act' : 'Ready to move and act';
        S.add(text(this, SIDE_X + 12, 192, status, { fontSize: '12px', color: u.acted ? COLORS.dim : COLORS.good }));
      }
    }

    if (b.phase !== 'player' || this.mode === 'over') {
      S.add(text(this, SIDE_X + SIDE_W / 2, 260, this.mode === 'over' ? '' : 'Enemy turn…', { color: COLORS.dim }).setOrigin(0.5));
      return;
    }
    const interactive = this.mode === 'select' || this.mode === 'target';
    if (u && u.team === 'player') {
      const canAct = interactive && b.canAct(u);
      b.actionIds(u).forEach((id, i) => {
        const a = getAction(u, id);
        const cd = u.cooldowns[id] ?? 0;
        const label = cd > 0 ? `${a.name} (${cd})` : a.name;
        S.add(button(this, SIDE_X, 226 + i * 42, SIDE_W, 36, label, () => this.selectAction(id), {
          enabled: canAct && cd <= 0,
          selected: this.mode === 'target' && this.action?.id === id,
          fontSize: 15,
          onHover: () => {
            this.hoverText.setText(`${a.name}: ${a.description}${a.cooldown ? ` Cooldown ${a.cooldown}.` : ''}`);
            if (this.mode === 'select') {
              this.previewAction = a;
              this.drawOverlay();
            }
          },
          onOut: () => {
            if (this.previewAction) {
              this.previewAction = null;
              this.drawOverlay();
            }
          },
        }));
      });
      const y = 226 + b.actionIds(u).length * 42;
      S.add(button(this, SIDE_X, y, 116, 36, 'Wait', () => this.waitUnit(), { enabled: canAct, fontSize: 15 }));
      S.add(button(this, SIDE_X + 124, y, 116, 36, 'Undo move', () => this.undoMove(), {
        enabled: interactive && b.canUndoMove(u), fontSize: 15,
      }));
    }
    S.add(button(this, SIDE_X, 590, SIDE_W, 40, 'End Turn', () => this.endPlayerPhase(), {
      enabled: interactive, fill: 0x4a2a22, fontSize: 16, selected: interactive && b.readyUnits().length === 0,
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

  private refresh(): void {
    this.refreshUnitTint();
    this.renderTopBar();
    this.renderSidebar();
    this.drawOverlay();
  }

  private addLog(line: string): void {
    this.log.push(line);
    this.logText.setText(this.log.slice(-2).join('\n'));
  }

  private async banner(label: string, color: string): Promise<void> {
    const t = text(this, MAP_X + (TILE * this.battle.map.width) / 2, MAP_Y + (TILE * this.battle.map.height) / 2, label, {
      fontSize: '44px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(900).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 200, yoyo: true, hold: 600, onComplete: () => t.destroy() });
    await this.wait(700);
  }

  // ---- player phase ---------------------------------------------------------------------

  private async startPlayerPhase(): Promise<void> {
    this.mode = 'busy';
    this.casterUid = null;
    this.selectedUid = null;
    this.refresh();
    await this.banner('YOUR TURN', '#8ecbff');
    this.mode = 'select';
    this.selectUnit(this.battle.readyUnits()[0]);
  }

  private selectUnit(u: Unit | undefined): void {
    if (!u || u.team !== 'player' || !u.alive) return;
    if (this.mode !== 'select' && this.mode !== 'target') return;
    this.mode = 'select';
    this.action = null;
    this.previewAction = null;
    this.selectedUid = u.uid;
    this.reach = this.battle.canMove(u) ? this.battle.reachable(u) : new Map();
    this.refresh();
  }

  private cycleUnit(): void {
    if (this.mode !== 'select' && this.mode !== 'target') return;
    const ready = this.battle.readyUnits();
    if (ready.length === 0) return;
    const i = ready.findIndex((u) => u.uid === this.selectedUid);
    this.selectUnit(ready[(i + 1) % ready.length]);
  }

  private selectAction(id: string): void {
    const u = this.selected;
    if (!u || (this.mode !== 'select' && this.mode !== 'target') || !this.battle.canAct(u)) return;
    this.action = getAction(u, id);
    this.previewAction = null;
    this.mode = 'target';
    this.renderSidebar();
    this.drawOverlay();
    this.hoverText.setText(`${this.action.name}: click any tile in range (right-click / Esc to cancel).`);
  }

  private cancel(): void {
    if (this.mode !== 'target') return;
    this.action = null;
    this.mode = 'select';
    this.renderSidebar();
    this.drawOverlay();
  }

  private undoMove(): void {
    const u = this.selected;
    if (!u || !this.battle.canUndoMove(u)) return;
    this.battle.undoMove(u);
    const c = this.tileCenter(u);
    this.views.get(u.uid)!.container.setPosition(c.x, c.y);
    this.selectUnit(u);
  }

  private waitUnit(): void {
    const u = this.selected;
    if (!u || !this.battle.canAct(u)) return;
    this.battle.wait(u);
    this.addLog(`${u.character.name} holds position.`);
    this.afterUnitDone();
  }

  /** After a hero acts, jump to the next hero who still can; end the phase when nobody can. */
  private afterUnitDone(): void {
    const outcome = this.battle.outcome();
    if (outcome) return this.endBattle(outcome);
    this.mode = 'select';
    this.action = null;
    const next = this.battle.readyUnits()[0];
    if (next) this.selectUnit(next);
    else this.endPlayerPhase();
  }

  private async onClick(tile: Point | null): Promise<void> {
    if (!tile || this.battle.phase !== 'player') return;
    const b = this.battle;
    const u = this.selected;
    const clicked = b.unitAt(tile.x, tile.y);

    if (this.mode === 'target' && u && this.action) {
      if (!b.inRange(this.action, u, tile)) return this.cancel();
      const action = this.action;
      this.mode = 'busy';
      this.action = null;
      this.casterUid = u.uid;
      this.refresh();
      await this.resolve(u, action, tile);
      this.casterUid = null;
      this.afterUnitDone();
      return;
    }
    if (this.mode !== 'select') return;

    // Clicking another of your heroes switches to them.
    if (clicked && clicked.team === 'player' && clicked !== u) return this.selectUnit(clicked);

    const k = key(tile.x, tile.y);
    if (u && b.canMove(u) && this.reach.has(k) && (tile.x !== u.x || tile.y !== u.y)) {
      this.mode = 'busy';
      const path = b.move(u, tile);
      this.refresh();
      await this.animatePath(u, path);
      this.mode = 'select';
      this.reach = new Map();
      this.refresh();
    }
  }

  private onHover(tile: Point | null): void {
    const changed = tile?.x !== this.hoverTile?.x || tile?.y !== this.hoverTile?.y;
    if (!changed) return;
    this.hoverTile = tile;
    if (this.mode !== 'busy') this.drawOverlay();
    if (!tile) return;
    const b = this.battle;
    const target = b.unitAt(tile.x, tile.y);
    const terrain = TERRAIN[b.map.tiles[tile.y][tile.x]];
    let info = `${terrain.name}${terrain.moveCost === null ? ' (impassable)' : terrain.moveCost > 1 ? ` (move cost ${terrain.moveCost}, +${terrain.defense} def/res)` : ''}`;
    if (target) {
      info = `${target.character.name} — Lv ${target.character.level} ${CLASSES[target.character.classId].name}\n${this.unitSummary(target)}`;
    }
    const u = this.selected;
    if (this.mode === 'target' && this.action && u) {
      info = b.inRange(this.action, u, tile)
        ? `${this.preview(u, this.action, tile)}\n${info}`
        : `Out of range — click to cancel.\n${info}`;
    }
    this.hoverText.setText(info);
  }

  private preview(u: Unit, action: ActionSpec, tile: Point): string {
    const hits = this.battle.affected(u, action, tile);
    if (hits.length === 0) return '→ Nobody in the area (action will be spent)';
    return hits.map((t) => {
      if (action.kind === 'damage') return `→ ${t.character.name}: ${this.battle.damage(u, t, action)} dmg, ${this.battle.hitChance(u, t, action)}% hit`;
      if (action.kind === 'heal') return `→ ${t.character.name}: +${Math.min(this.battle.healAmount(u, action), t.base.maxHp - t.hp)} HP`;
      return `→ ${t.character.name}: ${action.status?.name}`;
    }).join('\n');
  }

  private endPlayerPhase(): void {
    if (this.mode !== 'select' && this.mode !== 'target') return;
    this.mode = 'busy';
    this.action = null;
    this.selectedUid = null;
    this.battle.endPhase();
    void this.runEnemyPhase();
  }

  // ---- enemy phase ----------------------------------------------------------------------

  private async runEnemyPhase(): Promise<void> {
    const b = this.battle;
    this.refresh();
    await this.banner('ENEMY TURN', COLORS.bad);
    // Fastest enemies act first.
    const order = b.readyUnits().sort((x, y) => b.stat(y, 'speed') - b.stat(x, 'speed'));
    for (const u of order) {
      if (!u.alive || b.outcome()) continue;
      this.casterUid = u.uid;
      this.refresh();
      await this.wait(250);
      const plan = planTurn(b, u);
      if (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y) {
        const path = b.move(u, plan.moveTo);
        await this.animatePath(u, path);
      }
      if (plan.action) {
        const action = getAction(u, plan.action.id);
        this.action = action;
        this.mode = 'target';
        this.hoverTile = plan.action.target;
        this.drawOverlay();
        await this.wait(450);
        this.mode = 'busy';
        this.action = null;
        this.hoverTile = null;
        await this.resolve(u, action, plan.action.target);
      } else {
        b.wait(u);
        this.addLog(`${u.character.name} advances.`);
      }
      this.refreshUnitTint();
    }
    this.casterUid = null;
    const outcome = b.outcome();
    if (outcome) return this.endBattle(outcome);
    b.endPhase();
    void this.startPlayerPhase();
  }

  // ---- animation --------------------------------------------------------------------------

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
    const from = this.tileCenter(u);
    const to = this.tileCenter(target);
    if (action.kind === 'damage' && (target.x !== u.x || target.y !== u.y)) {
      await new Promise<void>((resolve) => this.tweens.add({
        targets: view.container, x: from.x + (to.x - from.x) * 0.2, y: from.y + (to.y - from.y) * 0.2,
        duration: 90, yoyo: true, onComplete: () => resolve(),
      }));
    }
    this.flashArea(action, target);
    const summary: string[] = [];
    for (const e of events) this.showEvent(e, summary, name);
    this.addLog(`${u.character.name} uses ${action.name}${summary.length ? ': ' + summary.join(', ') : ' — it hits nothing.'}`);
    this.refreshUnitTint();
    this.renderTopBar();
    await this.wait(events.length ? 750 : 400);
  }

  /** Brief flash on the tiles the action struck (also shows when it hits empty ground). */
  private flashArea(action: ActionSpec, target: Point): void {
    const g = this.add.graphics().setDepth(400);
    const color = action.target === 'ally' ? 0x6fdc8c : 0xffd166;
    for (let y = 0; y < this.battle.map.height; y++) {
      for (let x = 0; x < this.battle.map.width; x++) {
        if (manhattan({ x, y }, target) <= action.radius) {
          g.fillStyle(color, 0.55).fillRect(MAP_X + x * TILE + 1, MAP_Y + y * TILE + 1, TILE - 2, TILE - 2);
        }
      }
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
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
    if (this.mode !== 'select' && this.mode !== 'target') return;
    confirmDialog(this, 'Retreat to camp?\nThis counts as a defeat (no XP).', () => this.endBattle('defeat'), 'Retreat');
  }

  private endBattle(outcome: 'victory' | 'defeat'): void {
    if (this.mode === 'over') return;
    this.mode = 'over';
    this.selectedUid = null;
    this.casterUid = null;
    this.overlay.clear();
    this.rings.clear();
    this.renderSidebar();
    this.renderTopBar();
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
