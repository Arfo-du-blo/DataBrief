#!/usr/bin/env bash
# Tests the ESP32 / Arduino files (deploy/esp32):
#   - make_header.py and make_header.ps1 (via build.ps1, and directly when pwsh is installed) produce a header that decompresses to
#     databrief.html without its PDF reader (the ESP32 page), the same page byte for byte; with --with-pdf, databrief.html exactly
#   - the sketch compiles with PlatformIO for the three boards of platformio.ini, if PlatformIO is installed in
#     $DATABRIEF_ESP_TESTENV (default ~/databrief-esp-testenv: python3 -m venv venv && venv/bin/pip install platformio)
# A real board cannot be tested here: flashing and Wi-Fi are checked by hand (docs/esp32-arduino.md).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
E="${DATABRIEF_ESP_TESTENV:-$HOME/databrief-esp-testenv}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok()  { echo "PASS $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $1  —  $2"; FAIL=$((FAIL + 1)); }

# The header holds the gzip bytes as "0x1f,0x8b,..."; decompress them and compare with the page.
decodes_to_page() {
  python3 - "$1" "$2" <<'EOF'
import gzip, hashlib, re, sys
text = open(sys.argv[1], encoding="utf-8").read()
page = open(sys.argv[2], "rb").read()
body = text.split("PROGMEM = {", 1)[1].split("};", 1)[0]
data = bytes(int(h, 16) for h in re.findall(r"0x([0-9a-f]{2})", body))
length = int(re.search(r"DATABRIEF_HTML_GZ_LEN = (\d+);", text).group(1))
sha = re.search(r'DATABRIEF_HTML_SHA256\[\] = "([0-9a-f]{64})"', text).group(1)
assert len(data) == length, "length %d != %d" % (len(data), length)
assert gzip.decompress(data) == page, "content differs"
assert sha == hashlib.sha256(page).hexdigest(), "SHA-256 differs"
print("%d bytes -> %d compressed" % (len(page), len(data)))
EOF
}

cp -r "$ROOT/deploy/esp32" "$T/esp32"
rm -f "$T/esp32/DataBrief/databrief_html.h"
# The ESP32 page is databrief.html without its PDF reader (pdf.js between the "DataBrief: PDF reader" markers)
if python3 "$T/esp32/make_header.py" "$ROOT/databrief.html" --page-out "$T/page.html" > "$T/py.txt" 2>&1 && r="$(decodes_to_page "$T/esp32/DataBrief/databrief_html.h" "$T/page.html" 2>&1)"; then
  ok "make_header.py: header decompresses to the page without the PDF reader ($r)"
else bad "make_header.py" "$(cat "$T/py.txt") $r"; fi
if ! grep -q 'GlobalWorkerOptions' "$T/page.html" && grep -q 'GlobalWorkerOptions' "$ROOT/databrief.html" && [ "$(stat -c %s "$T/page.html")" -lt "$(( $(stat -c %s "$ROOT/databrief.html") - 1500000 ))" ]; then
  ok "the ESP32 page has no PDF reader (databrief.html has one): $(stat -c %s "$T/page.html") bytes instead of $(stat -c %s "$ROOT/databrief.html")"
else bad "PDF reader left out" "the ESP32 page still holds pdf.js, or databrief.html has none"; fi
# the PowerShell twin must give the same page byte for byte (run here when PowerShell 7 is installed, as on CI runners)
if command -v pwsh > /dev/null 2>&1; then
  if pwsh -NoProfile -File "$T/esp32/make_header.ps1" -Html "$ROOT/databrief.html" -Out "$T/ps.h" -PageOut "$T/ps.html" > "$T/ps.txt" 2>&1 && cmp -s "$T/ps.html" "$T/page.html"; then
    ok "make_header.ps1 and make_header.py give the same ESP32 page"
  else bad "make_header.ps1 vs make_header.py" "$(cat "$T/ps.txt" | tail -3) (pages differ or PowerShell failed)"; fi
else echo "SKIP make_header.ps1 vs .py: no pwsh"; fi
python3 "$T/esp32/make_header.py" "$ROOT/databrief.html" --with-pdf > /dev/null 2>&1
if r="$(decodes_to_page "$T/esp32/DataBrief/databrief_html.h" "$ROOT/databrief.html" 2>&1)"; then ok "make_header.py --with-pdf: header decompresses to databrief.html exactly ($r)"
else bad "make_header.py --with-pdf" "$r"; fi

if [ -f "$ROOT/deploy/esp32/DataBrief/databrief_html.h" ]; then
  if r="$(decodes_to_page "$ROOT/deploy/esp32/DataBrief/databrief_html.h" "$T/page.html" 2>&1)"; then
    ok "make_header.ps1 (from build.ps1): header decompresses to the same page without the PDF reader ($r)"
  else bad "make_header.ps1 (from build.ps1)" "$r (run build.ps1 again?)"; fi
else echo "SKIP make_header.ps1: run build.ps1 first"; fi

if [ -x "$E/venv/bin/pio" ]; then
  for env in esp32dev esp32-s3 arduino_nano_esp32; do
    if (cd "$T/esp32" && DATABRIEF_HTML="$ROOT/databrief.html" PLATFORMIO_CORE_DIR="$E/pio-core" PLATFORMIO_BUILD_DIR="$T/build" "$E/venv/bin/pio" run -e "$env" > "$T/$env.log" 2>&1); then
      ok "PlatformIO build $env ($(grep -o 'Flash: .*' "$T/$env.log" | sed 's/\[[=  ]*\] *//'))"
    else bad "PlatformIO build $env" "$(tail -20 "$T/$env.log")"; fi
  done
else echo "SKIP PlatformIO builds: no PlatformIO in $E"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
