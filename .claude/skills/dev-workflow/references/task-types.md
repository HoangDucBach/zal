# Task types and their paths

Read the section for the task type you chose. "Light" lists what to do by default; "Deep" adds
what runs when the user asked for the full process. A phase marked *skip* never runs at that depth.

## Contents
- Feature
- Bugfix
- Refactor
- Hotfix
- Infra

## Feature

New behavior. The path is longest here, so this is where scaling matters most.

| Phase | Light | Deep | Skill / agent |
|---|---|---|---|
| Ready | Restate the goal and acceptance criteria in two or three lines | Full user stories, Given/When/Then, edge cases, NFRs, DoR checklist | requirement-analysis / planner |
| Design | Skip, unless the change adds a component, an API or a data model | Design doc, ADR for hard-to-reverse decisions, API contract first | system-design / architect |
| Plan | Skip | Vertical slices with order and estimates | task-breakdown / planner |
| Build | Test first, implement, refactor | Same, one slice at a time, small commits | implement-feature / implementer |
| Verify | Project's format, lint, type check, tests | Plus integration and e2e where they exist | write-tests / test-engineer |
| Review | Self-check against DoD items that fit | Independent peer-review; appsec-review if it touches auth, input, data, dependencies or infra | peer-review, appsec-review / code-reviewer, security-auditor |
| Ship | Only if asked: Conventional Commit, PR from template | Plus CHANGELOG, docs, CI green | git-commit-pr, documentation |

Threat model is required (any depth) for a new service, an auth change, new external input, or
new personal data: `.claude/security/threat-modeling.md`. At light depth, flag the need and
offer; do not skip the check silently.

## Bugfix

The cause may be unknown, so understanding comes before changing code.

1. **Reproduce.** Get a failing case: a command, a request or a test. If you can't reproduce it, say so and gather evidence instead of guessing a fix.
2. **Root cause.** Isolate, form a hypothesis, verify it (debug-root-cause). Fix the cause, not the symptom.
3. **Failing test first.** A regression test that fails for the reported reason.
4. **Minimal fix.** Smallest change that makes the test pass. Resist drive-by cleanups.
5. **Verify.** Full test suite and linter; confirm the original reproduction is fixed.
6. **Review.** Light: self-check. Deep: peer-review, and appsec-review if the bug was a security issue (then also check for the same pattern elsewhere).
7. **Prevent (deep).** Note why it wasn't caught and add the missing test, check or alert.

## Refactor

Behavior must not change, so the tests are the safety net.

1. **Pin behavior.** Make sure tests cover what you'll touch; if not, write characterization tests that record current behavior first (refactor skill).
2. **One change at a time.** Rename, extract, move, simplify: each step keeps the tests green. Commit between steps.
3. **No behavior changes mixed in.** If you find a bug, note it and fix it in a separate change.
4. **Verify.** The same tests pass without modification; lint and types clean.
5. **Review.** Light: self-check that the diff is structure only. Deep: peer-review, with the reviewer told this is behavior-preserving.

## Hotfix

Production is hurt now. Speed matters, but skipping review is how a hotfix causes the next incident.

1. **Stabilize first** if there's a faster mitigation than a code fix (roll back, flag off). Do that, then fix properly.
2. **Reproduce and find the cause** as fast as you can; don't guess.
3. **Smallest possible fix** with a regression test.
4. **Expedited review, not skipped.** peer-review and appsec-review on the minimal diff (minutes, not hours). Say what was expedited.
5. **Ship carefully.** Deploy progressively if possible, watch the metrics, have the rollback ready.
6. **Follow up.** Postmortem (incident-postmortem) and the proper fix for anything left as a stopgap.

## Infra

CI/CD, containers, IaC, observability, release plumbing. Mistakes here have a wide blast radius.

1. **Understand the current setup** and the environments it affects.
2. **Change in code** (never click-ops in shared environments): ci-pipeline, containerize, infrastructure-as-code, or observability-setup.
3. **Validate locally** with the linters and scanners (`.claude/rules/core/devops.md` lists them) and a `plan` or dry run.
4. **appsec-review** on every infra change (permissions, network exposure, secrets, supply chain). Light depth: run `.claude/scripts/run_scanners.sh` and report.
5. **Review** with peer-review; for risky changes, a rollback plan before applying.
6. **Apply** only with the user's go-ahead for anything affecting shared or production environments.
