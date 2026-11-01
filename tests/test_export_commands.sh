#!/usr/bin/env bash
# Runs the commands of the export helper (src/export-helper.js, the text the page shows and docs/export-your-database.md repeats)
# against REAL servers in containers, loads the small "shop" database first, and gives the files they write to DataBrief's own
# SQL reader (tests/check_export_outputs.cjs). Not part of tests/run.sh: it needs Docker and an internet connection for the images.
#
#   bash tests/test_export_commands.sh            (all engines)       ONLY=postgresql,mysql bash tests/test_export_commands.sh
#
# What is the same as on a user's computer: the command text, run by the engine's own client, as an ordinary (not admin) user.
# What the harness changes, nothing else: the password. Real users type it at a prompt (`-p`, `--password` with no value); here
# there is no keyboard, so the prompt flag is removed and the throw-away password goes in an environment variable.
# DuckDB: its command-line program is not installed here, so the SQL of its commands is run through the `duckdb` Python package
# (same engine, same SQL; the options of the command line itself are NOT exercised, which is why the page does not say "tested").
# Every container and every image pulled by this script is removed at the end; images you already had are left alone.
set -u
E="${DATABRIEF_TESTENV:-$HOME/databrief-testenv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/tests/sql-fixtures/src"
export PATH="$E/node/bin:$PATH"
PY="$E/venv/bin/python"
W="$(mktemp -d)"
export DOCKER_CONFIG="$(mktemp -d)"; echo '{}' > "$DOCKER_CONFIG/config.json"

BEFORE="$(docker images -q | sort -u)"
cleanup() {
  docker ps -aq --filter "name=db-exportcmd-" | xargs -r docker rm -f >/dev/null 2>&1
  for id in $(docker images -q | sort -u); do echo "$BEFORE" | grep -qx "$id" || docker rmi -f "$id" >/dev/null 2>&1; done
  rm -rf "$DOCKER_CONFIG" "$W"
}
trap cleanup EXIT

FAILED=0
note() { echo "== $*"; }
fail() { echo "FAIL $*" >&2; FAILED=$((FAILED + 1)); }
only() { [ -z "${ONLY:-}" ] || [[ ",$ONLY," == *",$1,"* ]]; }
wait_log() { local c="$1" pat="$2" n="$3"; for _ in $(seq 1 90); do [ "$(docker logs "$c" 2>&1 | grep -c "$pat")" -ge "$n" ] && return 0; sleep 2; done; return 1; }
wait_for() { local c="$1"; shift; for _ in $(seq 1 90); do docker exec "$c" "$@" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
cmd() { node "$ROOT/tests/export_commands.cjs" "$1" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(j[process.argv[1]])' "$2"; }

# run_cmd <container> <engine> <command text> [env var...] : runs the text in the container (in /tmp), then copies /tmp's files out
run_cmd() {
  local c="$1" eng="$2" text="$3"; shift 3
  local envs=(); for v in "$@"; do envs+=(-e "$v"); done
  echo "   \$ ${text:0:150}"
  docker exec -i -w /tmp "${envs[@]}" "$c" sh -c "$text" >/dev/null 2>"$W/err" || { fail "$eng: command failed: ${text:0:80}... $(head -c 400 "$W/err")"; return 1; }
}
collect() { local c="$1" eng="$2"; mkdir -p "$W/out/$eng"; docker cp "$c:/tmp/." "$W/out/$eng/" >/dev/null 2>&1; }
VERS=""
addver() { VERS="$VERS$1\n"; }

# ---------------------------------------------------------------- PostgreSQL (the postgres:16 image) ----------
if only postgresql; then
  note "PostgreSQL 16"
  c=db-exportcmd-pg
  docker run -d --name "$c" -e POSTGRES_USER=myuser -e POSTGRES_DB=mydb -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null || fail "pg: cannot start"
  if wait_log "$c" "ready to accept connections" 2; then
    docker exec -i "$c" psql -U myuser -d mydb -v ON_ERROR_STOP=1 -q < "$SRC/pg.sql" >/dev/null || fail "pg: loading the source failed"
    for k in schema full fks; do run_cmd "$c" postgresql "$(cmd postgresql $k)"; done
    collect "$c" postgresql
    addver "PostgreSQL: $(docker exec "$c" psql -U myuser -d mydb -tAc 'show server_version')"
  else fail "pg: not ready"; fi
  docker rm -f "$c" >/dev/null 2>&1
fi

# ---------------------------------------------------------------- MySQL 8.4 / MariaDB 11.8 ----------
mysql_like() {   # $1 key, $2 image, $3 client, $4 env prefix, $5 label
  local key="$1" img="$2" cli="$3" p="$4" c="db-exportcmd-$1"
  note "$5 ($img)"
  docker run -d --name "$c" -e "${p}_ROOT_PASSWORD=throwaway" -e "${p}_DATABASE=mydb" -e "${p}_USER=myuser" -e "${p}_PASSWORD=throwaway" "$img" >/dev/null || { fail "$key: cannot start"; return; }
  wait_log "$c" "ready for connections" 2 || { fail "$key: not ready"; return; }
  sleep 3
  docker exec -i "$c" $cli -uroot -pthrowaway --default-character-set=utf8mb4 mydb < "$SRC/mysql.sql" >/dev/null 2>"$W/err" || { fail "$key: loading the source failed: $(head -c 300 "$W/err")"; return; }
  for k in schema full fks; do
    local t; t="$(cmd "$key" $k)"
    t="${t// -p / }"                       # the prompt flag: no keyboard here (see the top of this file)
    run_cmd "$c" "$key" "$t" MYSQL_PWD=throwaway
  done
  collect "$c" "$key"
  addver "$5: $(docker exec "$c" $cli -uroot -pthrowaway -N -e 'select version()' 2>/dev/null)"
  docker rm -f "$c" >/dev/null 2>&1
}
only mysql && mysql_like mysql mysql:8.4 mysql MYSQL MySQL
only mariadb && mysql_like mariadb mariadb:11.8 mariadb MARIADB MariaDB

# ---------------------------------------------------------------- ClickHouse ----------
if only clickhouse; then
  note "ClickHouse"
  c=db-exportcmd-ch
  if docker run -d --name "$c" --ulimit nofile=262144:262144 -e CLICKHOUSE_USER=myuser -e CLICKHOUSE_PASSWORD=throwaway -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 clickhouse/clickhouse-server >/dev/null; then
    if wait_for "$c" clickhouse-client --user myuser --password throwaway -q 'select 1'; then
      sed 's/\bshop\b/mydb/g' "$SRC/clickhouse.sql" | docker exec -i "$c" clickhouse-client --user myuser --password throwaway --multiquery >/dev/null || fail "clickhouse: loading the source failed"
      for k in schema full; do
        t="$(cmd clickhouse $k)"; t="${t// --password / --password throwaway }"   # the prompt flag, as above
        run_cmd "$c" clickhouse "$t"
      done
      # the page says there is no foreign-key query for ClickHouse
      [ -z "$(cmd clickhouse fks)" ] || fail "clickhouse: the page now offers a foreign-key query: it needs a test"
      collect "$c" clickhouse
      addver "ClickHouse: $(docker exec "$c" clickhouse-client --user myuser --password throwaway -q 'select version()')"
    else fail "clickhouse: not ready"; fi
  else fail "clickhouse: cannot start"; fi
  docker rm -f "$c" >/dev/null 2>&1
fi

# ---------------------------------------------------------------- SQLite (Alpine's sqlite3) ----------
if only sqlite; then
  note "SQLite"
  c=db-exportcmd-sqlite
  if docker run -d --name "$c" alpine:3 sleep 600 >/dev/null && docker exec "$c" apk add -q sqlite >/dev/null 2>&1; then
    docker exec -i -w /tmp "$c" sh -c 'sqlite3 mydb.sqlite' < "$SRC/generic.sql" >/dev/null || fail "sqlite: loading the source failed"
    for k in schema full fks; do run_cmd "$c" sqlite "$(cmd sqlite $k)"; done
    collect "$c" sqlite
    addver "SQLite: $(docker exec "$c" sqlite3 --version | cut -d' ' -f1)"
  else fail "sqlite: cannot start"; fi
  docker rm -f "$c" >/dev/null 2>&1
fi

# ---------------------------------------------------------------- DuckDB (Python package, see the top) ----------
if only duckdb; then
  note "DuckDB (SQL of the commands, through the Python package)"
  mkdir -p "$W/out/duckdb" && cp "$SRC/generic.sql" "$W/out/duckdb/.src.sql"
  sed -e 's/char(10)/chr(10)/' -e 's/ ON DELETE CASCADE//' "$SRC/generic.sql" > "$W/out/duckdb/.src.sql"   # the same two edits as make_sql_fixtures.sh
  for k in schema full fks; do cmd duckdb $k > "$W/out/duckdb/.$k.txt"; done
  (cd "$W/out/duckdb" && "$PY" - <<'EOF'
import csv, duckdb, shlex, subprocess, sys
def sql_of(name):   # the text after -c in the page's command, as the shell would split it
    a = shlex.split(open("." + name + ".txt").read().split("\n")[0])
    return a[a.index("-c") + 1]
con = duckdb.connect("mydb.duckdb")
con.execute(open(".src.sql", encoding="utf-8").read())
rows = con.execute(sql_of("schema")).fetchall()                       # -noheader -list: one value per line
open("schema.sql", "w", encoding="utf-8").write("".join(r[0] + "\n" for r in rows))
con.execute(sql_of("full"))                                           # EXPORT DATABASE 'export'
cur = con.execute(sql_of("fks")); head = [d[0] for d in cur.description]   # -csv: header, then rows
with open("foreign_keys.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(head); w.writerows(cur.fetchall())
print(duckdb.__version__, file=sys.stderr)
EOF
  ) 2>"$W/err" || fail "duckdb: $(head -c 400 "$W/err")"
  # the zip step is run for real, as written
  (cd "$W/out/duckdb" && zip -qr export.zip export && unzip -l export.zip | grep -q load.sql) || fail "duckdb: zip -r export.zip export"
  addver "DuckDB: $(tail -1 "$W/err")"
fi

# ---------------------------------------------------------------- the files, read by DataBrief's own reader ----------
echo
echo "== Versions"; printf "$VERS"
echo
echo "== The files read by DataBrief"
node "$ROOT/tests/check_export_outputs.cjs" "$W/out" > "$W/check.txt"; rc=$?; grep -v '^PASS' "$W/check.txt"; [ $rc -eq 0 ] || FAILED=$((FAILED + 1))
[ "$FAILED" -eq 0 ] && echo "all export commands verified" || echo "$FAILED problem(s)"
exit $FAILED
