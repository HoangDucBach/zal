# Code review

> **Precedence:** the project's own review process (required reviewers, CODEOWNERS, labels)
> wins over this file.

Review exists to keep the codebase healthy over time, not to make each change perfect. The
standard from Google's engineering practices: **approve once the change clearly improves the
overall health of the code, even if it isn't perfect.** There is no perfect code, only better code.

## What reviewers look for (in priority order)

1. **Design:** does the change belong here, fit the architecture, and is now the right time for it?
2. **Functionality:** does it do what the author intended and what users need? Look at edge
   cases, concurrency, error paths, and backward compatibility.
3. **Complexity:** could it be simpler? Will the next reader understand it quickly? Is there
   over-engineering for hypothetical futures?
4. **Tests:** are there correct, meaningful tests that would fail if the code broke? Are they
   simple and maintainable? (`.claude/rules/core/testing.md`)
5. **Security:** input validation, authZ on every object, secrets, injection, sensitive data in
   logs. (Deep review: the `appsec-review` skill.)
6. **Naming:** do names say what things are? (`.claude/rules/core/naming.md`)
7. **Comments:** do they explain *why*? Are there stale comments, or TODOs without owners?
8. **Style:** does it follow the language rules and the project's formatter? Style that a
   formatter could fix is the tool's job, not a review comment.
9. **Documentation:** README, API docs, CHANGELOG and runbooks updated if behavior changed.

Read every line you're asked to review. Look at the change in the context of the whole file
and system, not only the diff.

## Severity labels

Every comment carries a label, so the author knows what blocks the merge:

| Label | Meaning | Blocks merge? |
|---|---|---|
| **blocker** | Bug, security issue, data loss risk, broken contract, missing tests for new behavior | Yes |
| **should** | Clear improvement to design, readability or robustness; fix now or file an issue | Usually; the author can push back with reasons |
| **nit** | Minor preference or polish | No |
| **question** | You don't understand something; the answer may lead to a change | Until answered |
| **praise** | Something done well, worth repeating | No |

Examples and comment templates are in `.claude/skills/peer-review/references/`.

## How to write comments

- Comment on the code, never the person: "This loop re-reads the file each time", not "you
  wrote a slow loop".
- Explain *why*, and suggest a concrete fix or alternative.
- Distinguish facts and principles from personal preference. Preferences are nits at most.
- If the code needs explaining in review, ask for it to be clearer in the code itself (better
  names, a comment), not only in the review thread.

## Speed

A slow review blocks the author and encourages big PRs. Respond within one business day
(sooner is better). For large changes, give design feedback first, before line-level comments.

## For authors

Keep PRs small (`.claude/standards/git-workflow.md`), describe the why, self-review first, and
respond to every comment: either change the code or explain why not. Don't take comments
personally; the reviewer is helping the code, not grading you.

## Independence

The agent or person who wrote a change doesn't approve it. In this workflow the
`code-reviewer` agent reviews using only the diff and the acceptance criteria, so the review
judges what the code does rather than what the author meant.

## Verify

The output of a review is a list of labelled findings with `file:line`, plus a verdict:
**approve**, **approve with comments**, or **request changes** (any blocker). The format is in
`.claude/skills/peer-review/references/review-output-template.md`.

## Sources

- Google Engineering Practices, "How to do a code review" — https://google.github.io/eng-practices/review/reviewer/
- "What to look for in a code review" — https://google.github.io/eng-practices/review/reviewer/looking-for.html
- "The standard of code review" — https://google.github.io/eng-practices/review/reviewer/standard.html
- "Speed of code reviews" — https://google.github.io/eng-practices/review/reviewer/speed.html
- Conventional Comments — https://conventionalcomments.org/
