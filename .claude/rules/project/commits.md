# Commits: Conventional Commits 1.0.0

Spec: https://www.conventionalcommits.org/en/v1.0.0/

Every commit in this project follows it. This rule is project-owned and always loaded; it is not
part of the shared workflow, so re-running `install.sh` does not touch it.

## Format

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`.
- `feat` adds behaviour (MINOR); `fix` repairs a bug (PATCH).
- Description: imperative, lowercase start, no trailing period, header at most 72 characters.
- Body and footers are separated from the header by a blank line.
- Breaking change: `!` after the type or scope, and/or a `BREAKING CHANGE: <what breaks>` footer.
- One logical change per commit. Do not mix a refactor with a behaviour change.
- No `Co-authored-by` trailers (the workflow hook rejects them).

## Scopes (suggested, keep them consistent)

`account`, `registry`, `invoice`, `pool`, `vault`, `factory`, `web`, `indexer`, `docker`, `docs`, `deps`.
Use the contract, package or service the change lives in. Omit the scope when a change spans several.

## Zal specifics

- Cite requirement or test IDs in the body or footer, e.g. `Refs: ZR-PAY-01, AT-09`.
- Changes to invariants or acceptance tests need their own commit with the reason in the body.

## Check before committing

```
python3 .claude/scripts/check_commit_msg.py "feat(invoice): add escrowInvoice"
python3 .claude/scripts/check_commit_msg.py --file .git/COMMIT_EDITMSG
```

Exit 0 means valid. The same check runs automatically as a hook on `git commit`.
