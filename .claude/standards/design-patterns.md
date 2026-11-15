# Design patterns

> **Precedence:** the project's established patterns and framework idioms win over this file.
> Introducing a new pattern into an existing codebase is a design decision; mention it in the PR.

A pattern is a name for a solution to a recurring problem. Use one when you actually have
that problem. A pattern applied without the problem is just indirection. Many patterns
collapse to a function or a lambda in modern languages, so use the lightest form.

## Creational

| Pattern | Use when | Avoid when |
|---|---|---|
| **Factory** (function or method) | Creation logic varies by input or config, or callers shouldn't know the concrete type | A plain constructor call is clear enough |
| **Builder** | Many optional parameters, or step-wise construction of an immutable object | ≤ 4 fields; the language has named or default arguments (Kotlin, Python, C#) |
| **Singleton** | Almost never. Prefer one instance wired at the composition root | Always reconsider: it is global mutable state that hides dependencies and breaks tests |

## Structural

| Pattern | Use when | Avoid when |
|---|---|---|
| **Adapter** | Wrapping a third-party or legacy API behind your own interface (the anti-corruption layer) | You own both sides; change one instead |
| **Decorator** | Adding cross-cutting behavior (caching, retry, metrics, logging) without changing the wrapped object | The behavior is core to the object; or the chain gets deeper than ~3 and becomes hard to debug |
| **Facade** | Giving a simple entry point to a complex subsystem | It becomes a god object that every module depends on |
| **Proxy** | Lazy loading, access control or remote access with the same interface | A decorator or adapter says what you mean more clearly |

## Behavioral

| Pattern | Use when | Avoid when |
|---|---|---|
| **Strategy** | Interchangeable algorithms chosen at runtime (pricing rules, export formats) | There's only one algorithm; a function parameter or lambda is enough |
| **Observer / pub-sub** | Several independent reactions to an event, where the producer shouldn't know its consumers | Order or failure handling matters; implicit control flow makes debugging hard |
| **Command** | Undo/redo, queuing, auditing, or retrying operations as objects | A direct method call suffices |
| **State** | An object's behavior changes with explicit states and transitions (order lifecycle) | Two states; an enum and a `switch` are clearer |
| **Template method** | A fixed algorithm with customizable steps | You can compose with strategies instead (preferred; avoids inheritance) |
| **Chain of responsibility** | A pipeline of handlers (middleware, validation) | The order is unclear or every handler must run anyway |

## Enterprise and application

| Pattern | Use when | Avoid when |
|---|---|---|
| **Repository** | Hiding persistence behind a collection-like domain interface; testing the domain without a DB | Thin CRUD where the ORM already is the repository; don't wrap it again just to wrap it |
| **Unit of Work** | Coordinating several repository changes in one transaction | The framework already provides it (EF `DbContext`, SQLAlchemy `Session`) |
| **Service layer / use case** | Orchestrating domain objects and infrastructure for one application operation | Logic belongs on the domain object itself (avoid an anemic domain) |
| **DTO / mapper** | Decoupling wire or persistence shapes from domain types | Internal calls inside one module |
| **CQRS** | Read and write models differ a lot in shape or scale; complex read views | Simple CRUD. CQRS doubles the models to maintain |
| **Event sourcing** | Audit history is a core requirement; temporal queries; rebuilding projections | Most systems. It is costly to evolve and hard to query ad hoc |
| **Outbox** | Publishing events reliably together with a DB write | Single-process apps with no broker |
| **Saga** | Multi-service workflows that need compensation instead of distributed transactions | Everything fits in one transaction |
| **Circuit breaker** | Protecting callers from a repeatedly failing dependency | In-process calls |
| **Specification** | Composable business rules reused across queries and validation | A single, simple predicate |

For CQRS, event sourcing, outbox, saga and circuit breaker in depth (how they work, what goes
wrong, and how to combine them), plus anti-corruption layer, retry with backoff, publish-subscribe,
scatter-gather, strangler fig, hexagonal architecture and API routing, see
`.claude/standards/cloud-design-patterns.md`.

## Anti-patterns to flag in review

God object or service, anemic domain model (getters and setters only, logic everywhere else),
service locator, shotgun surgery (one change touches many files), primitive obsession (strings
for emails, money as float), deep inheritance hierarchies, and speculative generality
(`AbstractBaseFactoryProvider`).

## Verify

In review, ask "what problem does this pattern solve here, and what would the code look like
without it?" If the answer without it is shorter and just as clear, remove the pattern.

## Sources

- Gamma, Helm, Johnson, Vlissides, *Design Patterns* (GoF)
- Martin Fowler, *Patterns of Enterprise Application Architecture* — https://martinfowler.com/eaaCatalog/
- Martin Fowler, "CQRS" — https://martinfowler.com/bliki/CQRS.html
- Refactoring.Guru, design patterns catalog — https://refactoring.guru/design-patterns
- Microservices.io patterns — https://microservices.io/patterns/
