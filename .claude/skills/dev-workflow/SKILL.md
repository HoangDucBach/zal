---
name: dev-workflow
description: End-to-end orchestrator for software development tasks. Classifies the work (feature, bugfix, refactor, hotfix, infra), picks the lightest path that is still safe, hands each phase to the right skill or agent, and checks a quality gate before reporting a phase done. Use when the user asks to build, add, implement, fix, refactor or ship something non-trivial, says "full workflow", "end to end", "thorough", "production-ready", "kỹ", "đầy đủ", or runs /dev-workflow, even if they never name a phase. Not for a one-line edit or a plain question (just answer it), and not when one specific skill clearly covers the request (reviewing a diff is peer-review, a security audit is appsec-review).
compatibility: Designed for Claude Code with this workflow installed (.claude/rules, standards, security, scripts, checklists). Needs git and python3.
metadata:
  author: workflow
  version: 1.0.0
---

# Dev workflow

Run a software task from request to shipped change, with only as much process as the task
deserves. The point of a workflow is fewer surprises, not more ceremony: a typo fix that goes
through design review wastes everyone's time, and a payment change that skips review is a
risk nobody agreed to.

## Standards to load

Read these when you reach the phase that needs them, not up front:

- `.claude/CLAUDE.md` for the depth rule (already loaded in every session).
- `.claude/checklists/definition-of-ready.md` and `definition-of-done.md` for the entry and exit gates.
- `references/task-types.md` once you know the task type, for its exact path.
- `references/quality-gates.md` when checking or reporting a gate.
- `references/routing-table.md` when delegating to a skill or agent.

## Step 1: choose the depth

Default to **light**. Go **deep** only when the user asks for it ("thorough", "full review",
"production-ready", "kỹ", "chi tiết", "đầy đủ") or names a phase or skill. Between the two: if
a light change touches auth, payments, personal data, migrations or infrastructure, do the
light version, then say in one line what risk you saw and offer the deeper step. Don't take it
unasked. When unsure, pick light and say what a deeper pass would add.

| | Light (default) | Deep (on request) |
|---|---|---|
| Phases | Only those the task needs | All phases for the task type |
| Agents | You do the work yourself | Delegate per `references/routing-table.md` |
| Review | Self-check against Definition of Done items that fit | Independent `peer-review`, plus `appsec-review` when risky |
| Artifacts | None beyond the change and its tests | Design doc, ADR, threat model as the task calls for |

## Step 2: classify the task

Pick one type; read its path in `references/task-types.md`.

| Type | Signal |
|---|---|
| feature | New behavior or capability |
| bugfix | Existing behavior is wrong and the cause may be unknown |
| refactor | Same behavior, better structure |
| hotfix | Production is broken or exposed and time matters |
| infra | CI/CD, containers, IaC, observability, release plumbing |

If a request mixes types (a bugfix that needs a refactor first), split it and order the parts
so each is separately reviewable. Never hide a behavior change inside a refactor.

## Step 3: learn the project

Run `python3 .claude/scripts/detect_stack.py` (the SessionStart hook may already have printed
it). Use the project's own commands for test, lint, format and type check, and read the language
rule it points to. If the requirement is ambiguous in a way that would make a wrong guess
costly, ask one focused question before building; otherwise state your assumption and go on.

## Step 4: run the path

Follow the path for the task type. For each phase, invoke the skill named in the path, do the
work, then check that phase's gate (see `references/quality-gates.md`) before moving on.

- A gate passes only with **evidence**: the command you ran and what it printed, not "looks fine".
- If a gate fails, fix the cause and run it again. After three failed attempts, stop and tell
  the user what is blocking and what you tried. Don't weaken a test, skip a check or disable a
  hook to get through: that hides the problem from the people relying on the gate.
- The author never approves their own change. In deep mode, run `peer-review` and
  `appsec-review` in the `code-reviewer` and `security-auditor` agents, giving them the diff and
  acceptance criteria but not your reasoning, so they judge what the code does.
- Commit, push and open PRs only when the user asks. Ask before any destructive or
  outward-facing action (`.claude/security/agent-safety.md`).

## Step 5: report

End with a short status the user can scan, using this shape:

```
Task: <one line>   Type: <feature|bugfix|refactor|hotfix|infra>   Depth: <light|deep>
Done: <what changed, in two or three bullets>
Gates: Ready ✓  Design -  Tests ✓ (pytest: 12 passed)  Build ✓ (ruff, mypy clean)  Review -  Security -  CI -
Not done / risks: <what was skipped and why, anything to watch>
Next: <the deeper step you'd offer, or the follow-up>
```

Use `-` for gates that don't apply at this depth, and say why in "Not done". Never mark a gate
✓ that you did not actually run.

## Examples

**Light.** User: "add a `--json` flag to the export command."
Type: feature, light. Detect stack, read the neighboring flag handling, write a failing test for
`--json`, implement, run the project's tests and linter, report. No design doc, no agents.

**Deep.** User: "build the password-reset flow, production-ready, full process."
Type: feature, deep. requirement-analysis (including abuse cases) → threat model (auth change) →
system-design → task-breakdown → implement-feature per slice with tests first → independent
peer-review → appsec-review → docs and CHANGELOG. Report all gates with evidence.

**In between.** User: "add a column to the users table for phone number."
Light: write the migration and code. Then say: "This stores personal data and runs a
migration on a live table. I can add a retention/privacy check and a zero-downtime plan if you
want." Don't do them unasked.

## Troubleshooting

- **Unsure about depth.** Light, plus a one-line offer of what deep adds.
- **Project has no tests or linter.** Say so, write the tests for your change anyway, and note the gap in "Not done / risks".
- **A gate keeps failing.** Three tries, then stop and report the command, its output and your
  hypothesis. Don't loop forever and don't bypass.
- **Request spans several types.** Split it, order the parts, and tell the user the order.
- **A skill or agent named here isn't installed.** Do that phase yourself using the matching
  standard in `.claude/standards/` or `.claude/security/`, and say you did.
