// Unit and monster art as SVG strings. Shared by tools/generate-art.mjs (static sprites)
// and the game itself (adventurers with a custom look are drawn at runtime).
//
// Style: "storybook" - no outlines, simple dot eyes, a muted watercolour palette,
// soft light from the top-left and a light paper texture. Figures are 5 heads tall,
// on a 64x80 canvas with the feet at y = 76. Monsters use a 96x80 canvas.

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
export const MODELS = {
  m1: { female: false, skin: '#f0c8a2', hair: '#6a3f24', hairStyle: 'short', eyes: '#3d6fb8', outfit: 'armor', cloth: '#3f6fb5', accent: '#d9b44a', legs: '#4a4036', boots: '#6b4a2e' },
  m2: { female: false, skin: '#d9a77a', hair: '#1f1b1d', hairStyle: 'spiky', eyes: '#4a3020', outfit: 'tunic', cloth: '#3f8a5a', accent: '#8a5a34', legs: '#3b3b44', boots: '#5a3d28' },
  m3: { female: false, skin: '#8d5a3b', hair: '#2a1d17', hairStyle: 'bald', beard: true, eyes: '#3a2418', outfit: 'armor', cloth: '#8a4b32', accent: '#c9a050', legs: '#3f3630', boots: '#4e3424' },
  m4: { female: false, skin: '#f3d2b5', hair: '#d8b45a', hairStyle: 'swept', stubble: true, eyes: '#4f8a6a', outfit: 'tunic', cloth: '#6b6f7a', accent: '#7a4a32', legs: '#2f3540', boots: '#5a3d28' },
  f1: { female: true, skin: '#f4cfae', hair: '#7a4a2a', hairStyle: 'long', eyes: '#2f7a6a', outfit: 'robe', cloth: '#2f8f8a', accent: '#e0c070', legs: '#4a4036', boots: '#6b4a2e' },
  f2: { female: true, skin: '#f6d6bf', hair: '#b8442b', hairStyle: 'ponytail', eyes: '#4a7a3a', outfit: 'tunic', cloth: '#7a4fa3', accent: '#c9a050', legs: '#3b3346', boots: '#5a3d28' },
  f3: { female: true, skin: '#7a4a2f', hair: '#1c1416', hairStyle: 'bun', eyes: '#3a2418', outfit: 'armor', cloth: '#c9772f', accent: '#e0c070', legs: '#3f3630', boots: '#4e3424' },
  f4: { female: true, skin: '#e0b088', hair: '#e8cf7a', hairStyle: 'bob', eyes: '#3d6fb8', outfit: 'robe', cloth: '#a8324a', accent: '#e0c070', legs: '#2f3540', boots: '#6b4a2e' },
};
// Bandits: hoods, masks, an eye patch, a headscarf; ragged leather, round wooden shields, hex orbs.
export const BANDITS = {
  b1: { bandit: true, female: false, skin: '#e8b890', hair: '#3a2a20', hairStyle: 'hood', hood: '#4e3e32', mask: '#8a2f2a', eyes: '#3a2418', outfit: 'leather', cloth: '#a08a62', leather: '#6a4428', accent: '#8a6a3a', legs: '#3e3a34', boots: '#3e2a1c' },
  b2: { bandit: true, female: false, skin: '#c58a62', hair: '#2a1d17', hairStyle: 'bald', beard: true, eyepatch: true, scar: true, eyes: '#3a2418', outfit: 'leather', bareArms: true, cloth: '#7a3a2e', leather: '#4a3424', accent: '#8a6a3a', legs: '#3a3632', boots: '#3e2a1c' },
  b3: { bandit: true, female: true, skin: '#f0c8a2', hair: '#2b2220', hairStyle: 'ponytail', headscarf: '#9a3a2e', scar: true, eyes: '#4a3020', outfit: 'leather', cloth: '#8a7a5a', leather: '#4a5a36', accent: '#8a6a3a', legs: '#3b3632', boots: '#3e2a1c' },
  b4: { bandit: true, female: true, skin: '#8a5a3c', hair: '#1c1416', hairStyle: 'hood', hood: '#4a5248', mask: '#3a3a3e', eyes: '#3a2418', outfit: 'leather', cloth: '#6a5a6e', leather: '#34303a', accent: '#8a6a3a', legs: '#33302e', boots: '#3e2a1c' },
};
// Other humanoid foes: goblins (small, green, pointy ears), orcs (tusks), skeletons (bone and empty sockets).
export const HUMANOIDS = {
  g1: { bandit: true, female: false, skin: '#8fae5a', hair: '#2a2a1e', hairStyle: 'bald', pointyEars: true, eyes: '#c8a020', outfit: 'leather', bareArms: true, cloth: '#7a6a4a', leather: '#5a4a30', accent: '#8a6a3a', legs: '#4a4232', boots: '#3e2a1c' },
  g2: { bandit: true, female: false, skin: '#9ab866', hair: '#2a2a1e', hairStyle: 'hood', hood: '#5a5040', pointyEars: true, eyes: '#c8a020', outfit: 'leather', cloth: '#6a5a3a', leather: '#4a3a28', accent: '#8a6a3a', legs: '#3e3a2e', boots: '#3e2a1c' },
  o1: { bandit: true, female: false, skin: '#6f8f5f', hair: '#1c1c1a', hairStyle: 'spiky', tusks: true, eyes: '#a02a1a', outfit: 'leather', bareArms: true, cloth: '#6a3a2a', leather: '#3e3428', accent: '#8a6a3a', legs: '#3a3228', boots: '#2e2218' },
  o2: { bandit: true, female: false, skin: '#7a8a5a', hair: '#1c1c1a', hairStyle: 'bald', tusks: true, scar: true, eyes: '#a02a1a', outfit: 'armor', cloth: '#5a3a2a', accent: '#6a6a6e', legs: '#3a3228', boots: '#2e2218' },
  s1: { bandit: true, female: false, skin: '#e6dcc4', hair: '#e6dcc4', hairStyle: 'bald', skull: true, eyes: '#ff5a3a', outfit: 'leather', bareArms: true, cloth: '#4a4a4e', leather: '#3a3430', accent: '#6a6a6e', legs: '#e6dcc4', boots: '#4a4038' },
  s2: { bandit: true, female: false, skin: '#ddd2b8', hair: '#ddd2b8', hairStyle: 'hood', hood: '#34343a', skull: true, eyes: '#7ad0ff', outfit: 'armor', cloth: '#3a3a40', accent: '#7a7a80', legs: '#ddd2b8', boots: '#3a3430' },
};
export const ART_WEAPONS = ['sword_shield', 'spear', 'bow', 'staff'];
const METAL = '#b9c3cf';
const WOOD = '#8a5a34';

// ---- one figure -------------------------------------------------------------------------------
/**
 * One unit figure as an SVG string. `model` describes the body (see MODELS / lookModel);
 * `scale` sets the SVG's pixel size (the viewBox stays 64x80) so it rasterizes sharply.
 */
export function figureSvg(id, model, weapon, scale = 1) {
  const P = {};
  for (const k of ['skin', 'hair', 'eyes', 'cloth', 'accent', 'legs', 'boots', 'hood', 'mask', 'leather', 'headscarf']) if (model[k]) P[k] = paint(model[k]);
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
  if (model.hairStyle === 'hood') {
    back.push(path(`M${at(-1.35, 0.95)} Q${at(-1.5, -0.38)} ${at(0, -0.33)} Q${at(1.5, -0.38)} ${at(1.35, 0.95)} L${at(1.55, 1.45)} Q${at(0, 1.6)} ${at(-1.55, 1.45)} Z`, dark(P.hood, 0.2)));
  }
  if (model.hairStyle === 'bun') back.push(circle(32, top + H * 0.02, H * 0.26, dark(P.hair, 0.08)));
  if (model.hairStyle === 'bangs') {
    // Worn down: long straight hair behind the shoulders.
    const len = hipY - 1;
    back.push(path(`M${at(-1.1, 0.46)} Q${at(-1.28, -0.1)} ${at(0, -0.1)} Q${at(1.28, -0.1)} ${at(1.1, 0.46)}
      L${n(32 + hw + 1.2 + sW * 0.15)} ${n(len)} Q32 ${n(len + 1.5)} ${n(32 - hw - 1.2 - sW * 0.15)} ${n(len)} Z`, dark(P.hair, 0.15)));
  }
  if (model.hairStyle === 'tied') {
    // A short tail tied at the nape, peeking out behind the neck.
    back.push(path(`M${at(0.35, 0.75)} Q${at(1.25, 0.95)} ${at(1.05, 1.75)} Q${at(0.85, 1.95)} ${at(0.7, 1.7)} Q${at(0.85, 1.2)} ${at(0.2, 0.95)} Z`, dark(P.hair, 0.12)));
  }
  if (model.hairStyle === 'permed') {
    for (const [u, v] of [[-1.12, 0.62], [1.12, 0.62]]) back.push(circle(32 + u * hw, top + v * H, H * 0.15, dark(P.hair, 0.12)));
  }
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
  } else if (model.outfit === 'leather') {
    // Ragged shirt with a torn hem, leather jerkin, a strap across the chest, belt pouch.
    const skirtY = hipY + (kneeY - hipY) * 0.42;
    const teeth = 6;
    let hem = '';
    for (let i = 0; i <= teeth; i++) {
      const x = 32 + hipW + 1.6 - (i / teeth) * (2 * hipW + 3.2);
      hem += ` L${n(x)} ${n(skirtY + (i % 2 ? -1.4 : 0.4))}`;
    }
    parts.push(path(`M${n(32 - sW + 1.5)} ${n(shoulderY)} Q${n(32 - sW)} ${n(shoulderY)} ${n(32 - sW)} ${n(shoulderY + 2)} L${n(32 - wW)} ${n(waistY)}
      L${n(32 - hipW - 1.6)} ${n(skirtY)} L${n(32 + hipW + 1.6)} ${n(skirtY)} ${hem} Z
      M${n(32 + wW)} ${n(waistY)} L${n(32 + sW)} ${n(shoulderY + 2)} Q${n(32 + sW)} ${n(shoulderY)} ${n(32 + sW - 1.5)} ${n(shoulderY)} L${n(32 - sW + 1.5)} ${n(shoulderY)} L${n(32 - wW)} ${n(waistY)} Z`, P.cloth));
    parts.push(path(`M${n(32 - sW + 0.8)} ${n(shoulderY + 0.5)} L${n(32 - 2.4)} ${n(shoulderY + 0.5)} L32 ${n(shoulderY + 4.5)} L${n(32 + 2.4)} ${n(shoulderY + 0.5)} L${n(32 + sW - 0.8)} ${n(shoulderY + 0.5)}
      L${n(32 + wW + 0.6)} ${n(hipY + 1)} L${n(32 + 1.5)} ${n(hipY + 2)} L${n(32 - wW - 0.6)} ${n(hipY + 1)} Z`, P.leather));
    parts.push(limb([[32 - 1.6, shoulderY + 6], [32 + 1.6, shoulderY + 6]], 0.5, dark(P.leather, 0.35)));
    parts.push(limb([[32 - 1.6, shoulderY + 8.5], [32 + 1.6, shoulderY + 8.5]], 0.5, dark(P.leather, 0.35)));
    parts.push(limb([[32 - sW + 1.6, shoulderY + 1], [32 + wW + 0.2, waistY]], 1.4, dark(P.leather, 0.3)));
    parts.push(path(`M${n(32 - 2.2)} ${n(shoulderY + 4.6)} h2.4 v2.4 h-2.4 Z`, paint('#8a8a8a')));
    belt(dark(P.leather, 0.25));
    parts.push(path(`M${n(32 + wW - 3.4)} ${n(waistY + beltH)} h3.4 v3.2 q-1.7 1.2 -3.4 0 Z`, dark(P.leather, 0.1)));
  } else if (model.outfit === 'leatherArmor') {
    // Leather armor: a tunic under a stitched leather cuirass with a high collar and shoulder flaps.
    const skirtY = hipY + (kneeY - hipY) * 0.4;
    parts.push(torso(skirtY, 1.4));
    const lth = paint('#7a5232');
    const cut = (sk) => `M${n(32 - sW + 0.6)} ${n(shoulderY + 0.4)} L${n(32 + sW - 0.6)} ${n(shoulderY + 0.4)} L${n(32 + wW + 0.5)} ${n(waistY)} L${n(32 + hipW + 0.6)} ${n(sk)} L${n(32 - hipW - 0.6)} ${n(sk)} L${n(32 - wW - 0.5)} ${n(waistY)} Z`;
    parts.push(path(cut(hipY + 1.5), lth));
    // Stitched panels down the front and a laced chest.
    parts.push(`<path d="M${n(32 - wW * 0.55)} ${n(shoulderY + 2)} L${n(32 - wW * 0.6)} ${n(hipY + 1)} M${n(32 + wW * 0.55)} ${n(shoulderY + 2)} L${n(32 + wW * 0.6)} ${n(hipY + 1)}" stroke="${light(lth, 0.35)}" stroke-width="0.45" stroke-dasharray="0.9 0.7" fill="none"/>`);
    for (let i = 0; i < 3; i++) parts.push(limb([[32 - 1.3, shoulderY + 2.4 + i * 2], [32 + 1.3, shoulderY + 3.4 + i * 2]], 0.45, dark(lth, 0.4)));
    parts.push(path(`M${n(32 - 3)} ${n(shoulderY - 0.6)} L${n(32 + 3)} ${n(shoulderY - 0.6)} L${n(32 + 2.4)} ${n(shoulderY + 1.4)} L${n(32 - 2.4)} ${n(shoulderY + 1.4)} Z`, dark(lth, 0.15)));
    // Hanging leather strips over the hips.
    for (const u of [-0.66, -0.22, 0.22, 0.66]) parts.push(path(`M${n(32 + u * hipW * 1.5 - 1.3)} ${n(hipY + 1)} h2.6 v${n((skirtY - hipY) * 0.85)} h-2.6 Z`, dark(lth, 0.08)));
    for (const s of [-1, 1]) parts.push(path(`M${n(32 + s * (sW - 3.5))} ${n(shoulderY - 0.2)} Q${n(32 + s * (sW + 1.8))} ${n(shoulderY - 0.6)} ${n(32 + s * (sW + 1.4))} ${n(shoulderY + 3.6)} L${n(32 + s * (sW - 2.6))} ${n(shoulderY + 2.6)} Z`, dark(lth, 0.12)));
    belt(dark(lth, 0.35));
  } else if (model.outfit === 'mail') {
    // Mail: a grey hauberk to mid-thigh (ring texture) with a tabard in the unit's colour over it.
    const skirtY = hipY + (kneeY - hipY) * 0.62;
    const mail = paint('#8e959e');
    parts.push(path(`M${n(32 - sW + 1.2)} ${n(shoulderY - 0.3)} Q${n(32 - sW - 0.4)} ${n(shoulderY)} ${n(32 - sW - 0.4)} ${n(shoulderY + 2)} L${n(32 - wW - 0.4)} ${n(waistY)} L${n(32 - hipW - 2.2)} ${n(skirtY)} L${n(32 + hipW + 2.2)} ${n(skirtY)} L${n(32 + wW + 0.4)} ${n(waistY)} L${n(32 + sW + 0.4)} ${n(shoulderY + 2)} Q${n(32 + sW + 0.4)} ${n(shoulderY)} ${n(32 + sW - 1.2)} ${n(shoulderY - 0.3)} Z`, mail));
    for (let y = shoulderY + 1.2, row = 0; y < skirtY - 0.4; y += 1.3, row++) {
      const t = (y - shoulderY) / (skirtY - shoulderY);
      const half = y < waistY ? sW - (sW - wW) * ((y - shoulderY) / (waistY - shoulderY)) : wW + (hipW + 2.2 - wW) * ((y - waistY) / (skirtY - waistY));
      parts.push(`<path d="M${n(32 - half + 0.3 + (row % 2) * 0.6)} ${n(y)} L${n(32 + half - 0.3)} ${n(y)}" stroke="${dark(mail, 0.3 + t * 0.05)}" stroke-width="0.5" stroke-dasharray="0.7 0.5" fill="none"/>`);
    }
    // Tabard.
    const tw = wW * 0.62;
    parts.push(path(`M${n(32 - tw - 0.6)} ${n(shoulderY + 0.2)} L${n(32 + tw + 0.6)} ${n(shoulderY + 0.2)} L${n(32 + tw)} ${n(skirtY + 1.5)} L${n(32 - tw)} ${n(skirtY + 1.5)} Z`, P.cloth));
    parts.push(path(`M${n(32 - 2.2)} ${n(shoulderY + 0.2)} L32 ${n(shoulderY + 2.4)} L${n(32 + 2.2)} ${n(shoulderY + 0.2)} Z`, mail));
    parts.push(`<path d="M${n(32 - tw)} ${n(skirtY + 0.4)} L${n(32 + tw)} ${n(skirtY + 0.4)}" stroke="${P.accent}" stroke-width="0.9"/>`);
    // Mail coif collar.
    parts.push(path(`M${n(32 - hw * 0.75)} ${n(chin - 1.2)} Q32 ${n(chin + 0.6)} ${n(32 + hw * 0.75)} ${n(chin - 1.2)} L${n(32 + sW * 0.7)} ${n(shoulderY + 1.4)} Q32 ${n(shoulderY + 3)} ${n(32 - sW * 0.7)} ${n(shoulderY + 1.4)} Z`, dark(mail, 0.05)));
    belt(dark(P.legs, 0.2));
  } else if (model.outfit === 'plate') {
    // Plate: breastplate, big pauldrons, a fauld and tassets over a cloth skirt, gauntlets and greaves.
    const skirtY = hipY + (kneeY - hipY) * 0.5;
    parts.push(torso(skirtY, 2));
    const bp = sW * 0.9;
    parts.push(path(`M${n(32 - bp)} ${n(shoulderY + 0.6)} Q32 ${n(shoulderY + 2.6)} ${n(32 + bp)} ${n(shoulderY + 0.6)} L${n(32 + wW * 1.02)} ${n(waistY)} Q32 ${n(waistY + 2.4)} ${n(32 - wW * 1.02)} ${n(waistY)} Z`, metal));
    parts.push(limb([[32, shoulderY + 2.4], [32, waistY + 1]], 0.6, dark(metal, 0.25)));
    parts.push(`<path d="M${n(32 - bp * 0.6)} ${n(shoulderY + 3)} Q${n(32 - bp * 0.2)} ${n(shoulderY + 6)} ${n(32 - bp * 0.3)} ${n(waistY - 2)}" stroke="${light(metal, 0.6)}" stroke-width="0.8" fill="none" stroke-linecap="round"/>`);
    // Gorget.
    parts.push(path(`M${n(32 - hw * 0.7)} ${n(shoulderY - 1.6)} L${n(32 + hw * 0.7)} ${n(shoulderY - 1.6)} L${n(32 + hw * 0.85)} ${n(shoulderY + 1)} Q32 ${n(shoulderY + 2.2)} ${n(32 - hw * 0.85)} ${n(shoulderY + 1)} Z`, dark(metal, 0.12)));
    // Fauld (two lames) and tassets.
    for (let i = 0; i < 2; i++) {
      const y = waistY + 1.2 + i * 2.2;
      const w = wW + 0.8 + i * 1.2;
      parts.push(path(`M${n(32 - w)} ${n(y)} Q32 ${n(y + 1.4)} ${n(32 + w)} ${n(y)} L${n(32 + w + 0.4)} ${n(y + 2.2)} Q32 ${n(y + 3.6)} ${n(32 - w - 0.4)} ${n(y + 2.2)} Z`, i ? dark(metal, 0.08) : metal));
    }
    for (const s of [-1, 1]) {
      const x = 32 + s * hipW * 0.72;
      parts.push(path(`M${n(x - 2.6)} ${n(hipY + 0.6)} L${n(x + 2.6)} ${n(hipY + 0.6)} L${n(x + 2.8 + s * 0.4)} ${n(skirtY + 0.6)} Q${n(x)} ${n(skirtY + 1.8)} ${n(x - 2.8 + s * 0.4)} ${n(skirtY + 0.6)} Z`, dark(metal, 0.05)));
      // Pauldrons: three overlapping lames.
      for (let i = 2; i >= 0; i--) {
        const y = shoulderY - 1.4 + i * 1.7;
        parts.push(path(`M${n(32 + s * (sW - 4.2))} ${n(y + 0.4)} Q${n(32 + s * (sW + 3))} ${n(y - 1.4)} ${n(32 + s * (sW + 2.6))} ${n(y + 4)} Q${n(32 + s * (sW - 0.6))} ${n(y + 3)} ${n(32 + s * (sW - 4.2))} ${n(y + 0.4)} Z`, i ? dark(metal, 0.06 * i) : light(metal, 0.08)));
      }
      // Greaves and knee cops over the legs.
      const lx = 32 + s * legX * 1.03;
      parts.push(path(`M${n(lx - legW * 0.62)} ${n(kneeY + 1)} L${n(lx + legW * 0.62)} ${n(kneeY + 1)} L${n(lx + legW * 0.56)} ${n(bootTop + 2.2)} L${n(lx - legW * 0.56)} ${n(bootTop + 2.2)} Z`, metal));
      parts.push(circle(lx, kneeY + 0.4, legW * 0.6, light(metal, 0.1)));
      parts.push(limb([[lx - legW * 0.2, kneeY + 2.6], [lx - legW * 0.25, bootTop + 1.4]], 0.5, light(metal, 0.5)));
    }
    belt(dark(P.legs, 0.2));
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
    parts.push(limb([sh, elbow, hand], armW, model.bareArms ? P.skin : P.cloth));
    if (model.bareArms) parts.push(limb([sh, [sh[0] + (elbow[0] - sh[0]) * 0.35, sh[1] + (elbow[1] - sh[1]) * 0.35]], armW + 0.4, P.cloth));
    const ex = elbow[0] + (hand[0] - elbow[0]) * 0.55;
    const ey = elbow[1] + (hand[1] - elbow[1]) * 0.55;
    if (model.outfit === 'robe') {
      parts.push(path(`M${n(ex - armW * 0.8)} ${n(ey - 1)} L${n(ex + armW * 0.8)} ${n(ey - 1)} L${n(ex + armW)} ${n(ey + 1.2)} L${n(ex - armW)} ${n(ey + 1.2)} Z`, P.accent));
    } else {
      if (model.outfit === 'mail') parts.push(limb([sh, elbow, [elbow[0] + (hand[0] - elbow[0]) * 0.3, elbow[1] + (hand[1] - elbow[1]) * 0.3]], armW + 0.3, paint('#8e959e')));
      if (model.outfit === 'plate') {
        parts.push(limb([sh, elbow], armW + 0.4, dark(metal, 0.05)));
        parts.push(circle(elbow[0], elbow[1], armW * 0.62, light(metal, 0.08)));
      }
      const glove = model.outfit === 'armor' || model.outfit === 'plate' ? metal : model.outfit === 'leather' ? dark(P.leather, 0.1)
        : model.outfit === 'leatherArmor' || model.outfit === 'mail' ? paint('#6a4428') : dark(P.accent, 0.1);
      parts.push(limb([[ex, ey], [hand[0] - (hand[0] - elbow[0]) * 0.08, hand[1] - (hand[1] - elbow[1]) * 0.08]], armW + 0.5, glove));
    }
    parts.push(circle(hand[0], hand[1], handR, P.skin));
  }

  // ---- neck & head ----
  const neckW = hw * 0.36;
  parts.push(path(`M${n(32 - neckW)} ${n(chin - 2.5)} L${n(32 - neckW)} ${n(shoulderY + 0.8)} Q32 ${n(shoulderY + 1.8)} ${n(32 + neckW)} ${n(shoulderY + 0.8)} L${n(32 + neckW)} ${n(chin - 2.5)} Z`, dark(P.skin, 0.12)));
  if (model.pointyEars) {
    // Long ears sticking out sideways (drawn behind the head).
    for (const s of [-1, 1]) {
      parts.push(path(`M${n(32 + s * hw * 0.9)} ${n(top + H * 0.45)} L${n(32 + s * (hw + H * 0.42))} ${n(top + H * 0.32)} L${n(32 + s * hw * 0.9)} ${n(top + H * 0.72)} Z`, P.skin));
      parts.push(path(`M${n(32 + s * hw * 0.95)} ${n(top + H * 0.5)} L${n(32 + s * (hw + H * 0.28))} ${n(top + H * 0.4)} L${n(32 + s * hw * 0.95)} ${n(top + H * 0.64)} Z`, dark(P.skin, 0.15)));
    }
  } else if (!female && !['long', 'hood', 'bowl', 'permed'].includes(model.hairStyle)) {
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
  if (model.face) drawFace(model.face);
  if (model.skull) {
    // Empty sockets with a faint glow, a nose hole and a row of teeth.
    for (const s of [-1, 1]) {
      const x = 32 + s * hw * 0.42;
      face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY)}" rx="${n(H * 0.11)}" ry="${n(H * 0.1)}" fill="#1a1416"/>`);
      face.push(circle(x, eyeY + H * 0.01, H * 0.028, P.eyes));
    }
    face.push(path(`M32 ${n(eyeY + H * 0.08)} L${n(32 - H * 0.04)} ${n(eyeY + H * 0.17)} L${n(32 + H * 0.04)} ${n(eyeY + H * 0.17)} Z`, '#1a1416'));
    const ty = top + H * 0.82;
    face.push(`<path d="M${n(32 - H * 0.13)} ${n(ty)} L${n(32 + H * 0.13)} ${n(ty)}" stroke="#1a1416" stroke-width="${n(H * 0.02)}"/>`);
    for (const dx of [-0.08, -0.03, 0.02, 0.07]) face.push(`<path d="M${n(32 + H * dx)} ${n(ty - H * 0.04)} L${n(32 + H * dx)} ${n(ty + H * 0.04)}" stroke="#1a1416" stroke-width="${n(H * 0.012)}"/>`);
  }
  if (model.tusks) {
    for (const s of [-1, 1]) face.push(path(`M${n(32 + s * H * 0.12)} ${n(top + H * 0.86)} L${n(32 + s * H * 0.16)} ${n(top + H * 0.68)} L${n(32 + s * H * 0.2)} ${n(top + H * 0.86)} Z`, '#f4ecd8'));
  }
  for (const s of model.face || model.skull ? [] : [-1, 1]) {
    const x = 32 + s * hw * 0.42;
    if (model.eyepatch && s === 1) {
      face.push(`<path d="M${at(-1.0, 0.3)} L${at(1.02, 0.72)}" stroke="#1e1a1c" stroke-width="${n(H * 0.035)}"/>`);
      face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY + 0.2)}" rx="${n(H * 0.1)}" ry="${n(H * 0.085)}" fill="#1e1a1c"/>`);
      face.push(`<path d="M${n(x - H * 0.09)} ${n(eyeY - H * 0.16)} L${n(x + H * 0.08)} ${n(eyeY - H * 0.12)}" stroke="${dark(P.hair, 0.25)}" stroke-width="${n(H * 0.035)}" stroke-linecap="round"/>`);
      continue;
    }
    face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY)}" rx="${n(H * 0.05)}" ry="${n(H * 0.066)}" fill="${dark(P.eyes, 0.6)}"/>`);
    face.push(circle(x - H * 0.017, eyeY - H * 0.022, H * 0.017, '#ffffff'));
    const browY = eyeY - H * (female ? 0.15 : 0.13);
    face.push(`<path d="M${n(x - H * 0.075)} ${n(browY + (female ? 0.2 : 0.1))} Q${n(x)} ${n(browY - H * 0.03)} ${n(x + H * 0.075)} ${n(browY + (female ? 0.2 : 0.1))}" stroke="${dark(P.hair, 0.25)}" stroke-width="${n(H * (female ? 0.022 : 0.032))}" fill="none" stroke-linecap="round"/>`);
    if (female) face.push(`<path d="M${n(x + s * H * 0.04)} ${n(eyeY - H * 0.05)} l${n(s * H * 0.04)} ${n(-H * 0.025)}" stroke="${dark(P.eyes, 0.6)}" stroke-width="${n(H * 0.018)}" stroke-linecap="round"/>`);
    if (!model.mask && !model.bandit) face.push(`<ellipse cx="${n(x + s * H * 0.04)}" cy="${n(eyeY + H * 0.14)}" rx="${n(H * 0.07)}" ry="${n(H * 0.035)}" fill="#ff8fa3" opacity="${female ? 0.35 : 0.2}"/>`);
  }
  function drawFace(F) {
    const ink = dark(P.eyes, 0.6);
    const browInk = dark(P.hair, 0.25);
    for (const s of [-1, 1]) {
      const x = 32 + s * hw * 0.42;
      // Eyes
      if (F.eyes === 'round') {
        face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY)}" rx="${n(H * 0.062)}" ry="${n(H * 0.08)}" fill="${ink}"/>`);
        face.push(circle(x - H * 0.022, eyeY - H * 0.028, H * 0.024, '#ffffff'));
      } else if (F.eyes === 'narrow') {
        face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY + H * 0.01)}" rx="${n(H * 0.06)}" ry="${n(H * 0.036)}" fill="${ink}"/>`);
      } else if (F.eyes === 'sleepy') {
        face.push(`<path d="M${n(x - H * 0.058)} ${n(eyeY - H * 0.005)} A${n(H * 0.058)} ${n(H * 0.05)} 0 0 0 ${n(x + H * 0.058)} ${n(eyeY - H * 0.005)} Z" fill="${ink}"/>`);
        face.push(`<path d="M${n(x - H * 0.075)} ${n(eyeY - H * 0.012)} L${n(x + H * 0.075)} ${n(eyeY - H * 0.012)}" stroke="${ink}" stroke-width="${n(H * 0.022)}" stroke-linecap="round"/>`);
      } else {
        face.push(`<ellipse cx="${n(x)}" cy="${n(eyeY)}" rx="${n(H * 0.05)}" ry="${n(H * 0.066)}" fill="${ink}"/>`);
        face.push(circle(x - H * 0.017, eyeY - H * 0.022, H * 0.017, '#ffffff'));
      }
      if (F.lashes) face.push(`<path d="M${n(x + s * H * 0.045)} ${n(eyeY - H * 0.05)} l${n(s * H * 0.045)} ${n(-H * 0.03)}" stroke="${ink}" stroke-width="${n(H * 0.02)}" stroke-linecap="round"/>`);
      // Brows: s = -1 is the viewer's left eye; "inner" is the end nearest the nose.
      const by = eyeY - H * 0.14;
      const outer = x + s * H * 0.08;
      const inner = x - s * H * 0.075;
      const w = H * (F.brows === 'heavy' ? 0.045 : F.brows === 'soft' ? 0.024 : 0.03);
      const browPath = F.brows === 'heavy' ? `M${n(outer)} ${n(by + H * 0.01)} L${n(inner)} ${n(by + H * 0.02)}`
        : F.brows === 'angled' ? `M${n(outer)} ${n(by - H * 0.025)} L${n(inner)} ${n(by + H * 0.04)}`
          : F.brows === 'arched' ? `M${n(outer)} ${n(by + H * 0.01)} Q${n(x)} ${n(by - H * 0.07)} ${n(inner)} ${n(by + H * 0.01)}`
            : `M${n(outer)} ${n(by + H * 0.01)} Q${n(x)} ${n(by - H * 0.035)} ${n(inner)} ${n(by + H * 0.01)}`;
      face.push(`<path d="${browPath}" stroke="${browInk}" stroke-width="${n(w)}" fill="none" stroke-linecap="round"/>`);
      if (F.blush) face.push(`<ellipse cx="${n(x + s * H * 0.04)}" cy="${n(eyeY + H * 0.14)}" rx="${n(H * 0.07)}" ry="${n(H * 0.035)}" fill="#ff8fa3" opacity="${F.blush}"/>`);
      if (F.freckles) {
        for (const [fx, fy] of [[0, 0.12], [0.06, 0.15], [-0.05, 0.16]]) face.push(circle(x + s * H * fx, eyeY + H * fy, H * 0.011, dark(P.skin, 0.32), 'opacity="0.8"'));
      }
    }
    if (F.mole) face.push(circle(32 + hw * 0.62, eyeY + H * 0.17, H * 0.014, dark(P.skin, 0.55)));
    face.push(circle(32, eyeY + H * 0.12, H * 0.013, dark(P.skin, 0.35)));
    if (model.beard) return;
    const lip = female ? '#b85a64' : dark(P.skin, 0.45);
    const my = top + H * 0.8;
    if (F.mouth === 'grin') {
      const mw = H * 0.08;
      face.push(`<path d="M${n(32 - mw)} ${n(my - H * 0.01)} Q32 ${n(my + H * 0.09)} ${n(32 + mw)} ${n(my - H * 0.01)} Z" fill="${dark(lip, 0.25)}"/>`);
      face.push(`<path d="M${n(32 - mw * 0.75)} ${n(my)} L${n(32 + mw * 0.75)} ${n(my)}" stroke="#ffffff" stroke-width="${n(H * 0.02)}" opacity="0.9"/>`);
    } else if (F.mouth === 'flat') {
      face.push(`<path d="M${n(32 - H * 0.055)} ${n(my + H * 0.01)} L${n(32 + H * 0.055)} ${n(my + H * 0.01)}" stroke="${lip}" stroke-width="${n(H * 0.03)}" stroke-linecap="round"/>`);
    } else {
      const mw = F.mouth === 'small' ? H * 0.04 : H * 0.065;
      face.push(`<path d="M${n(32 - mw)} ${n(my)} Q32 ${n(my + H * 0.04)} ${n(32 + mw)} ${n(my)}" stroke="${lip}" stroke-width="${n(H * 0.03)}" fill="none" stroke-linecap="round"/>`);
    }
  }
  if (model.scar) face.push(`<path d="M${at(-0.62, 0.42)} L${at(-0.3, 0.8)} M${at(-0.56, 0.58)} L${at(-0.4, 0.55)} M${at(-0.47, 0.7)} L${at(-0.32, 0.66)}" stroke="${dark(P.skin, 0.3)}" stroke-width="${n(H * 0.022)}" stroke-linecap="round" opacity="0.8"/>`);
  if (!model.mask && !model.face && !model.skull) face.push(circle(32, eyeY + H * 0.12, H * 0.013, dark(P.skin, 0.35)));
  if (!model.beard && !model.mask && !model.face && !model.skull && !model.tusks) {
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
    case 'crew':
      hair.push(fringe([[1.0, 0.36], [0.72, 0.2], [0.3, 0.17], [0, 0.17], [-0.3, 0.17], [-0.72, 0.2], [-1.0, 0.36], [-1.06, 0.62]]));
      break;
    case 'bowl':
      hair.push(path(`M${at(-1.13, 0.68)} Q${at(-1.3, -0.14)} ${at(0, -0.15)} Q${at(1.3, -0.14)} ${at(1.13, 0.68)} L${at(0.9, 0.68)} L${at(0.88, 0.4)} L${at(-0.88, 0.4)} L${at(-0.9, 0.68)} Z`, P.hair));
      hair.push(`<path d="M${at(-0.82, 0.38)} L${at(0.82, 0.38)}" stroke="${dark(P.hair, 0.2)}" stroke-width="${n(H * 0.025)}"/>`);
      break;
    case 'permed': {
      hair.push(fringe([[0.95, 0.42], [0.7, 0.3], [0.3, 0.26], [0, 0.26], [-0.3, 0.26], [-0.7, 0.3], [-0.95, 0.42], [-1.06, 0.62]]));
      const cy = top + H * 0.45;
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (1.0 + (i / 8) * 1.0);
        hair.push(circle(32 + Math.cos(a) * hw * 1.02, cy + Math.sin(a) * H * 0.5, H * 0.15, i % 2 ? P.hair : light(P.hair, 0.06)));
      }
      for (const u of [-0.55, -0.18, 0.18, 0.55]) hair.push(circle(32 + u * hw, top + H * 0.27, H * 0.12, P.hair));
      break;
    }
    case 'tied':
      hair.push(fringe([[0.98, 0.45], [0.8, 0.22], [0.35, 0.16], [0, 0.16], [-0.35, 0.16], [-0.8, 0.22], [-0.98, 0.45], [-1.06, 0.62]]));
      hair.push(`<path d="M${at(-0.6, 0.2)} Q${at(0, 0.08)} ${at(0.7, 0.24)} M${at(-0.3, 0.3)} Q${at(0.2, 0.14)} ${at(0.85, 0.36)}" stroke="${dark(P.hair, 0.2)}" stroke-width="${n(H * 0.02)}" fill="none" opacity="0.8"/>`);
      break;
    case 'bangs':
      hair.push(fringe([[0.95, 0.45], [0.8, 0.45], [0.5, 0.45], [0.2, 0.45], [0, 0.45], [-0.25, 0.45], [-0.5, 0.45], [-0.8, 0.45], [-0.98, 0.5], [-1.06, 0.62]]));
      hair.push(path(`M${at(-1.08, 0.5)} Q${at(-1.22, 1.3)} ${at(-1.05, 1.75)} L${at(-0.86, 1.7)} Q${at(-0.86, 1.0)} ${at(-0.86, 0.5)} Z M${at(1.08, 0.5)} Q${at(1.22, 1.3)} ${at(1.05, 1.75)} L${at(0.86, 1.7)} Q${at(0.86, 1.0)} ${at(0.86, 0.5)} Z`, P.hair));
      break;
    case 'crown': {
      hair.push(fringe([[0.98, 0.45], [0.8, 0.26], [0.35, 0.22], [0, 0.22], [-0.35, 0.22], [-0.8, 0.26], [-0.98, 0.45], [-1.06, 0.62]]));
      // A braid wound over the top of the head like a crown.
      const cy = top + H * 0.5;
      for (let i = 0; i <= 9; i++) {
        const a = Math.PI * (1.02 + (i / 9) * 0.96);
        const x = 32 + Math.cos(a) * hw * 1.0;
        const y = cy + Math.sin(a) * H * 0.48;
        const deg = (a * 180) / Math.PI + 90 + (i % 2 ? 25 : -25);
        hair.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(H * 0.13)}" ry="${n(H * 0.085)}" fill="${i % 2 ? light(P.hair, 0.12) : P.hair}" transform="rotate(${n(deg)} ${n(x)} ${n(y)})"/>`);
      }
      break;
    }
    case 'braid': {
      hair.push(fringe([[0.95, 0.5], [0.75, 0.28], [0.4, 0.38], [0.15, 0.3], [-0.2, 0.32], [-0.55, 0.36], [-0.8, 0.4], [-0.98, 0.5], [-1.0, 0.56], [-1.06, 0.62]]));
      // A single braid over the shoulder.
      const x0 = 32 + hw * 0.92;
      const y0 = top + H * 0.85;
      const len = shoulderY + 9 - y0;
      for (let i = 0; i < 6; i++) {
        const y = y0 + (i / 5) * len;
        const x = x0 + Math.sin(i * 0.5) * 0.4 + (i / 5) * 0.8;
        hair.push(`<ellipse cx="${n(x + (i % 2 ? 0.5 : -0.5))}" cy="${n(y)}" rx="${n(H * 0.1)}" ry="${n(H * 0.08)}" fill="${i % 2 ? light(P.hair, 0.1) : P.hair}"/>`);
      }
      hair.push(circle(x0 + 0.8, y0 + len + H * 0.08, H * 0.05, P.accent));
      hair.push(path(`M${n(x0 + 0.8 - H * 0.07)} ${n(y0 + len + H * 0.1)} L${n(x0 + 0.8 + H * 0.07)} ${n(y0 + len + H * 0.1)} L${n(x0 + 0.8)} ${n(y0 + len + H * 0.3)} Z`, P.hair));
      break;
    }
    case 'bob':
      hair.push(fringe([[0.95, 0.5], [0.8, 0.42], [0.5, 0.42], [0.2, 0.42], [0, 0.42], [-0.25, 0.42], [-0.5, 0.42], [-0.8, 0.42], [-0.98, 0.5], [-1.06, 0.62]]));
      hair.push(path(`M${at(-1.08, 0.5)} Q${at(-1.2, 0.9)} ${at(-1.12, 1.1)} L${at(-0.86, 1.08)} Q${at(-0.86, 0.8)} ${at(-0.86, 0.5)} Z M${at(1.08, 0.5)} Q${at(1.2, 0.9)} ${at(1.12, 1.1)} L${at(0.86, 1.08)} Q${at(0.86, 0.8)} ${at(0.86, 0.5)} Z`, P.hair));
      break;
  }
  if (model.hairStyle === 'hood') {
    hair.push(fringe([[0.7, 0.3], [0.4, 0.34], [0, 0.3], [-0.4, 0.34], [-0.7, 0.3], [-1.06, 0.62]]));
    hair.push(path(`M${at(-1.32, 1.2)} Q${at(-1.5, -0.36)} ${at(0, -0.32)} Q${at(1.5, -0.36)} ${at(1.32, 1.2)} L${at(1.0, 1.12)} Q${at(1.08, 0.12)} ${at(0, 0.14)} Q${at(-1.08, 0.12)} ${at(-1.0, 1.12)} Z`, P.hood));
  }
  if (model.headscarf) {
    hair.push(path(`M${at(-1.1, 0.5)} Q${at(-1.22, -0.14)} ${at(0, -0.14)} Q${at(1.22, -0.14)} ${at(1.1, 0.5)} Q${at(0.6, 0.26)} ${at(0, 0.3)} Q${at(-0.6, 0.26)} ${at(-1.1, 0.5)} Z`, P.headscarf));
    hair.push(path(`M${at(1.0, 0.25)} L${at(1.55, 0.45)} L${at(1.35, 0.7)} Z M${at(1.0, 0.3)} L${at(1.45, 0.85)} L${at(1.2, 0.95)} Z`, dark(P.headscarf, 0.1)));
    hair.push(circle(32 + hw * 1.0, top + H * 0.3, H * 0.08, dark(P.headscarf, 0.15)));
  }
  if (model.mask) {
    hair.push(path(`M${at(-1.02, 0.66)} Q${at(0, 0.74)} ${at(1.02, 0.66)} L${at(0.82, 0.98)} Q${at(0, 1.2)} ${at(-0.82, 0.98)} Z`, P.mask));
    hair.push(`<path d="M${at(-0.5, 0.86)} Q${at(0, 0.95)} ${at(0.5, 0.86)} M${at(-0.3, 1.0)} Q${at(0, 1.06)} ${at(0.3, 1.0)}" stroke="${dark(P.mask, 0.3)}" stroke-width="${n(H * 0.02)}" fill="none"/>`);
  }
  if (model.beard) {
    hair.push(path(`M${at(-0.98, 0.55)} Q${at(-1.0, 1.05)} ${at(0, 1.25)} Q${at(1.0, 1.05)} ${at(0.98, 0.55)} Q${at(0.75, 0.82)} ${at(0.3, 0.8)} Q${at(0, 0.74)} ${at(-0.3, 0.8)} Q${at(-0.75, 0.82)} ${at(-0.98, 0.55)} Z`, P.hair));
    hair.push(`<path d="M${at(-0.2, 0.9)} Q${at(0, 0.95)} ${at(0.2, 0.9)}" stroke="${dark(P.skin, 0.45)}" stroke-width="${n(H * 0.03)}" fill="none" stroke-linecap="round"/>`);
  }
  if (!['bald', 'hood', 'crown', 'permed'].includes(model.hairStyle) && !model.headscarf) {
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
    const guard = model.bandit ? paint('#5a5a5e') : paint('#c9a050');
    front.push(limb([[gx + nx * 4, gy + ny * 4], [gx - nx * 4, gy - ny * 4]], 1.7, guard));
    front.push(circle(rx - dx * 3.4, ry - dy * 3.4, 1.2, guard));
    gripOver(rx, ry);
    if (model.bandit) {
      // Round wooden shield with an iron rim and boss.
      const r = 8;
      const cy = ly + 2;
      front.push(circle(lx, cy, r, paint('#5e5e62')));
      front.push(circle(lx, cy, r - 1.1, dark(wood, 0.05)));
      for (const off of [-3.4, 0, 3.4]) front.push(limb([[lx + off, cy - Math.sqrt(Math.max(0, (r - 1.4) ** 2 - off * off))], [lx + off, cy + Math.sqrt(Math.max(0, (r - 1.4) ** 2 - off * off))]], 0.5, dark(wood, 0.35)));
      front.push(circle(lx, cy, 2.2, paint('#8a8a90')));
      front.push(circle(lx - 0.6, cy - 0.6, 0.7, '#dcdcdc'));
    } else {
      const w = 7.3;
      const ht = 19;
      const t = ly - ht * 0.42;
      const bt = ly + ht * 0.58;
      const face1 = paint('#7d8aa3');
      front.push(path(`M${n(lx - w)} ${n(t)} Q${n(lx)} ${n(t - 2)} ${n(lx + w)} ${n(t)} L${n(lx + w)} ${n(t + ht * 0.4)} Q${n(lx + w * 0.8)} ${n(bt - ht * 0.2)} ${n(lx)} ${n(bt)} Q${n(lx - w * 0.8)} ${n(bt - ht * 0.2)} ${n(lx - w)} ${n(t + ht * 0.4)} Z`, face1));
      front.push(path(`M${n(lx - w + 1.5)} ${n(t + 1.2)} Q${n(lx)} ${n(t - 0.6)} ${n(lx + w - 1.5)} ${n(t + 1.2)} L${n(lx + w - 1.5)} ${n(t + ht * 0.4)} Q${n(lx + w * 0.7)} ${n(bt - ht * 0.25)} ${n(lx)} ${n(bt - 2)} Q${n(lx - w * 0.7)} ${n(bt - ht * 0.25)} ${n(lx - w + 1.5)} ${n(t + ht * 0.4)} Z`, paint('#a33b3b')));
      front.push(`<path d="M${n(lx)} ${n(t + 2.5)} L${n(lx)} ${n(bt - 3.5)} M${n(lx - w * 0.55)} ${n(t + ht * 0.3)} L${n(lx + w * 0.55)} ${n(t + ht * 0.3)}" stroke="${paint('#e8c45a')}" stroke-width="1.8" stroke-linecap="round"/>`);
    }
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
    const hex = model.bandit ? 'H' : '';
    front.push(circle(sx, topY + 2.2, 6, `url(#glow${hex})`));
    front.push(circle(sx, topY + 2.2, 2.6, `url(#orb${hex})`));
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

  return storybook(64, `${id} (${weapon})`, back[0], `${back.slice(1).join('')}${parts.join('')}${hair.join('')}${front.join('')}`, face.join(''), 0, scale);
}

/**
 * Wrap art in the storybook finish: a faint soft edge, soft light from the top-left,
 * a light paper texture, and the face (eyes etc.) drawn crisp on top.
 */
function storybook(width, label, shadow, body, face, dx = 0, scale = 1) {
  const defs = `
    <radialGradient id="orb" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#a8e0f5"/><stop offset="1" stop-color="#4a8cc8"/></radialGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#a8e0f5" stop-opacity="0.7"/><stop offset="1" stop-color="#a8e0f5" stop-opacity="0"/></radialGradient>
    <radialGradient id="orbH" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#d0a0f0"/><stop offset="1" stop-color="#6a3a9a"/></radialGradient>
    <radialGradient id="glowH"><stop offset="0" stop-color="#c890f0" stop-opacity="0.7"/><stop offset="1" stop-color="#c890f0" stop-opacity="0"/></radialGradient>
    <filter id="dk" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="0.62"/><feFuncG type="linear" slope="0.6"/><feFuncB type="linear" slope="0.72"/></feComponentTransfer></filter>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.5"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.65"/></linearGradient>
    <mask id="mk" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="80"><rect width="${width}" height="80" fill="url(#lg)"/></mask>
    <filter id="tx" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.55 -0.1"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="edge" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="0.45"/><feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0.45 0"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} 80" width="${n(width * scale)}" height="${n(80 * scale)}">
<!-- ${label}: generated by tools/generate-art.mjs -->
<defs>${defs}</defs>
${shadow}
<use href="#fig" xlink:href="#fig" filter="url(#edge)"/>
<g id="fig"><g transform="translate(${dx} 0)">${body}</g></g>
<use href="#fig" xlink:href="#fig" mask="url(#mk)" filter="url(#dk)" opacity="0.7"/>
<use href="#fig" xlink:href="#fig" filter="url(#tx)" opacity="0.3"/>
<g transform="translate(${dx} 0)">${face}</g>
</svg>
`;
}

// ---- monsters (96x80, facing right, feet at y = 76) -------------------------------------------
export function monsterSvg(kind, color) {
  const c = paint(color);
  const lt = light(c, 0.35);
  const dk = dark(c, 0.25);
  const path = (d, fill, extra = '') => `<path d="${d.replace(/\s+/g, ' ').trim()}" fill="${fill}" ${extra}/>`;
  const limb = (pts, w, col) => `<path d="M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L')}" fill="none" stroke="${col}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const circle = (x, y, r, fill, extra = '') => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" ${extra}/>`;
  const pink = paint('#e8a0a0');
  const body = [];
  const face = [];
  let shadow = '<ellipse cx="48" cy="76.2" rx="24" ry="3" fill="#2a2018" opacity="0.25"/>';
  if (kind === 'rat') {
    // Round, chubby body with a big head and big ears.
    body.push(`<path d="M30 70 Q16 75 13.5 65 Q12.5 58.5 18 57.5" fill="none" stroke="${dark(pink, 0.08)}" stroke-width="2.3" stroke-linecap="round"/>`);
    body.push(`<ellipse cx="44" cy="64" rx="18.5" ry="12" fill="${c}"/>`);
    body.push(`<ellipse cx="46" cy="70" rx="12.5" ry="5" fill="${lt}"/>`);
    body.push(circle(58, 44.5, 6, dark(c, 0.12)) + circle(58.3, 45, 3.6, dark(pink, 0.12)));
    body.push(circle(64, 56, 11.5, c));
    body.push(`<ellipse cx="74" cy="60" rx="6.5" ry="5" fill="${c}"/>`);
    body.push(`<ellipse cx="73" cy="61.5" rx="5.5" ry="3.6" fill="${lt}"/>`);
    body.push(circle(67.5, 45, 6.6, c) + circle(67.8, 45.6, 4.2, pink));
    body.push(`<ellipse cx="36" cy="75.4" rx="3.6" ry="1.7" fill="${pink}"/><ellipse cx="51" cy="75.6" rx="3.4" ry="1.6" fill="${pink}"/><ellipse cx="63" cy="75.6" rx="3" ry="1.5" fill="${pink}"/>`);
    body.push(`<path d="M76 61.5 L85 59.5 M76.5 63 L85 64.5" stroke="${paint('#eae2da')}" stroke-width="0.5" stroke-linecap="round"/>`);
    face.push(circle(80.2, 59.2, 1.9, dark(pink, 0.12)));
    face.push(circle(69, 53.8, 2.3, '#1e1618') + circle(68.3, 53, 0.8, '#ffffff'));
    face.push(`<ellipse cx="70" cy="60.4" rx="2.6" ry="1.3" fill="#ff8fa3" opacity="0.4"/>`);
    face.push(`<path d="M76.5 64.2 Q78 65.4 79.5 64.2" stroke="#3a2a2a" stroke-width="0.6" fill="none" stroke-linecap="round"/>`);
  } else if (kind === 'slime') {
    // A gumdrop: soft rounded top, sitting flat on the ground (no rim at the bottom).
    shadow = '<ellipse cx="48" cy="76.2" rx="25" ry="2.6" fill="#2a2018" opacity="0.25"/>';
    body.push(path('M27 76 C18 76 18.5 64 23.5 55 C29 45 39.5 34.5 48 34 C56.5 34.5 67 45 72.5 55 C77.5 64 78 76 69 76 Z', c, 'opacity="0.95"'));
    body.push(`<ellipse cx="48" cy="63" rx="17" ry="10" fill="${lt}" opacity="0.3"/>`);
    body.push(`<ellipse cx="37" cy="47.5" rx="6" ry="3" fill="#ffffff" opacity="0.55" transform="rotate(-38 37 47.5)"/>`);
    body.push(circle(31.5, 54, 1.3, '#ffffff', 'opacity="0.6"'));
    body.push(circle(62, 67, 2, lt, 'opacity="0.7"') + circle(57, 71, 1.2, lt, 'opacity="0.7"') + circle(66, 59, 1, lt, 'opacity="0.7"'));
    face.push(`<ellipse cx="41" cy="60" rx="2.5" ry="3.4" fill="#1e2a1e"/><ellipse cx="55" cy="60" rx="2.5" ry="3.4" fill="#1e2a1e"/>`);
    face.push(circle(40.2, 58.9, 0.9, '#ffffff') + circle(54.2, 58.9, 0.9, '#ffffff'));
    face.push(`<path d="M45 66.5 Q48 68.8 51 66.5" stroke="#1e2a1e" stroke-width="1.1" fill="none" stroke-linecap="round"/>`);
    face.push(`<ellipse cx="36.5" cy="65" rx="2.8" ry="1.3" fill="#ff8fa3" opacity="0.35"/><ellipse cx="59.5" cy="65" rx="2.8" ry="1.3" fill="#ff8fa3" opacity="0.35"/>`);
  } else if (kind === 'wolf') {
    // Sturdy and rounded: big head, short legs, fluffy upturned tail.
    const fur = c;
    body.push(path('M29 53 Q15 51 14 38 Q19 41 21 39 Q22 45 31 48 Z', fur));
    body.push(path('M14.2 38.5 Q18 41 21 39 Q19 35.5 15.5 35 Z', lt));
    body.push(limb([[34, 62], [34, 74.5]], 5.4, dk) + limb([[55, 62], [55.5, 74.5]], 5.4, dk));
    body.push(`<ellipse cx="45" cy="56" rx="20" ry="11.5" fill="${fur}"/>`);
    body.push(`<ellipse cx="45" cy="63" rx="13" ry="4" fill="${lt}"/>`);
    body.push(limb([[39, 62], [38.5, 74.5]], 5.8, fur) + limb([[60, 61], [61, 74.5]], 5.8, fur));
    body.push(`<ellipse cx="38.5" cy="75.2" rx="3.6" ry="1.6" fill="${lt}"/><ellipse cx="61.5" cy="75.2" rx="3.6" ry="1.6" fill="${lt}"/>`);
    body.push(`<ellipse cx="62" cy="55" rx="7.5" ry="8.5" fill="${lt}"/>`);
    body.push(path('M60.5 37 L62 22.5 Q63.5 22 69 32 Z M68 32 L73.5 20.5 Q75 21 76.5 33.5 Z', fur));
    body.push(path('M62.3 33 L63 26 L66.5 32 Z M70.5 31.5 L73.8 25 L74.8 32 Z', paint('#d9b0b0')));
    body.push(circle(68.5, 42, 12, fur));
    body.push(`<ellipse cx="66" cy="49" rx="7" ry="4" fill="${lt}"/>`);
    body.push(`<ellipse cx="79" cy="46.5" rx="7.5" ry="5.2" fill="${fur}"/>`);
    body.push(`<ellipse cx="79.5" cy="48.5" rx="6.2" ry="3.4" fill="${lt}"/>`);
    face.push(`<ellipse cx="86" cy="45" rx="2" ry="1.6" fill="#1a1416"/>`);
    face.push(circle(73, 40.2, 2.1, '#1a1416') + circle(72.3, 39.4, 0.75, '#ffffff'));
    face.push(`<path d="M81.5 50 Q83 51.2 84.6 50" stroke="#2a1e1e" stroke-width="0.6" fill="none" stroke-linecap="round"/>`);
  } else if (kind === 'spider') {
    // A fat abdomen behind a small head, eight bent legs, a cluster of shiny eyes.
    const leg = dark(c, 0.3);
    for (const [hx, kx, ky, fx] of [[56, 70, 46, 84], [54, 64, 44, 74], [52, 46, 44, 40], [50, 36, 46, 26]]) {
      body.push(limb([[hx, 60], [kx, ky], [fx, 75]], 2.6, leg));
    }
    body.push(`<ellipse cx="36" cy="55" rx="18" ry="14" fill="${c}"/>`);
    body.push(`<ellipse cx="33" cy="51" rx="9" ry="5" fill="${lt}" opacity="0.35"/>`);
    body.push(path('M30 46 L36 52 L42 46 M30 58 L36 64 L42 58', 'none', `stroke="${paint('#c8b040')}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"`));
    for (const [hx, kx, ky, fx] of [[60, 76, 50, 88], [58, 70, 52, 80], [54, 50, 52, 46], [52, 42, 54, 32]]) {
      body.push(limb([[hx, 62], [kx, ky], [fx, 76]], 2.8, dk));
    }
    body.push(`<ellipse cx="61" cy="60" rx="11" ry="9" fill="${dk}"/>`);
    body.push(path('M68 66 L71 71 L69 66 Z M64 67 L65 72 L66 67 Z', paint('#e8e0d0')));
    for (const [x, y, r] of [[66, 56, 2.2], [70, 57.5, 1.9], [63, 58, 1.5], [68, 60, 1.4]]) face.push(circle(x, y, r, '#c02a2a') + circle(x - r * 0.35, y - r * 0.35, r * 0.35, '#ffffff'));
  } else if (kind === 'bear') {
    // Big and round: heavy body, thick legs, round ears and a long snout.
    body.push(limb([[32, 62], [31, 74]], 8, dk) + limb([[56, 62], [57, 74]], 8, dk));
    body.push(`<ellipse cx="44" cy="54" rx="25" ry="16" fill="${c}"/>`);
    body.push(`<ellipse cx="44" cy="63" rx="16" ry="5" fill="${lt}" opacity="0.6"/>`);
    body.push(limb([[38, 62], [37, 74.5]], 8.6, c) + limb([[62, 60], [63, 74.5]], 8.6, c));
    body.push(`<ellipse cx="36.5" cy="75.2" rx="5" ry="2" fill="${dk}"/><ellipse cx="63.5" cy="75.2" rx="5" ry="2" fill="${dk}"/>`);
    body.push(circle(66, 34, 4.5, c) + circle(66, 34, 2.4, dark(pink, 0.2)));
    body.push(circle(78, 33, 4.5, c) + circle(78, 33, 2.4, dark(pink, 0.2)));
    body.push(circle(72, 44, 12, c));
    body.push(`<ellipse cx="82" cy="49" rx="8" ry="5.6" fill="${lt}"/>`);
    face.push(`<ellipse cx="88.5" cy="47.5" rx="2.6" ry="2" fill="#1a1416"/>`);
    face.push(circle(76, 41, 2, '#1a1416') + circle(75.4, 40.3, 0.7, '#ffffff'));
    face.push(`<path d="M83 52.5 Q85.5 54 88 52.5" stroke="#2a1e1e" stroke-width="0.7" fill="none" stroke-linecap="round"/>`);
  } else if (kind === 'troll') {
    // A hulking, stooped giant with long arms, a big nose and a club.
    const skin = c;
    body.push(limb([[40, 58], [38, 74]], 7, dark(skin, 0.15)) + limb([[54, 58], [56, 74]], 7, dark(skin, 0.15)));
    body.push(`<ellipse cx="37.5" cy="75" rx="5" ry="2" fill="${dk}"/><ellipse cx="56.5" cy="75" rx="5" ry="2" fill="${dk}"/>`);
    body.push(limb([[34, 38], [28, 52], [30, 64]], 6.5, dark(skin, 0.08)) + circle(30, 65, 4, skin));
    body.push(`<ellipse cx="47" cy="44" rx="16" ry="17" fill="${skin}"/>`);
    body.push(`<ellipse cx="49" cy="50" rx="10" ry="9" fill="${lt}" opacity="0.4"/>`);
    body.push(path('M33 52 L61 52 L58 63 Q47 66 36 63 Z', paint('#6a4a30')));
    body.push(path('M36 63 L39 68 L42 63 L46 68 L50 63 L54 68 L58 63', 'none', `stroke="${paint('#4a3220')}" stroke-width="1.2"`));
    // Club over the shoulder.
    body.push(path('M66 56 L76 22 Q80 16 84 22 L72 58 Z', paint('#7a5232')));
    body.push(circle(78, 24, 1.3, paint('#4a3220')) + circle(81, 30, 1.1, paint('#4a3220')));
    body.push(limb([[58, 36], [66, 48], [69, 56]], 6.5, skin) + circle(69, 56, 4.2, skin));
    body.push(path('M42 22 L36 16 L44 19 Z M58 22 L64 15 L57 19 Z', dark(skin, 0.1)));
    body.push(circle(50, 25, 10, skin));
    body.push(`<ellipse cx="56" cy="27.5" rx="4" ry="3" fill="${dark(skin, 0.08)}"/>`);
    face.push(circle(48, 22.5, 1.8, '#1a1416') + circle(54, 22, 1.6, '#1a1416'));
    face.push(`<path d="M45 19.5 L50 20.5 M52 20 L56.5 19" stroke="#1a1416" stroke-width="1" stroke-linecap="round"/>`);
    face.push(path('M47 31 L48.5 28 L50 31 Z M53 31 L54.5 28 L56 31 Z', '#f4ecd8'));
  } else if (kind === 'wraith') {
    // A floating, tattered hooded cloak with glowing eyes and reaching hands.
    shadow = '<ellipse cx="48" cy="76.2" rx="16" ry="2" fill="#2a2018" opacity="0.15"/>';
    body.push(path('M48 10 C62 10 66 26 66 40 C68 52 72 60 70 68 L64 62 L60 70 L55 63 L50 71 L45 63 L40 70 L36 62 L30 68 C28 58 32 50 32 40 C32 26 36 10 48 10 Z', c, 'opacity="0.92"'));
    body.push(path('M48 12 C58 12 62 24 62 34 L34 34 C34 24 38 12 48 12 Z', dk));
    body.push(`<ellipse cx="48" cy="30" rx="10" ry="11" fill="#14121c"/>`);
    body.push(path('M62 38 Q74 40 80 46', 'none', `stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="0.9"`));
    body.push(path('M80 46 L86 44 M80 46 L86 48 M80 46 L84 51', 'none', `stroke="${lt}" stroke-width="1.4" stroke-linecap="round"`));
    body.push(path('M38 50 Q44 56 50 52 Q56 58 62 54', 'none', `stroke="${lt}" stroke-width="1" opacity="0.5"`));
    face.push(`<ellipse cx="44" cy="29" rx="2.4" ry="1.6" fill="#9ef0ff"/><ellipse cx="52" cy="29" rx="2.4" ry="1.6" fill="#9ef0ff"/>`);
    face.push(`<ellipse cx="44" cy="29" rx="5" ry="3.5" fill="#9ef0ff" opacity="0.25"/><ellipse cx="52" cy="29" rx="5" ry="3.5" fill="#9ef0ff" opacity="0.25"/>`);
  } else if (kind === 'wyvern') {
    // Two-legged dragon: wings raised, long neck, horned head, barbed tail.
    body.push(path('M44 44 L18 8 L30 26 L22 24 L34 36 L28 38 L42 46 Z', dk, 'opacity="0.95"'));
    body.push(path('M30 60 Q12 66 8 54 Q6 48 12 46 L10 52 Q16 58 30 54 Z', c));
    body.push(path('M12 46 L6 42 L13 43 Z', dark(c, 0.3)));
    body.push(limb([[40, 62], [38, 74]], 5.5, dk) + limb([[54, 62], [56, 74]], 5.5, c));
    body.push(`<ellipse cx="37" cy="75" rx="4" ry="1.6" fill="${dark(c, 0.4)}"/><ellipse cx="57" cy="75" rx="4" ry="1.6" fill="${dark(c, 0.4)}"/>`);
    body.push(`<ellipse cx="46" cy="54" rx="17" ry="11" fill="${c}"/>`);
    body.push(`<ellipse cx="48" cy="60" rx="11" ry="4" fill="${paint('#d8c890')}" opacity="0.8"/>`);
    body.push(path('M58 48 Q66 36 70 28 L76 31 Q70 42 62 54 Z', c));
    body.push(path('M48 44 L72 8 L66 28 L76 22 L62 40 L70 40 L52 48 Z', light(dk, 0.1), 'opacity="0.95"'));
    body.push(`<ellipse cx="78" cy="27" rx="9" ry="6" fill="${c}"/>`);
    body.push(`<ellipse cx="86" cy="29" rx="5" ry="3" fill="${c}"/>`);
    body.push(path('M72 22 L68 14 L75 21 Z M76 21 L75 12 L79 20 Z', paint('#e8e0d0')));
    face.push(circle(80, 25, 1.7, '#e8c020') + circle(80, 25, 0.8, '#1a1416'));
    face.push(`<path d="M82 31 L90 30" stroke="#1a1416" stroke-width="0.7" stroke-linecap="round"/>`);
  } else if (kind === 'demon') {
    // Horned, winged and hoofed, with burning eyes.
    const wing = dark(c, 0.45);
    body.push(path('M40 36 L14 14 L20 30 L10 30 L22 42 L14 46 L38 48 Z', wing));
    body.push(path('M56 36 L82 14 L76 30 L86 30 L74 42 L82 46 L58 48 Z', wing));
    body.push(limb([[42, 56], [40, 66], [43, 74]], 6, dk) + limb([[54, 56], [56, 66], [53, 74]], 6, dk));
    body.push(`<ellipse cx="43" cy="75" rx="3.4" ry="1.6" fill="#1a1416"/><ellipse cx="53" cy="75" rx="3.4" ry="1.6" fill="#1a1416"/>`);
    body.push(path('M48 58 Q34 66 30 60 Q32 66 26 64', 'none', `stroke="${dk}" stroke-width="2" stroke-linecap="round"`));
    body.push(path('M26 64 L22 62 L25 67 Z', dk));
    body.push(`<ellipse cx="48" cy="45" rx="12" ry="14" fill="${c}"/>`);
    body.push(`<ellipse cx="48" cy="48" rx="7" ry="7" fill="${lt}" opacity="0.35"/>`);
    body.push(limb([[37, 38], [32, 48], [34, 56]], 4.6, c) + limb([[59, 38], [66, 46], [70, 44]], 4.6, c));
    body.push(path('M34 56 L31 60 M34 56 L34 61 M34 56 L37 60 M70 44 L75 42 M70 44 L75 46 M70 44 L73 49', 'none', `stroke="${paint('#f0e0c0')}" stroke-width="1.1" stroke-linecap="round"`));
    body.push(circle(48, 24, 9, c));
    body.push(path('M41 19 Q34 12 38 4 Q40 12 44 16 Z M55 19 Q62 12 58 4 Q56 12 52 16 Z', paint('#2a2020')));
    face.push(path('M43 22 L47 24 L43 25 Z M53 22 L49 24 L53 25 Z', '#ffd040'));
    face.push(`<ellipse cx="45" cy="23.8" rx="3.5" ry="2" fill="#ffd040" opacity="0.3"/><ellipse cx="51" cy="23.8" rx="3.5" ry="2" fill="#ffd040" opacity="0.3"/>`);
    face.push(`<path d="M44.5 29 Q48 31 51.5 29" stroke="#1a1416" stroke-width="0.9" fill="none" stroke-linecap="round"/>`);
    face.push(path('M45.5 29.3 L46.3 31 L47 29.6 Z M49 29.6 L49.7 31 L50.5 29.3 Z', '#f4ecd8'));
  }
  return storybook(96, kind, shadow, body.join(''), face.join(''), 0);
}


// ---- custom looks (player-made adventurers) ------------------------------------------------------
export const SKIN_TONES = {
  pale: '#f6dccb', light: '#f0c8a2', fair: '#e4b48c', olive: '#c69a6c', lightBrown: '#a8714a', brown: '#7a4a2f',
};
export const HAIR_COLORS = {
  black: '#1f1b1d', darkBrown: '#3e2a1e', brown: '#6a3f24', auburn: '#8a3a22', red: '#b8442b', blonde: '#e0c070', ash: '#a8a4a0',
};
/** Faces 1-4 for each sex. */
export const FACES = {
  male: [
    { eyes: 'dot', brows: 'soft', mouth: 'smile', blush: 0.2 },
    { eyes: 'narrow', brows: 'heavy', mouth: 'flat', stubble: true },
    { eyes: 'dot', brows: 'heavy', mouth: 'smile', beard: true },
    { eyes: 'round', brows: 'arched', mouth: 'grin', freckles: true, blush: 0.25 },
  ],
  female: [
    { eyes: 'round', brows: 'soft', mouth: 'smile', lashes: true, blush: 0.4 },
    { eyes: 'dot', brows: 'arched', mouth: 'grin', lashes: true, freckles: true, blush: 0.35 },
    { eyes: 'narrow', brows: 'angled', mouth: 'flat', lashes: true, blush: 0.15 },
    { eyes: 'sleepy', brows: 'soft', mouth: 'small', lashes: true, mole: true, blush: 0.3 },
  ],
};
/** Hair style ids used by the art for each look option. */
export const HAIR_ART = {
  crewCut: 'crew', bowlCut: 'bowl', permed: 'permed', tied: 'tied',
  bobCut: 'bob', ponytail: 'ponytail', crownBraid: 'crown', downWithBangs: 'bangs', braided: 'braid', bun: 'bun',
};
/** Outfit follows the weapon: armour for sword & shield, a tunic for spear and bow, a robe for the staff. */
const OUTFIT_BY_WEAPON = { sword_shield: 'armor', spear: 'tunic', bow: 'tunic', staff: 'robe' };
const EYES_BY_HAIR = { black: '#3a2418', darkBrown: '#4a3020', brown: '#4a3020', auburn: '#4a7a3a', red: '#4a7a3a', blonde: '#3d6fb8', ash: '#4f6a8a' };

/** A body model for figureSvg from a custom look ({ sex, skin, face, hair, hairColor }) and outfit colour. */
export function lookModel(look, clothColor, weapon) {
  const female = look.sex === 'female';
  const face = (FACES[look.sex] ?? FACES.male)[Math.max(0, Math.min(3, (look.face ?? 1) - 1))];
  const outfit = OUTFIT_BY_WEAPON[weapon] ?? 'tunic';
  return {
    female,
    skin: SKIN_TONES[look.skin] ?? SKIN_TONES.light,
    hair: HAIR_COLORS[look.hairColor] ?? HAIR_COLORS.brown,
    hairStyle: HAIR_ART[look.hair] ?? (female ? 'bob' : 'crew'),
    eyes: EYES_BY_HAIR[look.hairColor] ?? '#4a3020',
    outfit,
    cloth: clothColor,
    accent: outfit === 'tunic' ? '#8a5a34' : '#d9b44a',
    legs: '#4a4036',
    boots: '#6b4a2e',
    face,
    beard: !!face.beard,
    stubble: !!face.stubble,
  };
}
