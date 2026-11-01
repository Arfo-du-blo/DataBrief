#!/usr/bin/env bash
# Runs the DataBrief test suite inside an isolated environment (WSL/Linux).
# Expects the environment created by tests/setup_testenv.sh (default: ~/databrief-testenv).
set -euo pipefail
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$E/node/bin:$PATH" PUPPETEER_CACHE_DIR="$E/puppeteer-cache" NODE_PATH="$E/js/node_modules"
"$E/venv/bin/python" "$HERE/make_fixtures.py" "$E/fixtures"
node "$HERE/run_tests.cjs" "$HERE/../databrief.html" "$E/fixtures" "$E/out"
echo
echo "=== Privacy demo (tampered copies)"
node "$HERE/test_privacy_demo.cjs" "$HERE/.." "$E/venv/bin/python" "$E/fixtures/ventes.csv"
# Second engine: Firefox (skipped when it is not installed)
if [ -d "$E/puppeteer-cache/firefox" ]; then
  echo; echo "=== Firefox"
  node "$HERE/test_firefox.cjs" "$HERE/../databrief.html" "$E/fixtures"
else
  echo; echo "SKIP Firefox: not installed (npx puppeteer browsers install firefox)"
fi
