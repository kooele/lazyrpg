import Phaser from 'phaser';
import { SKILLS, STATUSES, WEAPONS, hasTag, isFree, isSupport, skillDetails, skillFormula, tagNames } from '../data/content';
import type { SkillDef } from '../data/types';
import { bestAction, bestFreeAction, planTurn, preferredMode, shouldDisengage, shouldEscape } from '../game/ai';
import {
  AP_PER_TURN, Battle, deploymentTiles, generateEnemies, makeUnit,
  type BattleEvent, type MoveResult, type Unit,
} from '../game/battle';
import { BAR_PAGE, makeRng, skillBarLayout, swapBarSlots } from '../game/character';
import { TERRAIN, generateMap, key, type Point } from '../game/grid';
import { GUILD } from '../data/guild';
import { lineupMembers, resolveQuest } from '../game/city';
import { DEMO_STAGES, requireDemo, resolveDemoBattle } from '../game/demo';
import { markDirty, requireState } from '../game/session';
import { COLORS, HEIGHT, ScrollList, UI_SCALE, WIDTH, button, confirmDialog, figure, monsterFigure, panel, setupCamera, text } from '../ui/widgets';
import { ENEMIES } from '../data/enemies';

/** Tile size in layout pixels; set per battle so the map fits the 672x500 board area. */
let TILE = 56;
/** Scale factor relative to the original 56px tiles (for sizes drawn inside a tile). */
let K = 1;
const BOARD_W = 672;
const BOARD_H = 488;
const MAP_X = 16;
const MAP_Y = 72;
const SIDE_X = 704;
const SIDE_W = 240;
/** Skill bar (below the board): 10 slots a page, hotkeys 1-0. */
const BAR_Y = 566;
const SLOT_W = 60;
const SLOT_H = 66;
const SLOT_GAP = 4;
/** Battle log (sidebar, under the unit panel). */
const LOG_Y = 222;
const LOG_H = 252;
const HOTKEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'ZERO'];
/** Where a unit's feet are, relative to its tile center; the HP bar sits just below. */
let FEET_Y = 14;
let HP_Y = 21;

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
  private bar!: Phaser.GameObjects.Container;
  /** Skill-bar page shown (0-based). */
  private barPage = 0;
  /** A bar slot being dragged to a new place. */
  private barDrag: { from: number; x: number; y: number; dragging: boolean; ghost?: Phaser.GameObjects.Text; flipped?: number } | null = null;
  private topBar!: Phaser.GameObjects.Container;
  private hoverText!: Phaser.GameObjects.Text;
  private logList!: ScrollList;
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
  /** A confirm dialog is open: ignore clicks on the board behind it. */
  private dialogOpen = false;
  /** The enemy whose next-turn reach is shown (click an enemy to toggle). */
  private threat: { uid: string; move: Set<string>; attack: Point[]; label: string } | null = null;

  /** Quick Battle (demo) instead of a campaign quest. */
  private demo = false;

  constructor() {
    super('Battle');
  }

  init(data: { demo?: boolean }): void {
    this.demo = !!data?.demo;
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
    this.dialogOpen = false;
    setupCamera(this);

    // Quick Battle (demo) fights the demo party at its stage; the campaign fights the accepted quest.
    const d = this.demo ? requireDemo() : null;
    const quest = d ? null : requireState().quest;
    if (!d && !quest) {
      this.scene.start('City');
      return;
    }
    const stage = d ? d.stage : quest!.stage;
    const rng = makeRng(Date.now() & 0xffffffff);
    const map = generateMap(rng);
    TILE = Math.floor(Math.min(BOARD_W / map.width, BOARD_H / map.height));
    K = TILE / 56;
    FEET_Y = Math.round(14 * K);
    HP_Y = Math.round(21 * K);
    const party = d ? d.party : lineupMembers(requireState());
    const foes = generateEnemies(stage, party.length, rng);
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
    this.bar = this.add.container(0, 0);
    this.barPage = 0;
    this.barDrag = null;
    panel(this, SIDE_X, 482, SIDE_W, 150);
    this.hoverText = text(this, SIDE_X + 10, 489, '', { fontSize: '12px', wordWrap: { width: SIDE_W - 20 }, lineSpacing: 1 });
    panel(this, SIDE_X, LOG_Y, SIDE_W, LOG_H);
    this.logList = new ScrollList(this, SIDE_X + 8, LOG_Y + 6, SIDE_W - 14, LOG_H - 12, 1);

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
    // Skill bar: 1-0 use the slots on the current page; [ and ] flip pages.
    HOTKEYS.forEach((k, i) => this.input.keyboard?.on(`keydown-${k}`, () => this.useSlot(this.barPage * BAR_PAGE + i)));
    this.input.keyboard?.on('keydown-OPEN_BRACKET', () => this.flipPage(-1));
    this.input.keyboard?.on('keydown-CLOSED_BRACKET', () => this.flipPage(1));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onBarDragMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onBarDragEnd(p));

    const what = quest ? `${quest.title} (${quest.rank} rank)` : `Stage ${stage} of ${DEMO_STAGES}`;
    this.addLog(`${what}: ${foes.length} foe${foes.length > 1 ? 's' : ''} approach!`);
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
          g.fillTriangle(px + 14 * K, py + 40 * K, px + 24 * K, py + 14 * K, px + 34 * K, py + 40 * K);
          g.fillTriangle(px + 26 * K, py + 46 * K, px + 38 * K, py + 18 * K, px + 48 * K, py + 46 * K);
        } else if (t === 'rock') {
          g.fillStyle(0x8a8a93).fillCircle(px + 22 * K, py + 32 * K, 13 * K).fillCircle(px + 36 * K, py + 26 * K, 10 * K);
          g.fillStyle(0x55555c).fillCircle(px + 30 * K, py + 38 * K, 8 * K);
        } else if (t === 'water') {
          g.lineStyle(2, 0x5b8fcf, 0.8);
          g.lineBetween(px + 10 * K, py + 22 * K, px + 26 * K, py + 22 * K);
          g.lineBetween(px + 28 * K, py + 36 * K, px + 46 * K, py + 36 * K);
        } else if (t === 'river') {
          // Shallow, fordable water: lighter, with ripples and sandy edges.
          g.lineStyle(2, 0xa9d4f5, 0.7);
          for (const ry of [16, 30, 44]) {
            g.beginPath();
            g.moveTo(px + 8 * K, py + ry * K);
            g.lineTo(px + 18 * K, py + (ry - 4) * K);
            g.lineTo(px + 28 * K, py + ry * K);
            g.lineTo(px + 38 * K, py + (ry - 4) * K);
            g.lineTo(px + 48 * K, py + ry * K);
            g.strokePath();
          }
        }
      }
    }
    g.lineStyle(1, 0x000000, 0.25);
    for (let x = 0; x <= map.width; x++) g.lineBetween(MAP_X + x * TILE, MAP_Y, MAP_X + x * TILE, MAP_Y + map.height * TILE);
    for (let y = 0; y <= map.height; y++) g.lineBetween(MAP_X, MAP_Y + y * TILE, MAP_X + map.width * TILE, MAP_Y + y * TILE);
  }

  /** Adventurers and human enemies use the body art; monsters use their own figure. */
  private unitFigure(u: Unit, x: number, feetY: number, height: number): Phaser.GameObjects.Container {
    const def = u.character.enemyType ? ENEMIES[u.character.enemyType] : null;
    if (def && def.art.kind !== 'human') return monsterFigure(this, x, feetY, height, def.art.kind);
    // People are slimmer than monsters, so they're drawn a little taller (heads may overlap the tile above).
    return figure(this, x, feetY, height * 1.2, u.character.appearance, u.character.weaponId, { enemy: u.team === 'enemy' });
  }

  private createUnitView(u: Unit): void {
    const c = this.tileCenter(u);
    // Figure stands with its feet near the bottom of the tile; HP bar underneath.
    const fig = this.unitFigure(u, 0, FEET_Y, 52 * K);
    const statusText = text(this, -27 * K, 4 * K, '', { fontSize: '9px', fontStyle: 'bold', color: '#ffb35c', stroke: '#000000', strokeThickness: 3 }).setOrigin(0, 1);
    const hpBar = this.add.graphics();
    const container = this.add.container(c.x, c.y, [fig, statusText, hpBar]);
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
    const w = 40 * K;
    view.hpBar.fillStyle(0x000000, 0.7).fillRect(-w / 2 - 1, HP_Y, w + 2, 6);
    view.hpBar.fillStyle(pct > 0.5 ? 0x6fdc8c : pct > 0.25 ? 0xe0b44c : 0xff6b6b).fillRect(-w / 2, HP_Y + 1, w * pct, 4);
    if (this.battle.shieldOf(u) > 0) {
      view.hpBar.fillStyle(0x8ecbff).fillRect(-w / 2 + w * pct, HP_Y + 1, Math.max(2, w * shield), 4);
      view.hpBar.lineStyle(1, 0x8ecbff).strokeRect(-w / 2 - 1, HP_Y, w + 2, 6);
    }
    const tags: string[] = [];
    for (const st of u.statuses) {
      if (st.id === 'shield') continue;
      tags.push(st.stacks > 1 ? `${st.name[0]}${st.stacks}` : st.name.slice(0, 2).toUpperCase());
    }
    if (u.engagedWith) tags.push('ENG');
    if (u.overwatch) tags.push(SKILLS[u.overwatch.skillId].cone?.interrupt ? 'IC' : 'OW');
    view.statusText.setText(tags.join(' '));
  }

  /** Dim units that have already acted this turn. */
  private refreshUnits(): void {
    for (const u of this.battle.units) {
      if (!u.alive) continue;
      this.views.get(u.uid)?.container.setVisible(this.battle.canSee('player', u));
      const done = u.team === this.battle.phase && (u.acted || (u.ap === 0 && this.battle.usableFreeActions(u).length === 0));
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

    // Fog of war (only when vision is enabled in stats.json).
    if (b.rules.vision.enabled) {
      const seen = b.visibleTiles('player');
      for (let y = 0; y < b.map.height; y++) {
        for (let x = 0; x < b.map.width; x++) if (!seen.has(key(x, y))) fill({ x, y }, 0x05060a, 0.55);
      }
    }

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

    // Engagement links: a chain between engaged pairs.
    for (const u of b.living()) {
      const o = b.opponentOf(u);
      if (!o || u.uid > o.uid) continue;
      const a = this.tileCenter(u);
      const c = this.tileCenter(o);
      g.lineStyle(5, 0x000000, 0.5).lineBetween(a.x, a.y - 4, c.x, c.y - 4);
      g.lineStyle(3, 0xff9f43, 0.95).lineBetween(a.x, a.y - 4, c.x, c.y - 4);
    }

    // An inspected enemy's next turn: where it can move (orange) and what its longest-ranged attack reaches from there (red).
    const threat = this.mode === 'select' && !this.previewAction ? this.threat : null;
    if (threat) {
      for (const p of threat.attack) {
        if (threat.move.has(key(p.x, p.y))) continue;
        fill(p, 0xff4d4d, 0.2);
        outline(p, 0xff6b6b, 0.6);
      }
      for (const k of threat.move) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, 0xffb347, 0.3);
        outline({ x, y }, 0xffc56b, 0.9, 3);
      }
    }

    // Movement range for the selected unit (hidden while an enemy's reach is shown).
    if (this.mode === 'select' && sel && b.canMove(sel) && !this.previewAction && !threat) {
      // Pale fill + bright outline: stays readable on any terrain, including blue water.
      for (const k of this.reach.keys()) {
        const [x, y] = k.split(',').map(Number);
        fill({ x, y }, 0xe8fbff, 0.28);
        outline({ x, y }, 0xffffff, 0.9, 3);
      }
    }

    // Skill range ("attack box"): while targeting, or while hovering a skill button.
    const shown = this.mode === 'target' ? this.action : this.mode === 'select' ? this.previewAction : null;
    const caster = this.casterUid ? b.unit(this.casterUid) : sel;
    if (shown && caster) {
      const color = isSupport(shown) ? 0x6fdc8c : 0xff6b6b;
      for (const p of b.rangeTiles(caster, shown)) {
        fill(p, color, 0.2);
        outline(p, color, 0.55);
      }
      // In range but the line is blocked: greyed out with a cross.
      for (const p of b.blockedTiles(caster, shown)) {
        fill(p, 0x000000, 0.3);
        const px = MAP_X + p.x * TILE;
        const py = MAP_Y + p.y * TILE;
        g.lineStyle(2, 0x9aa3bd, 0.6).lineBetween(px + 18 * K, py + 18 * K, px + TILE - 18 * K, py + TILE - 18 * K).lineBetween(px + TILE - 18 * K, py + 18 * K, px + 18 * K, py + TILE - 18 * K);
      }
      const h = this.hoverTile;
      if (this.mode === 'target' && h && b.canTarget(caster, shown, h)) {
        for (const p of b.areaTiles(caster, shown, h)) fill(p, 0xffd166, 0.5);
        if (shown.charge) {
          const land = b.chargeDestination(caster, h, caster, shown);
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
      for (const u of b.commandableUnits()) {
        const c = this.tileCenter(u);
        const isSel = u === sel;
        this.rings.lineStyle(isSel ? 3 : 2, 0xffd166, isSel ? 1 : 0.4).strokeEllipse(c.x, c.y + FEET_Y, 46 * K, 18 * K);
      }
    } else if (this.casterUid && this.mode !== 'over') {
      const c = this.tileCenter(b.unit(this.casterUid));
      this.rings.lineStyle(3, 0xff6b6b, 1).strokeEllipse(c.x, c.y + FEET_Y, 46 * K, 18 * K);
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
    const heroes = b.living('player');
    heroes.forEach((u, i) => {
      const x = MAP_X + 190 + i * 52;
      const ready = mine && !u.acted && u.ap > 0;
      if (u.uid === this.selectedUid) this.topBar.add(this.add.rectangle(x, 36, 44, 56, 0xffd166, 0.18).setStrokeStyle(2, 0xffd166));
      this.topBar.add(figure(this, x, 58, 46, u.character.appearance, u.character.weaponId).setAlpha(ready ? 1 : 0.35));
      const hit = this.add.zone(x, 36, 44, 56).setInteractive({ useHandCursor: true });
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
    this.renderSkillBar();
    this.sidebar.removeAll(true);
    const S = this.sidebar;
    const b = this.battle;
    const u = this.selected ?? (this.casterUid ? b.unit(this.casterUid) : null);
    S.add(panel(this, SIDE_X, 16, SIDE_W, 160));
    if (u) {
      S.add(this.unitFigure(u, SIDE_X + 28, 64, 46));
      S.add(text(this, SIDE_X + 52, 24, u.character.name, { fontSize: '17px' }));
      S.add(text(this, SIDE_X + 52, 46, `Lv ${u.character.level} · ${WEAPONS[u.character.weaponId]?.name ?? (u.character.enemyType ? 'Monster' : '')}${u.team === 'enemy' ? ' (enemy)' : ''}`, {
        color: u.team === 'enemy' ? COLORS.bad : COLORS.dim, fontSize: '12px',
      }));
      S.add(text(this, SIDE_X + 10, 70, this.unitSummary(u), { fontSize: '12px', lineSpacing: 3, wordWrap: { width: SIDE_W - 20 } }));
      if (u.team === 'player' && b.phase === 'player') {
        const freeLeft = !u.acted && u.ap === 0 && b.usableFreeActions(u).length > 0;
        const done = u.acted || (u.ap === 0 && !freeLeft);
        const status = done ? 'Done this turn' : freeLeft ? 'Out of AP — free action available'
          : u.moved ? 'Moved — 1 AP left (act or Dash)' : 'Ready: move + act';
        const pips = `${'●'.repeat(u.ap)}${'○'.repeat(Math.max(0, AP_PER_TURN - u.ap))}`;
        S.add(text(this, SIDE_X + 10, 156, `AP ${pips}  ${status}`, { fontSize: '12px', color: done ? COLORS.dim : COLORS.good }));
      }
    }

    if (b.phase !== 'player' || this.mode === 'over') {
      S.add(text(this, SIDE_X + SIDE_W / 2, 230, this.mode === 'over' ? '' : 'Enemy turn…', { color: COLORS.dim }).setOrigin(0.5));
      return;
    }
    const interactive = this.mode === 'select' || this.mode === 'target';
    const y = 184;
    if (u && u.team === 'player') {
      const canAct = interactive && b.canAct(u);
      const opp = b.opponentOf(u);
      if (opp) {
        S.add(button(this, SIDE_X, y, 116, 30, 'Disengage', () => void this.disengageUnit(), {
          enabled: canAct, fontSize: 14, fill: 0x4a3418,
          onHover: () => {
            const dmg = b.previewHits(opp, b.basicAttack(opp), u).reduce((a, c) => a + c, 0);
            this.hoverText.setText(`Break away from ${opp.character.name}. They get a free ${b.basicAttack(opp).name} (~${dmg} dmg). You can then move and act normally.`);
          },
        }));
      } else {
        S.add(button(this, SIDE_X, y, 116, 30, 'Undo move', () => this.undoMove(), {
          enabled: interactive && b.canUndoMove(u), fontSize: 14,
        }));
      }
    }
    // Ends the whole team's turn (there is no per-unit turn order to wait in).
    const endX = u && u.team === 'player' ? SIDE_X + 124 : SIDE_X;
    const endW = u && u.team === 'player' ? 116 : SIDE_W;
    S.add(button(this, endX, y, endW, 30, 'End Turn', () => this.endPlayerPhase(), {
      enabled: interactive, fill: 0x4a2a22, fontSize: 14, selected: interactive && b.readyUnits().length === 0,
      onHover: () => this.hoverText.setText('End your turn. Units that have not acted give up their action, and the enemy moves next.'),
    }));
  }

  // ---- skill bar ----------------------------------------------------------------------

  /** The player unit whose skills are on the bar. */
  private get barUnit(): Unit | null {
    const u = this.selected;
    return u && u.team === 'player' && u.alive ? u : null;
  }

  private slotRect(i: number): { x: number; y: number } {
    return { x: MAP_X + i * (SLOT_W + SLOT_GAP), y: BAR_Y };
  }

  /** Bar slots 1-0 for the selected unit (drag a slot onto another to swap them; ◀ ▶ or [ ] change page). */
  private renderSkillBar(): void {
    this.bar.removeAll(true);
    const B = this.bar;
    const b = this.battle;
    const u = this.barUnit;
    const layout = u ? skillBarLayout(u.character) : Array<string | null>(BAR_PAGE).fill(null);
    // While dragging, an empty page past the end is available to drop onto.
    if (this.barDrag?.dragging) layout.push(...Array<string | null>(BAR_PAGE).fill(null));
    const pages = layout.length / BAR_PAGE;
    this.barPage = Math.min(this.barPage, pages - 1);
    const interactive = (this.mode === 'select' || this.mode === 'target') && b.phase === 'player';
    for (let i = 0; i < BAR_PAGE; i++) {
      const index = this.barPage * BAR_PAGE + i;
      const id = layout[index];
      const s = id ? (u ? b.skillFor(u, SKILLS[id]) : SKILLS[id]) : null;
      const { x, y } = this.slotRect(i);
      const cd = u && id ? u.cooldowns[id] ?? 0 : 0;
      const usable = !!(u && id && interactive && b.canUseSkill(u, id) && cd <= 0);
      const selected = !!(id && this.mode === 'target' && this.action?.id === id);
      const bg = this.add.rectangle(x, y, SLOT_W, SLOT_H, selected ? 0x4a3d1c : s ? (usable ? COLORS.panelLight : 0x161a28) : 0x10131d)
        .setOrigin(0).setStrokeStyle(2, selected ? COLORS.accent : usable ? COLORS.border : 0x262c40);
      B.add(bg);
      B.add(text(this, x + 4, y + 2, String((i + 1) % 10), { fontSize: '11px', color: COLORS.gold }));
      if (s && u) {
        B.add(text(this, x + SLOT_W / 2, y + 30, s.name, {
          fontSize: '11px', color: usable ? COLORS.text : '#5d6480', align: 'center', wordWrap: { width: SLOT_W - 6 },
        }).setOrigin(0.5));
        const cost = [isFree(s) ? 'free' : s.ap === 'end' ? '' : `${s.ap}AP`, s.mana ? `${s.mana}MP` : ''].filter(Boolean).join(' ');
        if (cost) B.add(text(this, x + SLOT_W / 2, y + SLOT_H - 4, cost, { fontSize: '10px', color: u.mp < s.mana ? COLORS.bad : COLORS.dim }).setOrigin(0.5, 1));
        if (cd > 0) B.add(text(this, x + SLOT_W - 5, y + 2, String(cd), { fontSize: '13px', color: COLORS.bad, fontStyle: 'bold' }).setOrigin(1, 0));
      }
      bg.setInteractive({ useHandCursor: !!s });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (p.rightButtonDown() || !u || !id) return;
        this.barDrag = { from: index, x: p.x, y: p.y, dragging: false };
      });
      bg.on('pointerover', () => {
        if (this.barDrag?.dragging || !s || !u) return;
        this.showSkillInfo(u, id!);
        if (this.mode === 'select' && usable) {
          this.previewAction = SKILLS[id!];
          this.drawOverlay();
        }
      });
      bg.on('pointerout', () => {
        if (this.previewAction) {
          this.previewAction = null;
          this.drawOverlay();
        }
      });
    }
    // Page controls to the right of the slots.
    const px = MAP_X + BAR_PAGE * (SLOT_W + SLOT_GAP);
    const pw = BOARD_W - BAR_PAGE * (SLOT_W + SLOT_GAP);
    B.add(button(this, px, BAR_Y, pw, 22, '▲', () => this.flipPage(-1), { fontSize: 11, enabled: !!u && this.barPage > 0 }));
    B.add(text(this, px + pw / 2, BAR_Y + SLOT_H / 2, `${this.barPage + 1}/${pages}`, { fontSize: '11px', color: COLORS.dim }).setOrigin(0.5));
    B.add(button(this, px, BAR_Y + SLOT_H - 22, pw, 22, '▼', () => this.flipPage(1), { fontSize: 11, enabled: !!u && this.barPage < pages - 1 }));
  }

  private showSkillInfo(u: Unit, id: string): void {
    const b = this.battle;
    const s = b.skillFor(u, SKILLS[id]);
    const raw = SKILLS[id];
    const cd = u.cooldowns[id] ?? 0;
    const interactive = (this.mode === 'select' || this.mode === 'target') && b.phase === 'player';
    const usable = interactive && b.canUseSkill(u, id);
    const why = !interactive || usable ? '' : u.mp < s.mana ? `\nNot enough mana (${u.mp}/${s.mana}).`
      : s.target === 'move' && !u.moved ? '\nUse your regular move first.' : !b.canAct(u) ? '\nThis unit\'s turn is over.' : !b.canPay(u, s) ? '\nNot enough AP.' : '';
    const modeLine = raw.modes ? `\nBow mode: ${b.modeName(u)} (Switch Mode changes it)` : raw.switchMode && b.modesOf(u) ? `\nNow: ${b.modeName(u)}. Next: ${SKILLS[b.modesOf(u)![(u.weaponMode + 1) % b.modesOf(u)!.length]].modeName}` : '';
    this.hoverText.setText(`${s.name} [${tagNames(s).join(', ') || 'basic'}]\n${skillFormula(s) || s.description}\n${skillDetails(s)}${modeLine}${cd > 0 ? `\nReady ${cd === 1 ? 'next turn' : `in ${cd} turns`}.` : ''}${why}\nDrag to another slot to move it.`);
  }

  /** Page up/down. While dragging a skill, ▼ past the last page opens an empty one to drop it on. */
  private flipPage(delta: number): void {
    const u = this.barUnit;
    if (!u) return;
    const pages = skillBarLayout(u.character).length / BAR_PAGE;
    const last = this.barDrag?.dragging ? pages : pages - 1; // while dragging, one empty page past the end
    this.barPage = Math.max(0, Math.min(last, this.barPage + delta));
    this.renderSkillBar();
  }

  /** Hotkey or click: pick that slot's skill (pressing it again while aiming cancels). */
  private useSlot(index: number): void {
    const u = this.barUnit;
    if (!u || this.dialogOpen) return;
    const id = skillBarLayout(u.character)[index];
    if (!id) return;
    if (this.mode === 'target' && this.action?.id === id) return this.cancel();
    if ((this.mode === 'select' || this.mode === 'target') && this.battle.canUseSkill(u, id) && (u.cooldowns[id] ?? 0) <= 0) this.selectAction(id);
  }

  private slotAt(p: Phaser.Input.Pointer): number | 'up' | 'down' | null {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    if (wp.y < BAR_Y || wp.y > BAR_Y + SLOT_H) return null;
    const i = Math.floor((wp.x - MAP_X) / (SLOT_W + SLOT_GAP));
    if (i >= 0 && i < BAR_PAGE && wp.x - MAP_X - i * (SLOT_W + SLOT_GAP) <= SLOT_W) return i;
    if (i >= BAR_PAGE && wp.x <= MAP_X + BOARD_W) return wp.y < BAR_Y + SLOT_H / 2 ? 'up' : 'down';
    return null;
  }

  private onBarDragMove(p: Phaser.Input.Pointer): void {
    const d = this.barDrag;
    if (!d) return;
    if (!d.dragging && Math.hypot(p.x - d.x, p.y - d.y) > 6 * UI_SCALE) {
      d.dragging = true;
      const u = this.barUnit;
      const id = u ? skillBarLayout(u.character)[d.from] : null;
      d.ghost = text(this, 0, 0, id ? SKILLS[id].name : '', {
        fontSize: '12px', backgroundColor: '#4a3d1c', padding: { x: 6, y: 4 },
      }).setDepth(1000).setOrigin(0.5);
    }
    if (!d.dragging || !d.ghost) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    d.ghost.setPosition(wp.x, wp.y - 18);
    // Hovering the page arrows while dragging flips the page (to move a skill to another page).
    const over = this.slotAt(p);
    const now = this.time.now;
    if ((over === 'up' || over === 'down') && now - (d.flipped ?? 0) > 600) {
      d.flipped = now;
      this.flipPage(over === 'up' ? -1 : 1);
    }
  }

  private onBarDragEnd(p: Phaser.Input.Pointer): void {
    const d = this.barDrag;
    if (!d) return;
    this.barDrag = null;
    d.ghost?.destroy();
    const over = this.slotAt(p);
    const u = this.barUnit;
    if (!u) return;
    if (!d.dragging) {
      // A plain click on a slot uses it.
      if (typeof over === 'number' && this.barPage * BAR_PAGE + over === d.from) this.useSlot(d.from);
      return;
    }
    if (typeof over === 'number') {
      const to = this.barPage * BAR_PAGE + over;
      if (to !== d.from) {
        swapBarSlots(u.character, d.from, to);
        if (!this.demo) markDirty();
      }
    }
    this.renderSkillBar();
  }

  private unitSummary(u: Unit): string {
    const b = this.battle;
    const shield = b.shieldOf(u);
    const terrainDef = TERRAIN[b.map.tiles[u.y][u.x]].defense;
    const effects = u.statuses.map((s) => (s.id === 'shield' ? `Shield ${s.amount} (${s.turns}t)` : `${s.name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turns}t)`));
    if (u.overwatch) effects.push(`Watching: ${SKILLS[u.overwatch.skillId].name}`);
    const opp = b.opponentOf(u);
    if (opp) effects.push(`Engaged with ${opp.character.name}`);
    const mode = b.modeName(u);
    if (mode) effects.push(`Bow mode: ${mode}${b.activeMode(u) !== u.weaponMode ? ` (${b.modeName(u, b.activeMode(u))} while engaged)` : ''}`);
    if (u.team === 'enemy') effects.push(`Skills: ${b.skillIds(u).map((id) => b.skillFor(u, SKILLS[id]).name).join(', ')}`);
    return [
      `HP ${u.hp}/${u.stats.health}${shield ? ` +${shield} shield` : ''}${u.stats.mana > 0 ? `   MP ${u.mp}/${u.stats.mana}` : ''}   Move ${b.stat(u, 'movement')}`,
      `P.Atk ${b.stat(u, 'pAtk')}  M.Atk ${b.stat(u, 'mAtk')}  Def ${b.stat(u, 'defense')}${terrainDef ? ' (forest)' : ''}  Res ${b.resistChance(u)}%`,
      effects.join(', '),
    ].filter(Boolean).join('\n');
  }

  private refresh(): void {
    this.refreshUnits();
    this.renderTopBar();
    this.renderSidebar();
    this.drawOverlay();
  }

  /** Add a line to the battle log. The log keeps the whole battle; scroll it with the wheel or the bar. */
  private addLog(line: string): void {
    this.log.push(line);
    const atEnd = this.logList.atEnd();
    const items = this.log.map((l, i) => {
      const t = text(this, 0, 0, l, {
        fontSize: '12px', color: i === this.log.length - 1 ? COLORS.text : COLORS.dim, wordWrap: { width: SIDE_W - 30 },
      });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    });
    this.logList.setItems(items, atEnd ? 'end' : 'keep');
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
    if (this.selectedUid !== u.uid) this.barPage = 0;
    this.selectedUid = u.uid;
    this.threat = null;
    this.reach = this.battle.canMove(u) ? this.battle.reachable(u) : new Map();
    this.refresh();
  }

  private cycleUnit(): void {
    if ((this.mode !== 'select' && this.mode !== 'target') || this.dialogOpen) return;
    const ready = this.battle.commandableUnits();
    if (ready.length === 0) return;
    const i = ready.findIndex((u) => u.uid === this.selectedUid);
    this.selectUnit(ready[(i + 1) % ready.length]);
  }

  private selectAction(id: string): void {
    const u = this.selected;
    if (!u || (this.mode !== 'select' && this.mode !== 'target') || !this.battle.canUseSkill(u, id)) return;
    this.action = SKILLS[id];
    this.previewAction = null;
    this.threat = null;
    this.mode = 'target';
    // Switch Mode needs no target: do it right away.
    if (this.action.switchMode) {
      void this.useSkill(u, this.action, { x: u.x, y: u.y });
      return;
    }
    this.renderSidebar();
    this.drawOverlay();
    const how = this.action.target === 'cone' ? 'click to aim the cone'
      : this.action.target === 'move' ? 'click a tile to dash to'
      : this.action.target === 'line' ? 'click a tile to thrust toward'
        : this.action.target === 'self' ? 'click inside the box to use it' : 'click a tile in the box';
    this.hoverText.setText(`${this.battle.skillFor(u, this.action).name}: ${how} (right-click / Esc to cancel).`);
  }

  private cancel(): void {
    if (this.mode !== 'target' || this.dialogOpen) return;
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

  private async disengageUnit(): Promise<void> {
    const u = this.selected;
    if (!u || !this.battle.opponentOf(u) || !this.battle.canAct(u) || (this.mode !== 'select' && this.mode !== 'target')) return;
    this.mode = 'busy';
    this.action = null;
    await this.showDisengage(u, this.battle.disengage(u));
    if (!u.alive) {
      this.selectedUid = null;
      this.afterUnitDone();
      return;
    }
    this.mode = 'select';
    this.selectUnit(u);
  }

  private async showDisengage(u: Unit, events: BattleEvent[]): Promise<void> {
    const summary: string[] = [];
    events.forEach((e, i) => this.showEvent(e, summary, i));
    const hits = summary.filter((x) => !x.startsWith('breaks away'));
    this.addLog(`${u.character.name} disengages${hits.length ? ` — opportunity attack: ${hits.join(', ')}` : ''}.`);
    this.refresh();
    await this.wait(800);
  }

  /** After a hero acts: keep them selected if they can still act (free skill), else go to the next ready hero. */
  private afterUnitDone(): void {
    const outcome = this.battle.outcome();
    if (outcome) return this.endBattle(outcome);
    this.mode = 'select';
    this.action = null;
    // Stay on the current unit while it can still do something (incl. a free action like Kick);
    // otherwise move to the next unit that can act; end the turn only when nobody can do anything.
    const b = this.battle;
    const cur = this.selected;
    const commandable = b.commandableUnits();
    const next = cur && commandable.includes(cur) ? cur : commandable.find((x) => b.canAct(x)) ?? commandable[0];
    if (next) this.selectUnit(next);
    else this.endPlayerPhase();
  }

  private async onClick(tile: Point | null): Promise<void> {
    if (!tile || this.battle.phase !== 'player' || this.dialogOpen) return;
    const b = this.battle;
    const u = this.selected;
    const clicked = b.unitAt(tile.x, tile.y);

    if (this.mode === 'target' && u && this.action) {
      if (!b.canTarget(u, this.action, tile)) return this.cancel();
      const action = this.action;
      const warning = this.targetWarning(u, action, tile);
      if (warning) {
        this.ask(warning, () => void this.useSkill(u, action, tile), 'Use anyway');
        return;
      }
      await this.useSkill(u, action, tile);
      return;
    }
    if (this.mode !== 'select') return;
    await this.onSelectClick(tile, u, clicked);
  }

  /** Open a confirm dialog that blocks board input while it's up. */
  private ask(message: string, onYes: () => void, yesLabel: string): void {
    this.dialogOpen = true;
    confirmDialog(this, message, () => {
      this.dialogOpen = false;
      onYes();
    }, yesLabel, () => {
      this.dialogOpen = false;
    });
  }

  /**
   * Why the player might not mean this: attacking empty ground or an ally,
   * or healing / cleansing an enemy. Null when the target makes sense.
   */
  private targetWarning(u: Unit, s: SkillDef, tile: Point): string | null {
    const b = this.battle;
    const occupant = b.unitAt(tile.x, tile.y);
    s = b.skillFor(u, s);
    const targets = b.targetsOf(u, s, tile);
    const offensive = s.affects !== 'ally' && !s.cone && (!!s.hits?.length || !!s.applyStatus?.length || hasTag(s, 'engage'));
    if (offensive) {
      const allies = targets.filter((t) => t.team === u.team);
      const also = allies.length < targets.length ? 'also ' : '';
      if (allies.length) return `${s.name} will ${also}hit your own ${allies.length > 1 ? 'allies' : 'ally'} ${allies.map((a) => a.character.name).join(', ')}.\nUse it anyway?`;
      if (targets.length === 0) {
        if (occupant && occupant.team === u.team && occupant !== u) return `${occupant.character.name} is your ally: ${s.name} won't affect them and will be wasted.\nUse it anyway?`;
        return `No enemy there: ${s.name} will hit nothing${s.charge && !s.teleport ? ' (you will only dash)' : ''}.\nUse it anyway?`;
      }
    }
    if ((s.heal || s.cleanse) && occupant && occupant.team !== u.team) {
      const effect = s.heal ? 'restore their Health' : 'remove their debuffs';
      return `${occupant.character.name} is an enemy: ${s.name} will ${effect}.\nUse it anyway?`;
    }
    return null;
  }

  private async useSkill(u: Unit, action: SkillDef, tile: Point): Promise<void> {
    if (this.mode !== 'target') return;
    this.mode = 'busy';
    this.action = null;
    this.casterUid = u.uid;
    this.refresh();
    if (action.target === 'move') {
      // Dash: a second walk, paid with the action AP.
      const result = this.battle.dash(u, tile);
      this.addLog(`${u.character.name} dashes (${action.mana} MP).`);
      this.refresh();
      await this.animateMove(u, result);
      this.reach = new Map();
      if (!u.alive) this.selectedUid = null;
      this.casterUid = null;
      this.afterUnitDone();
      return;
    }
    await this.resolve(u, action, tile);
    this.casterUid = null;
    this.afterUnitDone();
  }

  private async onSelectClick(tile: Point, u: Unit | null, clicked: Unit | undefined): Promise<void> {
    const b = this.battle;
    if (clicked && clicked.team === 'enemy' && b.canSee('player', clicked)) return this.toggleThreat(clicked);
    if (this.threat) {
      // Any other click hides the enemy's reach first.
      this.threat = null;
      this.drawOverlay();
      if (!clicked) return;
    }
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

  /** Show (or hide) where an enemy can move next turn and how far its longest-ranged attack reaches. */
  private toggleThreat(e: Unit): void {
    if (this.threat?.uid === e.uid) {
      this.threat = null;
      this.drawOverlay();
      return;
    }
    const t = this.battle.threat(e);
    const moves = e.engagedWith ? "can't move (engaged)" : 'moves within orange';
    const reach = t.skill ? `${t.skill.name} (range ${Number(t.range.toFixed(1))}) reaches red` : 'no attack ready';
    const label = `${e.character.name} next turn: ${moves}; ${reach}. Click again to hide.`;
    this.threat = { uid: e.uid, move: new Set(t.move.map((p) => key(p.x, p.y))), attack: t.attack, label };
    this.drawOverlay();
    this.hoverText.setText(label);
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
    let info = `${terrain.name}${terrain.moveCost === null ? ' (impassable)' : ` (move cost ${terrain.moveCost}${terrain.defense ? `, +${terrain.defense} Def` : ''})`}${terrain.blocksSight ? ', blocks sight' : ''}`;
    if (target && b.canSee('player', target)) info = `${target.character.name} — Lv ${target.character.level}\n${this.unitSummary(target)}`;
    const u = this.selected;
    if (this.mode === 'target' && this.action && u) {
      const blocked = b.blockedTiles(u, this.action).some((p) => p.x === tile.x && p.y === tile.y);
      const los = b.skillLos(u, this.action);
      const engaged = b.engagementBlock(u, this.action, tile);
      const why = engaged ?? (blocked
        ? los === 'fire' ? 'No line of fire: a rock or unit is in the way.' : 'No line of sight: a rock is in the way.'
        : "Can't aim there — click to cancel.");
      info = b.canTarget(u, this.action, tile) ? `${this.preview(u, this.action, tile)}\n${info}` : `${why}\n${info}`;
    }
    if (this.threat && this.mode === 'select') info = `${this.threat.label}\n${info}`;
    this.hoverText.setText(info);
  }

  private preview(u: Unit, s: SkillDef, tile: Point): string {
    const b = this.battle;
    if (s.target === 'move') return `→ Dash here (${s.mana} MP, uses your last AP)`;
    if (s.cone) return '→ Watch this cone until your next turn';
    s = b.skillFor(u, s);
    const lines: string[] = [];
    if (hasTag(s, 'disengage') && b.opponentOf(u)) lines.push(`→ Breaks away from ${b.opponentOf(u)!.character.name} (no free attack)`);
    for (const a of s.selfStatus ?? []) lines.push(`→ You: ${STATUSES[a.status].name} (${STATUSES[a.status].description})`);
    if (s.teleport && !s.charge) return [...lines, '→ Teleport here'].join('\n');
    if (s.charge) {
      const land = b.chargeDestination(u, tile, u, s);
      if (land && (land.x !== u.x || land.y !== u.y)) lines.push(s.teleport ? '→ Teleport in, then strike' : '→ Dash in, then strike');
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
        if (s.recoilIfSurvives && !kills) lines.push(`   If it survives, you take ${b.recoilDamage(u, s)} dmg`);
      }
      if (hasTag(s, 'engage') && t.team !== u.team && !u.engagedWith && !t.engagedWith && !s.hits?.length) lines.push(`→ ${who}: engaged`);
      if (s.heal) lines.push(`→ ${who}: +${Math.min(b.healAmount(u, s), t.stats.health - t.hp)} HP`);
      if (s.shield) lines.push(`→ ${who}: +${Math.round(t.stats.health * s.shield.maxHpPct)} shield`);
      if (s.cleanse) lines.push(`→ ${who}: cleanse ${t.statuses.filter((x) => x.debuff).length} debuff(s)`);
      const debuffs = (s.applyStatus ?? []).filter((a) => STATUSES[a.status]?.debuff).map((a) => STATUSES[a.status].name);
      if (debuffs.length) lines.push(`   ${debuffs.join(', ')}: ${b.resistChance(t)}% chance ${t.character.name} resists`);
      if (s.knockback) lines.push(`   knocked back ${s.knockback} tile${s.knockback > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  }

  private endPlayerPhase(): void {
    if (this.mode !== 'select' && this.mode !== 'target') return;
    this.mode = 'busy';
    this.action = null;
    this.selectedUid = null;
    this.threat = null;
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
      if (shouldDisengage(b, u)) {
        await this.showDisengage(u, b.disengage(u));
        if (!u.alive || b.outcome()) continue;
      }
      const mode = preferredMode(b, u);
      if (mode !== null) {
        b.setWeaponMode(u, mode);
        this.addLog(`${u.character.name} switches to ${b.modeName(u)} mode.`);
        this.floatText(u, b.modeName(u)!, '#e0b44c');
      }
      const plan = planTurn(b, u);
      if (b.canMove(u) && (plan.moveTo.x !== u.x || plan.moveTo.y !== u.y)) {
        const result = b.move(u, plan.moveTo);
        await this.animateMove(u, result);
      }
      if (shouldEscape(b, u)) {
        b.escape(u);
        const v = this.views.get(u.uid)!;
        await this.tween({ targets: v.container, alpha: 0, scale: 0.6, duration: 400 });
        v.container.setVisible(false);
        this.addLog(`${u.character.name} flees the battlefield!`);
        this.refreshUnits();
        continue;
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
      // Free actions still work if the turn didn't end.
      if (!free && u.alive && !b.outcome()) {
        const late = bestFreeAction(b, u);
        if (late) await this.enemyUse(u, late.id, late.target);
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
        const first = trigger.events[0];
        const shooter = first && first.type === 'damage' && first.source ? this.battle.unit(first.source).character.name : 'Overwatch';
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
    s = this.battle.skillFor(u, s);
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
    const detail = summary.length ? `: ${summary.join(', ')}`
      : s.cone ? ' and watches the area.' : s.teleport ? '.' : s.hits?.length ? ' — it hits nothing.' : ' — it has no effect.';
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
    s = this.battle.skillFor(caster, s);
    const g = this.add.graphics().setDepth(400);
    const color = isSupport(s) ? 0x6fdc8c : 0xffd166;
    const tiles = s.target === 'self' && !s.aoeRadius ? [{ x: caster.x, y: caster.y }] : this.battle.areaTiles(caster, s, target);
    for (const p of tiles) g.fillStyle(color, 0.5).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
    this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
  }

  private showEvent(e: BattleEvent, summary: string[], index: number): void {
    if (e.type === 'move' || e.type === 'overwatch' || e.type === 'escape') return;
    if (e.type === 'mode') {
      summary.push(`switches to ${e.name} mode`);
      this.floatText(this.battle.unit(e.target), e.name, '#e0b44c', index * 120);
      return;
    }
    if (e.type === 'disengage') {
      const other = this.battle.unit(e.target).character.name;
      summary.push(e.reason === 'escaped' ? `slips away from ${other}` : e.reason === 'separated' ? 'engagement broken' : `breaks away from ${other}`);
      return;
    }
    const t = this.battle.unit(e.target);
    const name = t.character.name;
    const delay = index * 180;
    switch (e.type) {
      case 'damage': {
        // Damage colors: Physical red, Magical violet, status ticks (Burn) orange.
        const color = e.cause === 'status' ? '#ffb35c' : e.damageType === 'magical' ? '#c18cff' : '#ff6b6b';
        if (e.cause === 'opportunity') this.floatText(t, 'Opportunity!', '#ff9f43', delay);
        if (e.amount > 0) this.floatText(t, `-${e.amount}`, color, delay);
        if (e.absorbed > 0) this.floatText(t, `(${e.absorbed} blocked)`, '#8ecbff', delay + 90);
        this.drawHp(t);
        if (e.cause !== 'status') this.cameras.main.shake(70, 0.002);
        summary.push(`${name} -${e.amount}${e.absorbed ? ` (${e.absorbed} shielded)` : ''}${e.killed ? ' ☠' : ''}`);
        if (e.killed) {
          const v = this.views.get(t.uid)!;
          this.tweens.add({ targets: v.container, alpha: 0, scale: 0.5, delay: delay + 200, duration: 500, onComplete: () => v.container.setVisible(false) });
        }
        break;
      }
      case 'engage': {
        this.floatText(t, 'Engaged!', '#ff9f43', delay + 150);
        summary.push(`engaged ${name}`);
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
      case 'resist':
        this.floatText(t, 'Resisted', '#c9ced8', delay + 200);
        summary.push(`${name} resisted ${e.name} (${e.chance}%)`);
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
    if (this.dialogOpen) return;
    this.ask(this.demo ? 'Retreat to camp?\nThis counts as a defeat (no XP).' : 'Retreat to the city?\nThe quest fails (no reward, no XP).', () => this.endBattle('defeat'), 'Retreat');
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
    let lines: string[];
    if (this.demo) {
      lines = resolveDemoBattle(requireDemo(), outcome);
    } else {
      lines = resolveQuest(requireState(), outcome, makeRng(Date.now() & 0xffffffff));
      markDirty();
    }
    const title = this.demo ? (outcome === 'victory' ? 'Victory!' : 'Defeat') : (outcome === 'victory' ? 'Quest complete!' : 'Quest failed');

    const layer = this.add.container(0, 0).setDepth(1000);
    layer.add(this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.65).setOrigin(0).setInteractive());
    layer.add(panel(this, WIDTH / 2 - 300, 60, 600, 520));
    layer.add(text(this, WIDTH / 2, 100, title, {
      fontSize: '36px', color: outcome === 'victory' ? COLORS.gold : COLORS.bad,
    }).setOrigin(0.5));
    // The report can be long (days pass on the way home): show it in a scrolling list.
    const report = new ScrollList(this, WIDTH / 2 - 280, 136, 560, 360, 4);
    report.root.setDepth(1001);
    report.setItems(lines.map((line) => {
      const t = text(this, 0, 0, line, { fontSize: '14px', wordWrap: { width: 540 }, lineSpacing: 2 });
      return { obj: this.add.container(0, 0, [t]), height: t.height };
    }), 'top');
    layer.add(this.demo
      ? button(this, WIDTH / 2 - 120, 510, 240, 50, 'Return to camp', () => this.scene.start('DemoCamp'), { fontSize: 18 })
      : button(this, WIDTH / 2 - 120, 510, 240, 50, `Return to ${GUILD.city}`, () => this.scene.start('City'), { fontSize: 18 }));
  }
}
