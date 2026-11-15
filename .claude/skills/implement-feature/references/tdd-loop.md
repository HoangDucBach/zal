# The TDD loop in practice

Red (a failing test), green (the simplest code that passes), refactor (clean up, tests green).
This file covers the parts that go wrong in real projects.

## Contents
- Choosing the first test
- Keeping the loop small
- Red must be real
- Green: fake it, then generalize
- Refactor: what to change
- Existing code without tests
- Slow, coupled or awkward code
- Shape of a test per language

## Choosing the first test

Start from the acceptance criteria, not from the code you imagine. Make a short test list and
take the simplest behavior first, because an easy first test gets the structure in place:

1. Degenerate case (empty input, zero, none).
2. A simple happy path.
3. The next distinct rule.
4. Error and edge cases (invalid, unauthorized, boundary).

Add to the list as you discover cases. Don't write all the tests at once: each one should teach
you something before the next.

## Keeping the loop small

A step is a few minutes and a few lines. If you've gone ten minutes without running the tests,
the step was too big: stop, revert to the last green state, and take a smaller one. Small steps
make failures easy to locate: the cause is in the last few lines.

## Red must be real

Run the new test before writing code and read the failure message.

- Right reason: the assertion fails ("expected 10800, got 0") or the function doesn't exist yet.
- Wrong reason: a typo, a missing import, a broken fixture, a timeout. Fix the test until it fails
  for the behavior you're about to add.
- If it passes immediately, it tests nothing new. Either the behavior exists already, or the test is too weak.

## Green: fake it, then generalize

The simplest passing code is fine, even a hard-coded return. The next test will force the real
logic ("triangulation"). If the real implementation is obvious and small, write it directly. Don't
add parameters, options or branches that no test demands.

## Refactor: what to change

Only with tests green, and re-run after each edit.

- Names that don't say what things are. Duplicated knowledge (extract on the third use).
- Long functions, deep nesting, mixed concerns (I/O inside a business rule).
- Test code too: duplicated setup becomes a builder or fixture; keep the tests readable.
- Don't add behavior while refactoring. If you spot a missing case, add it to the test list.

## Existing code without tests

You can't safely change what you can't check. Before modifying it:

1. Write characterization tests that record what the code does now (even if it looks wrong).
2. Make your change test-first on top of them.
3. Note, but don't fix, bugs you discover unless they're in scope.

For a restructuring with no behavior change, use the `refactor` skill.

## Slow, coupled or awkward code

- **Hidden dependencies** (clock, network, database, global config): inject them, pass them as
  parameters, or wrap them in a small interface. This is the usual reason a test feels hard to write.
- **Slow tests:** keep logic in pure functions tested without I/O; use a real database or service
  (container) for a few integration tests, not for every case.
- **Framework glue and UI:** test the logic you can extract; cover the wiring with one integration
  or smoke test; give manual steps for what can't be automated.
- **Flaky tests:** find the nondeterminism (time, order, shared state, `sleep`). Don't retry until green.

## Shape of a test per language

Match the project's framework; these show the structure only. Commands for each project come from
`python3 .claude/scripts/detect_stack.py`.

**TypeScript (Vitest or Jest)**
```ts
describe("slugify", () => {
  it("replaces spaces with hyphens and lowercases", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
});
```

**Python (pytest)**
```python
def test_rejects_expired_token(clock):
    token = make_token(expires_at=clock.now() - timedelta(seconds=1))
    with pytest.raises(TokenExpired):
        verify(token, clock=clock)
```

**Rust**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rejects_empty_input() {
        assert!(matches!(parse(""), Err(ParseError::Empty)));
    }
}
```
