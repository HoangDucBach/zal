# Code structure

> **Precedence:** the project's own linter/formatter config and the style of the surrounding code
> win over this file. If you deviate from it, say why in the PR description.

The goal is code a reviewer can hold in their head. The limits below are signals to look
again, not hard caps.

## Size and nesting

| Signal | Look again when… | Why |
|---|---|---|
| Function length | over ~40 lines of logic | It is probably doing more than one thing |
| Parameters | more than 4 | Group them into a parameter object, or the function has too many jobs |
| Nesting depth | more than 3 levels | Each level multiplies the paths a reader must track |
| Class / module | over ~400 lines or ~15 public methods | Usually more than one responsibility |
| Boolean parameters | any `doThing(true)` | The call site is unreadable; use two functions or an options object |

## Guard clauses over nested conditionals

Handle invalid and edge cases first and return early, so the main path reads straight down.

```python
# ❌
def ship(order):
    if order:
        if order.paid:
            if order.items:
                return dispatch(order)
    return None

# ✅
def ship(order):
    if order is None or not order.paid or not order.items:
        return None
    return dispatch(order)
```

## Immutability and pure functions

- Make values immutable by default (`const`, `final`, `val`, `readonly`, frozen dataclasses).
  Mutation is where most state bugs come from; making it rare makes it visible.
- Keep calculations pure: same input, same output, no I/O. Push side effects to the edges.
  Pure code is trivially testable and safe to reuse.
- Don't mutate arguments. Return a new value instead.

## Dependency injection

Pass collaborators in (constructor or parameter) instead of creating them inside or reaching
for globals. This makes dependencies visible in the signature and lets tests substitute them.
Inject anything non-deterministic: clock, random, UUIDs, environment, network.

```ts
// ❌ Hidden dependency, untestable time
class TokenService { isExpired(t: Token) { return Date.now() > t.expiresAt; } }
// ✅
class TokenService { constructor(private readonly clock: Clock) {} isExpired(t: Token) { return this.clock.now() > t.expiresAt; } }
```

Use the framework's container if it has one (Spring, NestJS, Angular, .NET). Otherwise wire
things by hand in one composition root (`main`), not service locators scattered through the code.

## Module boundaries

- Each module exposes a small public surface (an index file, `__init__.py`, exported names)
  and hides the rest. Callers import from that surface, not from internal files.
- Dependencies point one way: UI → application → domain ← infrastructure adapters. The domain
  imports nothing from frameworks. See `.claude/standards/architecture.md` for the bigger picture.
- No dependency cycles between modules. A cycle means the boundary is wrong.
- Organize by feature (`billing/`, `orders/`) rather than by technical layer (`controllers/`,
  `services/`) once a codebase has more than a handful of features. Changes then stay local.

## Comments and dead code

- Comments explain **why** (a constraint, a trade-off, a link to the bug); the code says what.
- Delete dead code and commented-out code; git remembers it.
- A `TODO` carries an owner or issue link: `TODO(#123): remove after v2 migration`.

## Verify

Linter complexity rules: ESLint `complexity` / `max-depth` / `max-params`, Ruff `C901` / `PLR0913`,
Clippy `cognitive_complexity` / `too_many_arguments`. Dependency rules: `dependency-cruiser`
(TS), `import-linter` (Python), Cargo workspace boundaries (Rust).

## Sources

- Google Engineering Practices, "What to look for in a code review" — https://google.github.io/eng-practices/review/reviewer/looking-for.html
- Martin Fowler, *Refactoring* (2nd ed.)
- Mark Seemann, *Dependency Injection Principles, Practices, and Patterns*
