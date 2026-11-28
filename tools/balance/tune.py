# Tune the rebalance targets (model only, no battles) so each rank's average board quest hits its goal for the
# AI-played reference party: rescale (rebalance.sim.ts, keeping tempo and power factors), measure (boardavg.sim.ts),
# move each rank's target in logit space by the miss, repeat.
#   python3 tools/balance/tune.py [steps]
import json, math, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(os.path.dirname(here))
GOALS = {'D': 0.5, 'C': 0.4, 'B': 0.33, 'A': 0.33, 'S': 0.33}
MIDS = {'D': 3, 'C': 8, 'B': 13, 'A': 18, 'S': 23}
guild = json.load(open(f'{root}/src/data/guild.json'))['strength']['winCurve']
fit = {'a': guild['a'], 'b': guild['b'], 'par': 0, 'factors': {}}
json.dump(fit, open(f'{here}/out/tune.fit.json', 'w'))
tpath = f'{here}/out/tune.targets.json'
targets = json.load(open(tpath)) if os.path.exists(tpath) else dict(GOALS)
logit = lambda p: math.log(p / (1 - p)); sig = lambda z: 1 / (1 + math.exp(-z))
vt = ['npx', 'vitest', 'run', '--config', 'tools/balance/vitest.config.ts']
for step in range(int(sys.argv[1]) if len(sys.argv) > 1 else 6):
    knots = [[MIDS[r], targets[r]] for r in ['D', 'C', 'B', 'A', 'S']]
    env = {**os.environ, 'BALANCE_FIT': f'{here}/out/tune.fit.json', 'BALANCE_TARGETS': json.dumps(knots), 'BALANCE_GAIN': '1'}
    subprocess.run(vt + ['tools/balance/rebalance.sim.ts'], cwd=root, env=env, check=True, capture_output=True)
    subprocess.run(vt + ['tools/balance/boardavg.sim.ts'], cwd=root, check=True, capture_output=True)
    avg = json.load(open(f'{here}/out/boardavg.json'))
    print(f'step {step}: ' + '  '.join(f'{r} {avg[r]:.2f} (target {targets[r]:.2f})' for r in GOALS), flush=True)
    for r in GOALS: targets[r] = sig(logit(targets[r]) + (logit(GOALS[r]) - logit(avg[r])))
    json.dump(targets, open(tpath, 'w'))
print('targets', json.dumps({r: round(v, 3) for r, v in targets.items()}))
