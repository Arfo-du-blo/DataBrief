#!/usr/bin/env bash
# Regenerates tests/access-fixtures/ : real .mdb / .accdb files written by Jackcess (an independent open-source Java library;
# it is NOT Microsoft Access) from tests/access-fixtures/src/MakeAccess.java. The results are committed, so the tests need no Java.
# Needs Docker (+ internet the first time: the Jackcess jars come from Maven Central, with their checksums checked).
# Every container and every image pulled here is removed at the end; images you already had are left alone.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tests/access-fixtures"
export DOCKER_CONFIG="$(mktemp -d)"; echo '{}' > "$DOCKER_CONFIG/config.json"
BEFORE="$(docker images -q | sort -u)"
cleanup() {
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$DOCKER_CONFIG"
}
trap cleanup EXIT

# Jackcess 4.0.8 (Apache-2.0) and its two dependencies, from Maven Central
JARS="com/healthmarketscience/jackcess/jackcess/4.0.8/jackcess-4.0.8.jar org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar commons-logging/commons-logging/1.3.4/commons-logging-1.3.4.jar"
mkdir -p "$OUT"
rm -f "$OUT"/*.mdb "$OUT"/*.accdb
docker run --rm -v "$OUT/src:/src:ro" -v "$OUT:/out" eclipse-temurin:17-jdk sh -c '
  set -e
  mkdir -p /tmp/lib /tmp/classes && cd /tmp/lib
  for j in '"$JARS"'; do
    curl -fsSL -O "https://repo1.maven.org/maven2/$j"
    curl -fsSL "https://repo1.maven.org/maven2/$j.sha1" > "$(basename $j).sha1"
    echo "$(cat "$(basename $j).sha1")  $(basename $j)" | sha1sum -c -
  done
  javac -cp "/tmp/lib/*" -d /tmp/classes /src/MakeAccess.java
  java -cp "/tmp/lib/*:/tmp/classes" MakeAccess /out
  java -version 2>&1 | head -1 > /out/.java-version
  ls /tmp/lib | tr "\n" " " > /out/.jars
' || { echo "FAIL: generation failed"; exit 1; }
{ echo "Real Access files in this folder were written by Jackcess (NOT by Microsoft Access): see tests/make_access_fixtures.sh"; echo "Generated: $(date -u +%Y-%m-%d)"; echo "Libraries: $(cat "$OUT/.jars")"; echo "Java: $(cat "$OUT/.java-version")"; } > "$OUT/VERSIONS.txt"
rm -f "$OUT/.jars" "$OUT/.java-version"
ls -la "$OUT" | awk '{print $5, $9}' | tail -n +4
