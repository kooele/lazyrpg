// Stat icons, bundled as SVG text: they're drawn into textures at startup (see BootScene) the same way custom looks
// are, so they never depend on fetching files.
import type { StatKey } from '../data/types';
import defense from './stats/defense.svg?raw';
import health from './stats/health.svg?raw';
import mAtk from './stats/mAtk.svg?raw';
import mPen from './stats/mPen.svg?raw';
import mana from './stats/mana.svg?raw';
import movement from './stats/movement.svg?raw';
import pAtk from './stats/pAtk.svg?raw';
import pPen from './stats/pPen.svg?raw';
import resist from './stats/resist.svg?raw';
import vision from './stats/vision.svg?raw';

/** SVG text of each stat's icon (the ones in STAT_ICONS). */
export const STAT_ICON_SVG: Partial<Record<StatKey, string>> = { defense, health, mAtk, mPen, mana, movement, pAtk, pPen, resist, vision };
