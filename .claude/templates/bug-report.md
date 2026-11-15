# Bug: Short, specific title (symptom, not guess at cause)

- **Severity:** Critical | High | Medium | Low (see `.claude/skills/incident-postmortem/references/severity-definitions.md`)
- **Environment:** production | staging | local, version or commit, OS/browser/runtime
- **Reported by / date:**
- **First seen / regression from:** version or commit, if known

## What happened

The observed behavior, with the exact error message, status code or screenshot.

## What should have happened

The expected behavior, and where it is specified (acceptance criteria, docs, API contract).

## Steps to reproduce

1. Smallest set of steps, starting from a known state.
2. Include the input data, user role and any configuration that matters.
3. ...

**Reproducibility:** always | intermittent (rate) | once

## Evidence

Logs (secrets and personal data redacted), stack trace, request ID or trace ID, metrics, links.

## Impact

Who and how many are affected, whether there is data loss or a security exposure, and any
workaround.

## Analysis (filled in during debugging)

- **Root cause:** the actual defect, not the symptom. Use 5 Whys until you reach something you
  can change.
- **Why it wasn't caught:** which test, review or monitor should have found it.

## Fix and prevention

- **Fix:** link to the PR.
- **Regression test:** the test that fails before the fix and passes after it.
- **Prevention:** follow-ups (a missing test, lint rule, alert, or validation) with owners.
