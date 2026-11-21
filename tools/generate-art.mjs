// Generates the unit art in public/art as SVG files (crisp at any resolution).
//   node tools/generate-art.mjs
// Bodies (units/m1..m4, f1..f4) and weapons (weapons/*.svg) share one 64x80 canvas,
// so a weapon sprite drawn on top of a body lines up with the hands:
//   right hand (viewer's left) = (17.5, 54), left hand (viewer's right) = (46.5, 54), feet at y = 76.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art');
const OUT = '#1d1a22'; // outline colour
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="64" height="80">\n${body}\n</svg>\n`;

/** Darken a #rrggbb colour by `f` (0..1). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.round(v * (1 - f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const HAIR = {
  // Male styles
  short: (c) => `<path d="M21 21 Q21 9 32 9 Q43 9 43 21 L41 17 Q38 13 32 13 Q25 13 23 17 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
  spiky: (c) => `<path d="M20 21 L22 12 L25 15 L27 7 L31 13 L34 6 L36 13 L40 8 L41 15 L44 13 L43 21 Q38 14 32 14 Q25 14 20 21 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
  bald: () => '',
  swept: (c) => `<path d="M20 23 Q19 9 33 9 Q45 10 44 22 Q40 14 30 15 Q24 16 20 23 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/><path d="M42 17 Q47 22 44 29" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
  // Female styles
  long: (c) => `<path d="M20 22 Q19 8 32 8 Q45 8 44 22 L46 40 Q41 37 40 30 L40 20 Q36 14 32 14 Q27 14 24 20 L24 30 Q23 37 18 40 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
  ponytail: (c) => `<path d="M21 21 Q20 9 32 9 Q44 9 43 21 Q39 14 32 14 Q25 14 21 21 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/><path d="M42 14 Q52 18 48 36 Q46 28 42 22 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
  bun: (c) => `<circle cx="32" cy="8" r="5.5" fill="${c}" stroke="${OUT}" stroke-width="1.2"/><path d="M21 22 Q20 10 32 10 Q44 10 43 22 Q39 15 32 15 Q25 15 21 22 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
  bob: (c) => `<path d="M20 28 Q18 9 32 9 Q46 9 44 28 L40 28 L40 19 Q36 15 32 15 Q28 15 24 19 L24 28 Z" fill="${c}" stroke="${OUT}" stroke-width="1.2"/>`,
};

const MODELS = {
  m1: { female: false, skin: '#f1c9a5', hair: '#6b4226', hairStyle: 'short', outfit: '#3f6fb5', pants: '#4a4036' },
  m2: { female: false, skin: '#d9a77a', hair: '#1f1b1d', hairStyle: 'spiky', outfit: '#3f8a5a', pants: '#3b3b44' },
  m3: { female: false, skin: '#8d5a3b', hair: '#2a1d17', hairStyle: 'bald', beard: true, outfit: '#8a4b32', pants: '#3f3630' },
  m4: { female: false, skin: '#f3d2b5', hair: '#d8b45a', hairStyle: 'swept', stubble: true, outfit: '#6b6f7a', pants: '#2f3540' },
  f1: { female: true, skin: '#f4cfae', hair: '#7a4a2a', hairStyle: 'long', outfit: '#2f8f8a', pants: '#4a4036' },
  f2: { female: true, skin: '#f6d6bf', hair: '#b8442b', hairStyle: 'ponytail', outfit: '#7a4fa3', pants: '#3b3346' },
  f3: { female: true, skin: '#7a4a2f', hair: '#1c1416', hairStyle: 'bun', outfit: '#c9772f', pants: '#3f3630' },
  f4: { female: true, skin: '#e0b088', hair: '#e8cf7a', hairStyle: 'bob', outfit: '#a8324a', pants: '#2f3540' },
};

function body(m) {
  const sleeve = shade(m.outfit, 0.18);
  const boot = '#3a2a20';
  const parts = [];
  parts.push('<ellipse cx="32" cy="76" rx="15" ry="3.5" fill="#000" opacity="0.28"/>');
  if (m.hairStyle === 'long') parts.push(HAIR.long(m.hair)); // long hair falls behind the body
  // Legs + boots
  parts.push(`<rect x="24" y="58" width="7" height="15" rx="2" fill="${m.pants}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<rect x="33" y="58" width="7" height="15" rx="2" fill="${m.pants}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<rect x="23" y="69" width="9" height="6" rx="2" fill="${boot}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<rect x="32" y="69" width="9" height="6" rx="2" fill="${boot}" stroke="${OUT}" stroke-width="1.2"/>`);
  // Torso
  if (m.female) {
    parts.push(`<path d="M23 37 Q32 34 41 37 L40 50 L46 65 Q32 69 18 65 L24 50 Z" fill="${m.outfit}" stroke="${OUT}" stroke-width="1.2" stroke-linejoin="round"/>`);
    parts.push(`<path d="M24 50 L40 50" stroke="${shade(m.outfit, 0.35)}" stroke-width="2.5"/>`);
  } else {
    parts.push(`<rect x="21" y="36" width="22" height="25" rx="5" fill="${m.outfit}" stroke="${OUT}" stroke-width="1.2"/>`);
    parts.push(`<rect x="21.6" y="52" width="20.8" height="3.2" fill="#5a3b24"/><rect x="30" y="51.5" width="4" height="4.2" rx="0.8" fill="#d6b25a"/>`);
  }
  parts.push(`<path d="M28 36 L32 41 L36 36" fill="none" stroke="${shade(m.outfit, 0.35)}" stroke-width="1.4"/>`);
  // Arms + hands
  parts.push(`<rect x="14" y="37" width="7.5" height="16" rx="3.5" fill="${sleeve}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<rect x="42.5" y="37" width="7.5" height="16" rx="3.5" fill="${sleeve}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<circle cx="17.5" cy="54" r="3.6" fill="${m.skin}" stroke="${OUT}" stroke-width="1.2"/>`);
  parts.push(`<circle cx="46.5" cy="54" r="3.6" fill="${m.skin}" stroke="${OUT}" stroke-width="1.2"/>`);
  // Neck + head
  parts.push(`<rect x="29" y="30" width="6" height="7" fill="${shade(m.skin, 0.12)}"/>`);
  parts.push(`<circle cx="20.8" cy="23" r="2.4" fill="${m.skin}" stroke="${OUT}" stroke-width="1"/><circle cx="43.2" cy="23" r="2.4" fill="${m.skin}" stroke="${OUT}" stroke-width="1"/>`);
  parts.push(`<circle cx="32" cy="21.5" r="11" fill="${m.skin}" stroke="${OUT}" stroke-width="1.2"/>`);
  if (m.beard) parts.push(`<path d="M23 23 Q24 34 32 35 Q40 34 41 23 Q38 29 32 29 Q26 29 23 23 Z" fill="${m.hair}" stroke="${OUT}" stroke-width="1"/>`);
  if (m.stubble) parts.push(`<path d="M24 26 Q32 33 40 26" fill="none" stroke="${shade(m.hair, 0.3)}" stroke-width="2" opacity="0.45"/>`);
  // Face
  parts.push(`<circle cx="28.2" cy="22.5" r="1.6" fill="${OUT}"/><circle cx="35.8" cy="22.5" r="1.6" fill="${OUT}"/>`);
  parts.push(`<circle cx="28.7" cy="22" r="0.5" fill="#fff"/><circle cx="36.3" cy="22" r="0.5" fill="#fff"/>`);
  if (m.female) parts.push(`<path d="M26.4 20 L28 19.6 M35.9 19.6 L37.6 20" stroke="${OUT}" stroke-width="0.9"/>`);
  if (!m.beard) parts.push(`<path d="M29.5 27.2 Q32 28.8 34.5 27.2" fill="none" stroke="${shade(m.skin, 0.55)}" stroke-width="1.1" stroke-linecap="round"/>`);
  parts.push(`<ellipse cx="25.6" cy="25.6" rx="1.7" ry="1" fill="#e88" opacity="${m.female ? 0.45 : 0.2}"/><ellipse cx="38.4" cy="25.6" rx="1.7" ry="1" fill="#e88" opacity="${m.female ? 0.45 : 0.2}"/>`);
  // Hair (front)
  const hair = HAIR[m.hairStyle](m.hair);
  if (m.hairStyle !== 'long') parts.push(hair);
  else parts.push(`<path d="M21 21 Q20 9 32 9 Q44 9 43 21 Q38 13 32 14 Q26 13 21 21 Z" fill="${m.hair}" stroke="${OUT}" stroke-width="1.2"/>`);
  return svg(parts.join('\n'));
}

const STEEL = '#cfd6e0';
const WEAPONS = {
  sword_shield: [
    // Sword held in the right hand, blade up and slightly out.
    `<path d="M15.5 50 L10.5 18 L13 14 L15.5 18 L19 49 Z" fill="${STEEL}" stroke="${OUT}" stroke-width="1.2" stroke-linejoin="round"/>`,
    '<path d="M13 21 L17.7 47" stroke="#fff" stroke-width="0.9" opacity="0.7"/>',
    `<rect x="11" y="48.5" width="12" height="3.2" rx="1.2" fill="#b38b3a" stroke="${OUT}" stroke-width="1.1" transform="rotate(-8 17 50)"/>`,
    '<rect x="16" y="51" width="3" height="6" rx="1" fill="#5a3b24" transform="rotate(-8 17.5 54)"/>',
    // Kite shield on the left arm.
    `<path d="M38 40 Q47 37 56 40 L55.5 54 Q53 64 47 69 Q41 64 38.5 54 Z" fill="#7d8aa3" stroke="${OUT}" stroke-width="1.4" stroke-linejoin="round"/>`,
    '<path d="M40.5 42 Q47 40 53.5 42 L53 53 Q51 61 47 65 Q43 61 41 53 Z" fill="#a33b3b"/>',
    '<path d="M47 41 L47 65 M41 49 L53 49" stroke="#e8c45a" stroke-width="2"/>',
  ],
  spear: [
    `<rect x="16" y="12" width="3.2" height="66" rx="1.4" fill="#8a5a34" stroke="${OUT}" stroke-width="1"/>`,
    `<path d="M17.6 1 L22 13 L17.6 17 L13.2 13 Z" fill="${STEEL}" stroke="${OUT}" stroke-width="1.2" stroke-linejoin="round"/>`,
    '<path d="M17.6 3.5 L17.6 14.5" stroke="#fff" stroke-width="0.8" opacity="0.7"/>',
    '<path d="M14 18 Q17.6 21 21.2 18" fill="none" stroke="#b84a3a" stroke-width="2.2"/>',
  ],
  bow: [
    `<path d="M45 26 Q61 54 45 80" fill="none" stroke="${OUT}" stroke-width="4.4" stroke-linecap="round"/>`,
    '<path d="M45 26 Q61 54 45 80" fill="none" stroke="#9a6a3a" stroke-width="2.6" stroke-linecap="round"/>',
    '<path d="M45 26 L45 80" stroke="#efe6d2" stroke-width="0.9"/>',
    '<rect x="48.5" y="51" width="5" height="6" rx="1" fill="#5a3b24"/>',
    // Quiver peeking over the right shoulder.
    `<rect x="17" y="27" width="6" height="16" rx="2" fill="#6b4a2c" stroke="${OUT}" stroke-width="1.1" transform="rotate(-20 20 35)"/>`,
    '<path d="M15 26 L13 22 M18 25 L17 20 M21 26 L21 21" stroke="#e8e0d0" stroke-width="1.4"/>',
  ],
  staff: [
    `<rect x="16" y="14" width="3.2" height="63" rx="1.4" fill="#6e4a2e" stroke="${OUT}" stroke-width="1"/>`,
    `<path d="M17.6 15 Q11 11 13 4 M17.6 15 Q24 11 22 4" fill="none" stroke="#6e4a2e" stroke-width="2.4" stroke-linecap="round"/>`,
    '<circle cx="17.6" cy="8" r="7.5" fill="#7fe3ff" opacity="0.25"/>',
    `<circle cx="17.6" cy="8" r="4.4" fill="#57c7f2" stroke="${OUT}" stroke-width="1.1"/>`,
    '<circle cx="16.2" cy="6.6" r="1.4" fill="#fff" opacity="0.85"/>',
  ],
};

mkdirSync(join(root, 'units'), { recursive: true });
mkdirSync(join(root, 'weapons'), { recursive: true });
for (const [id, m] of Object.entries(MODELS)) writeFileSync(join(root, 'units', `${id}.svg`), body(m));
for (const [id, layers] of Object.entries(WEAPONS)) writeFileSync(join(root, 'weapons', `${id}.svg`), svg(layers.join('\n')));
console.log(`Wrote ${Object.keys(MODELS).length} bodies and ${Object.keys(WEAPONS).length} weapons to ${root}`);
