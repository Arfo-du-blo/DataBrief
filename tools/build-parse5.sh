#!/usr/bin/env bash
# Builds vendor/parse5.min.js (+ vendor/LICENSE-parse5.txt) from the npm package parse5 (MIT): the WHATWG HTML parser of the
# command-line tool. It builds the same tree as a browser (the same algorithm), so the page's HTML table reader gives the
# same tables in Node; cli/dom-shim.js gives that tree the few DOM features the reader uses. The page does not use it.
# esbuild bundles it as a classic script that sets window.parse5, loaded into the tool's sealed realm by cli/realm.cjs.
# The committed vendor/parse5.min.js is the reference. Run:  bash tools/build-parse5.sh   (needs node and npm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
cd "$W"
npm init -y >/dev/null
npm i -s --save-exact parse5@8.1.0 esbuild@0.24.0 >/dev/null
echo "export { parse } from 'parse5';" > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=parse5 --minify --platform=browser --target=es2018 \
  --legal-comments=none --outfile=out.js
{ echo "/* parse5 8.1.0 (MIT) - https://github.com/inikulin/parse5 - bundled by tools/build-parse5.sh (command-line tool only) */"
  cat out.js; } > "$ROOT/vendor/parse5.min.js"
cp node_modules/parse5/LICENSE "$ROOT/vendor/LICENSE-parse5.txt"
cd / && rm -rf "$W"
ls -la "$ROOT/vendor/parse5.min.js" "$ROOT/vendor/LICENSE-parse5.txt" | awk '{print $5, $9}'
