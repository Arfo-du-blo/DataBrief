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

if docker build -q -f mcp/Dockerfile --build-arg WIDGET=tests/mcp-fixtures/widget.html -t "$IMG" . >/dev/null; then ok "the image builds from the repository root"; else bad "the image builds"; exit 1; fi

FILES=$(docker run --rm --entrypoint sh "$IMG" -c 'ls /app' | tr '\n' ' ')
[ "$FILES" = "icon.svg package.json server.js uris.json widget.html " ] && ok "the image holds only the server, its icon, its list of addresses, package.json and the widget" || bad "the image content: $FILES"

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

if docker compose version >/dev/null 2>&1; then
  docker compose -f mcp/docker-compose.yml config -q && ok "docker-compose.yml is valid" || bad "docker-compose.yml"
else
  echo "skip docker compose is not installed"
fi

[ "$FAIL" = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
