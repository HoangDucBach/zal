# Writing review comments

A good comment names the problem, says why it matters, and gives the author something to do.
A bad one is vague, personal or unactionable.

## Contents
- The shape of a good comment
- Good vs bad pairs
- Phrases to avoid

## The shape of a good comment

`[label] file:line. What is wrong. Why it matters (the failing input or the cost). Suggested fix.`

Keep it to what the author needs to act. If a principle backs it up, name it in a few words.

## Good vs bad pairs

**Blocker**
- ❌ "This is insecure."
- ✅ `[blocker] orders/handler.py:42. get_order() loads by id only, so any signed-in user can read any order by changing the id in the URL. Scope the query by the caller: WHERE id = ? AND customer_id = ?, and add a test where user B requests user A's order (expect 404).`

**Should**
- ❌ "This function is too long."
- ✅ `[should] billing/charge.ts:15-110. charge() validates input, calls the gateway and formats the receipt in 95 lines, so the failure paths are hard to test. Extract validate() and formatReceipt(); the gateway call can then be tested with a fake.`

**Nit**
- ❌ "Ugly name, change it."
- ✅ `[nit] utils.py:8. data is generic; pending_orders would say what it holds.`

**Question**
- ❌ "Why did you do it this way?"
- ✅ `[question] queue/worker.rs:77. Is the unbounded channel intentional? If the producer outpaces the consumer, memory grows without limit. A bounded channel with back-pressure would avoid that.`

**Praise**
- ❌ "Nice!"
- ✅ `[praise] clock.ts. Putting time behind an interface makes the expiry test deterministic. Good pattern for the other services.`

## Phrases to avoid

| Instead of | Say |
|---|---|
| "You forgot to ..." | "This doesn't handle ... (the case where ...)" |
| "Obviously wrong" | The input that breaks it |
| "I would never do this" | The cost, and an alternative |
| "Just ..." | The concrete change |
| "Fix this" | What to change and why |
| "This might be a problem" | Either show the scenario, or ask a `question` |

## Tone

Assume good intent and limited context on both sides. The reviewer is helping the code, not
grading the person. If the code needs a long explanation to review, the fix is clearer code or
a better description, so ask for that rather than only answering in a thread.
