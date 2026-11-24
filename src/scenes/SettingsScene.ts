import Phaser from 'phaser';
import { session } from '../game/session';
import {
  FRAME_CAP_OPTIONS, GPU_OPTIONS, RESOLUTION_OPTIONS, STARTUP_GRAPHICS, loadGraphics, saveGraphics, uiScaleFor,
  type GraphicsSettings, type ResolutionSetting,
} from '../game/settings';
import { COLORS, HEIGHT, UI_SCALE, WIDTH, button, confirmDialog, panel, setupCamera, text } from '../ui/widgets';

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
    const row = <T>(y: number, h: number, opts: { id: T; label: string }[], cur: T, label: (o: { id: T; label: string }) => string, pick: (id: T) => void, fontSize: number) => {
      const bw = (W - 32 - (opts.length - 1) * GAP) / opts.length;
      opts.forEach((o, i) => button(this, X + 16 + i * (bw + GAP), y, bw, h, label(o), () => pick(o.id), { selected: cur === o.id, fontSize }));
    };

    // ---- resolution (on reload) ----
    let y = 62;
    panel(this, X, y, W, 168);
    text(this, X + 16, y + 10, 'Resolution', { fontSize: '20px', color: COLORS.gold });
    text(this, X + 140, y + 15, `Now drawing ${pixels(UI_SCALE)} pixels (${fmtScale(UI_SCALE)}). Applies on reload.`, { fontSize: '14px', color: COLORS.dim });
    row(y + 44, 56, RESOLUTION_OPTIONS, this.settings.resolution, (o) => `${o.label}\n${pixels(this.scaleOf(o.id))}`, (id) => this.set({ resolution: id }), 15);
    const res = RESOLUTION_OPTIONS.find((o) => o.id === this.settings.resolution)!;
    text(this, X + 16, y + 112, res.hint, { fontSize: '14px', wordWrap: { width: W - 32 } });

    // ---- frame cap (at once) ----
    y = 240;
    panel(this, X, y, W, 128);
    text(this, X + 16, y + 10, 'Frame rate cap', { fontSize: '20px', color: COLORS.gold });
    this.fpsText = text(this, X + 180, y + 15, 'Measuring FPS…', { fontSize: '14px', color: COLORS.dim });
    this.fpsFrames = 0;
    this.fpsSince = performance.now();
    row(y + 44, 40, FRAME_CAP_OPTIONS, this.settings.frameCap, (o) => o.label, (id) => this.set({ frameCap: id }), 16);
    const cap = FRAME_CAP_OPTIONS.find((o) => o.id === this.settings.frameCap)!;
    text(this, X + 16, y + 94, `${cap.hint} Applies at once.`, { fontSize: '14px', wordWrap: { width: W - 32 } });

    // ---- graphics chip (on reload) ----
    y = 378;
    panel(this, X, y, W, 148);
    text(this, X + 16, y + 10, 'Graphics chip', { fontSize: '20px', color: COLORS.gold });
    text(this, X + 168, y + 15, 'For laptops with two graphics chips. Applies on reload.', { fontSize: '14px', color: COLORS.dim });
    row(y + 44, 40, GPU_OPTIONS, this.settings.gpu, (o) => o.label, (id) => this.set({ gpu: id }), 16);
    const gpu = GPU_OPTIONS.find((o) => o.id === this.settings.gpu)!;
    text(this, X + 16, y + 94, `${gpu.hint} The browser may ignore this.`, { fontSize: '14px', wordWrap: { width: W - 32 } });

    // ---- reload ----
    const pending = this.settings.resolution !== STARTUP_GRAPHICS.resolution || this.settings.gpu !== STARTUP_GRAPHICS.gpu;
    if (!this.stored) {
      text(this, X, 540, 'This browser won\'t store settings, so they last only until the page is closed.', { fontSize: '13px', color: COLORS.bad });
    } else if (pending) {
      text(this, X, 546, 'Reload the game to apply the new resolution or graphics chip.', { fontSize: '14px', color: COLORS.gold });
      button(this, X + 430, 536, 150, 36, 'Reload now', () => this.reload(), { fontSize: 15 });
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
