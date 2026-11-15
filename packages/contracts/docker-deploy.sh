#!/bin/sh
# The compose deploy job: deploys the protocol once per chain. Anvil keeps its state in a volume, so on a rerun the
# factory from the deployment file already has code and the job exits without broadcasting.
set -eu

file=deployments/local.json
factory=$(sed -n 's/.*"factory": *"\(0x[0-9a-fA-F]*\)".*/\1/p' "$file")
code=$(cast code "$factory" --rpc-url "$ZAL_RPC_URL")

if [ "$code" != "0x" ]; then
  echo "already deployed: factory $factory has code"
  exit 0
fi

forge script script/Deploy.s.sol --rpc-url "$ZAL_RPC_URL" --broadcast --private-key "$ZAL_DEPLOYER_KEY"
echo "deployed: $(cat "$file")"
