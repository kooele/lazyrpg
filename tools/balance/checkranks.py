# Score check: average score (rewards against Health lost), the model's prediction and the target, per party level
# (plan 'ranks') or per skulls (plan 'skulls'), with battle lengths.   python3 tools/balance/checkranks.py <report>
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(f'{here}/out/{sys.argv[1]}.json'))
T = [(1, .99), (5, .70), (10, .60), (20, .50)]
def target(L):
    if L <= T[0][0]: return T[0][1]
    for (x0, y0), (x1, y1) in zip(T, T[1:]):
        if L <= x1: return y0 + (y1 - y0) * (L - x0) / (x1 - x0)
    return T[-1][1]
g = {}
for s, runs in zip(d['summary'], d['runs']):
    tok = s['id'].split()
    k = ('skulls', float(tok[0]), tok[2], tok[3]) if tok[1] == 'skulls' else ('level', s['party']['level'])
    v = g.setdefault(k, {'n': 0, 'score': 0, 'win': 0, 'pred': 0, 'rounds': [], 'skulls': 0, 'cells': 0})
    v['n'] += len(runs); v['score'] += sum(r['score'] for r in runs); v['win'] += sum(r['win'] for r in runs)
    v['pred'] += s['predicted'] * len(runs); v['rounds'] += [r['rounds'] for r in runs]; v['skulls'] += s['skulls']; v['cells'] += 1
for k, v in sorted(g.items()):
    r = sorted(v['rounds']); n = v['n']
    head = f'{k[1]} skulls, {k[2]} {k[3]}' if k[0] == 'skulls' else f"level {k[1]:2} (target {target(k[1]):.0%})"
    print(f"{head:34} score {v['score'] / n:.0%} (wins {v['win'] / n:.0%}) model {v['pred'] / n:.0%}  skulls {v['skulls'] / v['cells']:.1f}  rounds {sum(r) / n:4.1f} p90 {r[int(.9 * n)]} >20 {sum(x > 20 for x in r) / n:.1%}")
