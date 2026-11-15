# 0004 — Payment may come before the due date; the timeline is a replay
Status: accepted

## Context
Demo step 7 drags the timeline to the due date and then pays. A live Avalanche L1 cannot warp time.

## Decision
`payInvoice` accepts payment of an approved invoice at any time. The pool fixes its fee when it pays the advance, so an early payment does not change the split. The timeline is a client-side replay of indexed events plus projected due dates. Only escrowed invoices become payable by anyone, and only once `dueDate` has passed.

## Consequences
- The demo runs on the live L1 with real transactions.
- A buyer paying early pays the full face value. Early-payment discounts are out of scope.
