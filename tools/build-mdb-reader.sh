#!/usr/bin/env bash
# Builds vendor/mdb-reader.min.js (+ vendor/LICENSE-mdb-reader.txt) from the npm package mdb-reader (MIT) with esbuild.
#   - the encryption libraries (browserify-aes, create-hash) are replaced by tools/mdb-reader/stub-*.js: password-protected
#     Access databases are not supported (they are refused with a clear message), and the bundle stays small;
#   - Node's Buffer, which mdb-reader needs, comes from the "buffer" package.
# The committed vendor/mdb-reader.min.js is the reference. Run:  bash tools/build-mdb-reader.sh   (needs node and npm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
cd "$W"
npm init -y >/dev/null
npm i -s --save-exact mdb-reader@3.2.0 esbuild@0.24.0 buffer@6.0.3 >/dev/null
cp "$ROOT"/tools/mdb-reader/*.js .     # the shim imports "buffer": it must sit next to node_modules
npx esbuild node_modules/mdb-reader/lib/browser/index.js --bundle --format=iife --global-name=MDBReaderLib --minify --platform=browser \
  --legal-comments=none --alias:browserify-aes/browser.js=./stub-aes.js --alias:create-hash=./stub-hash.js \
  --inject:./buffer-shim.js --define:global=globalThis --metafile=meta.json --outfile="$ROOT/vendor/mdb-reader.min.js"
node - "$ROOT" <<'JS'
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const meta = JSON.parse(fs.readFileSync('meta.json', 'utf8'));
const names = new Set();
for (const p of Object.keys(Object.values(meta.outputs)[0].inputs)) { const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(p); if (m) names.add(m[1]); }
let out = 'Licenses of the packages bundled in vendor/mdb-reader.min.js (built by tools/build-mdb-reader.sh).\n' +
  'Every one is permissive and compatible with GPL-3.0-or-later. The encryption libraries of mdb-reader are NOT included.\n';
for (const n of [...names].sort()) {
  const dir = path.join('node_modules', n), pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  out += '\n' + '='.repeat(78) + '\n' + n + ' ' + pkg.version + ' (' + pkg.license + ')\n' + '='.repeat(78) + '\n';
  out += lic ? fs.readFileSync(path.join(dir, lic), 'utf8').trim() + '\n' : 'This package ships no license file; its package.json declares the license "' + pkg.license + '".\n';
}
fs.writeFileSync(path.join(root, 'vendor', 'LICENSE-mdb-reader.txt'), out);
console.log([...names].sort().join(' '));
JS
rm -rf "$W"
ls -la "$ROOT/vendor/mdb-reader.min.js" "$ROOT/vendor/LICENSE-mdb-reader.txt" | awk '{print $5, $9}'
