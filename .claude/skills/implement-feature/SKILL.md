---
name: implement-feature
description: Implements a feature or behavior change test-first (red, green, refactor) in small verified steps, using the project's own conventions and tooling and this workflow's rules. Use when the user asks to add, build, implement, create or extend functionality such as endpoints, components, commands, functions or integrations, or says "make X work", even if tests are never mentioned. Not for a bug whose cause is unknown (use debug-root-cause), restructuring with no behavior change (use refactor), or design and planning only (use system-design or task-breakdown).
compatibility: Designed for Claude Code with this workflow installed (.claude/rules, standards, security, scripts). Needs git and python3; uses the project's own test, lint and type-check commands.
metadata:
  author: workflow
  version: 1.0.0
---

# Implement a feature

Build the change in small steps where a test proves each one. Writing the test first matters for
a practical reason: it forces the acceptance criterion to be precise before there is code to bend
it, and a test you have seen fail for the right reason is the only kind you can trust when it passes.

## Standards to load

- The language rule for the files you will touch (`.claude/rules/languages/`; `python3 .claude/scripts/detect_stack.py` lists which apply). It also names the formatter, linter and test commands.
- `.claude/rules/core/testing.md` for how to structure tests.
- `.claude/standards/design-patterns.md` only if you're choosing a structure (strategy, repository, adapter).
- `.claude/security/input-output.md` whenever the feature accepts input or touches files, queries or URLs; `.claude/security/auth-session.md` when it involves identity or permissions; `.claude/security/secure-coding.md` for the quick check at the end.
- `references/tdd-loop.md` the first time you start the loop, or when a step is hard (no tests exist, tests are slow, the code is tightly coupled).

## Depth

Default to **light**: restate the criteria in a few lines, run the loop, verify, report. No design
doc, no agents, no checklist beyond the items that fit. Go **deep** when the user asks for it
("thorough", "production-ready", "kỹ", "đầy đủ") or the feature is large or risky: write the
acceptance criteria out as Given/When/Then, check the design first (`system-design`), build one
vertical slice at a time, run the full Definition of Done (`.claude/checklists/definition-of-done.md`),
and recommend independent `peer-review` (and `appsec-review` for auth, input, data, dependencies or infra).

## Steps

1. **Understand.** State the goal and the acceptance criteria in two to five lines, plus any
   assumptions. Ask a question only if a wrong guess would be costly; otherwise proceed and make
   the assumption visible so the user can correct it.
2. **Learn the project.** Run `python3 .claude/scripts/detect_stack.py`. Read two or three
   neighboring files to match structure, naming, error handling and test layout. Search for an
   existing helper before writing a new one: duplicated knowledge drifts apart.
3. **Pick the first slice.** The smallest piece that delivers observable behavior (one endpoint
   path, one rule, one command flag). List the later slices; don't build them yet.
4. **Red.** Write one failing test for that behavior. Run it and confirm it fails for the right
   reason (the assertion, not a typo or an import error). Keep the output; it is your evidence.
5. **Green.** Write the simplest code that passes. Resist extras the criteria don't ask for.
6. **Refactor.** With tests green, clean up: names, duplication (extract on the third use, not
   the first), structure (`.claude/rules/core/code-structure.md`). Re-run the tests after each change.
7. **Repeat** steps 4 to 6 for the next behavior, including error paths and edge cases (empty,
   invalid, unauthorized, large, concurrent). Each criterion ends up with a test.
8. **Verify.** Run the project's format, lint, type check and the relevant tests, with the exact
   commands from `detect_stack.py` or the project's scripts. Everything must pass, using the
   project's real configuration.
9. **Self-check the diff** against the Definition of Done items that fit: no debug code or
   commented-out code, no secrets, inputs validated, authorization checked, errors handled,
   docs and CHANGELOG updated if behavior changed. Read your own diff as a reviewer would.
10. **Report** using the format below.

## Rules of the road

- A test that is hard to write usually means the code is too coupled. Introduce a seam (inject
  the dependency, pass the clock in) instead of skipping the test.
- Never weaken a test to get green: no deleting assertions, `skip`, or changing the expected value
  to match wrong output. Fix the code, or stop and explain why the test is wrong.
- Stay in scope. Note unrelated problems you see; don't fix them in this change.
- Commit, push or open a PR only when the user asks (`git-commit-pr` helps when they do).
- Where TDD is genuinely impractical (exploratory UI, thin glue), still add at least one
  integration or smoke test, or give exact manual steps, and say that is what you did.
- If you cannot run the tests (missing services, secrets), say so plainly and say what you did instead.

## Output format

```
Implemented: <what now works, in one or two lines>
Tests: <n added, names of the key ones>. Red first: <the failing run's key line>
Checks: <command: result> for tests, lint, types, format
Decisions / assumptions: <anything the user should confirm>
Not done / risks: <skipped items, follow-ups, areas that deserve peer-review or appsec-review>
```

## Quality gate

Each acceptance criterion maps to a test. The tests failed before the code and pass now. The
project's own format, lint, type check and tests pass. No unrelated changes. You can show the
command output for each claim.

## Examples

**Light.** User: "add a `slugify` util and use it for post URLs." Detect stack (TypeScript, vitest).
Red: tests for spaces, accents, punctuation, empty input. Green: the function. Wire it into the URL
builder with one more test. Run `pnpm test` and `pnpm lint`. Report. Done in a few minutes.

**Deep.** User: "implement the login endpoint, production-ready." Criteria written as Given/When/Then
(including lockout and generic errors), design checked against `.claude/security/auth-session.md`,
slices: happy path, bad password, lockout, session rotation. Tests first for each. Full DoD run.
Recommend `appsec-review` before merge, because it changes authentication.

## Troubleshooting

- **No tests exist in the project.** Add a test file next to the code in the language's usual
  framework, mention that you introduced it, and keep it minimal.
- **Tests are slow or need services.** Run the focused subset while iterating, then the full
  suite once at the end. Say which you ran.
- **The first test passes immediately.** Then it isn't testing new behavior. Tighten it until it fails.
- **Requirements are contradictory.** Stop, show the contradiction, and ask.
- **The change turns out to be large.** Stop after the first slice, show it, and propose the split
  (`task-breakdown`) instead of delivering one huge change.
