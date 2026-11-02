#!/usr/bin/env bash
# Builds vendor/flechette.min.js (+ vendor/LICENSE-flechette.txt) from the npm package @uwdata/flechette (BSD-3-Clause), the
# Apache Arrow IPC reader used for .arrow, .arrows and Feather v2 files. esbuild bundles it as a classic script that sets
# window.flechette (no eval, no worker: it runs under the page's security policy). The compression codecs (LZ4, Zstandard)
# are registered by the page (src/arrow.js) with the decoders it already has.
# The committed vendor/flechette.min.js is the reference. Run:  bash tools/build-flechette.sh   (needs node and npm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
cd "$W"
npm init -y >/dev/null
npm i -s --save-exact @uwdata/flechette@2.7.1 esbuild@0.24.0 >/dev/null
# One change to the source (a damaged file must not make the page allocate gigabytes): a FlatBuffers vector whose stored
# length does not fit in the bytes left is refused, instead of becoming Array.from({ length: 2 billion }).
node - <<'JS'
const fs = require('fs');
const f = 'node_modules/@uwdata/flechette/src/util/read.js';
const src = fs.readFileSync(f, 'utf8');
const from = '{ length: readInt32(buf, base) }';
if (!src.includes(from)) { console.error('build-flechette: readVector changed upstream, check the patch'); process.exit(1); }
fs.writeFileSync(f, src.replace(from, '{ length: checkedLength(buf, base, stride) }') + `
/* DataBrief: a vector length must fit in the buffer (a damaged or hostile file) */
function checkedLength(buf, base, stride) {
  const n = readInt32(buf, base);
  if (n < 0 || base + 4 + n * Math.max(stride, 1) > buf.length) throw new Error('Invalid vector length ' + n);
  return n;
}
`);
JS
echo "export * from '@uwdata/flechette';" > entry.js
npx esbuild entry.js --bundle --format=iife --global-name=flechette --minify --platform=browser --target=es2020 \
  --legal-comments=none --outfile=out.js
{ echo "/* @uwdata/flechette 2.7.1 (BSD-3-Clause) - https://github.com/uwdata/flechette - bundled by tools/build-flechette.sh (one bounds check added, see there) */"
  cat out.js; } > "$ROOT/vendor/flechette.min.js"
cp node_modules/@uwdata/flechette/LICENSE "$ROOT/vendor/LICENSE-flechette.txt"
cd / && rm -rf "$W"
ls -la "$ROOT/vendor/flechette.min.js" "$ROOT/vendor/LICENSE-flechette.txt" | awk '{print $5, $9}'
