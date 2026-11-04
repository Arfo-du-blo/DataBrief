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
echo "=== Packages of the command line: npm package (packed, installed, run), Homebrew formula, Scoop manifest, .deb, release workflow"
node "$HERE/test_packages.cjs" | grep -v '^PASS'
echo
echo "=== Hosted MCP server (Node: protocol, tool, widget resource, limits, nothing but method names in the log)"
node "$HERE/test_mcp.cjs" | grep -v '^ok'
echo
echo "=== Widget layer (Node: the texts in 15 languages, the build, no network call in the layer)"
node "$HERE/test_widget.cjs" | grep -v '^ok'
echo
echo "=== Claude Desktop extension (.mcpb: reproducible build, contents, the server run over stdio, same prompt as the command-line tool)"
node "$HERE/test_mcpb.cjs" | grep -v '^ok'
echo
echo "=== databrief --mcp (the command-line tool as an MCP server: --root, Do not share data, no subprocess)"
node "$HERE/test_cli_mcp.cjs" | grep -v '^ok'
echo
echo "=== Claude plugin (skill + connector + command: layout, manifest, .mcp.json, the bundled tool run from the plugin)"
node "$HERE/test_plugin.cjs" | grep -v '^ok'
echo
echo "=== Terminal pack (skill and snippet: reproducible build, every option exists, the documented commands run in both modes)"
node "$HERE/test_agents.cjs" | grep -v '^ok'
echo
echo "=== Widget layer in Chrome, inside fake hosts (Claude, ChatGPT, an unknown app, a silent one)"
node "$HERE/test_widget_browser.cjs" | grep -v '^ok'
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
