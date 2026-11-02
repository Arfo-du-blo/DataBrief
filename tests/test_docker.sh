#!/usr/bin/env bash
# Tests the Docker images (nginx and Python variants, amd64 and arm64 under emulation), Compose files, the
# Raspberry Pi setup script, and the configuration files for nginx, Apache, Caddy, IIS, Kubernetes and the
# GitHub/GitLab workflows (syntax). Also checks that the tampered privacy demo is never published. Removes every image it pulled or built.
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$E/venv/bin/python"
T="$(mktemp -d)"
PASS=0; FAIL=0
ok()   { echo "PASS $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL $1  —  $2"; FAIL=$((FAIL + 1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1" "${3:-}"; fi; }
config_of() { "$PY" -c 'import re,sys,json; h=sys.stdin.read(); m=re.search(r"<script id=\"databrief-config\" type=\"application/json\">([\s\S]*?)</script>",h); print(json.dumps(json.loads(m.group(1)),sort_keys=True))'; }
wait_http() { for _ in $(seq 1 60); do curl -s "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done; return 1; }

BEFORE="$(docker images -q | sort -u)"
cleanup() {
  docker rm -f db-test-nginx db-test-python db-test-arm-nginx db-test-arm-python db-test-nginx-nolock >/dev/null 2>&1
  docker rmi -f databrief-test:nginx databrief-test:python databrief-test:nginx-arm64 databrief-test:python-arm64 >/dev/null 2>&1
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$T"
}
trap cleanup EXIT

cd "$ROOT"
check "build nginx image" 'docker build -q -f deploy/docker/Dockerfile -t databrief-test:nginx . > "$T/b1.log" 2>&1' "$(tail -20 "$T/b1.log")"
check "build Python image" 'docker build -q -f deploy/docker/Dockerfile.python -t databrief-test:python . > "$T/b2.log" 2>&1' "$(tail -20 "$T/b2.log")"

# ---- nginx variant
RESPOND="$(printf '## Our rules\n- Answer in Japanese <b>')"
docker run -d --name db-test-nginx -p 18090:8080 -e DATABRIEF_LANG=ja -e DATABRIEF_LOCK=lang,view -e DATABRIEF_MODE=files \
  -e DATABRIEF_PROMPT_RESPOND="$RESPOND" -e DATABRIEF_BASE_PATH=/x -e DATABRIEF_FRAME_ANCESTORS="'self' https://teams.microsoft.com" \
  databrief-test:nginx >/dev/null
check "nginx: starts" 'wait_http localhost:18090/healthz' "$(docker logs db-test-nginx 2>&1 | tail -20)"
CFG="$(curl -s localhost:18090/x/ | config_of)"
check "nginx: settings in the page" '[ "$CFG" = "{\"lang\": \"ja\", \"lock\": [\"lang\", \"view\"], \"mode\": \"files\", \"promptRespond\": \"## Our rules\\n- Answer in Japanese <b>\"}" ]' "$CFG"
H="$(curl -s -D - -o "$T/n.gz" -H 'Accept-Encoding: gzip' localhost:18090/x/)"
check "nginx: gzip + headers" 'echo "$H" | grep -qi "content-encoding: gzip" && echo "$H" | grep -qi "frame-ancestors '"'"'self'"'"' https://teams.microsoft.com" && echo "$H" | grep -qi "cache-control: no-cache"' "$H"
check "nginx: base path redirect" '[ "$(curl -s -o /dev/null -w "%{http_code}" localhost:18090/x)" = "301" ]'
check "nginx: 404 elsewhere" '[ "$(curl -s -o /dev/null -w "%{http_code}" localhost:18090/other)" = "404" ]'
check "nginx: runs as non-root" '[ "$(docker exec db-test-nginx id -u)" = "101" ]'
for _ in $(seq 1 20); do [ "$(docker inspect -f '{{.State.Health.Status}}' db-test-nginx)" = "healthy" ] && break; sleep 2; done
check "nginx: Docker healthcheck" '[ "$(docker inspect -f "{{.State.Health.Status}}" db-test-nginx)" != "unhealthy" ]'
# regression (v1.0.0): without DATABRIEF_LOCK, the other settings were silently dropped
docker run -d --name db-test-nginx-nolock -p 18095:8080 -e DATABRIEF_LANG=it -e DATABRIEF_MODE=files -e DATABRIEF_SHARE=NO -e DATABRIEF_PROFILE=No databrief-test:nginx >/dev/null
check "nginx: settings work without DATABRIEF_LOCK" 'wait_http localhost:18095/healthz && [ "$(curl -s localhost:18095/ | config_of)" = "{\"lang\": \"it\", \"mode\": \"files\", \"profile\": \"no\", \"share\": \"no\"}" ]' "$(docker logs db-test-nginx-nolock 2>&1 | grep -v io_setup | tail -10)"
# "Do not share data" fails closed: a value that is not yes or no stops the container (it never starts sharing)
check "nginx: DATABRIEF_SHARE=bogus stops the container" '! timeout 60 docker run --rm -e DATABRIEF_SHARE=bogus databrief-test:nginx > "$T/share.txt" 2>&1 && grep -q "DATABRIEF_SHARE must be yes or no" "$T/share.txt"' "$(tail -5 "$T/share.txt" 2>/dev/null)"
check "nginx: DATABRIEF_PROFILE=bogus stops the container" '! timeout 60 docker run --rm -e DATABRIEF_PROFILE=bogus databrief-test:nginx > "$T/profile.txt" 2>&1 && grep -q "DATABRIEF_PROFILE must be yes or no" "$T/profile.txt"' "$(tail -5 "$T/profile.txt" 2>/dev/null)"

# ---- Python variant
docker run -d --name db-test-python -p 18091:8080 -e DATABRIEF_LANG=ko -e DATABRIEF_THREADS=4 databrief-test:python >/dev/null
check "python image: starts" 'wait_http localhost:18091/healthz' "$(docker logs db-test-python 2>&1 | tail -20)"
CFG="$(curl -s localhost:18091/ | config_of)"
check "python image: settings in the page" '[ "$CFG" = "{\"lang\": \"ko\"}" ]' "$CFG"
check "python image: runs as non-root" '[ "$(docker exec db-test-python id -u)" = "10001" ]'

# interactive setup inside the container, answers saved in the mounted folder
mkdir -p "$T/config" && chmod 777 "$T/config"
printf 'es\n\nfiles\n\n\n\n\n\n\n\n\n\n\n\n\ny\n' | docker run -i --rm -v "$T/config:/config" databrief-test:python setup --check > "$T/setup.txt" 2>&1
check "python image: interactive setup prints docker commands" 'grep -q "docker run -d -p 8080:8080" "$T/setup.txt" && grep -q "DATABRIEF_LANG=es" "$T/setup.txt"' "$(cat "$T/setup.txt" | tail -30)"
check "python image: setup saved to /config" 'grep -q "^DATABRIEF_LANG=es$" "$T/config/databrief.conf"' "$(cat "$T/config/databrief.conf" 2>/dev/null)"
docker rm -f db-test-python >/dev/null
docker run -d --name db-test-python -p 18091:8080 -v "$T/config:/config" databrief-test:python >/dev/null
wait_http localhost:18091/healthz
CFG="$(curl -s localhost:18091/ | config_of)"
check "python image: next start uses the saved answers" '[ "$CFG" = "{\"lang\": \"es\", \"mode\": \"files\"}" ]' "$CFG"

# ---- Compose file
check "docker compose config" 'docker compose -f deploy/docker/docker-compose.yml config -q 2>"$T/c.txt"' "$(cat "$T/c.txt" 2>/dev/null)"
check "docker compose (python profile) config" 'docker compose -f deploy/docker/docker-compose.yml --profile python config -q 2>"$T/c2.txt"' "$(cat "$T/c2.txt" 2>/dev/null)"

# ---- ARM images (Raspberry Pi), built and run under emulation (QEMU)
check "build nginx image for arm64" 'docker buildx build -q --platform linux/arm64 --load -f deploy/docker/Dockerfile -t databrief-test:nginx-arm64 . > "$T/b3.log" 2>&1' "$(tail -20 "$T/b3.log")"
check "build Python image for arm64" 'docker buildx build -q --platform linux/arm64 --load -f deploy/docker/Dockerfile.python -t databrief-test:python-arm64 . > "$T/b4.log" 2>&1' "$(tail -20 "$T/b4.log")"
docker run -d --name db-test-arm-nginx --platform linux/arm64 -p 18092:8080 -e DATABRIEF_LANG=fr databrief-test:nginx-arm64 >/dev/null
docker run -d --name db-test-arm-python --platform linux/arm64 -p 18093:8080 -e DATABRIEF_LANG=de databrief-test:python-arm64 >/dev/null
check "arm64 nginx: starts and serves the page" 'wait_http localhost:18092/healthz && [ "$(curl -s localhost:18092/ | config_of)" = "{\"lang\": \"fr\"}" ]' "$(docker logs db-test-arm-nginx 2>&1 | tail -20)"
check "arm64 Python: starts and serves the page" 'wait_http localhost:18093/healthz && [ "$(curl -s localhost:18093/ | config_of)" = "{\"lang\": \"de\"}" ]' "$(docker logs db-test-arm-python 2>&1 | tail -20)"
check "arm64 images really are ARM (aarch64)" '[ "$(docker exec db-test-arm-nginx uname -m)" = "aarch64" ] && [ "$(docker exec db-test-arm-python uname -m)" = "aarch64" ]'

# ---- the tampered privacy demo (examples/tampered) must never be published
check "demo pages are not in the Docker images" 'docker image inspect databrief-test:nginx databrief-test:python >/dev/null 2>&1 && [ -z "$(docker run --rm --entrypoint sh databrief-test:nginx -c "find / -xdev -name \"corrupted_databrief*\" 2>/dev/null")$(docker run --rm --entrypoint sh databrief-test:python -c "find / -xdev -name \"corrupted_databrief*\" 2>/dev/null")" ]'
# (tests.yml is not a publishing job: it only compares the demo pages with a fresh build)
check "Pages and release jobs never copy examples/" '! grep -nE "examples|corrupted" .github/workflows/pages.yml .github/workflows/release.yml .gitlab-ci.yml deploy/docker/Dockerfile deploy/docker/Dockerfile.python' "$(grep -nE "examples|corrupted" .github/workflows/pages.yml .github/workflows/release.yml .gitlab-ci.yml deploy/docker/Dockerfile* 2>/dev/null)"
check ".dockerignore excludes examples/" 'grep -qx "examples" .dockerignore'

# ---- Raspberry Pi files
check "Raspberry Pi Compose file" 'docker compose -f deploy/raspberry-pi/docker-compose.yml config -q 2>"$T/c3.txt"' "$(cat "$T/c3.txt" 2>/dev/null)"
check "Raspberry Pi setup.sh (shellcheck)" 'docker run --rm -v "$ROOT/deploy/raspberry-pi:/mnt:ro" koalaman/shellcheck:stable /mnt/setup.sh > "$T/sc.txt" 2>&1' "$(cat "$T/sc.txt")"
check "Raspberry Pi setup.sh dry run on Ubuntu 26.04 (both modes)" 'docker run --rm -v "$ROOT:/repo:ro" ubuntu:26.04 sh -c "bash /repo/deploy/raspberry-pi/setup.sh --dry-run --hostname mypi && bash /repo/deploy/raspberry-pi/setup.sh --dry-run --docker --port 8080" > "$T/pi.txt" 2>&1 && grep -q "hostnamectl set-hostname mypi" "$T/pi.txt" && grep -q "DATABRIEF_PUBLIC_PORT=8080 docker compose" "$T/pi.txt"' "$(tail -20 "$T/pi.txt")"

# ---- web server configuration files
CERT='mkdir -p /etc/ssl/databrief && apk add --no-cache openssl >/dev/null 2>&1 && openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=test -days 1 -keyout /etc/ssl/databrief/privkey.pem -out /etc/ssl/databrief/fullchain.pem >/dev/null 2>&1'
check "nginx config file (nginx -t)" 'docker run --rm -v "$ROOT/deploy/nginx/databrief.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable-alpine sh -c "$CERT && mkdir -p /var/www/databrief && nginx -t" > "$T/nx.txt" 2>&1' "$(cat "$T/nx.txt" 2>/dev/null)"
check "Caddyfile (caddy validate)" 'docker run --rm -v "$ROOT/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > "$T/cd.txt" 2>&1' "$(tail -5 "$T/cd.txt" 2>/dev/null)"
check "Apache vhost (httpd -t)" 'docker run --rm -v "$ROOT/deploy/apache/databrief.conf:/usr/local/apache2/conf/extra/databrief.conf:ro" httpd:2.4-alpine sh -c "$CERT && mkdir -p /var/www/databrief && sed -i -E \"s/^#(LoadModule (ssl|headers|proxy|proxy_http|deflate|rewrite|socache_shmcb)_module)/\\1/\" conf/httpd.conf && echo \"Listen 443\" >> conf/httpd.conf && echo \"Include conf/extra/databrief.conf\" >> conf/httpd.conf && httpd -t" > "$T/ap.txt" 2>&1' "$(cat "$T/ap.txt" 2>/dev/null)"

# ---- syntax of the other files
check "IIS web.config is valid XML" '"$PY" -c "import xml.etree.ElementTree as E; E.parse(\"$ROOT/deploy/iis/web.config\")"'
check "Kubernetes manifest parses (3 objects)" '[ "$("$PY" -c "import yaml; print(len([d for d in yaml.safe_load_all(open(\"$ROOT/deploy/kubernetes/databrief.yaml\")) if d]))")" = "3" ]'
check "GitHub workflows parse" '"$PY" -c "import yaml; [yaml.safe_load(open(\"$ROOT/.github/workflows/\" + f)) for f in (\"pages.yml\", \"release.yml\", \"tests.yml\")]"'
check "GitLab CI file parses (6 jobs)" '[ "$("$PY" -c "import yaml; d = yaml.safe_load(open(\"$ROOT/.gitlab-ci.yml\")); print(len([k for k, v in d.items() if isinstance(v, dict) and \"script\" in v]))")" = "6" ]'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
