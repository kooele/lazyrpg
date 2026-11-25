// Title Case for UI labels (see CLAUDE.md): Chicago style. Articles, coordinating conjunctions and prepositions stay
// lowercase unless first or last; abbreviations and anything in parentheses are left as they are.

const MINOR = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'off', 'on', 'onto',
  'per', 'to', 'up', 'via', 'with', 'from', 'into', 'over', 'than', 'vs',
]);
/** Abbreviations that keep their case. */
const ABBREVIATIONS = new Set(['g', 'd', 'wk', 'dmg', 'lv', 'hp', 'mp', 'ap', 'xp', 'x']);

const capitalize = (w: string) => w.replace(/^[a-z]/, (c) => c.toUpperCase());

/** "set out from the city gate" -> "Set Out from the City Gate". Text in parentheses is left alone. */
export function titleCase(s: string): string {
  // Split into parenthesized parts (kept) and the rest.
  const parts = s.split(/(\([^)]*\))/);
  const words: { part: number; start: number; end: number }[] = [];
  parts.forEach((p, i) => {
    if (i % 2) return;
    for (const m of p.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) words.push({ part: i, start: m.index!, end: m.index! + m[0].length });
  });
  const out = parts.slice();
  // Replace from the end so indexes stay valid.
  for (let n = words.length - 1; n >= 0; n--) {
    const { part, start, end } = words[n];
    const p = out[part];
    const w = p.slice(start, end);
    const before = p[start - 1];
    const after = p[end];
    // Part of a number+unit or a token like "18g/day" or ".json": leave it.
    if ((before && /[0-9./]/.test(before)) || (after && /[0-9/]/.test(after))) continue;
    if (ABBREVIATIONS.has(w.toLowerCase())) continue;
    const first = n === 0 || /[:·—]\s*$/.test(p.slice(0, start)) && words[n - 1]?.part === part;
    const last = n === words.length - 1;
    const lower = w.toLowerCase();
    const next = first || last || !MINOR.has(lower) ? w.split('-').map(capitalize).join('-') : w;
    out[part] = p.slice(0, start) + next + p.slice(end);
  }
  return out.join('');
}
