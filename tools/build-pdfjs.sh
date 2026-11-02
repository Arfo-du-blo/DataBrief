#!/usr/bin/env bash
# Builds vendor/pdfjs.min.js (+ vendor/LICENSE-pdfjs.txt) from the npm package pdfjs-dist (Apache-2.0), the PDF reader of the
# page. The LEGACY build is used: the modern one needs ES2025 features (Uint8Array.prototype.toHex) that many browsers still
# lack. Its worker code is bundled too and runs on the page's main thread (globalThis.pdfjsWorker): the page allows no
# worker and no eval (src/pdf.js calls getDocument with isEvalSupported: false and no URL of any kind).
# The committed vendor/pdfjs.min.js is the reference. Run:  bash tools/build-pdfjs.sh   (needs node and npm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
cd "$W"
npm init -y >/dev/null
npm i -s --save-exact pdfjs-dist@5.6.205 esbuild@0.24.0 >/dev/null
cat > entry.mjs <<'JS'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
globalThis.pdfjsWorker = pdfjsWorker;   // pdf.js then runs its "worker" on the main thread (no Worker, no import())
globalThis.pdfjsLib = pdfjsLib;
JS
npx esbuild entry.mjs --bundle --format=iife --minify --platform=browser --target=es2019 --legal-comments=none --outfile=out.js 2>&1 | tail -2
{ echo "/* pdf.js (pdfjs-dist 5.6.205, legacy build; Apache-2.0) - https://mozilla.github.io/pdf.js/ - bundled by tools/build-pdfjs.sh */"
  cat out.js; } > "$ROOT/vendor/pdfjs.min.js"
cp node_modules/pdfjs-dist/LICENSE "$ROOT/vendor/LICENSE-pdfjs.txt"
cd / && rm -rf "$W"
ls -la "$ROOT/vendor/pdfjs.min.js" "$ROOT/vendor/LICENSE-pdfjs.txt" | awk '{print $5, $9}'
