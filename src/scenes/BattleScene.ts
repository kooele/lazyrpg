import Phaser from 'phaser';
import { SKILLS, WEAPONS, skillDetails } from '../data/content';
import type { SkillDef } from '../data/types';
import { bestAction, bestFreeAction, planTurn } from '../game/ai';
import {
  Battle, deploymentTiles, generateEnemies, makeUnit, victoryXp,
  type BattleEvent, type MoveResult, type Unit,
} from '../game/battle';
import { grantXp, makeRng } from '../game/character';
import { TERRAIN, generateMap, key, type Point } from '../game/grid';
import { markDirty, requireState } from '../game/session';
import { COLORS, HEIGHT, WIDTH, button, confirmDialog, drawToken, panel, setupCamera, text } from '../ui/widgets';

const TILE = 56;
const MAP_X = 16;
const MAP_Y = 72;
const SIDE_X = 704;
const SIDE_W = 240;

/**
 * busy   – animating or enemy turn, no input
 * select – player turn: pick a unit, move it, or pick a skill
 * target – player picked a skill and is choosing a tile
 * over   – battle finished
 */
type Mode = 'busy' | 'select' | 'target' | 'over';

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  statusText: Phaser.GameObjects.Text;
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
  /** The unit whose skill is being shown (player or enemy). */
  private casterUid: string | null = null;
  private reach = new Map<string, { cost: number; prev: string | null }>();
  /** Skill chosen for targeting. */
  private action: SkillDef | null = null;
  /** Skill whose range is previewed while hovering its button. */
  private previewAction: SkillDef | null = null;
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
    panel(this, SIDE_X, 482, SIDE_W, 100);
    this.hoverText = text(this, SIDE_X + 10, 489, '', { fontSize: '12px', wordWrap: { width: SIDE_W - 20 }, lineSpacing: 1 });
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

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ ...config, onComplete: () => resolve() }));
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
    const tag = text(this, 10, -28, WEAPONS[u.character.weaponId].tag, {
      fontSize: '10px', fontStyle: 'bold', color: '#ffffff', backgroundColor: u.team === 'player' ? '#2a3a66' : '#661a1a', padding: { x: 2, y: 0 },
    });
    const statusText = text(this, -26, -28, '', { fontSize: '10px', fontStyle: 'bold', color: '#ffb35c', stroke: '#000000', strokeThickness: 3 });
    const hpBar = this.add.graphics();
    const container = this.add.container(c.x, c.y, [g, tag, statusText, hpBar]);
    this.views.set(u.uid, { container, hpBar, statusText });
    this.drawHp(u);
  }

  /** HP bar (green/yellow/red) with the shield as a light-blue extension, plus status tags. */
  private drawHp(u: Unit): void {
    const view = this.views.get(u.uid);
    if (!view) return;
    const max = u.stats.health;
    const pct = u.hp / max;
    const shield = Math.min(1 - pct, this.battle.shieldOf(u) / max);
    view.hpBar.clear();
    view.hpBar.fillStyle(0x000000, 0.7).fillRect(-21, 18, 42, 6);
    view.hpBar.fillStyle(pct > 0.5 ? 0x6fdc8c : pct > 0.25 ? 0xe0b44c : 0xff6b6b).fillRect(-20, 19, 40 * pct, 4);
    if (this.battle.shieldOf(u) > 0) {
      view.hpBar.fillStyle(0x8ecbff).fillRect(-20 + 40 * pct, 19, Math.max(2, 40 * shield), 4);
      view.hpBar.lineStyle(1, 0x8ecbff).strokeRect(-21, 18, 42, 6);
    }
    const tags: string[] = [];
    const burn = u.statuses.find((s) => s.id === 'burn');
    if (burn) tags.push(`B${burn.stacks}`);
    if (u.overwatch) tags.push(SKILLS[u.overwatch.skillId].cone?.interrupt ? 'IC' : 'OW');
    view.statusText.setText(tags.join(' '));
  }

  /** Dim units that have already acted this turn. */
  private refreshUnits(): void {
    for (const u of this.battle.units) {
      if (!u.alive) continue;
      const done = u.team === this.battle.phase && u.acted;
      this.views.get(u.uid)?.container.setAlpha(done ? 0.5 : 1);
      this.drawHp(u);
    }
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const b = this.battle;
    const fill = (p: Point, color: number, alpha: number) => {
      g.fillStyle(color, alpha).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
    };
    const outline = (p: Point, color: number, alpha: number, inset = 3) => {
      g.lineStyle(2, color, alpha).strokeRect(MAP_X + p.x * TILE + inset, MAP_Y + p.y * TILE + inset, TILE - inset * 2, TILE - inset * 2);
    };
    const sel = this.selected;

    // Standing overwatch / intercept cones.
    for (const u of b.living()) {
      if (!u.overwatch) continue;
      const color = u.team === 'player' ? 0x8ecbff : 0xff8a8a;
      for (const k of u.overwatch.tiles) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, color, 0.1);
        outline({ x, y }, color, 0.35, 8);
      }
    }

    // Movement range for the selected unit.
    if (this.mode === 'select' && sel && b.canMove(sel) && !this.previewAction) {
      for (const k of this.reach.keys()) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, 0x4aa3ff, 0.32);
      }
    }

    // Skill range ("attack box"): while targeting, or while hovering a skill button.
    const shown = this.mode === 'target' ? this.action : this.mode === 'select' ? this.previewAction : null;
    const caster = this.casterUid ? b.unit(this.casterUid) : sel;
    if (shown && caster) {
      const color = shown.affects === 'ally' ? 0x6fdc8c : 0xff6b6b;
      for (const p of b.rangeTiles(caster, shown)) {
        fill(p, color, 0.2);
        outline(p, color, 0.55);
      }
      const h = this.hoverTile;
      if (this.mode === 'target' && h && b.canTarget(caster, shown, h)) {
        for (const p of b.areaTiles(caster, shown, h)) fill(p, 0xffd166, 0.5);
        if (shown.charge) {
          const land = b.chargeDestination(caster, h);
          if (land) outline(land, 0x4aa3ff, 1, 6);
        }
      }
    }

    if (this.hoverTile) {
      g.lineStyle(2, 0xffffff, 0.8).strokeRect(MAP_X + this.hoverTile.x * TILE + 1, MAP_Y + this.hoverTile.y * TILE + 1, TILE - 2, TILE - 2);
    }

    // Selection rings: gold for the commanded unit, faint for other ready units.
    this.rings.clear();
    if (b.phase === 'player' && this.mode !== 'over') {
      for (const u of b.readyUnits()) {
        const c = this.tileCenter(u);
        const isSel = u === sel;
        this.rings.lineStyle(isSel ? 3 : 2, 0xffd166, isSel ? 1 : 0.35).strokeCircle(c.x, c.y - 4, 25);
      }
    } else if (this.casterUid && this.mode !== 'over') {
      const c = this.tileCenter(b.unit(this.casterUid));
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
      this.topBar.add(text(this, MAP_X + 176 + heroes.length * 52, 30, 'Tab: next', { color: COLORS.dim, fontSize: '12px' }));
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
    S.add(panel(this, SIDE_X, 16, SIDE_W, 160));
    if (u) {
      const g = this.add.graphics();
      drawToken(g, SIDE_X + 28, 44, 16, u.character.appearance.color, u.character.appearance.emblem);
      S.add(g);
      S.add(text(this, SIDE_X + 52, 24, u.character.name, { fontSize: '17px' }));
      S.add(text(this, SIDE_X + 52, 46, `Lv ${u.character.level} · ${WEAPONS[u.character.weaponId].name}${u.team === 'enemy' ? ' (enemy)' : ''}`, {
        color: u.team === 'enemy' ? COLORS.bad : COLORS.dim, fontSize: '12px',
      }));
      S.add(text(this, SIDE_X + 10, 70, this.unitSummary(u), { fontSize: '12px', lineSpacing: 3, wordWrap: { width: SIDE_W - 20 } }));
      if (u.team === 'player' && b.phase === 'player') {
        const status = u.acted ? 'Done this turn' : u.moved ? 'Moved — can still act' : 'Ready to move and act';
        S.add(text(this, SIDE_X + 10, 156, status, { fontSize: '12px', color: u.acted ? COLORS.dim : COLORS.good }));
      }
    }

    if (b.phase !== 'player' || this.mode === 'over') {
      S.add(text(this, SIDE_X + SIDE_W / 2, 230, this.mode === 'over' ? '' : 'Enemy turn…', { color: COLORS.dim }).setOrigin(0.5));
      return;
    }
    const interactive = this.mode === 'select' || this.mode === 'target';
    let y = 184;
    if (u && u.team === 'player') {
      const canAct = interactive && b.canAct(u);
      for (const id of b.skillIds(u)) {
        const s = SKILLS[id];
        const cd = u.cooldowns[id] ?? 0;
        const label = `${s.name}${s.free ? ' · free' : ''}${cd > 0 ? ` (${cd})` : ''}`;
        S.add(button(this, SIDE_X, y, SIDE_W, 30, label, () => this.selectAction(id), {
          enabled: canAct && cd <= 0,
          selected: this.mode === 'target' && this.action?.id === id,
          fontSize: 14,
          onHover: () => {
            this.hoverText.setText(`${s.name}: ${s.description}\n${skillDetails(s)}${cd > 0 ? `\nReady ${cd === 1 ? 'next turn' : `in ${cd} turns`}.` : ''}`);
            if (this.mode === 'select') {
              this.previewAction = s;
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
        y += 34;
      }
      S.add(button(this, SIDE_X, y + 2, 116, 30, 'Wait', () => this.waitUnit(), { enabled: canAct, fontSize: 14 }));
      S.add(button(this, SIDE_X + 124, y + 2, 116, 30, 'Undo move', () => this.undoMove(), {
        enabled: interactive && b.canUndoMove(u), fontSize: 14,
      }));
    }
    S.add(button(this, SIDE_X, 590, SIDE_W, 40, 'End Turn', () => this.endPlayerPhase(), {
      enabled: interactive, fill: 0x4a2a22, fontSize: 16, selected: interactive && b.readyUnits().length === 0,
    }));
  }

  private unitSummary(u: Unit): string {
    const b = this.battle;
    const shield = b.shieldOf(u);
    const terrainDef = TERRAIN[b.map.tiles[u.y][u.x]].defense;
    const effects = u.statuses.map((s) => (s.id === 'burn' ? `Burn x${s.stacks} (${s.turns}t)` : `${s.name} ${s.amount} (${s.turns}t)`));
    if (u.overwatch) effects.push(`Watching: ${SKILLS[u.overwatch.skillId].name}`);
    return [
      `HP ${u.hp}/${u.stats.health}${shield ? ` +${shield} shield` : ''}   Move ${b.stat(u, 'movement')}`,
      `P.Atk ${b.stat(u, 'pAtk')}  M.Atk ${b.stat(u, 'mAtk')}  Def ${b.stat(u, 'defense')}${terrainDef ? ' (forest)' : ''}`,
      effects.join(', '),
    ].filter(Boolean).join('\n');
  }

  private refresh(): void {
    this.refreshUnits();
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

  // ---- player turn ---------------------------------------------------------------------

  private async startPlayerPhase(events: BattleEvent[] = []): Promise<void> {
    this.mode = 'busy';
    this.casterUid = null;
    this.selectedUid = null;
    this.refresh();
    await this.banner('YOUR TURN', '#8ecbff');
    if (await this.showTurnStartEvents(events)) return;
    this.mode = 'select';
    this.selectUnit(this.battle.readyUnits()[0]);
  }

  /** Show Burn ticks etc. Returns true if the battle ended. */
  private async showTurnStartEvents(events: BattleEvent[]): Promise<boolean> {
    if (events.length) {
      const summary: string[] = [];
      for (const e of events) this.showEvent(e, summary, 0);
      this.addLog(`Burn: ${summary.join(', ')}`);
      this.refresh();
      await this.wait(800);
    }
    const outcome = this.battle.outcome();
    if (outcome) {
      this.endBattle(outcome);
      return true;
    }
    return false;
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
    this.action = SKILLS[id];
    this.previewAction = null;
    this.mode = 'target';
    this.renderSidebar();
    this.drawOverlay();
    const how = this.action.target === 'cone' ? 'click to aim the cone'
      : this.action.target === 'line' ? 'click a direction'
        : this.action.target === 'self' ? 'click inside the box to use it' : 'click a tile in the box';
    this.hoverText.setText(`${this.action.name}: ${how} (right-click / Esc to cancel).`);
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

  /** After a hero acts: keep them selected if they can still act (free skill), else go to the next ready hero. */
  private afterUnitDone(): void {
    const outcome = this.battle.outcome();
    if (outcome) return this.endBattle(outcome);
    this.mode = 'select';
    this.action = null;
    const cur = this.selected;
    const next = cur && this.battle.canAct(cur) ? cur : this.battle.readyUnits()[0];
    if (next) this.selectUnit(next);
    else this.endPlayerPhase();
  }

  private async onClick(tile: Point | null): Promise<void> {
    if (!tile || this.battle.phase !== 'player') return;
    const b = this.battle;
    const u = this.selected;
    const clicked = b.unitAt(tile.x, tile.y);

    if (this.mode === 'target' && u && this.action) {
      if (!b.canTarget(u, this.action, tile)) return this.cancel();
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

    if (clicked && clicked.team === 'player' && clicked !== u) return this.selectUnit(clicked);

    const k = key(tile.x, tile.y);
    if (u && b.canMove(u) && this.reach.has(k) && (tile.x !== u.x || tile.y !== u.y)) {
      this.mode = 'busy';
      const result = b.move(u, tile);
      this.refresh();
      await this.animateMove(u, result);
      this.reach = new Map();
      if (!u.alive) {
        this.selectedUid = null;
        this.afterUnitDone();
        return;
      }
      this.mode = 'select';
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
    let info = `${terrain.name}${terrain.moveCost === null ? ' (impassable)' : ''}${terrain.defense ? ` (+${terrain.defense} Def, move cost ${terrain.moveCost})` : ''}${terrain.blocksSight ? ', blocks sight' : ''}`;
    if (target) info = `${target.character.name} — Lv ${target.character.level}\n${this.unitSummary(target)}`;
    const u = this.selected;
    if (this.mode === 'target' && this.action && u) {
      info = b.canTarget(u, this.action, tile)
        ? `${this.preview(u, this.action, tile)}\n${info}`
        : `Can't aim there — click to cancel.\n${info}`;
    }
    this.hoverText.setText(info);
  }

  private preview(u: Unit, s: SkillDef, tile: Point): string {
    const b = this.battle;
    if (s.cone) return '→ Watch this cone until your next turn';
    if (s.teleport) return '→ Teleport here';
    const lines: string[] = [];
    if (s.charge) {
      const land = b.chargeDestination(u, tile);
      if (land && (land.x !== u.x || land.y !== u.y)) lines.push('→ Dash in, then strike');
    }
    const targets = b.targetsOf(u, s, tile);
    if (targets.length === 0 && lines.length === 0) return '→ Nobody affected (action will be spent)';
    for (const t of targets) {
      const who = `${t.character.name}${t.team === u.team && s.hits ? ' (ALLY!)' : ''}`;
      if (s.hits?.length) {
        const hits = b.previewHits(u, s, t);
        const total = hits.reduce((a, c) => a + c, 0);
        const kills = total >= t.hp + b.shieldOf(t);
        lines.push(`→ ${who}: ${hits.join(' + ')} dmg${kills ? ' (defeats!)' : ''}`);
      }
      if (s.heal) lines.push(`→ ${who}: +${Math.min(b.healAmount(u, s), t.stats.health - t.hp)} HP`);
      if (s.shield) lines.push(`→ ${who}: +${Math.round(t.stats.health * s.shield.maxHpPct)} shield`);
      if (s.cleanse) lines.push(`→ ${who}: cleanse ${t.statuses.filter((x) => x.debuff).length} debuff(s)`);
      if (s.knockback) lines.push('   knocked back 1 tile');
    }
    return lines.join('\n');
  }

  private endPlayerPhase(): void {
    if (this.mode !== 'select' && this.mode !== 'target') return;
    this.mode = 'busy';
    this.action = null;
    this.selectedUid = null;
    const events = this.battle.endPhase();
    void this.runEnemyPhase(events);
  }

  // ---- enemy turn ----------------------------------------------------------------------

  private async runEnemyPhase(startEvents: BattleEvent[]): Promise<void> {
    const b = this.battle;
    this.refresh();
    await this.banner('ENEMY TURN', COLORS.bad);
    if (await this.showTurnStartEvents(startEvents)) return;
    for (const u of [...b.readyUnits()]) {
      if (!u.alive || b.outcome()) continue;
      this.casterUid = u.uid;
      this.refresh();
      await this.wait(250);
      const plan = planTurn(b, u);
      if (b.canMove(u) && (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y)) {
        const result = b.move(u, plan.moveTo);
        await this.animateMove(u, result);
      }
      if (!u.alive || b.outcome()) continue;
      const free = bestFreeAction(b, u);
      if (free) await this.enemyUse(u, free.id, free.target);
      if (!u.alive || b.outcome() || !b.canAct(u)) continue;
      const action = bestAction(b, u);
      if (action) await this.enemyUse(u, action.id, action.target);
      else {
        b.wait(u);
        this.addLog(`${u.character.name} advances.`);
      }
      this.refreshUnits();
    }
    this.casterUid = null;
    const outcome = b.outcome();
    if (outcome) return this.endBattle(outcome);
    void this.startPlayerPhase(b.endPhase());
  }

  private async enemyUse(u: Unit, id: string, target: Point): Promise<void> {
    this.action = SKILLS[id];
    this.mode = 'target';
    this.hoverTile = target;
    this.drawOverlay();
    await this.wait(450);
    this.mode = 'busy';
    this.action = null;
    this.hoverTile = null;
    await this.resolve(u, SKILLS[id], target);
  }

  // ---- animation --------------------------------------------------------------------------

  private async animateMove(u: Unit, result: MoveResult): Promise<void> {
    const view = this.views.get(u.uid)!;
    for (let i = 0; i < result.path.length; i++) {
      const c = this.tileCenter(result.path[i]);
      await this.tween({ targets: view.container, x: c.x, y: c.y, duration: 110 });
      const trigger = result.triggers.find((t) => t.index === i);
      if (trigger) {
        const summary: string[] = [];
        trigger.events.forEach((e, n) => this.showEvent(e, summary, n));
        const shooter = trigger.events[0]?.type === 'damage' && trigger.events[0].source ? this.battle.unit(trigger.events[0].source).character.name : 'Overwatch';
        this.addLog(`${shooter} reacts! ${summary.join(', ')}${result.interrupted && i === result.path.length - 1 ? ' — movement stopped' : ''}`);
        this.refresh();
        await this.wait(700);
      }
    }
    this.drawOverlay();
  }

  private floatText(u: Unit, value: string, color: string, delay = 0): void {
    const c = this.tileCenter(u);
    const t = text(this, c.x, c.y - 20, value, { fontSize: '18px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(500).setAlpha(delay ? 0 : 1);
    this.tweens.add({ targets: t, y: c.y - 58, alpha: { from: 1, to: 0 }, delay, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private async resolve(u: Unit, s: SkillDef, target: Point): Promise<void> {
    const before = { x: u.x, y: u.y };
    const events = this.battle.perform(u, s.id, target);
    const view = this.views.get(u.uid)!;
    // Small lunge toward the target for attacks that don't move the caster.
    if (s.hits?.length && !s.charge && (target.x !== before.x || target.y !== before.y)) {
      const from = this.tileCenter(before);
      const to = this.tileCenter(target);
      await this.tween({ targets: view.container, x: from.x + (to.x - from.x) * 0.2, y: from.y + (to.y - from.y) * 0.2, duration: 90, yoyo: true });
    }
    const summary: string[] = [];
    let n = 0;
    for (const e of events) {
      if (e.type === 'move') {
        await this.animateDisplacement(e);
        continue;
      }
      this.showEvent(e, summary, n++);
    }
    this.flashArea(s, u, target);
    const detail = summary.length ? `: ${summary.join(', ')}` : s.cone ? ' and watches the area.' : s.teleport ? '.' : ' — it hits nothing.';
    this.addLog(`${u.character.name} uses ${s.name}${detail}`);
    this.refresh();
    await this.wait(events.length ? 800 : 400);
  }

  private async animateDisplacement(e: Extract<BattleEvent, { type: 'move' }>): Promise<void> {
    const t = this.battle.unit(e.target);
    const view = this.views.get(t.uid)!;
    const to = this.tileCenter(e.to);
    if (e.kind === 'teleport') {
      await this.tween({ targets: view.container, alpha: 0, scale: 0.4, duration: 150 });
      view.container.setPosition(to.x, to.y);
      await this.tween({ targets: view.container, alpha: 1, scale: 1, duration: 150 });
    } else {
      await this.tween({ targets: view.container, x: to.x, y: to.y, duration: e.kind === 'charge' ? 220 : 140, ease: 'Quad.easeOut' });
    }
  }

  /** Brief flash over the tiles the skill covered (also shows when it hits empty ground). */
  private flashArea(s: SkillDef, caster: Unit, target: Point): void {
    if (s.cone) return;
    const g = this.add.graphics().setDepth(400);
    const color = s.affects === 'ally' ? 0x6fdc8c : 0xffd166;
    const tiles = s.target === 'self' && !s.aoeRadius ? [{ x: caster.x, y: caster.y }] : this.battle.areaTiles(caster, s, target);
    for (const p of tiles) g.fillStyle(color, 0.5).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
    this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
  }

  private showEvent(e: BattleEvent, summary: string[], index: number): void {
    if (e.type === 'move' || e.type === 'overwatch') return;
    const t = this.battle.unit(e.target);
    const name = t.character.name;
    const delay = index * 180;
    switch (e.type) {
      case 'damage': {
        const color = e.cause === 'burn' ? '#ffb35c' : '#ff6b6b';
        if (e.amount > 0) this.floatText(t, `-${e.amount}`, color, delay);
        if (e.absorbed > 0) this.floatText(t, `(${e.absorbed} blocked)`, '#8ecbff', delay + 90);
        this.drawHp(t);
        if (e.cause !== 'burn') this.cameras.main.shake(70, 0.002);
        summary.push(`${name} -${e.amount}${e.absorbed ? ` (${e.absorbed} shielded)` : ''}${e.killed ? ' ☠' : ''}`);
        if (e.killed) {
          const v = this.views.get(t.uid)!;
          this.tweens.add({ targets: v.container, alpha: 0, scale: 0.5, delay: delay + 200, duration: 500, onComplete: () => v.container.setVisible(false) });
        }
        break;
      }
      case 'heal':
        this.floatText(t, `+${e.amount}`, '#6fdc8c', delay);
        summary.push(`${name} +${e.amount} HP`);
        break;
      case 'shield':
        this.floatText(t, `Shield ${e.amount}`, '#8ecbff', delay);
        summary.push(`${name} shielded (${e.amount})`);
        break;
      case 'status':
        this.floatText(t, e.name, '#ffb35c', delay + 200);
        summary.push(`${name} ${e.name}`);
        break;
      case 'cleanse':
        this.floatText(t, 'Cleansed', '#6fdc8c', delay);
        summary.push(`${name} cleansed${e.removed.length ? ` (${e.removed.join(', ')})` : ''}`);
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
      lines.push(`Each adventurer gains ${xp} XP.`);
      for (const c of state.party) {
        const levels = grantXp(c, xp);
        if (levels > 0) lines.push(`${c.name} reached level ${c.level}! Stats grew automatically.`);
      }
      lines.push('', `Next up: stage ${state.progress.stage}.`);
    } else {
      state.progress.defeats += 1;
      lines.push('Your party falls back to camp to recover.', 'Rethink your loadouts and try again.');
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
