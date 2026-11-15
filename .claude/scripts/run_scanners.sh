#!/usr/bin/env bash
# Runs whichever security scanners are installed, and clearly reports the ones that are missing.
# A missing scanner is reported as SKIPPED, never as a pass: "not scanned" is different from "clean".
#
# Usage: run_scanners.sh [project-dir]
# Exit codes: 0 every scanner that ran was clean, 1 at least one reported findings,
#             2 no scanner could run at all.

set -uo pipefail

ROOT="${1:-.}"
cd "$ROOT" || { echo "error: cannot cd to $ROOT" >&2; exit 2; }

ran=0; failed=0
declare -a SUMMARY=()

have() { command -v "$1" >/dev/null 2>&1; }

# run <label> <command...>: runs the command, records the outcome in the summary.
run() {
  local label="$1"; shift
  echo
  echo "=== $label ==="
  ran=$((ran + 1))
  if "$@"; then
    SUMMARY+=("PASS     $label")
  else
    failed=$((failed + 1))
    SUMMARY+=("FINDINGS $label")
  fi
}

skip() { SUMMARY+=("SKIPPED  $1 (not installed; $2)"); }

# --- Secrets ---------------------------------------------------------------------------------------
if have gitleaks; then
  run "gitleaks (secrets in git history)" gitleaks detect --no-banner --redact
else
  skip "gitleaks" "brew install gitleaks"
fi

# --- SAST ------------------------------------------------------------------------------------------
if have semgrep; then
  run "semgrep (static analysis)" semgrep scan --config auto --error --quiet --metrics=off
else
  skip "semgrep" "pipx install semgrep"
fi

# --- Dependencies (SCA) ------------------------------------------------------------------------------
if have osv-scanner; then
  run "osv-scanner (dependencies, all lockfiles)" osv-scanner scan --recursive .
else
  skip "osv-scanner" "brew install osv-scanner"
fi
if [ -f package-lock.json ] && have npm; then
  run "npm audit (production dependencies)" npm audit --omit=dev --audit-level=high
fi
if { [ -f requirements.txt ] || [ -f pyproject.toml ]; } && have pip-audit; then
  run "pip-audit" pip-audit
elif [ -f requirements.txt ] || [ -f pyproject.toml ]; then
  skip "pip-audit" "pipx install pip-audit"
fi
if [ -f Cargo.lock ]; then
  if have cargo-deny; then run "cargo deny (advisories, licenses)" cargo deny check advisories
  elif have cargo-audit; then run "cargo audit" cargo audit
  else skip "cargo-audit / cargo-deny" "cargo install cargo-audit"; fi
fi

# --- Containers and IaC ------------------------------------------------------------------------------
if compgen -G "Dockerfile*" >/dev/null || compgen -G "*.tf" >/dev/null || [ -d k8s ] || [ -d terraform ]; then
  if have trivy; then
    run "trivy config (Dockerfile, Terraform, Kubernetes)" trivy config --severity HIGH,CRITICAL --exit-code 1 --quiet .
  elif have checkov; then
    run "checkov (IaC)" checkov -d . --quiet --compact
  else
    skip "trivy / checkov" "brew install trivy"
  fi
  if compgen -G "Dockerfile*" >/dev/null && have hadolint; then
    run "hadolint (Dockerfile lint)" hadolint Dockerfile*
  fi
fi

# --- Summary -----------------------------------------------------------------------------------------
echo
echo "=== Summary ==="
printf '%s\n' "${SUMMARY[@]}"
echo
if [ "$ran" -eq 0 ]; then
  echo "No scanner could run. Install at least gitleaks, semgrep and osv-scanner; do not treat this as a pass."
  exit 2
fi
if [ "$failed" -gt 0 ]; then
  echo "$failed scanner(s) reported findings. Triage with .claude/skills/appsec-review/references/."
  exit 1
fi
echo "All scanners that ran were clean. Skipped scanners above were NOT run."
