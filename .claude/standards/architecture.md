# Architecture

> **Precedence:** the project's existing architecture and documented ADRs win over this file.
> Changing the architecture is itself a decision that needs an ADR.

Architecture is the set of decisions that are expensive to change later. Make those decisions
deliberately, write down why, and keep everything else easy to change.

## Choose the simplest shape that fits

| Style | Use when | Avoid when |
|---|---|---|
| **Layered** (presentation → application → domain → infrastructure) | CRUD-heavy apps, small teams, simple domains | Business rules are complex and leak into controllers |
| **Clean / hexagonal** (ports and adapters) | Rich domain logic; several entry points (HTTP, queue, CLI); need to swap infrastructure or test the domain in isolation | Thin CRUD over a database, where the ports add only ceremony |
| **Modular monolith** | The default for new products: clear module boundaries, one deployable | Teams that need independent deploy cadence or scaling *today* |
| **Microservices** | Many teams that must deploy independently; parts with very different scaling or availability needs; boundaries already proven | Small team, unclear domain boundaries, no platform for observability, CI/CD and on-call per service |
| **Event-driven** | Decoupled reactions to facts, fan-out, audit trails, integrating systems | You need synchronous consistency and simple debugging |

Microservices trade code complexity for operational complexity: network failures, distributed
transactions, versioned contracts, and tracing across services. Start with a modular monolith
and extract a service when a boundary has proven stable and there is a concrete reason (team
autonomy, scaling, isolation). The patterns that make that migration, and the resulting distributed
system, safe (strangler fig, anti-corruption layer, saga, transactional outbox, circuit breaker,
retry with backoff) are in `.claude/standards/cloud-design-patterns.md`.

## Dependency rule

Source dependencies point inward, toward the domain:

```
[HTTP / CLI / queue consumers] → [application / use cases] → [domain model]
                                              ↑ implements ports
                                 [infrastructure adapters: DB, HTTP clients, brokers]
```

- The domain has no imports from frameworks, ORMs or transport libraries.
- Use cases orchestrate. They hold no SQL, no HTTP and no UI logic.
- Adapters translate between the outside world and domain types, including errors (see
  `.claude/rules/core/error-handling.md`).

## Module boundaries in a monolith

- Organize modules by business capability (`billing`, `catalog`, `identity`), each with a public
  API and private internals.
- Modules talk through that public API or through domain events, never by reading another
  module's tables.
- Enforce boundaries with tooling (ArchUnit, `import-linter`, `dependency-cruiser`, Nx module
  boundaries, Go `internal/`), because conventions alone erode.

## Data ownership and consistency

- Each service or module owns its data. Sharing a database between services creates a
  distributed monolith.
- Across boundaries, prefer eventual consistency with events. Use the outbox pattern for
  reliable publishing, and sagas with compensating actions for multi-step workflows.
- Strong consistency belongs inside one boundary, in one transaction.

## Cross-cutting concerns

Decide these once per system and document them: authN/authZ, configuration, logging/metrics/
tracing (`.claude/standards/logging-observability.md`), error model
(`.claude/rules/core/api-design.md`), feature flags, and multi-tenancy.

## Architecture Decision Records

Write an ADR for any decision that is hard to reverse or that someone will later ask "why?"
about: choosing a datastore, a framework, a service boundary, a sync vs async integration, an
auth model, or a deviation from these standards.

- Template: `.claude/templates/adr.md`. Store ADRs in `docs/adr/NNNN-title.md`.
- ADRs are immutable once accepted. Change a decision by writing a new ADR that supersedes
  the old one, so the history of reasoning stays intact.
- Keep each ADR short: context, decision, alternatives considered, consequences.

## Quality attributes drive the design

Name the two or three quality attributes that matter most (latency, availability, cost,
time-to-market, compliance) and design for them explicitly. Record the trade-offs you accepted.
"Highly available, low latency and cheap" without numbers is not a requirement; get SLO targets.
To check a design against all six qualities at once (operational excellence, security, reliability,
performance efficiency, cost optimization, sustainability) instead of only the one in front of you,
use `.claude/standards/well-architected.md`.

## Verify

Architecture tests in CI (ArchUnit, `import-linter`, `dependency-cruiser` rules), a current
C4 context and container diagram in the README or `docs/`, and ADRs for every significant decision.

## Sources

- Robert C. Martin, *Clean Architecture*
- Alistair Cockburn, "Hexagonal Architecture" — https://alistair.cockburn.us/hexagonal-architecture/
- Martin Fowler, "MonolithFirst" — https://martinfowler.com/bliki/MonolithFirst.html
- Michael Nygard, "Documenting Architecture Decisions" — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- C4 model — https://c4model.com/
- Microservices.io patterns (saga, outbox) — https://microservices.io/patterns/
