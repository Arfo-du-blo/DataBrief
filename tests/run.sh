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
echo "=== Avro and Arrow / Feather readers (Node, real files of tests/v14-fixtures written by fastavro and pyarrow)"
node "$HERE/test_columnar.cjs" | grep -v '^PASS'
echo
echo "=== Word / PowerPoint / OpenDocument reader (Node, real files of tests/v14-fixtures written by python-docx, python-pptx and LibreOffice)"
node "$HERE/test_office.cjs" | grep -v '^PASS'
echo
echo "=== PDF reader (Node, real PDFs of tests/v14-fixtures written by LibreOffice and Chrome)"
node "$HERE/test_pdf.cjs" | grep -v '^PASS\|^Warning'
echo
echo "=== Notebook reader (Node, notebooks of tests/v14-fixtures executed by a real kernel)"
node "$HERE/test_notebook.cjs" | grep -v '^PASS'
echo
echo "=== DBF reader (Node, real files of tests/dbf-fixtures)"
node "$HERE/test_dbf.cjs" | grep -v '^PASS'
echo
echo "=== Command-line tool core (Node: the page's reading code in a realm, src/core.js, cli/dom-shim.js)"
node "$HERE/test_core.cjs" | grep -v '^PASS'
echo
echo "=== Documentation: every link and anchor of the README and the docs"
node "$HERE/test_docs_links.cjs"
echo
echo "=== Command-line tool (Node: options, clipboard, files, --review, the one-file build, real processes on the test files)"
node "$HERE/test_cli.cjs" | grep -v '^PASS'
echo
"$E/venv/bin/python" "$HERE/make_fixtures.py" "$E/fixtures"
node "$HERE/run_tests.cjs" "$HERE/../databrief.html" "$E/fixtures" "$E/out"
echo
echo "=== Command-line tool against the page (Chrome): the same prompt for every file and setting"
node "$HERE/test_cli_parity.cjs" "$HERE/../databrief.html" "$E/fixtures" | grep -v '^PASS'
echo
echo "=== Command-line tool: Do not share data (canaries in every output), no network, hostile names, special files"
node "$HERE/test_cli_privacy.cjs" "$E/fixtures" | grep -v '^PASS'
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
