#!/usr/bin/env bash
# Isolated test environment for DataBrief. Everything lives in ~/databrief-testenv.
# Remove it all with:  rm -rf ~/databrief-testenv
set -e
E="$HOME/databrief-testenv"
mkdir -p "$E" && cd "$E"
if [ ! -d node ]; then
  curl -sfL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ
  mv node-v22.11.0-linux-x64 node
fi
export PATH="$E/node/bin:$PATH" PUPPETEER_CACHE_DIR="$E/puppeteer-cache" npm_config_cache="$E/npm-cache"
mkdir -p js && cd js
[ -f package.json ] || npm init -y >/dev/null
npm i -s puppeteer@23.9.0 xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz sql.js@1.14.2 >/dev/null 2>&1
# Firefox too (tests/test_firefox.cjs): the page is also checked in a second engine
npx puppeteer browsers install firefox > /dev/null 2>&1 || echo "Firefox not installed: its tests will be skipped"
echo "node packages ok"
cd "$E"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip -q install --cache-dir "$E/pip-cache" pyreadstat==1.2.8 pandas==2.2.3 pyarrow==18.1.0 openpyxl==3.1.5 pyyaml==6.0.2 duckdb==1.5.6
echo "python ok"
du -sh "$E"
