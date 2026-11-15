#!/bin/sh
# Proves every on-chain table is rebuilt from events (ADR 0012): indexes the running stack's chain from block 0
# into a scratch schema, waits until it reaches the live indexer's checkpoint, then diffs every table row by row.
# Run from the repository root with the stack up. Exits 1 on any difference.
set -eu

psql() { docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" postgres psql -U zal -d zal -At "$@" </dev/null; }
block_of() { psql -c "select substr(latest_checkpoint, 27, 16)::bigint from $1._ponder_checkpoint" 2>/dev/null || true; }

live=$(psql -c "select schema_name from information_schema.schemata where schema_name like 'zal_index_%' order by schema_name desc limit 1")
scratch=zal_reindex_check
psql -c "drop schema if exists $scratch cascade" >/dev/null

docker compose stop indexer >/dev/null 2>&1
trap 'docker rm -f zal-reindex-check >/dev/null 2>&1; psql -c "drop schema if exists $scratch cascade" >/dev/null; docker compose start indexer >/dev/null 2>&1' EXIT
target=$(block_of "$live")
docker compose run -d --name zal-reindex-check --no-deps -e DATABASE_SCHEMA=$scratch indexer >/dev/null 2>&1

i=0
until [ "$(block_of $scratch)" = "$target" ]; do
  i=$((i + 1))
  [ $i -gt 120 ] && { echo "reindex did not reach block $target"; exit 1; }
  sleep 1
done
echo "live $live and reindex $scratch both at block $target"

status=0
for t in $(psql -c "select table_name from information_schema.tables where table_schema = '$live' and table_type = 'BASE TABLE' and table_name not like '\_%' order by 1"); do
  r=$(psql -c "select (select count(*) from $live.\"$t\"),
    (select count(*) from (select to_jsonb(a)::text from $live.\"$t\" a except select to_jsonb(b)::text from $scratch.\"$t\" b) x),
    (select count(*) from (select to_jsonb(b)::text from $scratch.\"$t\" b except select to_jsonb(a)::text from $live.\"$t\" a) y)")
  rows=${r%%|*}
  diff=${r#*|}
  if [ "$diff" = "0|0" ]; then echo "same  $t ($rows rows)"; else echo "DIFF  $t ($rows rows, live-only|reindex-only $diff)"; status=1; fi
done
exit $status
