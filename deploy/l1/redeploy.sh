#!/usr/bin/env bash
# Ship the working tree to the L1 host and rebuild the Zal stack (docs/runbooks/l1-hosting.md).
# Usage, from anywhere in the repository: deploy/l1/redeploy.sh [path/to/key.pem]
# The key defaults to zalax.pem at the repository root. Only git-tracked and untracked-but-not-ignored files are
# sent, so the key and deploy/l1/.env on this machine never leave it.
set -euo pipefail

HOST="ubuntu@100.63.191.30"
ROOT="$(git rev-parse --show-toplevel)"
KEY="${1:-$ROOT/zalax.pem}"

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY (pass its path as the first argument)" >&2
  exit 1
fi

cd "$ROOT"
FILES="$(mktemp)"
trap 'rm -f "$FILES"' EXIT
git ls-files -co --exclude-standard | grep -v '^packages/contracts/lib' > "$FILES"

echo "==> checking SSH access"
ssh -i "$KEY" -o ConnectTimeout=15 "$HOST" true

echo "==> sending files"
rsync -az --files-from="$FILES" -e "ssh -i $KEY" ./ "$HOST:zal/"

echo "==> rebuilding the stack"
ssh -i "$KEY" "$HOST" 'cd ~/zal && docker compose -f deploy/l1/docker-compose.yml --env-file deploy/l1/.env up -d --build --wait'

echo "==> checking the web app"
curl -fsS -o /dev/null -w "app %{http_code}\n" https://app.100-63-191-30.sslip.io/app/canvas
