# Definition of Done

A change is done when it is safe to ship and no one will need to ask "did you check ...?".
Light work applies the items that fit what changed. The full list is for deep mode, or on
request. Mark an item n/a with a reason; never leave it blank. Don't report done on trust:
each item needs evidence (the command you ran and its result).

## Behavior
- [ ] Every acceptance criterion is met, and each one is covered by a test.
- [ ] New behavior has tests; a bug fix has a regression test that failed before the fix.
- [ ] Edge cases and error paths are handled and tested (empty, invalid, unauthorized, failure).

## Quality
- [ ] Format, lint and type check pass using the project's own commands.
- [ ] Unit and integration tests pass; no tests skipped, weakened or deleted to get there.
- [ ] Changed code follows `.claude/rules/` (naming, structure, error handling, language rules).
- [ ] No debug output, commented-out code, dead code, or `TODO` without an owner or issue.
- [ ] No new duplication of knowledge, and no abstraction without a second use.

## Review
- [ ] Independent code review done by an agent or person other than the author, with no open
      blocker findings (`peer-review`).
- [ ] Review comments are resolved, or have a reply explaining why not.

## Security and privacy
- [ ] No secrets in code, config, tests, logs or docs; the secret scan is clean.
- [ ] Inputs validated, authorization checked per object, and output encoded where relevant.
- [ ] Security review done, with no open high or critical findings, if the change touches auth,
      input, personal data, dependencies or infrastructure (`appsec-review`).
- [ ] New dependencies are vetted; the lockfile is updated; SCA shows no new high vulnerabilities.
- [ ] New personal data is justified, classified, and kept out of logs.

## Operations
- [ ] Logs, metrics and alerts cover the new behavior; no secrets or personal data in telemetry.
- [ ] Migrations are backward-compatible and reversible, or have a documented plan.
- [ ] Config and secrets are in the environment; `.env.example` lists new variables.
- [ ] CI is green on the final commit.
- [ ] Rollback is known (revert, flag off, or migration down).

## Documentation
- [ ] README, API docs, comments (explaining *why*) and runbooks updated where behavior changed.
- [ ] CHANGELOG updated for user-visible changes; breaking changes are marked and have a migration path.
- [ ] ADR written for any hard-to-reverse decision.

## Hand-off
- [ ] The PR description states what changed, why, how it was tested, the risks, and the rollback.
- [ ] Follow-ups and known limitations are filed as issues, not left in your head.
