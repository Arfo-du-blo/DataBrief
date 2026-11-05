#!/usr/bin/env bash
# The hosted MCP server's Docker image: built from the repository root with a stand-in widget page, run read-only without
# capabilities, asked over HTTP, stopped. Needs Docker (BuildKit) and curl.   bash tests/test_mcp_docker.sh
set -uo pipefail
cd "$(dirname "$0")/.."
IMG=databrief-mcp:test
NAME="databrief-mcp-test-$$"
FAIL=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; FAIL=1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if docker build -q -f mcp/Dockerfile --build-arg WIDGET_SOURCE=fixture -t "$IMG" . >/dev/null; then ok "the image builds from the repository root"; else bad "the image builds"; exit 1; fi

FILES=$(docker run --rm --entrypoint sh "$IMG" -c 'ls /app' | tr '\n' ' ')
[ "$FILES" = "home-i18n.json icon.svg package.json server.js uris.json widget.html " ] && ok "the image holds only the server, the home page texts, its icon, its list of addresses, package.json and the widget" || bad "the image content: $FILES"

UID_IN=$(docker run --rm --entrypoint id "$IMG" -u)
[ "$UID_IN" != "0" ] && ok "it runs as a user that is not root" || bad "it runs as root"

docker run -d --name "$NAME" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --health-interval=2s --health-timeout=2s -p 127.0.0.1:0:8787 "$IMG" >/dev/null
PORT=$(docker port "$NAME" 8787/tcp | head -1 | sed 's/.*://')
URL="http://127.0.0.1:$PORT"

UP=0
for _ in $(seq 1 30); do curl -fsS "$URL/healthz" >/dev/null 2>&1 && { UP=1; break; }; sleep 0.5; done
[ "$UP" = 1 ] && ok "it starts read-only, without capabilities, and answers /healthz" || { bad "it starts"; docker logs "$NAME"; exit 1; }

call() { curl -fsS -X POST "$URL/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1"; }
call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | grep -q '"name":"databrief"' && ok "initialize answers" || bad "initialize"
call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | grep -q '"readOnlyHint":true' && ok "the tool is read-only" || bad "tools/list"
call '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ui://databrief/widget-v7.html"}}' | grep -q 'Stand-in for dist' && ok "the widget page is served at its current address" || bad "resources/read"
call '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"ui://databrief/widget-v1.html"}}' | grep -q 'Stand-in for dist' && ok "an older widget address still answers" || bad "old address"

WANT=$(sha256sum tests/mcp-fixtures/widget.html | cut -d' ' -f1)
docker logs "$NAME" 2>&1 | grep -q "\"widgetSha256\":\"$WANT\"" && ok "the start line states the SHA-256 of the widget page" || bad "the SHA-256 in the start line"
docker logs "$NAME" 2>&1 | grep -qE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"' && bad "an IP address is in the logs" || ok "no IP address in the logs"

H=starting
for _ in $(seq 1 20); do H=$(docker inspect --format '{{.State.Health.Status}}' "$NAME"); [ "$H" = healthy ] && break; sleep 1; done
[ "$H" = healthy ] && ok "Docker's health check turns healthy" || bad "the health check: $H"

T0=$(date +%s)
docker stop -t 10 "$NAME" >/dev/null
T1=$(date +%s)
CODE=$(docker inspect --format '{{.State.ExitCode}}' "$NAME")
{ [ $((T1 - T0)) -le 4 ] && [ "$CODE" = 0 ]; } && ok "it stops on SIGTERM at once, exit code 0" || bad "stop: $((T1 - T0)) s, code $CODE"

# The real image builds its own widget page (from databrief.html and widget/): it must be byte-identical to a local build.
if command -v node >/dev/null 2>&1 && docker build -q -f mcp/Dockerfile -t databrief-mcp:built . >/dev/null; then
  WANT_REAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('./tools/build-widget.cjs').build()).digest('hex'))")
  GOT_REAL=$(docker run --rm --entrypoint sha256sum databrief-mcp:built /app/widget.html | cut -d' ' -f1)
  [ "$WANT_REAL" = "$GOT_REAL" ] && ok "the real image builds its own widget page, identical to a local build" || bad "the real image's widget page: $GOT_REAL, local build: $WANT_REAL"
else
  bad "the real image builds (with its widget page)"
fi

# Compose: valid with the example settings, with the tunnel (the example's default) and without it, and the server starts from it.
if docker compose version >/dev/null 2>&1; then
  C="docker compose --env-file mcp/.env.example -f mcp/docker-compose.yml"
  $C config -q && ok "docker-compose.yml is valid with the example .env" || bad "docker-compose.yml with the example .env"
  S=$($C config --services | sort | tr '\n' ' ')
  [ "$S" = "cloudflared databrief-mcp " ] && ok "with the example settings Compose starts the server and the tunnel" || bad "services with the tunnel: $S"
  S=$(COMPOSE_PROFILES= $C config --services | sort | tr '\n' ' ')
  [ "$S" = "databrief-mcp " ] && ok "with COMPOSE_PROFILES empty Compose starts the server alone" || bad "services without the tunnel: $S"
  PROJ="dbmcp-test-$$"
  if COMPOSE_PROFILES= DATABRIEF_MCP_PORT=18787 docker compose --env-file mcp/.env.example -p "$PROJ" -f mcp/docker-compose.yml up -d --build databrief-mcp >/dev/null 2>&1; then
    UP2=0
    for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:18787/healthz >/dev/null 2>&1 && { UP2=1; break; }; sleep 0.5; done
    [ "$UP2" = 1 ] && ok "the server starts from the Compose file and answers /healthz" || bad "the server from the Compose file"
    H2=starting
    for _ in $(seq 1 40); do H2=$(docker inspect --format '{{.State.Health.Status}}' "${PROJ}-databrief-mcp-1" 2>/dev/null || echo none); [ "$H2" = healthy ] && break; sleep 1; done
    [ "$H2" = healthy ] && ok "Docker reports it healthy (the tunnel would wait for that)" || bad "health from Compose: $H2"
    docker compose -p "$PROJ" -f mcp/docker-compose.yml down >/dev/null 2>&1
  else
    bad "docker compose up of the server"
  fi
else
  echo "skip docker compose is not installed"
fi

[ "$FAIL" = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
