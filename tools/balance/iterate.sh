#!/usr/bin/env bash
# Converge enemy stats on par and battle length: simulate each type alone, fit (fitfac.py), rescale (rebalance.sim.ts).
#   tools/balance/iterate.sh <first iteration number> <iterations> [seeds]
set -euo pipefail
cd "$(dirname "$0")/../.."
start=$1; n=$2; seeds=${3:-24}
for ((i = start; i < start + n; i++)); do
  npm run balance --silent -- --name "iter$i" --plan types --seeds "$seeds" > "tools/balance/out/iter$i.txt"
  python3 tools/balance/fitfac.py "iter$i" > "tools/balance/out/iter$i.fit.txt"
  cp tools/balance/out/fit.json "tools/balance/out/iter$i.fit.json"
  BALANCE_FIT=tools/balance/out/fit.json npx vitest run --config tools/balance/vitest.config.ts tools/balance/rebalance.sim.ts 2>&1 | grep ' x' > "tools/balance/out/iter$i.rebalance.txt"
  echo "iteration $i done: $(head -1 tools/balance/out/iter$i.fit.txt)"
done
