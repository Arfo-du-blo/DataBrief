#!/usr/bin/env bash
# Tests the Python and Node.js servers: settings priority (option > environment > databrief.conf > default),
# page settings written into the page, gzip, /healthz, 404, base path redirect, security headers, --setup.
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$E/node/bin:$PATH"
PY="$E/venv/bin/python"
T="$(mktemp -d)"
PASS=0; FAIL=0
ok()   { echo "PASS $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL $1  —  $2"; FAIL=$((FAIL + 1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1" "${3:-}"; fi; }

config_of() { "$PY" -c 'import re,sys,json; h=open(sys.argv[1],encoding="utf-8").read(); m=re.search(r"<script id=\"databrief-config\" type=\"application/json\">([\s\S]*?)</script>",h); print(json.dumps(json.loads(m.group(1)),sort_keys=True))' "$1"; }

server_tests() {
  local name="$1" port="$2"; shift 2
  mkdir -p "$T/$name" && cd "$T/$name"
  cat > databrief.conf <<'EOF'
# test configuration
DATABRIEF_LANG=de
DATABRIEF_MODE=files
DATABRIEF_PROMPT_INTRO="Line 1\nLine 2 <b>"
DATABRIEF_PORT=1
DATABRIEF_FRAME_ANCESTORS='self' https://example.sharepoint.com
EOF
  DATABRIEF_MODE=inline DATABRIEF_PORT= "$@" --html "$ROOT/databrief.html" --port "$port" --base-path /db/ --lock lang,edit --access-log false > server.log 2>&1 &
  local pid=$!
  for _ in $(seq 1 50); do curl -s "localhost:$port/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
  check "$name: /healthz" '[ "$(curl -s localhost:'"$port"'/healthz)" = "ok" ]' "$(cat server.log)"
  curl -s "localhost:$port/db/" -o page.html
  local cfg; cfg="$(config_of page.html)"
  check "$name: settings priority + page config" '[ "$cfg" = "{\"lang\": \"de\", \"lock\": [\"lang\", \"edit\"], \"promptIntro\": \"Line 1\\nLine 2 <b>\"}" ]' "$cfg"
  check "$name: \"<\" escaped in the config block" 'grep -q "Line 2 \\\\u003cb>" page.html'
  check "$name: page is the full tool" '[ "$(stat -c %s page.html)" -gt 2000000 ]'
  local gz; gz="$(curl -s -H 'Accept-Encoding: gzip' -D - -o gz.bin "localhost:$port/db/")"
  check "$name: gzip" 'echo "$gz" | grep -qi "content-encoding: gzip" && [ "$(stat -c %s gz.bin)" -lt 1500000 ] && gunzip -c gz.bin | cmp -s - page.html' "$gz"
  check "$name: security headers" 'echo "$gz" | grep -qi "content-security-policy: frame-ancestors '"'"'self'"'"' https://example.sharepoint.com" && echo "$gz" | grep -qi "x-content-type-options: nosniff"' "$gz"
  check "$name: base path redirect" '[ "$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "localhost:'"$port"'/db?lang=fr")" = "301 http://localhost:'"$port"'/db/?lang=fr" ]'
  check "$name: 404 elsewhere" '[ "$(curl -s -o /dev/null -w "%{http_code}" localhost:'"$port"'/etc/passwd)" = "404" ]'
  check "$name: /db/databrief.html" '[ "$(curl -s -o /dev/null -w "%{http_code}" localhost:'"$port"'/db/databrief.html)" = "200" ]'
  local cpids=(); for _ in $(seq 1 20); do curl -s -o /dev/null "localhost:$port/db/" & cpids+=($!); done; wait "${cpids[@]}"
  check "$name: 20 parallel requests" 'grep -qv "Error" server.log' "$(tail -5 server.log)"
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

  # invalid setting -> clear error, exit code 2
  "$@" --html "$ROOT/databrief.html" --mode bogus --check > err.txt 2>&1
  check "$name: invalid value rejected" '[ $? -eq 2 ] || grep -q "DATABRIEF_MODE" err.txt' "$(cat err.txt)"

  # interactive setup: answers on stdin (one invalid answer is asked again), saved to databrief.conf
  mkdir -p setup && cd setup
  printf 'fr\n\nbogus\nfiles\n\n\n\n\nlang\n\n9999\n\n\n\n\ny\n' | "$@" --setup --check --config "$PWD/databrief.conf" --html "$ROOT/databrief.html" > setup.txt 2>&1
  check "$name: --setup asks again after an invalid answer" 'grep -q "must be one of inline, files" setup.txt' "$(tail -20 setup.txt)"
  check "$name: --setup saves databrief.conf" 'grep -q "^DATABRIEF_LANG=fr$" databrief.conf && grep -q "^DATABRIEF_MODE=files$" databrief.conf && grep -q "^DATABRIEF_PORT=9999$" databrief.conf && grep -q "^DATABRIEF_LOCK=lang$" databrief.conf' "$(cat databrief.conf 2>/dev/null)"
  check "$name: --setup result used" 'grep -Eq "\"lang\": ?\"fr\"" setup.txt && grep -Eq "\"mode\": ?\"files\"" setup.txt' "$(tail -3 setup.txt)"
  cd "$T"
}

server_tests python 18080 "$PY" "$ROOT/deploy/python/serve.py"
server_tests node 18081 node "$ROOT/deploy/node/server.js"

# the shared databrief.conf is valid for both servers
check "databrief.conf (repository) is valid" '"$PY" "$ROOT/deploy/python/serve.py" --config "$ROOT/deploy/databrief.conf" --html "$ROOT/databrief.html" --check >/dev/null && node "$ROOT/deploy/node/server.js" --config "$ROOT/deploy/databrief.conf" --html "$ROOT/databrief.html" --check >/dev/null'

rm -rf "$T"
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
