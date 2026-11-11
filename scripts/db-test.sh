#!/usr/bin/env bash
# Database tests on a throwaway local Postgres.
#
#   pnpm test:db
#
# Applies the Supabase stand-ins, then every migration twice (the second pass
# proves they are safe to re-run), then the SQL tests in supabase/tests.
# Needs the Postgres server programs (initdb, pg_ctl) and psql on this machine;
# set PG_BIN if they are not on the PATH. Nothing here touches a real project.
set -euo pipefail

cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-}"
if [ -z "$PG_BIN" ]; then
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ]; then
  echo "Postgres server programs not found. Install PostgreSQL 15 or newer, or set PG_BIN." >&2
  exit 1
fi

WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
run() { "$@"; }
# Postgres refuses to run as root, so hand the work to the postgres user there.
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  run() { su postgres -c "$(printf '%q ' "$@")"; }
fi
cleanup() {
  run "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
run "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

sql() { psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres "$@"; }

sql -f supabase/tests/00_supabase_stubs.sql 2>/dev/null
for pass in first second; do
  for migration in supabase/migrations/*.sql; do
    sql -f "$migration" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; false; } || { echo "Failed on the $pass pass: $migration" >&2; exit 1; }
  done
  echo "Migrations applied ($pass pass): $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') files"
done

for test in supabase/tests/*.test.sql; do
  echo "Running $test"
  if ! sql -f "$test" >"$WORK/out" 2>&1; then
    echo "FAILED: $test" >&2
    grep -E "ERROR|ASSERT|CONTEXT" "$WORK/out" | head -6 >&2
    exit 1
  fi
  sed -n 's/^.*NOTICE:  /  /p' "$WORK/out"
done
echo "Database tests passed."
