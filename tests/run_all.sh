#!/usr/bin/env bash
# Runs every test suite: browser (formats, UI, settings, privacy demo), servers, Docker and configuration files, ESP32.
HERE="$(cd "$(dirname "$0")" && pwd)"
status=0
echo "=== Browser tests";        bash "$HERE/run.sh"          || status=1
echo; echo "=== Server tests";   bash "$HERE/test_servers.sh" || status=1
echo; echo "=== Docker tests";   bash "$HERE/test_docker.sh"  || status=1
echo; echo "=== ESP32 tests";    bash "$HERE/test_esp32.sh"   || status=1
exit $status
