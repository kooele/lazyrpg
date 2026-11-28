# Which law of numbers fits the battles best? Each candidate turns a cell's ranged and melee values (meta.ts) into a
# log power ratio; a logistic win curve is fitted to each, and they are compared by log-likelihood (higher is better)
# and calibration by enemy count.   python3 tools/balance/fitlaws.py <report> [...]
import json, math, os, sys
here = os.path.dirname(os.path.abspath(__file__))
cells = []
for name in sys.argv[1:]:
    d = json.load(open(f'{here}/out/{name}.json'))
    for s, runs in zip(d['summary'], d['runs']):
        cells.append((s, [r.get('score', 1 if r['win'] else 0) for r in runs]))
sig = lambda z: 1 / (1 + math.exp(-max(-50, min(50, z))))
eps = 1e-9
def side(s, k, law):
    V, N = s['v' + k], s['n' + k]
    Vr, Vm, Nr, Nm = s['v' + k + 'r'], s['v' + k + 'm'], s['n' + k + 'r'], s['n' + k + 'm']
    if law == 'square': return 2 * math.log(V + eps)                      # (sum v)^2
    if law == 'linear': return math.log(V * V / max(N, eps) + eps)          # N x mean(v)^2
    if law.startswith('alpha'):                                             # N^a x mean(v)^2
        a = float(law[5:]); return math.log(N ** a * (V / max(N, eps)) ** 2 + eps)
    if law.startswith('crowd'):                                             # square law, numbers saturating at ~c
        c = float(law[5:]); ne = N / (1 + N / c); return math.log(ne * ne * (V / max(N, eps)) ** 2 + eps)
    if law == 'ranged-square': return math.log(Vr * Vr + Vm * Vm / max(Nm, eps) + eps)   # ranged square, melee linear, added
    if law == 'ranged-blend': return 2 * math.log(Vr + Vm / math.sqrt(max(Nm, eps)) + eps)  # in value space
    raise ValueError(law)
def fit(xs):
    a, b = 0.0, 1.0
    for _ in range(200):
        ga = gb = haa = hab = hbb = 0
        for x, ys in xs:
            p = sig(a + b * x); q = p * (1 - p) + 1e-9; n = len(ys); w = sum(ys)
            ga += w - n * p; gb += (w - n * p) * x; haa += n * q; hab += n * q * x; hbb += n * q * x * x
        det = haa * hbb - hab * hab
        if abs(det) < 1e-12: break
        da = (hbb * ga - hab * gb) / det; db = (haa * gb - hab * ga) / det
        a += da; b += db
        if abs(da) + abs(db) < 1e-10: break
    ll = sum(sum(math.log(max(1e-12, sig(a + b * x))) if y else math.log(max(1e-12, 1 - sig(a + b * x))) for y in ys) for x, ys in xs)
    return a, b, ll
laws = ['square', 'linear', 'alpha1.25', 'alpha1.5', 'alpha1.75', 'ranged-square', 'ranged-blend', 'crowd8', 'crowd12', 'crowd20', 'crowd40']
res = {}
for law in laws:
    xs = [(side(s, 'P', law) - side(s, 'Q', law), ys) for s, ys in cells]
    a, b, ll = fit(xs)
    res[law] = (a, b, ll, xs)
best = max(res, key=lambda k: res[k][2])
print(f'{sum(len(ys) for _, ys in cells)} battles, {len(cells)} cells')
for law in laws:
    a, b, ll, xs = res[law]
    # calibration by enemy count, close-ish fights
    bins = {}
    for (s, ys), (x, _) in zip(cells, xs):
        p = sig(a + b * x); n = s['nQ']; k = '1-6' if n <= 6 else '7-12' if n <= 12 else '13-24'
        g = bins.setdefault(k, [0, 0, 0]); g[0] += len(ys); g[1] += sum(ys); g[2] += p * len(ys)
    cal = '  '.join(f'{k}: {v[1] / v[0]:.2f} vs {v[2] / v[0]:.2f}' for k, v in sorted(bins.items()))
    print(f'{law:14} log-lik {ll:9.1f}{"  <- best" if law == best else ""}   by enemies (battles vs model): {cal}')
json.dump({law: {'a': res[law][0], 'b': res[law][1], 'll': res[law][2]} for law in laws}, open(f'{here}/out/laws.json', 'w'), indent=1)
