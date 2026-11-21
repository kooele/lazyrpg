// Generates the unit art in public/art/units as SVG files (crisp at any resolution).
//   node tools/generate-art.mjs
//
// Style: "storybook" - no outlines, simple dot eyes, a muted watercolour palette,
// soft light from the top-left and a light paper texture. Figures are 5 heads tall.
//
// Each body model is drawn once per weapon (the pose depends on the weapon), as
// units/<model>_<weapon art>.svg on a 64x80 canvas with the feet at y = 76.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art', 'units');

// ---- colour helpers -------------------------------------------------------------------------
function mix(hex, to, f) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const dark = (h, f) => mix(h, '#000000', f);
const light = (h, f) => mix(h, '#ffffff', f);
function grey(h) {
  const n = parseInt(h.slice(1), 16);
  const g = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11);
  return `#${[g, g, g].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** Watercolour look: a little desaturated and warmed toward paper. */
const paint = (h) => mix(mix(h, grey(h), 0.22), '#f3e6cf', 0.12);
const n = (v) => +v.toFixed(2);

// ---- body models ------------------------------------------------------------------------------
// outfit: armor (tunic + breastplate), tunic (tunic + vest), robe (long dress + cape).
const MODELS = {
  m1: { female: false, skin: '#f0c8a2', hair: '#6a3f24', hairStyle: 'short', eyes: '#3d6fb8', outfit: 'armor', cloth: '#3f6fb5', accent: '#d9b44a', legs: '#4a4036', boots: '#6b4a2e' },
  m2: { female: false, skin: '#d9a77a', hair: '#1f1b1d', hairStyle: 'spiky', eyes: '#4a3020', outfit: 'tunic', cloth: '#3f8a5a', accent: '#8a5a34', legs: '#3b3b44', boots: '#5a3d28' },
  m3: { female: false, skin: '#8d5a3b', hair: '#2a1d17', hairStyle: 'bald', beard: true, eyes: '#3a2418', outfit: 'armor', cloth: '#8a4b32', accent: '#c9a050', legs: '#3f3630', boots: '#4e3424' },
  m4: { female: false, skin: '#f3d2b5', hair: '#d8b45a', hairStyle: 'swept', stubble: true, eyes: '#4f8a6a', outfit: 'tunic', cloth: '#6b6f7a', accent: '#7a4a32', legs: '#2f3540', boots: '#5a3d28' },
  f1: { female: true, skin: '#f4cfae', hair: '#7a4a2a', hairStyle: 'long', eyes: '#2f7a6a', outfit: 'robe', cloth: '#2f8f8a', accent: '#e0c070', legs: '#4a4036', boots: '#6b4a2e' },
  f2: { female: true, skin: '#f6d6bf', hair: '#b8442b', hairStyle: 'ponytail', eyes: '#4a7a3a', outfit: 'tunic', cloth: '#7a4fa3', accent: '#c9a050', legs: '#3b3346', boots: '#5a3d28' },
  f3: { female: true, skin: '#7a4a2f', hair: '#1c1416', hairStyle: 'bun', eyes: '#3a2418', outfit: 'armor', cloth: '#c9772f', accent: '#e0c070', legs: '#3f3630', boots: '#4e3424' },
  f4: { female: true, skin: '#e0b088', hair: '#e8cf7a', hairStyle: 'bob', eyes: '#3d6fb8', outfit: 'robe', cloth: '#a8324a', accent: '#e0c070', legs: '#2f3540', boots: '#6b4a2e' },
};
const WEAPONS = ['sword_shield', 'spear', 'bow', 'staff'];
const METAL = '#b9c3cf';
const WOOD = '#8a5a34';

// ---- one figure -------------------------------------------------------------------------------
function figure(id, model, weapon) {
  const P = {};
  for (const k of ['skin', 'hair', 'eyes', 'cloth', 'accent', 'legs', 'boots']) P[k] = paint(model[k]);
  const metal = paint(METAL);
  const wood = paint(WOOD);
  const female = model.female;

  const path = (d, fill, extra = '') => `<path d="${d.replace(/\s+/g, ' ').trim()}" fill="${fill}" ${extra}/>`;
  const limb = (pts, w, color) => `<path d="M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L')}" fill="none" stroke="${color}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const circle = (x, y, r, fill, extra = '') => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" ${extra}/>`;

  // ---- skeleton: 5 heads tall ----
  const top = 6;
  const H = 70 / 5; // head height
  const hw = H * 0.455; // head half-width
  const chin = top + H;
  const b = 76 - chin;
  const shoulderY = chin + H * 0.17; // a short, natural neck
  const waistY = shoulderY + (b - H * 0.17) * 0.33;
  const hipY = shoulderY + (b - H * 0.17) * 0.45;
  const kneeY = shoulderY + (b - H * 0.17) * 0.72;
  const ankleY = 74;
  const sW = (H * 0.69 + 3) * (female ? 0.86 : 1); // shoulder half-width
  const wW = sW * (female ? 0.62 : 0.74);
  const hipW = sW * (female ? 0.84 : 0.76);
  const armW = Math.max(2.6, sW * 0.33);
  const legW = sW * (female ? 0.4 : 0.44);
  const legX = hipW * 0.5;
  const at = (u, v) => `${n(32 + u * hw)} ${n(top + v * H)}`; // head-space point

  // Hand positions depend on the weapon. "r" = the figure's right hand (viewer's left).
  const relaxed = (s) => [32 + s * (sW + 1.2), hipY + 0.5];
  const hands = {
    sword_shield: { r: [32 - sW - 3.2, hipY - 1], l: [32 + sW + 2.5, waistY + 1] },
    spear: { r: [32 - sW - 2.6, waistY + 1.5], l: relaxed(1) },
    staff: { r: [32 - sW - 2.6, waistY + 1.5], l: relaxed(1) },
    bow: { r: relaxed(-1), l: [32 + sW + 4.2, waistY - 0.5] },
  }[weapon];

  const back = [];
  const parts = [];
  const hair = [];
  const front = [];
  const face = [];

  // Soft ground shadow.
  back.push('<ellipse cx="32" cy="76.2" rx="12" ry="2.6" fill="#2a2018" opacity="0.25"/>');

  // ---- things behind the body ----
  const cyC = top + H * 0.46;
  if (model.hairStyle === 'long') {
    const len = hipY + 1;
    back.push(path(`M${at(-1.05, 0.46)} Q${at(-1.25, -0.08)} ${at(0, -0.08)} Q${at(1.25, -0.08)} ${at(1.05, 0.46)}
      L${n(32 + hw + 1.5 + sW * 0.2)} ${n(len)} Q32 ${n(len + 2.5)} ${n(32 - hw - 1.5 - sW * 0.2)} ${n(len)} Z`, dark(P.hair, 0.15)));
  }
  if (model.hairStyle === 'bob') {
    back.push(path(`M${at(-1.1, 0.46)} Q${at(-1.25, -0.08)} ${at(0, -0.08)} Q${at(1.25, -0.08)} ${at(1.1, 0.46)} L${at(1.18, 1.08)} Q${at(0, 1.18)} ${at(-1.18, 1.08)} Z`, dark(P.hair, 0.15)));
  }
  if (model.hairStyle === 'ponytail') {
    back.push(path(`M${at(0.5, 0.05)} Q${at(1.9, 0.1)} ${at(1.55, 1.2)} Q${at(1.45, 1.9)} ${at(1.05, 2.25)} Q${at(1.15, 1.5)} ${at(0.7, 0.9)} Z`, dark(P.hair, 0.12)));
  }
  if (model.hairStyle === 'bun') back.push(circle(32, top + H * 0.02, H * 0.26, dark(P.hair, 0.08)));
  if (weapon === 'bow') {
    // Quiver across the back, arrows over the right shoulder.
    back.push(`<g transform="rotate(-22 ${n(32 - sW * 0.3)} ${n(shoulderY + 6)})">
      ${limb([[32 - sW * 0.3, shoulderY - 5], [32 - sW * 0.3, shoulderY - 8.5]], 0.8, '#efe6d2')}
      ${limb([[32 - sW * 0.3 - 1.2, shoulderY - 5], [32 - sW * 0.3 - 1.2, shoulderY - 8]], 0.8, '#efe6d2')}
      ${limb([[32 - sW * 0.3 + 1.2, shoulderY - 5], [32 - sW * 0.3 + 1.2, shoulderY - 7.8]], 0.8, '#efe6d2')}
      <path d="M${n(32 - sW * 0.3 - 1.9)} ${n(shoulderY - 9.2)} l1 -1.6 l1 1.6 Z M${n(32 - sW * 0.3 - 0.7)} ${n(shoulderY - 9.6)} l0.9 -1.5 l0.9 1.5 Z" fill="#c25a4a"/>
      <rect x="${n(32 - sW * 0.3 - 2.6)}" y="${n(shoulderY - 5.5)}" width="5.2" height="15" rx="1.6" fill="${dark(wood, 0.15)}"/></g>`);
  }
  if (model.outfit === 'robe') {
    back.push(path(`M${n(32 - sW + 1)} ${n(shoulderY)} L${n(32 - sW - 4)} ${n(kneeY + 3)} Q32 ${n(kneeY + 6)} ${n(32 + sW + 4)} ${n(kneeY + 3)} L${n(32 + sW - 1)} ${n(shoulderY)} Z`, dark(P.accent === P.cloth ? P.cloth : mix(P.cloth, '#203040', 0.45), 0.1)));
  }

  // ---- legs & boots ----
  const bootTop = kneeY + (ankleY - kneeY) * 0.35;
  for (const s of [-1, 1]) {
    parts.push(limb([[32 + s * legX, hipY - 1], [32 + s * legX * 1.02, kneeY], [32 + s * legX * 1.05, ankleY - 2]], legW, P.legs));
    const x = 32 + s * legX * 1.05;
    const bw = legW * 0.62 + 0.4;
    const toe = s * 1.8;
    parts.push(path(`M${n(x - bw)} ${n(bootTop)} L${n(x + bw)} ${n(bootTop)} L${n(x + bw + (s > 0 ? toe : 0))} 75
      Q${n(x + bw + toe)} 76.6 ${n(x)} 76.6 L${n(x - bw + (s < 0 ? toe : 0))} 76.6 Q${n(x - bw - 0.6 + (s < 0 ? toe : 0))} 76 ${n(x - bw + (s < 0 ? toe * 0.5 : 0))} 75 Z`, P.boots));
    parts.push(limb([[x - bw, bootTop + 1.4], [x + bw, bootTop + 1.4]], 0.7, dark(P.boots, 0.3)));
  }

  // ---- torso ----
  const beltH = Math.max(1.8, b * 0.045);
  const torso = (skirtY, flare) => path(`M${n(32 - sW + 1.5)} ${n(shoulderY)} Q${n(32 - sW)} ${n(shoulderY)} ${n(32 - sW)} ${n(shoulderY + 2)}
    L${n(32 - wW)} ${n(waistY)} L${n(32 - hipW - flare)} ${n(skirtY)} L${n(32 + hipW + flare)} ${n(skirtY)} L${n(32 + wW)} ${n(waistY)}
    L${n(32 + sW)} ${n(shoulderY + 2)} Q${n(32 + sW)} ${n(shoulderY)} ${n(32 + sW - 1.5)} ${n(shoulderY)} Z`, P.cloth);
  const belt = (color) => {
    parts.push(path(`M${n(32 - wW - 0.4)} ${n(waistY)} L${n(32 + wW + 0.4)} ${n(waistY)} L${n(32 + wW + 0.8)} ${n(waistY + beltH)} L${n(32 - wW - 0.8)} ${n(waistY + beltH)} Z`, color));
    parts.push(path(`M30.4 ${n(waistY - 0.3)} h3.2 v${n(beltH + 0.6)} h-3.2 Z`, P.accent));
  };
  if (model.outfit === 'armor') {
    const skirtY = hipY + (kneeY - hipY) * 0.45;
    parts.push(torso(skirtY, 2));
    parts.push(limb([[32, hipY + 0.5], [32, skirtY - 0.3]], 0.6, dark(P.cloth, 0.35)));
    const bp = sW * 0.82;
    parts.push(path(`M${n(32 - bp)} ${n(shoulderY + 1.2)} Q32 ${n(shoulderY + 3.2)} ${n(32 + bp)} ${n(shoulderY + 1.2)} L${n(32 + wW * 0.95)} ${n(waistY)} Q32 ${n(waistY + 2)} ${n(32 - wW * 0.95)} ${n(waistY)} Z`, metal));
    parts.push(limb([[32, shoulderY + 2.8], [32, waistY + 0.8]], 0.6, dark(metal, 0.25)));
    parts.push(`<path d="M${n(32 - bp * 0.6)} ${n(shoulderY + 3.5)} Q${n(32 - bp * 0.2)} ${n(shoulderY + 6)} ${n(32 - bp * 0.3)} ${n(waistY - 2)}" stroke="${light(metal, 0.6)}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`);
    for (const s of [-1, 1]) {
      parts.push(path(`M${n(32 + s * (sW - 3.5))} ${n(shoulderY + 0.2)} Q${n(32 + s * (sW + 2.2))} ${n(shoulderY - 1)} ${n(32 + s * (sW + 1.8))} ${n(shoulderY + 4.2)} Q${n(32 + s * (sW - 1))} ${n(shoulderY + 3.2)} ${n(32 + s * (sW - 3.5))} ${n(shoulderY + 0.2)} Z`, metal));
    }
    belt(P.legs);
  } else if (model.outfit === 'tunic') {
    const skirtY = hipY + (kneeY - hipY) * (female ? 0.5 : 0.35);
    parts.push(torso(skirtY, female ? 2.4 : 1.2));
    // leather vest
    const vest = dark(P.accent, 0.1);
    parts.push(path(`M${n(32 - sW + 1.2)} ${n(shoulderY + 0.6)} L${n(32 - 2.2)} ${n(shoulderY + 0.6)} L${n(32 - 1)} ${n(waistY)} L${n(32 - wW)} ${n(waistY)} L${n(32 - sW + 0.6)} ${n(shoulderY + 3)} Z`, vest));
    parts.push(path(`M${n(32 + sW - 1.2)} ${n(shoulderY + 0.6)} L${n(32 + 2.2)} ${n(shoulderY + 0.6)} L${n(32 + 1)} ${n(waistY)} L${n(32 + wW)} ${n(waistY)} L${n(32 + sW - 0.6)} ${n(shoulderY + 3)} Z`, vest));
    parts.push(path(`M${n(32 - 2.6)} ${n(shoulderY)} L32 ${n(shoulderY + 3.2)} L${n(32 + 2.6)} ${n(shoulderY)} Z`, dark(P.skin, 0.08)));
    belt(dark(P.legs, 0.1));
  } else {
    const hemY = kneeY + (ankleY - kneeY) * 0.3;
    const hemW = sW * 1.2;
    parts.push(path(`M${n(32 - sW + 1.5)} ${n(shoulderY)} Q${n(32 - sW)} ${n(shoulderY)} ${n(32 - sW)} ${n(shoulderY + 2)} L${n(32 - wW)} ${n(waistY)}
      Q${n(32 - hipW)} ${n(hipY)} ${n(32 - hemW)} ${n(hemY)} Q32 ${n(hemY + 2.5)} ${n(32 + hemW)} ${n(hemY)} Q${n(32 + hipW)} ${n(hipY)} ${n(32 + wW)} ${n(waistY)}
      L${n(32 + sW)} ${n(shoulderY + 2)} Q${n(32 + sW)} ${n(shoulderY)} ${n(32 + sW - 1.5)} ${n(shoulderY)} Z`, P.cloth));
    parts.push(`<path d="M${n(32 - hemW + 0.6)} ${n(hemY - 1.2)} Q32 ${n(hemY + 1.3)} ${n(32 + hemW - 0.6)} ${n(hemY - 1.2)}" stroke="${P.accent}" stroke-width="1.2" fill="none"/>`);
    parts.push(limb([[32, waistY + 1], [32, hemY + 1]], 0.6, dark(P.cloth, 0.2)));
    parts.push(path(`M${n(32 - sW * 0.6)} ${n(shoulderY + 0.2)} Q32 ${n(shoulderY + 4.5)} ${n(32 + sW * 0.6)} ${n(shoulderY + 0.2)} Q32 ${n(shoulderY + 2)} ${n(32 - sW * 0.6)} ${n(shoulderY + 0.2)} Z`, P.accent));
    parts.push(path(`M${n(32 - wW - 0.3)} ${n(waistY - 0.5)} L${n(32 + wW + 0.3)} ${n(waistY - 0.5)} L${n(32 + wW + 0.6)} ${n(waistY + beltH)} L${n(32 - wW - 0.6)} ${n(waistY + beltH)} Z`, P.accent));
    parts.push(path(`M33 ${n(waistY + beltH)} l1.2 ${n(b * 0.12)} l1.6 -0.6 l-1 ${n(-b * 0.11)} Z`, P.accent));
  }

  // ---- arms ----
  const handR = armW * 0.58;
  for (const [s, hand] of [[-1, hands.r], [1, hands.l]]) {
    const sh = [32 + s * (sW - armW * 0.45), shoulderY + armW * 0.5];
    const elbow = [32 + s * (sW + armW * 0.25), waistY - 1];
    parts.push(limb([sh, elbow, hand], armW, P.cloth));
    const ex = elbow[0] + (hand[0] - elbow[0]) * 0.55;
    const ey = elbow[1] + (hand[1] - elbow[1]) * 0.55;
    if (model.outfit === 'robe') {
      parts.push(path(`M${n(ex - armW * 0.8)} ${n(ey - 1)} L${n(ex + armW * 0.8)} ${n(ey - 1)} L${n(ex + armW)} ${n(ey + 1.2)} L${n(ex - armW)} ${n(ey + 1.2)} Z`, P.accent));
    } else {
      const glove = model.outfit === 'armor' ? metal : dark(P.accent, 0.1);
      parts.push(limb([[ex, ey], [hand[0] - (hand[0] - elbow[0]) * 0.08, hand[1] - (hand[1] - elbow[1]) * 0.08]], armW + 0.5, glove));
    }
    parts.push(circle(hand[0], hand[1], handR, P.skin));
  }

  // ---- neck & head ----
  const neckW = hw * 0.36;
  parts.push(path(`M${n(32 - neckW)} ${n(chin - 2.5)} L${n(32 - neckW)} ${n(shoulderY + 0.8)} Q32 ${n(shoulderY + 1.8)} ${n(32 + neckW)} ${n(shoulderY + 0.8)} L${n(32 + neckW)} ${n(chin - 2.5)} Z`, dark(P.skin, 0.12)));
  if (!female && model.hairStyle !== 'long') {
    for (const s of [-1, 1]) parts.push(`<ellipse cx="${n(32 + s * hw)}" cy="${n(top + H * 0.58)}" rx="${n(H * 0.07)}" ry="${n(H * 0.11)}" fill="${P.skin}"/>`);
  }
  const jawX = hw * 0.62;
  const jawY = chin - H * 0.16;
  parts.push(path(`M${n(32 - hw)} ${n(cyC)} A${n(hw)} ${n(H * 0.47)} 0 0 1 ${n(32 + hw)} ${n(cyC)}
    C${n(32 + hw)} ${n(cyC + (jawY - cyC) * 0.7)} ${n(32 + jawX + (hw - jawX) * 0.4)} ${n(jawY)} ${n(32 + jawX)} ${n(jawY + 0.5)}
    Q32 ${n(chin + 0.8)} ${n(32 - jawX)} ${n(jawY + 0.5)} C${n(32 - jawX - (hw - jawX) * 0.4)} ${n(jawY)} ${n(32 - hw)} ${n(cyC + (jawY - cyC) * 0.7)} ${n(32 - hw)} ${n(cyC)} Z`, P.skin));
  if (model.stubble) parts.push(path(`M${at(-0.85, 0.7)} Q${at(-0.7, 1.02)} ${at(0, 1.04)} Q${at(0.7, 1.02)} ${at(0.85, 0.7)} Q${at(0, 0.98)} ${at(-0.85, 0.7)} Z`, dark(P.hair, 0.2), 'opacity="0.35"'));

  // ---- face (dot eyes) ----
  const eyeY = top + H * 0.57;
  for (const s of [-1, 1]) {
    const x = 32 + s * hw * 0.42;
    face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY)}" rx="${n(H * 0.05)}" ry="${n(H * 0.066)}" fill="${dark(P.eyes, 0.6)}"/>`);
    face.push(circle(x - H * 0.017, eyeY - H * 0.022, H * 0.017, '#ffffff'));
    const browY = eyeY - H * (female ? 0.15 : 0.13);
    face.push(`<path d="M${n(x - H * 0.075)} ${n(browY + (female ? 0.2 : 0.1))} Q${n(x)} ${n(browY - H * 0.03)} ${n(x + H * 0.075)} ${n(browY + (female ? 0.2 : 0.1))}" stroke="${dark(P.hair, 0.25)}" stroke-width="${n(H * (female ? 0.022 : 0.032))}" fill="none" stroke-linecap="round"/>`);
    if (female) face.push(`<path d="M${n(x + s * H * 0.04)} ${n(eyeY - H * 0.05)} l${n(s * H * 0.04)} ${n(-H * 0.025)}" stroke="${dark(P.eyes, 0.6)}" stroke-width="${n(H * 0.018)}" stroke-linecap="round"/>`);
    face.push(`<ellipse cx="${n(x + s * H * 0.04)}" cy="${n(eyeY + H * 0.14)}" rx="${n(H * 0.07)}" ry="${n(H * 0.035)}" fill="#ff8fa3" opacity="${female ? 0.35 : 0.2}"/>`);
  }
  face.push(circle(32, eyeY + H * 0.12, H * 0.013, dark(P.skin, 0.35)));
  if (!model.beard) {
    const mw = H * 0.06;
    const my = top + H * 0.8;
    face.push(`<path d="M${n(32 - mw)} ${n(my)} Q32 ${n(my + H * 0.035)} ${n(32 + mw)} ${n(my)}" stroke="${female ? '#b85a64' : dark(P.skin, 0.45)}" stroke-width="${n(H * 0.03)}" fill="none" stroke-linecap="round"/>`);
  }

  // ---- hair (front) ----
  const fringe = (pts) => {
    // pts: list of [u, v] along the fringe, from the right temple to the left one.
    let d = `M${at(-1.06, 0.62)} Q${at(-1.18, -0.08)} ${at(0, -0.09)} Q${at(1.18, -0.08)} ${at(1.06, 0.62)}`;
    for (let i = 0; i < pts.length; i += 2) d += pts[i + 1] ? ` Q${at(...pts[i])} ${at(...pts[i + 1])}` : ` L${at(...pts[i])}`;
    return path(`${d} Z`, P.hair);
  };
  switch (model.hairStyle) {
    case 'short':
      hair.push(fringe([[0.8, 0.3], [0.55, 0.24], [0.45, 0.41], [0.2, 0.42], [0.1, 0.28], [-0.15, 0.3], [-0.25, 0.44], [-0.5, 0.44], [-0.6, 0.31], [-0.78, 0.34], [-0.95, 0.48], [-1.06, 0.62]]));
      break;
    case 'spiky':
      hair.push(path(`M${at(-1.08, 0.6)} L${at(-1.2, 0.05)} L${at(-0.85, 0.12)} L${at(-0.75, -0.22)} L${at(-0.4, -0.02)} L${at(-0.1, -0.3)} L${at(0.15, -0.04)} L${at(0.5, -0.25)} L${at(0.65, 0.04)} L${at(1.1, -0.08)} L${at(0.98, 0.2)} L${at(1.08, 0.6)}
        L${at(0.75, 0.32)} L${at(0.55, 0.42)} L${at(0.35, 0.28)} L${at(0.1, 0.42)} L${at(-0.1, 0.28)} L${at(-0.35, 0.42)} L${at(-0.55, 0.3)} L${at(-0.8, 0.42)} Z`, P.hair));
      break;
    case 'bald':
      hair.push(`<path d="M${at(-0.5, 0.1)} Q${at(0, -0.02)} ${at(0.45, 0.08)}" stroke="${light(P.skin, 0.35)}" stroke-width="${n(H * 0.05)}" fill="none" stroke-linecap="round" opacity="0.7"/>`);
      break;
    case 'swept':
      hair.push(fringe([[0.9, 0.4], [0.75, 0.42], [0.5, 0.3], [0.2, 0.28], [-0.1, 0.24], [-0.4, 0.26], [-0.65, 0.3], [-0.85, 0.36], [-0.98, 0.5], [-1.06, 0.62]]));
      break;
    case 'long':
      hair.push(fringe([[0.9, 0.6], [0.75, 0.38], [0.55, 0.47], [0.3, 0.45], [0.15, 0.32], [-0.1, 0.3], [-0.3, 0.46], [-0.55, 0.45], [-0.78, 0.44], [-0.95, 0.75], [-1.06, 0.62]]));
      hair.push(path(`M${at(-1.06, 0.5)} Q${at(-1.2, 1.2)} ${at(-0.95, 1.55)} Q${at(-0.82, 1.1)} ${at(-0.86, 0.6)} Z M${at(1.06, 0.5)} Q${at(1.2, 1.2)} ${at(0.95, 1.55)} Q${at(0.82, 1.1)} ${at(0.86, 0.6)} Z`, P.hair));
      break;
    case 'ponytail':
      hair.push(fringe([[0.85, 0.34], [0.6, 0.3], [0.45, 0.42], [0.2, 0.4], [0.05, 0.28], [-0.2, 0.3], [-0.35, 0.44], [-0.6, 0.42], [-0.75, 0.36], [-0.95, 0.55], [-1.06, 0.62]]));
      hair.push(circle(32 + hw * 0.72, top + H * 0.08, H * 0.07, P.accent));
      break;
    case 'bun':
      hair.push(fringe([[0.9, 0.45], [0.7, 0.2], [0.4, 0.25], [0.1, 0.18], [-0.2, 0.22], [-0.5, 0.2], [-0.75, 0.26], [-0.95, 0.4], [-1.02, 0.55], [-1.06, 0.62]]));
      break;
    case 'bob':
      hair.push(fringe([[0.95, 0.5], [0.8, 0.42], [0.5, 0.42], [0.2, 0.42], [0, 0.42], [-0.25, 0.42], [-0.5, 0.42], [-0.8, 0.42], [-0.98, 0.5], [-1.06, 0.62]]));
      hair.push(path(`M${at(-1.08, 0.5)} Q${at(-1.2, 0.9)} ${at(-1.12, 1.1)} L${at(-0.86, 1.08)} Q${at(-0.86, 0.8)} ${at(-0.86, 0.5)} Z M${at(1.08, 0.5)} Q${at(1.2, 0.9)} ${at(1.12, 1.1)} L${at(0.86, 1.08)} Q${at(0.86, 0.8)} ${at(0.86, 0.5)} Z`, P.hair));
      break;
  }
  if (model.beard) {
    hair.push(path(`M${at(-0.98, 0.55)} Q${at(-1.0, 1.05)} ${at(0, 1.25)} Q${at(1.0, 1.05)} ${at(0.98, 0.55)} Q${at(0.75, 0.82)} ${at(0.3, 0.8)} Q${at(0, 0.74)} ${at(-0.3, 0.8)} Q${at(-0.75, 0.82)} ${at(-0.98, 0.55)} Z`, P.hair));
    hair.push(`<path d="M${at(-0.2, 0.9)} Q${at(0, 0.95)} ${at(0.2, 0.9)}" stroke="${dark(P.skin, 0.45)}" stroke-width="${n(H * 0.03)}" fill="none" stroke-linecap="round"/>`);
  }
  if (model.hairStyle !== 'bald') {
    hair.push(`<path d="M${at(-0.55, 0.12)} Q${at(0, -0.02)} ${at(0.5, 0.12)}" stroke="${light(P.hair, 0.4)}" stroke-width="${n(H * 0.04)}" fill="none" stroke-linecap="round" opacity="0.7"/>`);
  }

  // ---- weapon ----
  const [rx, ry] = hands.r;
  const [lx, ly] = hands.l;
  const gripOver = (x, y) => front.push(circle(x, y, handR, P.skin));
  if (weapon === 'sword_shield') {
    const ang = -0.12;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const blade = 26;
    const bw = 1.5;
    const gx = rx + dx * 2.5;
    const gy = ry + dy * 2.5;
    const tx = gx + dx * blade;
    const ty = gy + dy * blade;
    const nx = -dy;
    const ny = dx;
    front.push(path(`M${n(gx + nx * bw)} ${n(gy + ny * bw)} L${n(tx + nx * bw - dx * 3)} ${n(ty + ny * bw - dy * 3)} L${n(tx)} ${n(ty)} L${n(tx - nx * bw - dx * 3)} ${n(ty - ny * bw - dy * 3)} L${n(gx - nx * bw)} ${n(gy - ny * bw)} Z`, '#d6dbe2'));
    front.push(limb([[gx + nx * 0.3, gy + ny * 0.3], [tx + nx * 0.3 - dx * 3, ty + ny * 0.3 - dy * 3]], 0.7, '#ffffff'));
    front.push(limb([[rx - dx * 2.5, ry - dy * 2.5], [gx, gy]], 1.5, '#5a3a22'));
    front.push(limb([[gx + nx * 4, gy + ny * 4], [gx - nx * 4, gy - ny * 4]], 1.7, paint('#c9a050')));
    front.push(circle(rx - dx * 3.4, ry - dy * 3.4, 1.2, paint('#c9a050')));
    gripOver(rx, ry);
    const w = 7.3;
    const ht = 19;
    const t = ly - ht * 0.42;
    const bt = ly + ht * 0.58;
    const face1 = paint('#7d8aa3');
    front.push(path(`M${n(lx - w)} ${n(t)} Q${n(lx)} ${n(t - 2)} ${n(lx + w)} ${n(t)} L${n(lx + w)} ${n(t + ht * 0.4)} Q${n(lx + w * 0.8)} ${n(bt - ht * 0.2)} ${n(lx)} ${n(bt)} Q${n(lx - w * 0.8)} ${n(bt - ht * 0.2)} ${n(lx - w)} ${n(t + ht * 0.4)} Z`, face1));
    front.push(path(`M${n(lx - w + 1.5)} ${n(t + 1.2)} Q${n(lx)} ${n(t - 0.6)} ${n(lx + w - 1.5)} ${n(t + 1.2)} L${n(lx + w - 1.5)} ${n(t + ht * 0.4)} Q${n(lx + w * 0.7)} ${n(bt - ht * 0.25)} ${n(lx)} ${n(bt - 2)} Q${n(lx - w * 0.7)} ${n(bt - ht * 0.25)} ${n(lx - w + 1.5)} ${n(t + ht * 0.4)} Z`, paint('#a33b3b')));
    front.push(`<path d="M${n(lx)} ${n(t + 2.5)} L${n(lx)} ${n(bt - 3.5)} M${n(lx - w * 0.55)} ${n(t + ht * 0.3)} L${n(lx + w * 0.55)} ${n(t + ht * 0.3)}" stroke="${paint('#e8c45a')}" stroke-width="1.8" stroke-linecap="round"/>`);
  } else if (weapon === 'spear') {
    const x0 = rx + 0.5;
    const x1 = rx - 0.8;
    const tipY = 0.6;
    front.push(limb([[x0, 76.5], [x1, tipY + 10]], 1.9, wood));
    front.push(path(`M${n(x1)} ${n(tipY)} L${n(x1 + 2.6)} ${n(tipY + 7.5)} L${n(x1)} ${n(tipY + 10.5)} L${n(x1 - 2.6)} ${n(tipY + 7.5)} Z`, '#d6dbe2'));
    front.push(limb([[x1, tipY + 1.5], [x1, tipY + 9]], 0.6, '#ffffff'));
    front.push(`<path d="M${n(x1 - 2)} ${n(tipY + 11)} Q${n(x1)} ${n(tipY + 13.5)} ${n(x1 + 2)} ${n(tipY + 11)}" fill="none" stroke="${paint('#b84a3a')}" stroke-width="1.8"/>`);
    gripOver(rx, ry);
  } else if (weapon === 'staff') {
    const topY = top - 2;
    const sx = rx - 0.9;
    front.push(limb([[rx + 0.4, 76.5], [sx, topY + 6]], 1.9, dark(wood, 0.1)));
    front.push(path(`M${n(sx)} ${n(topY + 6.5)} Q${n(sx - 4.1)} ${n(topY + 4)} ${n(sx - 2.7)} ${n(topY - 0.5)} Q${n(sx - 1.7)} ${n(topY + 3.2)} ${n(sx)} ${n(topY + 4)} Q${n(sx + 1.7)} ${n(topY + 3.2)} ${n(sx + 2.7)} ${n(topY - 0.5)} Q${n(sx + 4.1)} ${n(topY + 4)} ${n(sx)} ${n(topY + 6.5)} Z`, paint('#c9a050')));
    front.push(circle(sx, topY + 2.2, 6, 'url(#glow)'));
    front.push(circle(sx, topY + 2.2, 2.6, 'url(#orb)'));
    gripOver(rx, ry);
  } else if (weapon === 'bow') {
    // Bow held out in the left hand, string toward the body.
    const bx = lx - 3.2; // the grip (bx + 3.5) sits in the hand
    const half = 17;
    const tY = ly - half;
    const bY = ly + half;
    front.push(`<path d="M${n(bx - 1.5)} ${n(tY)} Q${n(bx + 9)} ${n(ly)} ${n(bx - 1.5)} ${n(bY)}" fill="none" stroke="${dark(wood, 0.05)}" stroke-width="2" stroke-linecap="round"/>`);
    front.push(limb([[bx - 1.5, tY], [bx - 1.5, bY]], 0.6, '#efe6d2'));
    front.push(limb([[bx + 3.5, ly - 2], [bx + 3.7, ly + 2]], 2.4, dark(P.accent, 0.2)));
    gripOver(lx, ly);
  }

  // ---- assemble: base art, soft light from the top-left, paper texture, crisp face ----
  const defs = `
    <radialGradient id="orb" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#a8e0f5"/><stop offset="1" stop-color="#4a8cc8"/></radialGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#a8e0f5" stop-opacity="0.7"/><stop offset="1" stop-color="#a8e0f5" stop-opacity="0"/></radialGradient>
    <filter id="dk" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="0.62"/><feFuncG type="linear" slope="0.6"/><feFuncB type="linear" slope="0.72"/></feComponentTransfer></filter>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.5"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.65"/></linearGradient>
    <mask id="mk" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="80"><rect width="64" height="80" fill="url(#lg)"/></mask>
    <filter id="tx" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.55 -0.1"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="edge" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="0.45"/><feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0.45 0"/></filter>`;
  const body = `<g id="fig">${back.slice(1).join('')}${parts.join('')}${hair.join('')}${front.join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 80" width="64" height="80">
<!-- ${id} (${weapon}): generated by tools/generate-art.mjs -->
<defs>${defs}</defs>
${back[0]}
<use href="#fig" xlink:href="#fig" filter="url(#edge)"/>
${body}
<use href="#fig" xlink:href="#fig" mask="url(#mk)" filter="url(#dk)" opacity="0.7"/>
<use href="#fig" xlink:href="#fig" filter="url(#tx)" opacity="0.3"/>
<g>${face.join('')}</g>
</svg>
`;
}

mkdirSync(root, { recursive: true });
let count = 0;
for (const [id, model] of Object.entries(MODELS)) {
  for (const weapon of WEAPONS) {
    writeFileSync(join(root, `${id}_${weapon}.svg`), figure(id, model, weapon));
    count++;
  }
}
console.log(`Wrote ${count} unit sprites to ${root}`);
