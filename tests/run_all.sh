#!/usr/bin/env bash
# Runs every test suite: browser (formats, UI, settings), servers, Docker and configuration files.
HERE="$(cd "$(dirname "$0")" && pwd)"
status=0
echo "=== Browser tests";        bash "$HERE/run.sh"          || status=1
echo; echo "=== Server tests";   bash "$HERE/test_servers.sh" || status=1
echo; echo "=== Docker tests";   bash "$HERE/test_docker.sh"  || status=1
exit $status
