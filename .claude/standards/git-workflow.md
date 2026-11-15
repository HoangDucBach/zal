# Git workflow

> **Precedence:** the project's own branching model, commit conventions and CI rules win over
> this file. If you deviate from it, say why in the PR description.

History is documentation. Small, well-described changes are easier to review, revert,
bisect and release.

## Commits: Conventional Commits

```
<type>(<optional scope>): <imperative summary, ≤ 72 chars, no trailing period>

<body: what and why, not how; wrap at 72>

<footer: BREAKING CHANGE: …, Refs #123>
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `style`,
`revert`. A breaking change adds `!` (`feat(api)!: …`) and a `BREAKING CHANGE:` footer.
Rules from the spec are summarized in the next section. Lint with
`.claude/scripts/check_commit_msg.py`.

- **One logical change per commit.** Refactors and behavior changes go in separate commits, so
  reviewers can verify that the refactor changed nothing.
- **Every commit builds and passes tests**, so `git bisect` works.
- **No secrets, generated files or unrelated formatting churn.**
- **No co-author lines, ever.** Don't add `Co-authored-by` (or `Co-Authored-By`) trailers to any
  commit, including ones an agent helped write. Each commit has one author, and the history
  should show who owns the change. This overrides any default attribution text a tool offers.
  `.claude/scripts/check_commit_msg.py` and the `commit_msg_check` hook reject it.

### Conventional Commits 1.0.0: the rules

Structure: `type[(scope)][!]: description`, then an optional body, then optional footers, each
separated by one blank line.

1. The prefix is a type, an optional scope in parentheses, an optional `!`, then a colon and a space.
2. `feat` adds a feature (SemVer MINOR). `fix` patches a bug (PATCH). Other types are allowed and
   have no SemVer effect on their own.
3. The scope is a noun for a section of the codebase: `fix(parser): …`.
4. The description follows the colon and space and summarizes the change.
5. The body is free-form, may have several paragraphs, and starts one blank line after the description.
6. Footers start one blank line after the body. Each is `token: value` or `token #value`, and
   tokens use hyphens instead of spaces (`Reviewed-by`, `Refs`). `BREAKING CHANGE` is the exception.
7. A breaking change (SemVer MAJOR) can be on any type. Mark it with `!` before the colon, a
   `BREAKING CHANGE: <description>` footer, or both. With `!` the footer may be dropped.
   `BREAKING CHANGE` must be uppercase; `BREAKING-CHANGE` is a synonym.
8. Everything else is case-insensitive. This workflow still writes types in lowercase.

Practical notes:

- **Wrong type or message:** fix it with `git rebase -i` before the branch is shared. After that, add a
  new commit instead (see Merge policy). A non-standard type only means tools skip that commit.
- **Reverts:** the spec leaves them open. Use `revert: <original description>` with a
  `Refs: <sha>` footer naming the reverted commits. Messages git generates (`Revert "…"`,
  `Merge …`, `fixup!`) are not linted.
- **Squash merge:** contributors don't have to follow the spec on every WIP commit. The PR title,
  which becomes the squashed commit, must.

## Branches

- Use short-lived branches off `main` (trunk-based development): merged within a few days.
  Long-lived branches cause painful merges.
- Naming: `<type>/<issue>-<short-desc>`, e.g. `feat/123-oauth-login`, `fix/456-null-total`.
- `main` is protected: PR required, CI green, at least one approving review, no force pushes.
- Release branches (`release/1.4`) only if you support several versions in parallel.

## Pull requests

- **Small:** aim for under ~400 changed lines (excluding generated files and lockfiles).
  Review quality drops sharply above that. Split big work into stacked PRs or ship behind a
  feature flag. Check with `.claude/scripts/check_pr_size.sh`.
- **Described:** use `.claude/templates/pr.md` to say what, why, how it was tested, risks and
  rollback. Screenshots for UI changes.
- **Self-reviewed** before requesting review: read your own diff and remove debug code.
- **Up to date** with `main` before merging, and CI green on the merge result.

## Merge policy

| Strategy | Use when |
|---|---|
| **Squash merge** (default) | Most PRs: one clean commit per PR on `main` with the PR title as a Conventional Commit |
| **Rebase merge** | A PR whose individual commits are each meaningful and you want to keep them |
| **Merge commit** | Integrating long-lived branches (release back-merges) |

Rebase your own branch freely before review. After review starts, add commits instead of
force-pushing, so reviewers can see what changed. Never rewrite shared branch history.

## Versioning: SemVer

`MAJOR.MINOR.PATCH`: MAJOR for breaking changes, MINOR for backward-compatible features, PATCH
for backward-compatible fixes. Conventional Commit types map onto it (`feat` → minor, `fix` →
patch, `!` → major). Tags are `vX.Y.Z` and annotated. Detailed rules (pre-releases, 0.x) live in
`.claude/skills/release-management/references/semver-rules.md`.

## CHANGELOG

Keep `CHANGELOG.md` in Keep a Changelog format, written for users, not copied from the
commit log. Sections are Added, Changed, Deprecated, Removed, Fixed, Security, with an
`Unreleased` section at the top. Template: `.claude/templates/changelog.md`.

## Never

- Force-push to `main` or any shared branch.
- Commit with `--no-verify` to bypass hooks.
- Commit secrets. If one leaks, rotate it first, then clean history. Rewriting history alone
  doesn't un-leak a secret.

## Verify

`commitlint` or `.claude/scripts/check_commit_msg.py` in a commit-msg hook and in CI; branch
protection rules; PR size check in CI; `git log --oneline` reads like a changelog.

## Sources

- Conventional Commits 1.0.0 — https://www.conventionalcommits.org/en/v1.0.0/
- Semantic Versioning 2.0.0 — https://semver.org/
- Keep a Changelog 1.1.0 — https://keepachangelog.com/en/1.1.0/
- Google Engineering Practices, "Small CLs" — https://google.github.io/eng-practices/review/developer/small-cls.html
- Trunk-based development — https://trunkbaseddevelopment.com/
