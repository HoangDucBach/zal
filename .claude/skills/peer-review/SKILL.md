---
name: peer-review
description: Senior code review of a diff, branch, set of files or local change against the project's conventions and this workflow's rules, producing findings labelled blocker, should or nit, each with file and line, a reason, a suggested fix and a final verdict. Use when asked to review, check, critique or "look over" code, to self-review before opening a PR, or right after finishing a change that someone else will merge. Not for security audits or threat models (use appsec-review), not for writing the fix (a review only reports; the author changes the code), and not for drafting the paste-ready message on a GitHub PR checked against a ticket's acceptance criteria (use pr-review-message).
compatibility: Designed for Claude Code with this workflow installed (.claude/rules, standards, security, scripts). Needs git and python3. Read-only, it never edits the code under review.
metadata:
  author: workflow
  version: 1.0.0
---

# Peer review

Review a change the way a careful senior engineer would: judge whether it makes the codebase
healthier, say exactly what needs to change and why, and be clear about what blocks the merge.
The goal is not a perfect change; it is that the change clearly improves the code and doesn't
hurt the people who maintain it next.

## Standards to load

- `.claude/standards/code-review.md`: what to look for and the severity labels.
- The language rule for the files in the diff (`.claude/rules/languages/`). It usually loads on its own when you read the file.
- `.claude/rules/core/testing.md` if the diff has tests or should have.
- `.claude/security/checklists/security-review-checklist.md` for the quick security pass. A deep security review is `appsec-review`.
- `references/severity-levels.md` before assigning a label, `references/review-checklist.md` in deep mode, `references/comment-examples.md` when unsure how to word a finding, and `references/review-output-template.md` for the report shape.

## Depth

Default to **light**: the user wants the important problems, not an audit.

| | Light (default) | Deep (asked for, or a large or risky change) |
|---|---|---|
| Findings | Blockers and shoulds only, most important first, about 7 at most; nits only if asked | Everything, including nits, grouped by file |
| Checks | The project's lint, types and tests, if they run in under a couple of minutes | Plus the full checklist in `references/review-checklist.md` |
| Who reviews | You | A fresh `code-reviewer` agent given the diff and acceptance criteria |
| Security | Quick pass using the checklist; recommend `appsec-review` when the change touches auth, input, data, dependencies or infra | Same, and run it if asked |

## Steps

1. **Scope the change.** Review what the user named (a PR number, branch, paths). Otherwise
   review the branch against its base plus uncommitted work:
   `git diff $(git merge-base origin/main HEAD)` (try `main` or `master` if there is no `origin/main`).
   If there is nothing to review, say so and ask. Run `bash .claude/scripts/check_pr_size.sh`:
   over about 400 changed lines, say the change is too big to review well and start with design-level
   feedback and a suggested split.
2. **Learn the intent.** Read the PR description, commit messages, linked issue and acceptance
   criteria. If there are none, state your reading of the intent in one line and review against that.
   A change can be flawless and still solve the wrong problem.
3. **Check independence.** If you wrote this change earlier in the session, say so: your review is a
   self-review and shares your blind spots. In deep mode, hand it to the `code-reviewer` agent with
   only the diff and the criteria, not your reasoning.
4. **Run the checks.** Use `python3 .claude/scripts/detect_stack.py` to find the project's lint,
   type check and test commands, and run them. A failure is a finding. Don't fix it. If you can't
   run something, say so in the report rather than skipping silently.
5. **Read every changed line in context.** Open the whole function or file, not just the hunk. Read
   the tests alongside the code: do they fail if the code is wrong?
6. **Review in priority order**: design, functionality, complexity, tests, security (quick pass),
   naming, comments, style, docs. Spend your attention on the top of the list; don't comment on
   formatting a tool would fix.
7. **Write findings** with `references/review-output-template.md`. Each one has a label, `file:line`,
   what is wrong and why it matters, and a concrete fix. A blocker needs a failing scenario: the
   input or state that breaks it. Something you suspect but cannot show is a `question`.
8. **Give a verdict**: `approve`, `approve with comments`, or `request changes` (any blocker).

## Rules of the road

- Review only. Don't edit, reformat or "quickly fix" the code under review. The author owns the change, and a reviewer who edits stops being independent.
- Comment on the code, not the person. Explain why, and suggest a fix.
- Separate facts and principles from preference. Preferences are nits at most.
- If the diff touches something the rules forbid (swallowed errors, hard-coded secrets, tests weakened to pass), that is a blocker regardless of how small it is.
- Praise something only when it's specific and worth repeating.

## Quality gate

Before reporting, check: every changed file was read; every blocker has a failing scenario; the
verdict matches the labels (any blocker means `request changes`); the commands you ran, and the
ones you couldn't, are named.

## Examples

**Light.** User: "review my changes." Scope: branch vs `main`, 140 lines. Run lint and tests (pass).
Findings: one blocker (the new `/orders/{id}` handler never checks the order belongs to the caller),
one should (the retry loop swallows the final exception), no nits listed. Verdict: request changes.

**Deep.** User: "do a thorough review of PR 482 before I merge." Fetch the diff, read the linked issue,
spawn `code-reviewer` with the diff and acceptance criteria, collect findings including nits, note
that the PR adds a dependency and a new upload endpoint and recommend `appsec-review`, deliver the
full report.

## Troubleshooting

- **No base branch found.** Ask which branch to compare against, or review the staged and unstaged changes.
- **The diff is huge or generated.** Say so, review the hand-written parts and the design, and ask for a split. Don't pretend to have read generated files.
- **Tests can't run here** (missing services, secrets). Say so, and review the tests by reading them.
- **You disagree with the project's established pattern.** Follow the pattern; mention the concern as a `nit` or a note, not a blocker.
