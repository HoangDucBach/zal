# Design principles

> **Precedence:** the project's own linter/formatter config and the style of the surrounding code
> win over this file. If you deviate from it, say why in the PR description.

These principles are judgment calls, not laws. Each one says when it helps and when it hurts.
Use them to choose between designs and to explain the choice in a review.

## KISS and YAGNI: the simplest thing that meets today's requirement

Every abstraction, option and layer is code someone has to read, test and keep working. Code
for a requirement that never arrives is pure cost.

```python
# ❌ A plugin registry for a single exporter that nobody asked to extend
class ExporterRegistry: ...
registry.register("csv", CsvExporter)

# ✅ Call it directly; introduce the registry when the second exporter is real
export_csv(rows, path)
```

When not to apply: public APIs, wire formats and database schemas are expensive to change
later. Spend design time on them up front.

## DRY: one home for each piece of knowledge

Duplicated *knowledge* (a business rule, a constant, a schema) drifts apart. Duplicated-looking
*code* that changes for different reasons is not duplication. Merging it couples unrelated
features.

- **Rule of three:** tolerate the second copy and extract on the third, once you can see what
  actually varies.
- The wrong abstraction costs more than duplication. If an abstraction keeps growing flags to
  serve its callers, inline it back.

## SOLID

| Principle | In one line | Smell when it's violated |
|---|---|---|
| **S**ingle responsibility | A module has one reason to change (one actor it serves) | "And" in the class name; unrelated tests in one file |
| **O**pen/closed | Add behavior by adding code, not by editing a growing `switch` | The same `if type == …` chain in several places |
| **L**iskov substitution | A subtype works wherever its parent is expected | Overrides that throw `NotSupported` or tighten preconditions |
| **I**nterface segregation | Clients depend only on the methods they use | Mocks that stub ten methods to test one |
| **D**ependency inversion | Business logic depends on abstractions; I/O implements them | Domain code importing the HTTP client or ORM directly |

When not to apply: an interface with exactly one implementation and no test seam is
ceremony. Add it when a second implementation or a test needs it.

## Separation of concerns

Keep I/O (HTTP, DB, files, clock, randomness), business rules and presentation in separate
units, so each can be tested and changed alone.

```ts
// ❌ Rule, I/O and formatting tangled together
async function handler(req) { const u = await db.query(...); if (u.age > 17) res.send(`<b>${u.name}</b>`); }

// ✅ Pure rule in the middle, I/O at the edges
const isAdult = (user: User) => user.age >= ADULT_AGE;
```

## Law of Demeter

Talk to direct collaborators, not their internals. `order.customer.address.city` couples you to
three structures. Ask the owner instead: `order.shippingCity()`. Fluent builders and data
pipelines are fine; the rule is about reaching through objects, not about the number of dots.

## Composition over inheritance

Inheritance couples a subclass to its parent's implementation details. Prefer small objects
combined through interfaces. Use inheritance for true "is-a" relationships that are stable and
shallow (no more than 2 levels).

## Fail fast

Validate inputs at the boundary and stop on the first invalid state, with a message that says
what was expected. A crash near the cause is cheaper to debug than corrupt data found later.
See `.claude/rules/core/error-handling.md`.

## Principle of least astonishment

Code should do what its name and signature suggest. A `get` should not write, a `validate`
should not mutate, and a function should not behave differently based on hidden global state.

## High cohesion, low coupling

Group together what changes together; keep dependencies between groups few, explicit and
one-directional. If a one-line change touches five modules, the boundaries are in the wrong place.

## Verify

These are judgment calls, so review checks them. Tooling can flag symptoms: cyclomatic
complexity (`radon`, ESLint `complexity`), dependency cycles (`madge`, `import-linter`,
`go vet`), and duplication (`jscpd`, PMD CPD).

## Sources

- Hunt & Thomas, *The Pragmatic Programmer* (DRY)
- Robert C. Martin, *Clean Architecture* (SOLID)
- Sandi Metz, "The Wrong Abstraction" — https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction
- Martin Fowler, "Yagni" — https://martinfowler.com/bliki/Yagni.html
- Google Engineering Practices — https://google.github.io/eng-practices/
