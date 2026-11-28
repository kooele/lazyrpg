# Battle length and win rate per enemy type in a type-only balance report: python3 tools/balance/lengths.py <report>
import json, sys
d = json.load(open(__file__.rsplit('/', 1)[0] + f'/out/{sys.argv[1]}.json'))
by = {}
for s, runs in zip(d['summary'], d['runs']):
    t = '+'.join(s['quest'].get('foes') or ['mixed'])
    by.setdefault(t, []).extend((r['rounds'], r['win']) for r in runs)
for t, v in by.items():
    r = sorted(x for x, _ in v)
    print(f"{t:10} n {len(v):4} win {sum(w for _, w in v) / len(v):.2f}  rounds mean {sum(r) / len(r):5.1f} p10 {r[int(.1 * len(r))]} p90 {r[int(.9 * len(r))]} max {r[-1]}  >20 {sum(x > 20 for x in r) / len(r):.1%}")
