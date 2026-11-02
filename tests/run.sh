#!/usr/bin/env bash
# Runs the DataBrief test suite inside an isolated environment (WSL/Linux).
# Expects the environment created by tests/setup_testenv.sh (default: ~/databrief-testenv).
set -euo pipefail
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$E/node/bin:$PATH" PUPPETEER_CACHE_DIR="$E/puppeteer-cache" NODE_PATH="$E/js/node_modules"
echo "=== SQL dump reader (Node, real dumps in tests/sql-fixtures)"
node "$HERE/test_sql_parser.cjs" | grep -v '^PASS'   # failures and the summary only; pipefail stops here on a failure
echo
echo "=== Access reader (Node, real files of tests/access-fixtures)"
node "$HERE/test_access.cjs" | grep -v "^PASS"
echo
echo "=== Geodata reader (Node, real files of tests/v14-fixtures written by GDAL)"
node "$HERE/test_geo.cjs" | grep -v '^PASS'
echo
echo "=== Notebook reader (Node, notebooks of tests/v14-fixtures executed by a real kernel)"
node "$HERE/test_notebook.cjs" | grep -v '^PASS'
echo
echo "=== DBF reader (Node, real files of tests/dbf-fixtures)"
node "$HERE/test_dbf.cjs" | grep -v '^PASS'
echo
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
