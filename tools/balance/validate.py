# Model check on a balance report: predicted win chance (strength.winCurve) against the battles, by rank or type, and
# battle lengths.   python3 tools/balance/validate.py <report> [--by rank|foes|level]
import json, sys
name = sys.argv[1]
by = sys.argv[sys.argv.index('--by') + 1] if '--by' in sys.argv else 'rank'
d = json.load(open(__file__.rsplit('/', 1)[0] + f'/out/{name}.json'))
groups = {}
for s, runs in zip(d['summary'], d['runs']):
    k = s['id'].split()[0] if by == 'rank' else '+'.join(s['quest'].get('foes') or []) if by == 'foes' else s['party']['level']
    g = groups.setdefault(k, {'n': 0, 'won': 0, 'pred': 0, 'rounds': [], 'par': 0, 'cells': 0})
    g['n'] += len(runs); g['won'] += sum(r['win'] for r in runs); g['pred'] += s['predicted'] * len(runs)
    g['rounds'] += [r['rounds'] for r in runs]; g['par'] += s['par'] - s['party']['level']; g['cells'] += 1
tot = {'n': 0, 'won': 0, 'pred': 0, 'rounds': []}
for k, g in groups.items():
    r = sorted(g['rounds'])
    print(f"{str(k):24} n {g['n']:5} win {g['won'] / g['n']:.2f} model {g['pred'] / g['n']:.2f}  par - party level {g['par'] / g['cells']:+.1f}  rounds mean {sum(r) / len(r):5.1f} p90 {r[int(.9 * len(r))]} >20 {sum(x > 20 for x in r) / len(r):.1%}")
    for x in ('n', 'won', 'pred'): tot[x] += g[x]
    tot['rounds'] += g['rounds']
r = sorted(tot['rounds'])
print(f"{'all':24} n {tot['n']:5} win {tot['won'] / tot['n']:.2f} model {tot['pred'] / tot['n']:.2f}  rounds mean {sum(r) / len(r):5.1f} p90 {r[int(.9 * len(r))]} >20 {sum(x > 20 for x in r) / len(r):.1%}")
