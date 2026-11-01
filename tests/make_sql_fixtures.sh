#!/usr/bin/env bash
# Regenerates tests/sql-fixtures/ : REAL dumps written by the engines' own tools (never hand-written), from the small
# "shop" database in tests/sql-fixtures/src/. The results are committed, so the parser tests do not need Docker.
# Needs: Docker (+ internet to pull the images the first time), the test environment (tests/setup_testenv.sh) for DuckDB.
# Every container and every image pulled by this script is removed at the end; images you already had are left alone.
# Passwords are throw-away values of containers that never publish a port.
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tests/sql-fixtures"
SRC="$OUT/src"
PY="$E/venv/bin/python"
export DOCKER_CONFIG="$(mktemp -d)"; echo '{}' > "$DOCKER_CONFIG/config.json"   # no credential helper in WSL

BEFORE="$(docker images -q | sort -u)"
cleanup() {
  docker ps -aq --filter "name=db-sqlfix-" | xargs -r docker rm -f >/dev/null 2>&1
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$DOCKER_CONFIG"
}
trap cleanup EXIT

FAILED=0
note() { echo "== $*"; }
fail() { echo "FAIL $*" >&2; FAILED=$((FAILED + 1)); }
# Waits until a command run in a container succeeds (up to ~3 minutes)
wait_for() { local c="$1"; shift; for _ in $(seq 1 90); do docker exec "$c" "$@" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
# Waits until the log shows a line N times (the official images start a temporary server first, then restart it)
wait_log() { local c="$1" pat="$2" n="$3"; for _ in $(seq 1 90); do [ "$(docker logs "$c" 2>&1 | grep -c "$pat")" -ge "$n" ] && return 0; sleep 2; done; return 1; }

only() { [ -z "${ONLY:-}" ] || [[ ",$ONLY," == *",$1,"* ]]; }   # ONLY=mysql8,duckdb regenerates just those parts
if [ -z "${ONLY:-}" ]; then rm -rf "$OUT"/*.sql "$OUT"/*.dump "$OUT"/*.tar "$OUT"/duckdb-* "$OUT"/canary "$OUT"/VERSIONS.txt; fi
mkdir -p "$OUT"
if [ -z "${ONLY:-}" ]; then { echo "Real dumps in this folder were written by these tools (see tests/make_sql_fixtures.sh)."; echo "Generated: $(date -u +%Y-%m-%d)"; echo; } > "$OUT/VERSIONS.txt"; fi
ver() { sed -i "/^$1: /d" "$OUT/VERSIONS.txt"; echo "$1: $2" >> "$OUT/VERSIONS.txt"; }   # replaces its own line (ONLY= runs)

# ---------------------------------------------------------------- PostgreSQL ----------
pg_one() {   # $1 = major version, $2 = image
  local v="$1" img="$2" c="db-sqlfix-pg$1"
  note "PostgreSQL $v ($img)"
  docker run -d --name "$c" -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=shop "$img" >/dev/null || { fail "pg$v: cannot start"; return; }
  wait_log "$c" "ready to accept connections" 2 || { fail "pg$v: not ready"; return; }
  docker exec -i "$c" psql -U postgres -d shop -v ON_ERROR_STOP=1 -q < "$SRC/pg.sql" >/dev/null || { fail "pg$v: loading the source failed"; return; }
  local d="docker exec $c pg_dump -U postgres shop"
  $d                            > "$OUT/pg$v-default.sql"        # COPY ... FROM stdin, ALTER TABLE ADD CONSTRAINT
  $d --inserts                  > "$OUT/pg$v-inserts.sql"
  $d --column-inserts           > "$OUT/pg$v-column-inserts.sql"
  $d --schema-only              > "$OUT/pg$v-schema-only.sql"
  $d --data-only                > "$OUT/pg$v-data-only.sql"
  $d -Fc                        > "$OUT/pg$v-custom.dump"        # custom archive (gzip by default)
  $d -Ft                        > "$OUT/pg$v-tar.tar"            # tar archive
  if [ "$v" -ge 16 ]; then
    $d -Fc --compress=zstd      > "$OUT/pg$v-custom-zstd.dump"
    $d -Fc --compress=lz4       > "$OUT/pg$v-custom-lz4.dump"
  fi
  $d -Fc --compress=0           > "$OUT/pg$v-custom-nocompress.dump"
  ver "PostgreSQL $v" "$(docker exec "$c" pg_dump --version) / server $(docker exec "$c" psql -U postgres -tAc 'show server_version')"
  docker rm -f "$c" >/dev/null
}
only pg13 && pg_one 13 postgres:13-alpine
only pg16 && pg_one 16 postgres:16
only pg17 && pg_one 17 postgres:17-alpine

# ---------------------------------------------------------------- MySQL / MariaDB ----------
mysql_like() {   # $1 = label, $2 = image, $3 = client, $4 = dump tool, $5 = root password variable
  local label="$1" img="$2" cli="$3" dump="$4" pwvar="$5" c="db-sqlfix-$1"
  note "$label ($img)"
  docker run -d --name "$c" -e "$pwvar=throwaway" -e "${pwvar%%_ROOT*}_DATABASE=shop" "$img" >/dev/null || { fail "$label: cannot start"; return; }
  wait_log "$c" "ready for connections" 2 || { fail "$label: not ready"; return; }
  sleep 3
  docker exec -i "$c" $cli -uroot -pthrowaway --default-character-set=utf8mb4 shop < "$SRC/mysql.sql" >/dev/null 2>"$OUT/.err" || { fail "$label: loading the source failed: $(cat "$OUT/.err")"; return; }
  local d="docker exec $c $dump -uroot -pthrowaway shop"
  $d 2>/dev/null                              > "$OUT/$label-default.sql"
  $d --no-data 2>/dev/null                    > "$OUT/$label-schema-only.sql"
  $d --complete-insert 2>/dev/null            > "$OUT/$label-complete-insert.sql"
  $d --skip-extended-insert 2>/dev/null       > "$OUT/$label-one-row-per-insert.sql"
  $d --single-transaction --routines --triggers --events 2>/dev/null > "$OUT/$label-full.sql"
  ver "$label" "$(docker exec "$c" $dump --version)"
  docker rm -f "$c" >/dev/null
}
only mysql8 && mysql_like mysql8   mysql:8     mysql   mysqldump      MYSQL_ROOT_PASSWORD
only mariadb11 && mysql_like mariadb11 mariadb:11 mariadb mariadb-dump   MARIADB_ROOT_PASSWORD
rm -f "$OUT/.err"

# ---------------------------------------------------------------- canary dumps (the "Do not share data" tests) ----------
# Real pg_dump output of a database full of CONFIDENTIAL_ values (src/canary-pg.sql). tests/make_fixtures.py copies them.
if only canary; then
note "canary (PostgreSQL 16)"
mkdir -p "$OUT/canary"
c=db-sqlfix-canary
if docker run -d --name "$c" -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=shop postgres:16 >/dev/null && wait_log "$c" "ready to accept connections" 2; then
  docker exec -i "$c" psql -U postgres -d shop -v ON_ERROR_STOP=1 -q < "$SRC/canary-pg.sql" >/dev/null || fail "canary: loading the source failed"
  docker exec "$c" pg_dump -U postgres shop > "$OUT/canary/pg16-canary.sql"
  docker exec "$c" pg_dump -U postgres -Fc shop > "$OUT/canary/pg16-canary.dump"
  ver "canary" "$(docker exec "$c" pg_dump --version | cut -d' ' -f1-3)"
else fail "canary: cannot start"; fi
docker rm -f "$c" >/dev/null 2>&1
fi

# ---------------------------------------------------------------- ClickHouse ----------
if only clickhouse; then
note "ClickHouse"
c=db-sqlfix-ch
if docker run -d --name "$c" --ulimit nofile=262144:262144 clickhouse/clickhouse-server >/dev/null; then
  if wait_for "$c" clickhouse-client -q 'select 1'; then
    docker exec -i "$c" clickhouse-client --multiquery < "$SRC/clickhouse.sql" >/dev/null || fail "clickhouse: loading the source failed"
    { for t in customers orders order_items; do docker exec "$c" clickhouse-client -q "SHOW CREATE TABLE shop.$t" --format TSVRaw; echo ";"; done; } > "$OUT/clickhouse-show-create.sql"
    { for t in customers orders order_items; do
        docker exec "$c" clickhouse-client -q "SELECT * FROM shop.$t ORDER BY 1 FORMAT SQLInsert" --output_format_sql_insert_table_name="$t" --output_format_sql_insert_include_column_names=1
      done; } > "$OUT/clickhouse-data-sqlinsert.sql"
    ver "ClickHouse" "$(docker exec "$c" clickhouse-client --version)"
  else fail "clickhouse: not ready"; fi
  docker rm -f "$c" >/dev/null
else fail "clickhouse: cannot start"; fi
fi

# ---------------------------------------------------------------- SQLite ----------
if only sqlite; then
note "SQLite"
# 1. The sqlite3 shell's ".dump" (what people usually have): run in a small Alpine container
rm -f "$OUT/sqlite-dump.sql"
if docker run --rm -i alpine:3 sh -c 'apk add -q sqlite >/dev/null && cat > /tmp/s.sql && sqlite3 /tmp/shop.db < /tmp/s.sql && sqlite3 /tmp/shop.db .dump && sqlite3 --version >&2' \
     < "$SRC/generic.sql" > "$OUT/sqlite-shell-dump.sql" 2> "$OUT/.sqlite-version"; then
  ver "SQLite shell" "sqlite3 $(tail -1 "$OUT/.sqlite-version" | cut -d' ' -f1) (.dump, Alpine)"
else fail "sqlite: shell dump failed: $(cat "$OUT/.sqlite-version")"; fi
rm -f "$OUT/.sqlite-version"
# 2. Python's iterdump: NOT the same text as the shell (newlines stay raw inside strings), a second real variant
"$PY" - "$SRC/generic.sql" "$OUT/sqlite-python-iterdump.sql" <<'EOF'
import sqlite3, sys
con = sqlite3.connect(":memory:")
con.executescript(open(sys.argv[1], encoding="utf-8").read())
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
    for line in con.iterdump():
        f.write(line + "\n")
EOF
ver "SQLite Python" "library $("$PY" -c 'import sqlite3; print(sqlite3.sqlite_version)') (Python sqlite3 iterdump)"
fi

# ---------------------------------------------------------------- DuckDB ----------
if only duckdb; then
note "DuckDB"
if "$PY" -c 'import duckdb' 2>/dev/null; then
  # DuckDB has no char() and no ON DELETE CASCADE: the only two edits to the shared source
  sed -e 's/char(10)/chr(10)/' -e 's/ ON DELETE CASCADE//' "$SRC/generic.sql" > "$OUT/.duck.sql"
  (cd "$OUT" && "$PY" - ".duck.sql" "." <<'EOF'
import duckdb, os, shutil, sys
src, out = sys.argv[1], sys.argv[2]
for fmt, folder in (("CSV", "duckdb-export-csv"), ("PARQUET", "duckdb-export-parquet")):
    con = duckdb.connect(":memory:")
    con.execute(open(src, encoding="utf-8").read())
    d = folder   # relative: DuckDB writes this path into load.sql, so it must not be an absolute path of this computer
    shutil.rmtree(d, ignore_errors=True)
    con.execute(f"EXPORT DATABASE '{d}' (FORMAT {fmt})")
print(duckdb.__version__)
EOF
  )
  [ -f "$OUT/duckdb-export-csv/schema.sql" ] && ver "DuckDB" "$("$PY" -c 'import duckdb; print(duckdb.__version__)') (EXPORT DATABASE, CSV and Parquet)" || fail "duckdb: export failed"
  rm -f "$OUT/.duck.sql"
else fail "duckdb: python package missing (pip install duckdb in the test environment)"; fi
fi

echo
du -sh "$OUT" | cut -f1 | sed 's/^/total size: /'
[ "$FAILED" -eq 0 ] && echo "all dumps generated" || echo "$FAILED step(s) failed"
exit $FAILED
