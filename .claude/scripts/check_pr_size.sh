#!/usr/bin/env bash
# Reports how large a change is, ignoring lockfiles and generated files, and flags oversized PRs.
#
# Usage: check_pr_size.sh [base-ref] [max-lines]
#   base-ref   branch to compare against (default: origin/main, falling back to main/master)
#   max-lines  threshold for a warning (default: 400)
#
# Exit codes: 0 within the limit, 1 over the limit, 2 cannot compute (not a git repo, bad ref).

set -euo pipefail

MAX_LINES="${2:-400}"
BASE="${1:-}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "error: not a git repository" >&2; exit 2; }

if [ -z "$BASE" ]; then
  for candidate in origin/main origin/master main master; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null; then BASE="$candidate"; break; fi
  done
fi
[ -n "$BASE" ] || { echo "error: no base ref found; pass one explicitly" >&2; exit 2; }
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "error: unknown ref: $BASE" >&2; exit 2; }

# Compare against the merge base so that unrelated commits on the base branch are not counted.
MERGE_BASE="$(git merge-base "$BASE" HEAD)"

# Files that add review noise without adding review value.
EXCLUDES=(
  ':(exclude)*package-lock.json' ':(exclude)*pnpm-lock.yaml' ':(exclude)*yarn.lock'
  ':(exclude)*poetry.lock' ':(exclude)*uv.lock' ':(exclude)*Cargo.lock' ':(exclude)*go.sum'
  ':(exclude)*.min.js' ':(exclude)*.min.css' ':(exclude)*.snap' ':(exclude)*.map'
  ':(exclude)*/generated/*' ':(exclude)*.generated.*' ':(exclude)*.pb.go' ':(exclude)*_pb2.py'
)

# numstat prints "added<TAB>deleted<TAB>path"; binary files show "-".
STATS="$(git diff --numstat "$MERGE_BASE" HEAD -- . "${EXCLUDES[@]}")"
# Include uncommitted work, so the check also works before committing.
STATS="$STATS"$'\n'"$(git diff --numstat HEAD -- . "${EXCLUDES[@]}")"

read -r FILES ADDED DELETED < <(printf '%s\n' "$STATS" | awk -F '\t' '
  NF >= 3 && $3 != "" { files[$3] = 1; if ($1 != "-") a += $1; if ($2 != "-") d += $2 }
  END { n = 0; for (f in files) n++; print n + 0, a + 0, d + 0 }')

TOTAL=$((ADDED + DELETED))
echo "Base: $BASE ($(git rev-parse --short "$MERGE_BASE"))"
echo "Files changed: $FILES  |  +$ADDED -$DELETED  |  total $TOTAL changed lines (lockfiles and generated files excluded)"

if [ "$TOTAL" -gt "$MAX_LINES" ]; then
  echo "TOO LARGE: $TOTAL > $MAX_LINES lines. Review quality drops sharply on big changes."
  echo "Split by vertical slice (see .claude/skills/task-breakdown) or land the refactor separately from the behavior change."
  exit 1
fi
echo "OK: within the $MAX_LINES-line limit."
