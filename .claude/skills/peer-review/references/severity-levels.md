# Severity levels

Every finding carries one label. The label tells the author what blocks the merge, so choosing it
well matters more than anything else in the report.

## Contents
- Labels
- How to decide
- Examples per label

## Labels

| Label | Meaning | Blocks the merge? |
|---|---|---|
| **blocker** | Merging this would cause a defect, a security or data risk, or a broken contract | Yes |
| **should** | A real improvement to design, readability or robustness; the code works without it | Usually; the author may push back with reasons |
| **nit** | Minor polish or preference | No |
| **question** | You can't tell whether something is a problem | Until answered |
| **praise** | A specific thing worth repeating | No |

## How to decide

Ask in this order and stop at the first yes:

1. **Can I describe a concrete input or state that makes it fail, lose data, expose data or violate a requirement?** Then it is a **blocker**. If you can't describe one, it isn't a blocker; it is a `should` or a `question`.
2. **Would a future maintainer be meaningfully slowed down or misled, or is a cheap failure mode left open?** Then it is a **should**.
3. **Is it about taste, polish or a convention a formatter would not enforce?** Then it is a **nit**. Many nits in one place are noise: pick the pattern, mention it once.
4. **Am I unsure what the code is meant to do?** Then it is a **question**.

Escalation: a thing that is normally a `should` becomes a **blocker** if it is a rule violation
this workflow treats as non-negotiable (swallowed errors, secrets in code, tests weakened to pass,
missing tests for new behavior).

## Examples per label

**blocker**
- `GET /invoices/{id}` returns any invoice to any signed-in user. (Authorization missing; user B reads user A's data.)
- A migration drops a column the running version still reads. (Deploy breaks during rollout.)
- A new test is added with `skip` so CI passes. (A weakened check.)
- The retry loop catches `Exception` and returns `None`, so a failed payment looks successful.

**should**
- A 90-line function mixes validation, database access and formatting; split along those lines.
- The new helper duplicates `formatMoney` in `utils/currency.ts`; reuse it so the rules stay in one place.
- Error messages say "failed" with no context; include the order id so the logs are searchable.
- The test asserts on a mock call count, so it breaks on any refactor; assert on the outcome.

**nit**
- Rename `data` to `pendingOrders`.
- This comment restates the code; drop it or explain why.
- Prefer early return to the nested `if` (the code is correct either way).

**question**
- Is the 30-second timeout intentional? The upstream SLA is 10 seconds.
- Does this path run for imported orders too, or only manual ones?

**praise**
- Good call isolating the clock behind an interface; the test for expiry is now deterministic.
