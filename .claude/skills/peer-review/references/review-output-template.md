# Review report template

Use this shape for the report. Keep it scannable: the verdict and the blockers come first, because
that is what the author needs to act on. Drop sections that are empty.

## Contents
- Template
- Rules
- Filled example

## Template

```markdown
## Review: <what was reviewed: PR number, branch, or paths>

**Verdict:** approve | approve with comments | request changes
**Scope:** <files and lines reviewed; base compared against>   **Reviewer:** <independent agent | self-review>
**Intent assumed:** <one line, if there was no description>
**Checks run:** <commands and results, or "not run: reason">

### Blockers (<n>)
1. `path/to/file.ext:LINE`: <what is wrong>. <Why it matters: the input or state that breaks it>. **Fix:** <concrete change>.

### Should fix (<n>)
1. `path/to/file.ext:LINE`: <issue>. <Why>. **Fix:** <change>.

### Nits (<n>)           <!-- deep mode, or when asked -->
- `path/to/file.ext:LINE`: <note>.

### Questions (<n>)
- `path/to/file.ext:LINE`: <what you need to know and why it affects the review>.

### Good
- <specific thing worth keeping>

### Recommendations
- <for example: run appsec-review (touches auth); split the PR; add a rollback note>
```

## Rules

- Order findings by importance within each section, not by file.
- Every finding has a location. If it is about the whole change, use `(general)`.
- The verdict follows the labels: any blocker means `request changes`; no blockers but shoulds
  means `approve with comments`; nothing worth fixing means `approve`.
- Counts in the headings match the list.
- Don't restate the diff. Don't pad with praise.
- Say what you did not review (generated files, files you could not read) so the author knows
  where the review stops.

## Filled example

```markdown
## Review: feat/order-lookup (vs main)

**Verdict:** request changes
**Scope:** 4 files, 138 changed lines   **Reviewer:** self-review (I wrote this change earlier in the session)
**Checks run:** `pytest -q`: 41 passed; `ruff check .`: clean

### Blockers (1)
1. `orders/handler.py:42`: `get_order()` loads by id only, so any signed-in user can read any order by changing the id. **Fix:** scope the query by the caller (`WHERE id = ? AND customer_id = ?`) and add a test where user B requests user A's order and gets 404.

### Should fix (1)
1. `orders/retry.py:18`: the loop catches `Exception` and returns `None` after the last attempt, so a failed lookup looks like "not found". **Fix:** re-raise the last error with the order id in the message.

### Recommendations
- This adds a customer-facing endpoint: run `appsec-review` before merging.
```
