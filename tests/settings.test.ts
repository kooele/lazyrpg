import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHICS, parseGraphics, uiScaleFor, type Viewport } from '../src/game/settings';

const view = (dpr: number, win: [number, number], screen: [number, number]): Viewport => ({
  devicePixelRatio: dpr, windowWidth: win[0], windowHeight: win[1], screenWidth: screen[0], screenHeight: screen[1],
});

describe('graphics settings', () => {
  const macbook = view(2, [1470, 830], [1470, 956]);
  const mac5k = view(2, [2560, 1300], [2560, 1440]);
  const pc1080 = view(1, [1920, 950], [1920, 1080]);
  const smallWindow = view(2, [800, 560], [1470, 956]);

  it('auto follows the window and stops at 2x', () => {
    expect(uiScaleFor('auto', macbook)).toBe(2);
    expect(uiScaleFor('auto', mac5k)).toBe(2);
    expect(uiScaleFor('auto', pc1080)).toBe(1.5);
    expect(uiScaleFor('auto', smallWindow)).toBe(1.75);
    expect(uiScaleFor('auto', view(1, [700, 500], [700, 500]))).toBe(1);
  });

  it('ultra follows the whole screen, up to 4x (the old behaviour)', () => {
    expect(uiScaleFor('ultra', macbook)).toBe(3);
    expect(uiScaleFor('ultra', mac5k)).toBe(4);
    expect(uiScaleFor('ultra', smallWindow)).toBe(3);
  });

  it('fixed levels ignore the screen', () => {
    for (const v of [macbook, pc1080]) {
      expect(uiScaleFor('low', v)).toBe(1);
      expect(uiScaleFor('medium', v)).toBe(1.5);
      expect(uiScaleFor('high', v)).toBe(2);
    }
  });

  it('reads stored settings, keeping defaults for anything missing or invalid', () => {
    expect(parseGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    expect(parseGraphics('not json')).toEqual(DEFAULT_GRAPHICS);
    expect(parseGraphics('{"resolution":"high","frameCap":30}')).toEqual({ resolution: 'high', frameCap: 30 });
    expect(parseGraphics('{"resolution":"huge","frameCap":45}')).toEqual(DEFAULT_GRAPHICS);
    expect(parseGraphics('{"frameCap":0}')).toEqual({ resolution: 'auto', frameCap: 0 });
  });
});
