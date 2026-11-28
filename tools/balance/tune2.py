# Tune by skulls (model only): find the skull anchors (skulls.sim.ts), write them to guild.json strength.skulls, turn
# the win rate wanted by skulls (WANT) into per-level targets for the usual quest (targets.json), rescale
# (rebalance.sim.ts), repeat.   python3 tools/balance/tune2.py [steps]
import json, os, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(os.path.dirname(here))
# Wanted AI win rate for the party of a quest's level, by its skulls (half a skull "around 100%": 97%).
WANT = [(0.5, 0.97), (1, 0.75), (5, 0.5), (10, 0.25)]
def through(pts, x):
    i = 1
    while i < len(pts) - 1 and x > pts[i][0]: i += 1
    (x0, y0), (x1, y1) = pts[i - 1], pts[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
vt = ['npx', 'vitest', 'run', '--config', 'tools/balance/vitest.config.ts']
gpath = f'{root}/src/data/guild.json'
for step in range(int(sys.argv[1]) if len(sys.argv) > 1 else 4):
    subprocess.run(vt + ['tools/balance/skulls.sim.ts'], cwd=root, check=True, capture_output=True)
    k = json.load(open(f'{here}/out/skulls.json'))
    knots = [[round(k['half']['par'], 2), 0.5], [round(k['one']['par'], 2), 1], [round(k['ten']['par'], 2), 10]]
    g = open(gpath).read()
    g = re.sub(r'"skulls": \[\[.*?\]\]', '"skulls": ' + json.dumps(knots), g)
    open(gpath, 'w').write(g)
    targets = []
    for u in k['usual']:
        s = max(0.5, min(10, through(knots, u['par'])))
        targets.append([u['level'], round(max(0.05, min(0.97, through(WANT, s))), 3)])
    json.dump({'_comment': 'Win rate wanted for the AI-played reference party against the usual quest of each level (from tune2.py: WANT by the quest skulls).', 'targets': targets}, open(f'{here}/targets.json', 'w'), indent=1)
    curve = json.load(open(gpath))['strength']['winCurve']
    json.dump({'a': curve['a'], 'b': curve['b'], 'par': 0, 'factors': {}}, open(f'{here}/out/tune.fit.json', 'w'))
    env = {**os.environ, 'BALANCE_FIT': f'{here}/out/tune.fit.json', 'BALANCE_GAIN': '1'}
    subprocess.run(vt + ['tools/balance/rebalance.sim.ts'], cwd=root, env=env, check=True, capture_output=True)
    print(f'step {step}: skulls {knots}; targets ' + ' '.join(f'L{l}:{t:.2f}' for l, t in targets[::3]), flush=True)
