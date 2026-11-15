---
paths:
  - "**/*_test.*"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test_*.py"
  - "**/conftest.py"
  - "**/*Test.java"
  - "**/*Test.kt"
  - "**/*Tests.cs"
  - "**/*Tests.swift"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
  - "**/spec/**"
  - "**/e2e/**"
  - "**/{jest,vitest,playwright,cypress,karma}.config.*"
  - "**/pytest.ini"
---

# Testing

> **Precedence:** the project's own test framework, config and existing test style win over
> this file. If you deviate from it, say why in the PR description.

Tests exist so the team can change code without fear. A test suite that is slow, flaky or
coupled to implementation details gets ignored and stops doing that job.

## Test pyramid: most tests small and fast

| Level | Share | Scope | Speed |
|---|---|---|---|
| Unit | Most | One unit of behavior, no real I/O | ms |
| Integration | Some | Real DB/queue/filesystem via containers (Testcontainers) or in-memory fakes | seconds |
| Contract | At service boundaries | Consumer-provider agreement (Pact, schema checks) | seconds |
| End-to-end | Few | Critical user journeys only | minutes |

A bug found by an e2e test should usually get a unit or integration test that pins the root cause.

## Structure: Arrange, Act, Assert

```python
def test_applies_discount_when_order_exceeds_threshold():
    # Arrange
    order = Order(items=[Item(price_cents=12_000)])
    # Act
    total = checkout_total(order, discount=TenPercentOver(10_000))
    # Assert
    assert total == 10_800
```

One behavior per test. Several assertions are fine if they check one outcome.

## FIRST

- **Fast**, so people run them constantly.
- **Isolated**: no shared mutable state, any order, parallel-safe.
- **Repeatable**: no real clock, randomness, network or locale. Inject or freeze them.
- **Self-validating**: a pass or fail result, with no reading of logs.
- **Timely**: written with the code (TDD where it helps), not after the fact.

## Naming

The name states the behavior and the condition, so a failure explains itself:
`test_rejects_expired_token`, `returnsEmptyListWhenNoOrdersMatch`, `TestParse_InvalidDate_ReturnsError`.
Follow the framework's convention (`describe/it`, `@DisplayName`, Go subtests).

## What to mock

- **Mock at the boundaries you own**: your repository interface, your payment gateway adapter.
  Don't mock types you don't own (ORM, HTTP library) or the unit under test.
- **Prefer fakes and real objects** over deep mock chains. A test that stubs ten calls is
  testing the implementation and breaks on every refactor.
- **Assert on outcomes** (return values, state, published events) rather than on which
  internal methods were called. Interaction checks are for real side effects, such as
  "an email was sent".

## Coverage: meaningful, not vanity

- Target behavior coverage: every acceptance criterion, error path and edge case has a test.
  Line coverage of ~80% on changed code is a useful floor, not a goal. 100% line coverage
  with no assertions proves nothing.
- Check the edge cases: empty input, one item, maximum size, boundaries (off-by-one), unicode,
  time zones/DST, concurrency, and permission denied.
- Bugs get a regression test that fails before the fix and passes after it.
- Mutation testing (Stryker, mutmut, PIT) is the honest measure for critical modules.

## Test data and flakiness

- Build data with factories/builders that set only what the test cares about.
- Each test creates and cleans up its own data. Don't depend on seed rows or on test order.
- Don't use `sleep` to wait for async work. Await the condition with a timeout instead.
- A flaky test gets fixed or quarantined with an issue link. Don't retry it until it passes:
  the flakiness often signals a real race condition.

## TDD loop

Red (write a failing test for the next behavior) → Green (the simplest code that passes) →
Refactor (clean up with tests green). It works best for business logic and bug fixes, and is
optional for exploratory UI or glue code.

## Never weaken a test to make it pass

Deleting assertions, loosening matchers, adding `skip`, or changing expected values to match
buggy output hides the bug. Fix the code, or stop and explain why the test is wrong.

## Verify

Run the project's test command (see `.claude/rules/languages/<lang>.md`) with coverage. Use
the coverage diff in CI (`diff-cover`, Codecov patch coverage) to check new code.

## Sources

- Google Testing Blog — https://testing.googleblog.com/
- Software Engineering at Google, ch. 11–14 (testing) — https://abseil.io/resources/swe-book
- Martin Fowler, "The Practical Test Pyramid" — https://martinfowler.com/articles/practical-test-pyramid.html
- Kent Beck, *Test-Driven Development: By Example*
