import Phaser from 'phaser';
import { session } from '../game/session';
import {
  FRAME_CAP_OPTIONS, RESOLUTION_OPTIONS, loadGraphics, saveGraphics, uiScaleFor,
  type GraphicsSettings, type ResolutionSetting,
} from '../game/settings';
import { ACTIVE_RESOLUTION, COLORS, HEIGHT, UI_SCALE, WIDTH, button, confirmDialog, panel, setupCamera, text } from '../ui/widgets';

const fmtScale = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(2).replace(/0$/, '')}x`;
const pixels = (s: number) => `${Math.round(960 * s)}x${Math.round(640 * s)}`;

/**
 * Settings: graphics quality (resolution and frame cap). Kept in the browser, not in save files.
 * Opened from the main menu; `returnTo` is the scene to go back to.
 */
export class SettingsScene extends Phaser.Scene {
  private returnTo = 'MainMenu';
  private settings: GraphicsSettings = loadGraphics();
  private stored = true;
  private fpsText?: Phaser.GameObjects.Text;
  /**
   * Frames rendered since `fpsSince` (a performance.now() time). Counted here because Phaser's
   * `loop.actualFps` counts every browser animation frame, including those the frame cap skips.
   */
  private fpsFrames = 0;
  private fpsSince = 0;

  constructor() {
    super('Settings');
  }

  init(data: { returnTo?: string }): void {
    this.returnTo = data.returnTo ?? 'MainMenu';
  }

  create(): void {
    setupCamera(this);
    this.settings = loadGraphics();
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(this.returnTo));
    this.render();
  }

  update(): void {
    // update() runs once per frame the game renders, so the cap is reflected here.
    this.fpsFrames++;
    const now = performance.now();
    const elapsed = now - this.fpsSince;
    if (elapsed >= 1000) {
      this.fpsText?.setText(`Running at ${Math.round((this.fpsFrames * 1000) / elapsed)} FPS`);
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  }

  private scaleOf(r: ResolutionSetting): number {
    return uiScaleFor(r, {
      devicePixelRatio: window.devicePixelRatio || 1,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenWidth: window.screen?.width ?? 0,
      screenHeight: window.screen?.height ?? 0,
    });
  }

  private set(change: Partial<GraphicsSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.stored = saveGraphics(this.settings);
    if (change.frameCap !== undefined) this.game.loop.setFPSLimit(change.frameCap);
    this.render();
  }

  private render(): void {
    this.children.removeAll(true);
    text(this, 24, 14, 'Settings', { fontSize: '30px', color: COLORS.gold });
    text(this, 160, 26, 'Graphics quality. Lower settings run faster and use less battery.', { fontSize: '14px', color: COLORS.dim });

    const X = 24;
    const W = WIDTH - 48;
    const GAP = 8;

    // ---- resolution ----
    let y = 70;
    panel(this, X, y, W, 222);
    text(this, X + 16, y + 12, 'Resolution', { fontSize: '20px', color: COLORS.gold });
    text(this, X + 140, y + 17, `Now drawing ${pixels(UI_SCALE)} pixels (${fmtScale(UI_SCALE)}).`, { fontSize: '14px', color: COLORS.dim });
    const n = RESOLUTION_OPTIONS.length;
    const bw = (W - 32 - (n - 1) * GAP) / n;
    RESOLUTION_OPTIONS.forEach((o, i) => {
      const s = this.scaleOf(o.id);
      button(this, X + 16 + i * (bw + GAP), y + 50, bw, 58, `${o.label}\n${pixels(s)}`, () => this.set({ resolution: o.id }), {
        selected: this.settings.resolution === o.id, fontSize: 15,
      });
    });
    const res = RESOLUTION_OPTIONS.find((o) => o.id === this.settings.resolution)!;
    text(this, X + 16, y + 122, res.hint, { fontSize: '14px', wordWrap: { width: W - 32 } });
    if (this.settings.resolution !== ACTIVE_RESOLUTION && this.stored) {
      text(this, X + 16, y + 168, 'Applies when the game is reloaded.', { fontSize: '14px', color: COLORS.gold });
      button(this, X + 280, y + 158, 150, 38, 'Reload now', () => this.reload(), { fontSize: 15 });
    } else {
      text(this, X + 16, y + 168, 'A change applies when the game is reloaded (the canvas and art are made at startup).', {
        fontSize: '13px', color: COLORS.dim,
      });
    }

    // ---- frame cap ----
    y = 306;
    panel(this, X, y, W, 156);
    text(this, X + 16, y + 12, 'Frame rate cap', { fontSize: '20px', color: COLORS.gold });
    this.fpsText = text(this, X + 180, y + 17, 'Measuring FPS…', { fontSize: '14px', color: COLORS.dim });
    this.fpsFrames = 0;
    this.fpsSince = performance.now();
    const m = FRAME_CAP_OPTIONS.length;
    const fw = (W - 32 - (m - 1) * GAP) / m;
    FRAME_CAP_OPTIONS.forEach((o, i) => {
      button(this, X + 16 + i * (fw + GAP), y + 50, fw, 44, o.label, () => this.set({ frameCap: o.id }), {
        selected: this.settings.frameCap === o.id, fontSize: 16,
      });
    });
    const cap = FRAME_CAP_OPTIONS.find((o) => o.id === this.settings.frameCap)!;
    text(this, X + 16, y + 108, `${cap.hint} Applies at once.`, { fontSize: '14px', wordWrap: { width: W - 32 } });

    if (!this.stored) {
      text(this, X, 478, 'This browser won\'t store settings, so they last only until the page is closed.', { fontSize: '13px', color: COLORS.bad });
    }

    button(this, 24, HEIGHT - 54, 180, 40, 'Back', () => this.scene.start(this.returnTo), { fontSize: 16 });
    text(this, 220, HEIGHT - 42, 'Esc also goes back. Settings are kept in this browser, not in save files.', { fontSize: '13px', color: COLORS.dim });
  }

  private reload(): void {
    const go = () => window.location.reload();
    if (!session.state) go();
    else if (session.dirty) confirmDialog(this, 'Reload the game now?\nUnsaved progress will be lost.', go, 'Reload');
    else confirmDialog(this, 'Reload the game now?\nLoad your save afterwards to continue.', go, 'Reload');
  }
}
