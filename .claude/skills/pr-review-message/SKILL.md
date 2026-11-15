---
name: pr-review-message
description: Use when asked to review a pull request. Checks it against the ticket's acceptance criteria, then conventions and patterns, then regressions, and ends with a review message in a fixed markdown format ready to paste on the PR.
---

# Review a PR and draft the message

Never post anything on the PR (no `gh pr review`, no comments) unless the user asks. The output is a draft.

## 1. Gather

- `gh pr view <n> --json title,headRefName,baseRefName,author,isDraft,body,commits,reviews,comments` and `gh pr checks <n>`.
- `gh pr diff <n> > <scratchpad>/pr.diff`. Read every non-test hunk, then the tests.
- Review in a throwaway worktree, not the user's checkout: `git fetch origin pull/<n>/head:pr-<n>`, `git worktree add <scratchpad>/pr<n> pr-<n>`, symlink `frontend/node_modules` from the main repo. Remove the worktree and the local `pr-<n>` branch when done.
- Line numbers in findings are the PR head's, not main's. Take them from the worktree (`grep -n`, `sed -n`) or from the diff hunk headers.

## 2. Acceptance criteria first

Take the ticket text the user pasted. Work through it for yourself (the table is not part of the message; a missed AC becomes a finding). Per AC: each AC and each scope item, a verdict (met, partly, not met, cannot verify here), and the evidence (file and line, or a test name).

- Every call site, file or flow the ticket names must be found in the diff. A named site that is missing is a finding, even when it looks unused (grep its callers and say so).
- State what cannot be verified from code (real wallet, staging, other browsers). Do not mark it met.
- Check that the PR body claims match the diff (counts, file names).

## 3. Conventions and patterns

- Does the new code reuse an existing helper or re-implement it? Grep for the same expression elsewhere (`grep -rn`, no `--include` under zsh).
- Does it follow the surrounding file's naming, comment density, quotes, import style, hook and test layout?
- Unrelated hunks (formatter-only changes, renames) are a nit.
- Repeated glue across call sites is a suggestion to move it into the shared hook.
- Read the repo's CLAUDE.md files for traps in the area touched.

## 4. Regressions

Answer each from the code, not from memory:

- Paths the ticket says must not change (login, link, other flows): are they absent from the diff, and does anything they read now behave differently?
- Terminal and edge states: signed out, hydrating, failed, cancelled, no account, empty list.
- Ordering: does a new async step run before or after a network call or a user gesture it depends on?
- Effects: does a new effect run on every mount, loop, or fire without a click when it should not?
- Dependents: who consumed the old values (props, test ids, copy)? Grep them.
- New failure paths: which message does the user now see?

## 5. Run the real tools in the worktree

Targeted `pnpm vitest run <dirs touched>`, `pnpm exec tsc --noEmit`, `pnpm exec biome check <changed files only>`. Compare any Biome or test failure against `origin/main` before calling it pre-existing, and say which ones are.

Read CI: say which checks failed and whether the cause is the diff (Vercel "must be a member" and Endor findings on unrelated packages are not).

## 6. The message

Write it in English, for the PR. Use exactly this shape, counts first:

```
### **Issue counts by severity**
bugs: <n>
suggestions: <n>
nits: <n>

<Two sentences at most: whether the PR meets the ticket, and the one thing to fix first.>

**Verified:** <One line: what was run and the result, plus what could not be verified.>

**Findings**
- [bug]: <what is wrong and the input or state that triggers it>. `path/to/file.ts` L<line>. <Fix.>
- [suggestion]: <what to change and why>. `path/to/file.ts` L<line>. <Suggested change.>
- [nit]: <what>. `path/to/file.ts` L<line>.
```

Rules:

- Severity words are only `bug`, `suggestion`, `nit`. The counts must equal the number of findings listed.
- A bug has a concrete failing scenario. If it cannot be reproduced or reasoned to a failure, it is a suggestion.
- Every finding names the file and the line, and says what to do.
- A nit is rare and must pass three checks, and `nits: 0` is a normal result:
  1. The author would actually change it, and leaving it costs the next reader something real.
  2. It is not required by a tool (check the formatter or linter before calling a reformatted hunk "unrelated": a change the formatter needs is not noise).
  3. It is not out of scope per the ticket, and not a taste choice (two small copies of a few lines, a type duplicated with no drift risk, where a helper could live).
  Before sending, re-read every nit against these checks and delete the ones that fail.
- One finding per point. No praise padding, no restating the diff.
- If a finding was not verified, say so in the same line.
- Do not include the author's pronouns. Use the author's handle or "you".

Reply to the user in Vietnamese, short: the verdict, the counts, the one or two things that matter, then the message block. Do not repost anything.
