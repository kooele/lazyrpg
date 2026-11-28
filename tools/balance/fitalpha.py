# Fit how numbers count: P(win) = sigmoid(a + b ln R), R = (vP / vQ)^2 x (nP / nQ)^(alpha - 2), where v are the sides'
# summed values and n their fighter counts (alpha 2: Lanchester's square law; 1: the linear law).
#   python3 tools/balance/fitalpha.py <report> [...]
import json, math, sys
here = __file__.rsplit('/', 1)[0]
X = []
for name in sys.argv[1:]:
    d = json.load(open(f'{here}/out/{name}.json'))
    for s, runs in zip(d['summary'], d['runs']):
        x = math.log(s['vP'] / s['vQ']); y = math.log(s['nP'] / s['nQ'])
        for r in runs: X.append((x, y, 1 if r['win'] else 0))
sig = lambda z: 1 / (1 + math.exp(-max(-50, min(50, z))))
w = [0.0, 1.0, 0.0]
for _ in range(100):
    g = [0.0] * 3; H = [[0.0] * 3 for _ in range(3)]
    for x, y, t in X:
        f = (1, x, y); p = sig(w[0] + w[1] * x + w[2] * y); q = p * (1 - p) + 1e-9
        for i in range(3):
            g[i] += (t - p) * f[i]
            for j in range(3): H[i][j] += q * f[i] * f[j]
    # solve H d = g
    import copy
    A = copy.deepcopy(H); bvec = g[:]
    for i in range(3):
        piv = A[i][i]
        for j in range(i + 1, 3):
            m = A[j][i] / piv
            for k in range(3): A[j][k] -= m * A[i][k]
            bvec[j] -= m * bvec[i]
    dlt = [0.0] * 3
    for i in (2, 1, 0): dlt[i] = (bvec[i] - sum(A[i][k] * dlt[k] for k in range(i + 1, 3))) / A[i][i]
    w = [w[i] + dlt[i] for i in range(3)]
    if sum(abs(v) for v in dlt) < 1e-10: break
a, b1, b2 = w
b = b1 / 2; alpha = 2 + b2 / b
ll = lambda ws: sum(math.log(max(1e-12, sig(ws[0] + ws[1] * x + ws[2] * y) if t else 1 - sig(ws[0] + ws[1] * x + ws[2] * y))) for x, y, t in X)
print(f'{len(X)} battles: a {a:.3f} b {b:.3f} alpha {alpha:.3f}  (log-lik {ll(w):.1f}; square law refit below)')
# For comparison: alpha fixed at 2.
w2 = [0.0, 1.0]
for _ in range(100):
    ga = gb = haa = hab = hbb = 0
    for x, y, t in X:
        z = 2 * x; p = sig(w2[0] + w2[1] * z); q = p * (1 - p) + 1e-9
        ga += t - p; gb += (t - p) * z; haa += q; hab += q * z; hbb += q * z * z
    det = haa * hbb - hab * hab; da = (hbb * ga - hab * gb) / det; db = (haa * gb - hab * ga) / det
    w2 = [w2[0] + da, w2[1] + db]
    if abs(da) + abs(db) < 1e-10: break
print(f'square law: a {w2[0]:.3f} b {w2[1]:.3f} log-lik {ll([w2[0], 2 * w2[1], 0]):.1f}')
json.dump({'a': a, 'b': b, 'alpha': alpha}, open(f'{here}/out/alpha.json', 'w'))
