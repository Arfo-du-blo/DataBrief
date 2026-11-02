#!/usr/bin/env bash
# Builds vendor/xmldom.min.js (+ vendor/LICENSE-xmldom.txt) from the npm package @xmldom/xmldom (MIT): the XML DOMParser of
# the command-line tool (Node has none). The page does not use it: browsers have their own. esbuild bundles it as a classic
# script that sets window.xmldom, loaded into the tool's sealed realm by cli/realm.cjs.
# The committed vendor/xmldom.min.js is the reference. Run:  bash tools/build-xmldom.sh   (needs node and npm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
cd "$W"
npm init -y >/dev/null
npm i -s --save-exact @xmldom/xmldom@0.9.12 esbuild@0.24.0 >/dev/null
echo "export { DOMParser } from '@xmldom/xmldom';" > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=xmldom --minify --platform=browser --target=es2018 \
  --legal-comments=none --outfile=out.js
{ echo "/* @xmldom/xmldom 0.9.12 (MIT) - https://github.com/xmldom/xmldom - bundled by tools/build-xmldom.sh (command-line tool only) */"
  cat out.js; } > "$ROOT/vendor/xmldom.min.js"
cp node_modules/@xmldom/xmldom/LICENSE "$ROOT/vendor/LICENSE-xmldom.txt"
cd / && rm -rf "$W"
ls -la "$ROOT/vendor/xmldom.min.js" "$ROOT/vendor/LICENSE-xmldom.txt" | awk '{print $5, $9}'
