# Error handling

> **Precedence:** the project's own linter/formatter config and the style of the surrounding code
> win over this file. If you deviate from it, say why in the PR description.

Errors are part of the interface. Callers need to know what can fail, operators need enough
context to diagnose it, and users need a message they can act on that leaks nothing.

## Never swallow errors

An empty `catch` turns a loud failure into silent data corruption. Handle the error, add
context and re-raise it, or let it propagate. Do one of these and nothing else.

```java
// ❌
try { charge(card); } catch (Exception e) { }

// ✅ Add context, keep the cause
try { charge(card); }
catch (PaymentDeclinedException e) { throw new CheckoutException("charge failed for order " + orderId, e); }
```

If ignoring an error is really correct, catch the narrowest type and leave a comment explaining
why it's safe.

## Typed, specific errors

- Throw or return error types the caller can distinguish (`NotFoundError`, `ValidationError`,
  `ConflictError`). Don't make callers parse message strings.
- Catch the narrowest type you can handle. Catching `Exception`/`Throwable`/bare `except:` is
  only acceptable at a top-level error boundary.
- Use the language's idiom: exceptions in Python/TS, `Result` with `?` in Rust (discriminated
  result unions in TS where errors are expected outcomes). Don't mix styles within one module.
- Keep the cause chain (`raise … from e`, `new Error(msg, { cause })`, `.context()` / `#[source]` in Rust).

## Error boundaries

Translate errors once, at the boundary of each layer:

| Boundary | Responsibility |
|---|---|
| Adapter (DB, HTTP client, queue) | Convert vendor errors into domain errors |
| Application / use case | Decide: retry, compensate, or surface |
| Transport (HTTP handler, CLI, UI) | Map to status code / exit code / message; log once with context |

Log an error once, where it is handled, not at every layer it passes through. Duplicate logs
make incidents harder to read.

## User-facing vs internal messages

- **Users** see a stable, actionable message and a correlation ID: "Payment failed. Try another
  card. (ref: 7f3a…)".
- **Logs** get the details: the cause chain, inputs (with secrets and PII redacted) and the
  correlation ID.
- Stack traces, SQL, file paths and internal hostnames never reach the user. They help
  attackers map the system (OWASP A10).

## Retries, backoff and idempotency

- Retry only transient failures (timeouts, 429, 503, connection reset), never validation or auth
  errors.
- Use exponential backoff with jitter, a maximum attempt count and an overall deadline.
  Respect `Retry-After`.
- Only retry operations that are idempotent. Make writes idempotent with an idempotency key or
  a natural unique constraint, so a retried request doesn't charge twice.
- Set a timeout on every network call. A missing timeout turns a slow dependency into an outage.
- For repeated downstream failures, use a circuit breaker so you fail fast instead of piling up.

## Fail fast on invalid state

Validate inputs at boundaries and assert invariants. Crash on programmer errors (impossible
states) rather than limping on. Resources are released on every path (`try/finally`, `with`,
`using`, `defer`, RAII).

## Verify

- Linters: ESLint `no-empty`, `@typescript-eslint/no-floating-promises`; Ruff `BLE001`, `S110`,
  `E722`; Clippy `unwrap_used`, `expect_used`, and the `#[must_use]` warnings.
- Tests: every error path the code handles has a test asserting the error type and that no
  partial write happened.

## Sources

- Google Go style, errors — https://google.github.io/styleguide/go/best-practices#error-handling
- Google Java style, caught exceptions — https://google.github.io/styleguide/javaguide.html#s6.2-caught-exceptions
- OWASP Top 10:2025, A10 Mishandling of Exceptional Conditions — https://owasp.org/Top10/
- AWS Builders' Library, "Timeouts, retries and backoff with jitter" — https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
