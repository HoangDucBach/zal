# Documentation

> **Precedence:** the project's existing doc structure, docstring style and doc tooling win
> over this file.

Documentation is for the reader who arrives with no context: a new teammate, the on-call
engineer at 3 a.m., or you in six months. Write the minimum that lets them act, and keep it
next to the code so it changes with the code.

## What to document, and where

| Audience | Document | Location |
|---|---|---|
| New contributor | README: what it is, how to run, test and deploy it | `README.md` (template: `.claude/templates/readme.md`) |
| API consumer | Reference generated from the code or spec, plus examples | OpenAPI / proto / GraphQL schema; docstrings |
| Maintainer | Why the code is the way it is | Comments, ADRs (`docs/adr/`, template `.claude/templates/adr.md`) |
| Operator | How to run, monitor and recover it | Runbook (`docs/runbooks/`, template `.claude/templates/runbook.md`) |
| User of a release | What changed | `CHANGELOG.md` (`.claude/standards/git-workflow.md`) |

## Comments explain why

The code says *what*. Comments are for what the code can't say: intent, constraints,
trade-offs, workarounds, and links to issues or specs.

```python
# ❌ Restates the code
# Increment retries by one
retries += 1

# ✅ Explains a non-obvious constraint
# The payment provider rate-limits per card, so retry with the same idempotency key
# rather than a new one, or the customer is charged twice (see INC-2041).
retries += 1
```

- Delete comments that have become wrong. A misleading comment is worse than none.
- Don't commit commented-out code or journal comments ("changed by X on date"); git has that.

## Docstrings and API docs

- Every public function, class, module and endpoint gets a docstring: what it does, its
  parameters and return value, the errors it raises, and any side effects. Use your language's
  format (Google-style docstrings, JSDoc/TSDoc, Javadoc, KDoc, GoDoc, rustdoc, XML docs); see
  the Docs section of `.claude/rules/languages/<lang>.md`.
- Document the contract, not the implementation, so the docstring stays true after a refactor.
- Include a short example for anything non-obvious. Doctests or compiled examples keep examples honest.

## README essentials

A README answers, in this order: what this is and who it's for; quick start (prerequisites,
install, run in ≤ 5 commands); configuration (env vars, linking `.env.example`); how to test;
how to deploy; architecture overview (one diagram); where to get help or report issues.

## Writing style

- Lead with the answer. Use short sentences, active voice, and second person ("Run `make test`").
- Copy-pasteable commands in fenced code blocks, with the language set.
- Descriptive link text ("see the deploy runbook"), never "click here".
- Diagrams as code (Mermaid, PlantUML) so they're reviewed and diffed like code.
- Markdown: one `#` title, ATX headings (`##`) without skipping levels, fenced code blocks with
  a language, and `1.` lazy numbering for long lists (Google Markdown style guide).

## Keep it current

- Docs change in the same PR as the behavior they describe. The PR template asks about it.
- Generated reference docs are built in CI. Broken links fail the build (`lychee`, `markdown-link-check`).
- Delete docs for removed features.

## Verify

`markdownlint`, link checking, doc-coverage linters (`interrogate`, ESLint `jsdoc/require-jsdoc`,
`revive` exported-comment rule, Clippy `missing_docs`), and a reviewer who tries the README
quick start on a clean machine.

## Sources

- Google developer documentation style guide — https://developers.google.com/style
- Google documentation guide (docguide) — https://google.github.io/styleguide/docguide/
- Diátaxis documentation framework — https://diataxis.fr/
- Google Python style, docstrings — https://google.github.io/styleguide/pyguide.html#38-comments-and-docstrings
