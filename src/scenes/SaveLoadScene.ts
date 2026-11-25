import Phaser from 'phaser';
import {
  SLOT_COUNT, exportToFile, importFromFile, readSlot, slotSummary, writeSlot, type ParseResult,
} from '../game/save';
import { requireState, session } from '../game/session';
import { COLORS, WIDTH, button, confirmDialog, panel, text, toast, setupCamera } from '../ui/widgets';

type Mode = 'save' | 'load';

export class SaveLoadScene extends Phaser.Scene {
  private mode: Mode = 'load';
  private returnTo = 'MainMenu';
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('SaveLoad');
  }

  init(data: { mode?: Mode; returnTo?: string }): void {
    this.mode = data.mode ?? 'load';
    this.returnTo = data.returnTo ?? 'MainMenu';
  }

  create(): void {
    setupCamera(this);
    this.render();
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(this.returnTo));
  }

  private render(): void {
    this.layer?.destroy();
    this.layer = this.add.container(0, 0);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.layer.add(o);
      return o;
    };
    const saving = this.mode === 'save';
    add(text(this, WIDTH / 2, 50, saving ? 'Save Game' : 'Load Game', { fontSize: '36px', color: COLORS.gold }).setOrigin(0.5));
    add(text(this, WIDTH / 2, 92, saving
      ? 'Pick a browser slot, or export a .json file to keep or share.'
      : 'Pick a browser slot, or import a .json save file.', { color: COLORS.dim }).setOrigin(0.5));

    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      const s = slotSummary(slot);
      const y = 130 + (slot - 1) * 110;
      add(panel(this, 130, y, 700, 96));
      add(text(this, 150, y + 12, `Slot ${slot}`, { fontSize: '20px', color: COLORS.gold }));
      if (s.empty) {
        add(text(this, 150, y + 46, 'Empty', { color: COLORS.dim }));
      } else if (s.error) {
        add(text(this, 150, y + 42, `Unreadable Save: ${s.error}`, { color: COLORS.bad, fontSize: '14px', wordWrap: { width: 480 } }));
      } else {
        const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
        add(text(this, 240, y + 15, `Day ${s.day} · ${s.rank} Rank · ${s.gold} Gold   ·   ${when}`, { color: COLORS.dim, fontSize: '14px' }));
        add(text(this, 150, y + 46, s.party ?? '', { fontSize: '15px', wordWrap: { width: 500 } }));
      }
      const canClick = saving || (!s.empty && !s.error);
      add(button(this, 680, y + 24, 130, 48, saving ? 'Save Here' : 'Load', () => this.useSlot(slot, s.empty), { enabled: canClick }));
    }

    const by = 470;
    if (saving) {
      add(button(this, 130, by, 340, 50, 'Export to .json File', () => {
        exportToFile(requireState());
        session.dirty = false;
        toast(this, 'Save file downloaded.', COLORS.good);
      }));
    } else {
      add(button(this, 130, by, 340, 50, 'Import .json File', () => this.importFile()));
    }
    add(button(this, 490, by, 340, 50, 'Back', () => this.scene.start(this.returnTo)));
  }

  private useSlot(slot: number, empty: boolean): void {
    if (this.mode === 'save') {
      const doSave = () => {
        try {
          writeSlot(slot, requireState());
          session.dirty = false;
          toast(this, `Saved to slot ${slot}.`, COLORS.good);
        } catch (e) {
          toast(this, (e as Error).message, COLORS.bad);
        }
        this.render();
      };
      if (empty) doSave();
      else confirmDialog(this, `Overwrite slot ${slot}?`, doSave, 'Overwrite');
      return;
    }
    const result = readSlot(slot);
    if (result) this.applyLoad(result);
  }

  private async importFile(): Promise<void> {
    const result = await importFromFile();
    if (result) this.applyLoad(result);
  }

  private applyLoad(result: ParseResult): void {
    const load = () => {
      if (!result.ok) {
        toast(this, `Could not load: ${result.error}`, COLORS.bad);
        return;
      }
      session.state = result.state;
      session.dirty = false;
      this.scene.start('City');
    };
    if (session.state && session.dirty && result.ok) {
      confirmDialog(this, 'Load this save?\nUnsaved progress will be lost.', load, 'Load');
    } else {
      load();
    }
  }
}
