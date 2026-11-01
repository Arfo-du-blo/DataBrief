#!/usr/bin/env bash
# Regenerates tests/dacpac-fixtures/*.dacpac: REAL data-tier packages built by Microsoft's own DacFx library (NuGet Microsoft.SqlServer.DacFx,
# MIT) from the T-SQL schemas in tests/dacpac-fixtures/src. They are committed, so the tests need no .NET. Needs Docker and internet.
# The container and the image pulled here are removed at the end; images you already had are left alone.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tests/dacpac-fixtures"
export DOCKER_CONFIG="$(mktemp -d)"; echo '{}' > "$DOCKER_CONFIG/config.json"
BEFORE="$(docker images -q | sort -u)"
cleanup() { for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done; rm -rf "$DOCKER_CONFIG"; }
trap cleanup EXIT
rm -f "$OUT"/*.dacpac
docker run --rm -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 -v "$OUT/src:/src:ro" -v "$OUT:/out" mcr.microsoft.com/dotnet/sdk:8.0 sh -c '
  set -e
  mkdir -p /work && cp /src/MakeDacpac.csproj /src/Program.cs /work/ && cd /work
  dotnet run -c Release -- /src /out
  dotnet --version > /out/.dotnet-version
  grep -o "DacFx\" Version=\"[^\"]*" /work/MakeDacpac.csproj | sed "s/.*Version=\"//" > /out/.dacfx-version
' || { echo "FAIL: generation failed"; exit 1; }
{ echo "Real .dacpac files here were built by Microsoft's DacFx library (NOT hand-written): see tests/make_dacpac_fixtures.sh"; echo "Generated: $(date -u +%Y-%m-%d)";
  echo "Microsoft.SqlServer.DacFx: $(cat "$OUT/.dacfx-version")"; echo ".NET SDK: $(cat "$OUT/.dotnet-version")"; } > "$OUT/VERSIONS.txt"
rm -f "$OUT/.dotnet-version" "$OUT/.dacfx-version"
ls -la "$OUT" | awk '{print $5, $9}' | tail -n +4
