#!/usr/bin/env bash
# Runs the DataBrief test suite inside an isolated environment (WSL/Linux).
# Expects the environment created by tests/setup_testenv.sh (default: ~/databrief-testenv).
set -euo pipefail
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$E/node/bin:$PATH" PUPPETEER_CACHE_DIR="$E/puppeteer-cache" NODE_PATH="$E/js/node_modules"
"$E/venv/bin/python" "$HERE/make_fixtures.py" "$E/fixtures"
node "$HERE/run_tests.cjs" "$HERE/../databrief.html" "$E/fixtures" "$E/out"
