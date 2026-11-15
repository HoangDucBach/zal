#!/bin/sh
set -eu
node lib/app-db/migrate.ts
# The index schema is keyed by the indexing code and by the chain's genesis hash, so a reset chain (a fresh anvil)
# indexes into a new schema instead of trusting rows from a chain that no longer exists.
genesis=$(node -e '
fetch(process.env.ZAL_RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x0", false] }),
})
  .then((r) => r.json())
  .then((j) => process.stdout.write(j.result.hash.slice(2, 10)))
  .catch((e) => { console.error("genesis lookup failed:", e.message); process.exit(1); });
')
exec node_modules/.bin/ponder start --port 42069 --schema "${DATABASE_SCHEMA:-zal_index_$(cat .schema-id)_${genesis}}"
