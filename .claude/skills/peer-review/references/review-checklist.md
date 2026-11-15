# Review checklist (deep mode)

Questions to ask, in priority order. You don't need to write something for every question: they
are prompts for attention, not a form. Anything that fails becomes a finding with a label from
`severity-levels.md`.

## Contents
1. Design
2. Functionality
3. Complexity
4. Tests
5. Security quick pass
6. Naming
7. Comments and docs
8. Style and consistency
9. Operations

## 1. Design
- Does the change belong in this module and layer? Does it respect the dependency direction (`.claude/standards/architecture.md`)?
- Does it fit the existing patterns, or introduce a new one without a reason?
- Is this the right time and size? Should part of it be a separate change?
- Does it add a public API, a schema or a wire format? Those are expensive to change later.
- Is there an abstraction with one user, or duplicated knowledge that now has two homes?

## 2. Functionality
- Does it do what the description and acceptance criteria say, for the happy path and the edges?
- Edge cases: empty, one, many, maximum, invalid, duplicate, concurrent, unauthorized, time zones, partial failure.
- Error paths: are failures handled, typed and reported without leaking internals? Fail closed or open?
- Concurrency and ordering: races, retries without idempotency, work done twice, locks held across I/O.
- Backward compatibility: callers, stored data, API clients, running old versions during a deploy.
- Resource handling: connections, files, timeouts, unbounded loops, unbounded memory.

## 3. Complexity
- Can a new reader follow it in one pass? Is any function over about 40 lines or nested deeper than 3 (`.claude/rules/core/code-structure.md`)?
- Is it solving a problem nobody has yet (speculative options, hooks, layers)?
- Could it be simpler without losing anything? Is clever code hiding a straightforward idea?

## 4. Tests
- Is there a test for each behavior change, and a regression test for each bug fix?
- Would the test fail if the code were wrong? (Look for assertions that can't fail, mocks that return what is asserted, tests that don't call the code.)
- Do they test outcomes, not internals? Are they isolated, deterministic and readable?
- Missing: error paths, boundaries, permission denied, concurrency.
- Were any tests deleted, skipped or loosened? Why?

## 5. Security quick pass
Use `.claude/security/checklists/security-review-checklist.md`. At minimum:
- Authorization on every new endpoint and object access.
- Input validated at the boundary; no string-built SQL, shell or HTML.
- No secrets in code, config, tests or logs; no personal data in logs.
- New dependency vetted, lockfile updated.
If the change is in a risky area, recommend `appsec-review` rather than reviewing deeply here.

## 6. Naming
- Do names say what things are and do? Are they consistent with the codebase (`.claude/rules/core/naming.md`)?
- Boolean names read as questions; units are in the name where the type doesn't carry them.

## 7. Comments and docs
- Do comments explain why, not what? Any stale, misleading or commented-out code? `TODO`s with an owner?
- Are the README, API docs, CHANGELOG and runbooks updated where behavior changed?
- Public functions documented in the language's format?

## 8. Style and consistency
- Does it follow the language rule and the project's formatter? (If a tool can enforce it, it isn't a review comment.)
- Does it match the surrounding file's conventions? Unrelated formatting churn mixed into the diff?

## 9. Operations
- Logging, metrics and alerts for new behavior; no noise or secrets (`.claude/standards/logging-observability.md`).
- Configuration through the environment; `.env.example` updated; feature flag for risky rollouts.
- Migrations reversible and zero-downtime (`.claude/rules/core/database.md`); rollback is known.
- Performance: N+1 queries, unbounded results, work in hot paths (`.claude/standards/performance.md`).
