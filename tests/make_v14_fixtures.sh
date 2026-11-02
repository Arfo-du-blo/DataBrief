#!/usr/bin/env bash
# Regenerates tests/v14-fixtures/: REAL files for the v1.4 formats, written by the tools people use (never by DataBrief, never by
# hand), plus one canary file per format (CONFIDENTIAL_ markers, see tests/v14-fixtures/make_sources.py).
#   1. Python (python:3.12-slim + pip): fastavro (Avro, 4 codecs), pyarrow (Arrow IPC file and stream, Feather v1 and v2),
#      python-docx (.docx), python-pptx (.pptx), a notebook EXECUTED by a real Jupyter kernel (nbclient + ipykernel + pandas)
#   2. LibreOffice (headless, Debian): .docx -> .odt and .pdf, .pptx -> .odp and .pdf, and LibreOffice's own .docx / .pptx
#      (a second writer of each format)
#   3. GDAL (ghcr.io/osgeo/gdal): GeoJSON, and a GeoPackage with several layers (points, lines, polygons, a CRS that is not
#      WGS 84, a table without geometry)
#   4. Chrome (the test environment's Puppeteer): a PDF printed from an HTML table (a second PDF producer)
# The results are committed, so the tests need neither Docker nor these tools. Needs Docker, internet, tests/setup_testenv.sh.
# Every container and every image pulled by this script is removed at the end; images you already had are left alone.
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tests/v14-fixtures"
export DOCKER_CONFIG="$(mktemp -d)"; echo '{}' > "$DOCKER_CONFIG/config.json"
BEFORE="$(docker images -q | sort -u)"
cleanup() {
  docker ps -aq --filter "name=db-v14fix-" | xargs -r docker rm -f >/dev/null 2>&1
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$DOCKER_CONFIG"
}
trap cleanup EXIT
FAILED=0
note() { echo "== $*"; }
fail() { echo "FAIL $*" >&2; FAILED=$((FAILED + 1)); }
U="$(id -u):$(id -g)"

rm -rf "$OUT"/{arrow-fixtures,doc-fixtures,ipynb-fixtures,geo-fixtures,geo-src,canary} "$OUT/VERSIONS.txt" "$OUT/.python-versions.txt"

note "Python libraries (Avro, Arrow, Feather, docx, pptx, executed notebook)"
docker run --rm --name db-v14fix-py -v "$OUT:/work" python:3.12-slim sh -c '
  set -e
  pip install -q --root-user-action=ignore --disable-pip-version-check fastavro cramjam backports.zstd pyarrow python-docx python-pptx \
      nbformat nbclient ipykernel pandas >/dev/null
  python -m ipykernel install --user >/dev/null
  python /work/make_sources.py /work
  chown -R '"$U"' /work
' || fail "python step"

note "LibreOffice (OpenDocument, PDF, LibreOffice-written docx / pptx)"
docker run --rm --name db-v14fix-lo -v "$OUT:/work" debian:stable-slim sh -c '
  set -e
  apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      libreoffice-writer-nogui libreoffice-impress-nogui fonts-dejavu-core >/dev/null 2>&1
  export HOME=/tmp
  so() { soffice --headless --norestore --convert-to "$1" --outdir "$2" "$3" >/dev/null 2>&1; }
  cd /work/doc-fixtures
  so odt . report.docx && so pdf . report.docx && so odp . deck.pptx && so pdf . deck.pptx
  mkdir -p /tmp/lo && so docx:"MS Word 2007 XML" /tmp/lo report.odt && mv /tmp/lo/report.docx report-libreoffice.docx
  so pptx:"Impress MS PowerPoint 2007 XML" /tmp/lo deck.odp && mv /tmp/lo/deck.pptx deck-libreoffice.pptx
  cd /work/canary
  for f in CONFIDENTIAL_FILE_docx.docx CONFIDENTIAL_FILE_pptx.pptx; do so pdf /tmp/lo "$f"; done
  so odt /tmp/lo CONFIDENTIAL_FILE_docx.docx && so odp /tmp/lo CONFIDENTIAL_FILE_pptx.pptx
  mv /tmp/lo/CONFIDENTIAL_FILE_docx.pdf CONFIDENTIAL_FILE_pdf.pdf
  mv /tmp/lo/CONFIDENTIAL_FILE_pptx.pdf CONFIDENTIAL_FILE_pdfslides.pdf
  mv /tmp/lo/CONFIDENTIAL_FILE_docx.odt CONFIDENTIAL_FILE_odt.odt
  mv /tmp/lo/CONFIDENTIAL_FILE_pptx.odp CONFIDENTIAL_FILE_odp.odp
  soffice --version | head -1 > /work/.lo-version
  chown -R '"$U"' /work
' || fail "libreoffice step"

note "GDAL (GeoJSON, GeoPackage)"
docker run --rm --name db-v14fix-gdal -v "$OUT:/work" ghcr.io/osgeo/gdal:ubuntu-small-3.13.3 sh -c '
  set -e
  mkdir -p /work/geo-fixtures && cd /work/geo-fixtures
  src=/work/geo-src
  oo="-oo GEOM_POSSIBLE_NAMES=wkt -oo KEEP_GEOM_COLUMNS=NO -oo AUTODETECT_TYPE=YES"
  ogr2ogr -f GeoJSON places.geojson $src/places.csv $oo -a_srs EPSG:4326 -nln places
  ogr2ogr -f GPKG city.gpkg $src/places.csv $oo -a_srs EPSG:4326 -nln places
  ogr2ogr -f GPKG -update city.gpkg $src/places.csv $oo -s_srs EPSG:4326 -t_srs EPSG:2154 -nln places_lambert93
  ogr2ogr -f GPKG -update city.gpkg $src/places.csv -oo AUTODETECT_TYPE=YES -nln attributes_only -select id,name,category -nlt NONE
  ogr2ogr -f GeoJSON /work/canary/CONFIDENTIAL_FILE_geojson.geojson $src/CONFIDENTIAL_COL_LAYER.csv $oo -a_srs EPSG:4326
  ogr2ogr -f GPKG /work/canary/CONFIDENTIAL_FILE_gpkg.gpkg $src/CONFIDENTIAL_COL_LAYER.csv $oo -a_srs EPSG:4326
  ogrinfo --version > /work/.gdal-version
  chown -R '"$U"' /work
' || fail "gdal step"
rm -rf "$OUT/geo-src"

note "Chrome (a PDF printed from an HTML table)"
cd "$ROOT" && PATH="$E/node/bin:$PATH" PUPPETEER_CACHE_DIR="$E/puppeteer-cache" NODE_PATH="$E/js/node_modules" node - "$OUT" <<'EOF' || fail "chrome step"
const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const out = process.argv[2];
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const table = (head, rows) => '<table border="1"><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((v) => '<td>' + v + '</td>').join('') + '</tr>').join('') + '</table>';
  await page.setContent('<h1>Orders</h1><p>Printed by Chrome.</p>' + table(['id', 'customer_id', 'total', 'status'],
    [[10, 1, '19.90', 'paid'], [11, 1, '5.00', 'refunded'], [12, 2, '120.00', 'paid'], [13, 4, '42.42', 'pending']]));
  await page.pdf({ path: path.join(out, 'doc-fixtures', 'orders-chrome.pdf'), format: 'A4' });
  require('fs').writeFileSync(path.join(out, '.chrome-version'), await browser.version());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
EOF

{ echo "Real files in this folder were written by these tools (see tests/make_v14_fixtures.sh), NOT by DataBrief and NOT by hand."
  echo "Generated: $(date -u +%Y-%m-%d)"; echo
  cat "$OUT/.python-versions.txt" 2>/dev/null
  echo "LibreOffice: $(cat "$OUT/.lo-version" 2>/dev/null)"
  echo "GDAL: $(cat "$OUT/.gdal-version" 2>/dev/null)"
  echo "Chrome: $(cat "$OUT/.chrome-version" 2>/dev/null) (Puppeteer of the test environment)"; } > "$OUT/VERSIONS.txt"
rm -f "$OUT/.python-versions.txt" "$OUT/.lo-version" "$OUT/.gdal-version" "$OUT/.chrome-version"
echo
(cd "$OUT" && find . -type f ! -name '*.py' ! -name VERSIONS.txt ! -name expected.json | sort | xargs ls -l | awk '{print $5, $9}')
du -sh "$OUT" | cut -f1 | sed 's/^/total size: /'
[ "$FAILED" -eq 0 ] && echo "all v1.4 fixtures generated" || echo "$FAILED step(s) failed"
exit $FAILED
