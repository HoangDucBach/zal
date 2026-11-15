# Quality gates

A gate is a question with an observable answer. Pass it with evidence, fail it honestly. The
gates below run in order; a task only needs the gates for the phases its depth includes.

## Contents
- Gate table
- Evidence rules
- When a gate fails

## Gate table

| Gate | Passes when | Evidence to show | Checked by |
|---|---|---|---|
| **Ready** | Goal, testable acceptance criteria and scope are written down | The criteria list; `.claude/checklists/definition-of-ready.md` items (light: the "Always" group) | planner / you |
| **Design approved** | A design exists for the change, and the user (or owner) accepted it | Design doc or short written proposal, plus the user's go-ahead | architect, then the user |
| **Tests written** | Acceptance criteria each map to a test, and new tests fail for the right reason before the code | Test names, and the failing run (red) output | test-engineer / implementer |
| **Implementation checks** | Project's format, lint, type check and tests pass | The exact commands and their summary lines (for example `pytest -q: 41 passed`) | implementer |
| **Code review** | No blocker findings from a reviewer who did not write the code | The review report with verdict | code-reviewer (`peer-review`) |
| **Security review** | No high or critical findings; scanners ran (or are named as skipped) | The report, scanner summary, verdict | security-auditor (`appsec-review`) |
| **CI green** | The pipeline passes on the final commit | Link or status of the run | you / devops-engineer |
| **Docs updated** | README, API docs, CHANGELOG and runbooks match the behavior | The changed doc files | doc-writer |
| **Release** | `.claude/checklists/release-checklist.md` and the pre-release security checklist are complete | The checked lists | release-manager |

## Evidence rules

- **Run it yourself.** Another agent's "tests pass" doesn't count until you've seen the output, or it's clearly quoted.
- **Quote the command and the result.** "Ran `npm test`: 58 passed, 0 failed" beats "tests pass".
- **State what was not run.** A scanner that isn't installed is "skipped", never "clean". A test suite that doesn't exist is "no tests", never "passes".
- **Independence.** Review gates count only when the reviewer is not the author (a separate agent, or the user).

## When a gate fails

1. Read the failure; don't skim it. Find the cause.
2. Fix the cause, then re-run the gate. Don't re-run hoping for a different result, except for a flaky test, which you report as flaky.
3. Do not weaken the gate: no deleting or loosening tests, adding skips or ignores, `--no-verify`, or disabling a scanner. These hide the problem and the hooks block them.
4. After three attempts, stop. Report: the gate, the command, the output, what you tried, your current hypothesis, and what you need from the user.
5. A finding you disagree with (review or scanner) gets a written reason and the user's call, not silent dismissal.
