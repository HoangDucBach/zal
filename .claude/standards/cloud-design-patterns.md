# Cloud design patterns

> **Precedence:** the project's existing architecture, messaging stack and cloud provider win over
> this file. The patterns are provider-neutral; the AWS services named here are examples, so use the
> equivalent managed service on another cloud. Adding a pattern to an existing system is an
> architecture decision: record it in an ADR (`.claude/templates/adr.md`).

These patterns solve problems that appear once a system is split into services that talk over a
network, keep their own data and fail independently. Each one adds moving parts, so use a pattern
when you have its problem, not because it is on the list. The basic one-line catalog (Strategy,
Repository, CQRS and so on) is in `.claude/standards/design-patterns.md`; this file goes deeper on
the distributed-system patterns from the AWS Prescriptive Guidance catalog. Architecture styles
and ADRs: `.claude/standards/architecture.md`.

## Which pattern for which problem

| Problem | Pattern | Usually combined with |
|---|---|---|
| Move a monolith to services without a big-bang rewrite | Strangler fig | Anti-corruption layer, API routing |
| A new service must talk to a legacy or external system with a different model | Anti-corruption layer | Strangler fig |
| One slow or failing dependency drags its callers down | Circuit breaker | Retry with backoff |
| Calls fail briefly (throttling, network blips, short outages) | Retry with backoff | Circuit breaker, idempotent operations |
| Write to a database and publish an event, atomically | Transactional outbox | Idempotent consumers, saga |
| A business transaction spans several services, each with its own database | Saga (choreography or orchestration) | Transactional outbox, event sourcing |
| Tell several independent consumers that something happened | Publish-subscribe | Dead-letter queues, idempotent consumers |
| Ask many sources in parallel and merge the answers | Scatter-gather | Publish-subscribe, timeouts |
| Need a full audit trail, replay, or several read models from one source of truth | Event sourcing | CQRS, transactional outbox |
| Keep domain logic independent of databases, UIs and external APIs | Hexagonal architecture | Domain-driven design |
| Expose many services behind one API surface | API routing (hostname, path or header) | Strangler fig, API gateway |

If none of these rows matches your problem, you probably don't need a pattern yet.

## Anti-corruption layer (ACL)

**Intent:** a translation layer that lets one system keep its own model while talking to another
whose model differs. It stops the other system's concepts from leaking into yours.
**Use when:** a migrated service's model no longer matches its old callers; you can't change the
other system; you call an external system you don't control.
**Watch for:**
- It is another component to run, monitor and release. Latency and a scaling ceiling come with it.
- It can become a single point of failure: give it retries and a circuit breaker.
- If it is a stopgap during a migration, record it as technical debt with a removal date and delete it when the last caller has moved. Permanent ACLs rot.
- Decide up front whether it is service-specific (a class or adapter per migrated service) or a shared service.

**On AWS:** an adapter class inside the monolith calls the new service through Amazon API Gateway
(for example to a Lambda function); callers never see the new interface.

## API routing: hostname, path, header

Three ways to expose many services as HTTP APIs:

| Method | Looks like | Choose it when | Costs |
|---|---|---|---|
| Hostname | `billing.api.example.com` | Teams should own everything including DNS; easy isolation per region or version | Consumers juggle many hostnames; a new subdomain per service; client SDKs |
| Path | `api.example.com/billing` | One entry point and one set of docs for consumers | An extra hop of latency; a shared gateway whose misconfiguration can hit every service; needs mature change management |
| Header | `x-service-action: get-thing` | Version routing, feature flags, A/B tests | You control the clients; proxies and CDNs can limit header size; usually combined with hostname or path routing |

Path routing options on AWS:
- **Reverse proxy** (NGINX, Kubernetes ingress): cheap at very high volume, but you operate and test it.
- **API gateway** in proxy mode: use wildcard paths (`/billing/*`) so the root gateway isn't edited for every API change. Gives authorization, tracing, WAF and throttling; cost grows with volume.
- **CDN with edge routing** (CloudFront with Lambda@Edge): good if you want caching and custom routing such as canaries; there is a cap on origins and changes take minutes to propagate.

## Circuit breaker

**Intent:** stop a caller from hammering a dependency that keeps timing out or failing, and detect
when the dependency is healthy again.
**How it works:** *closed* (calls pass; failures are counted) → *open* after a threshold (calls fail
immediately) → after a timeout, a trial call; if it succeeds the circuit *closes*.
**Use when:** a synchronous call is likely to fail or is slow, and repeated attempts would tie up
threads, connections or the dependency itself.
**Watch for:**
- Implement it once, service-agnostic, instead of copy-pasting per call site.
- With concurrent callers, the first failure sets the open window; later calls must not keep pushing the expiry out.
- Let operators force a circuit open or closed, and let a recovered callee close it if your recovery objective needs that.
- Log every call rejected while open; it is how you find out something is wrong.
- Decide the fallback (cached value, default, clear error) before you need it.

**On AWS:** a Step Functions express workflow plus a DynamoDB table (with TTL expiry) tracking
open circuits; ElastiCache for lower latency. In application code, a resilience library does the same job.

## Retry with backoff

**Intent:** recover from transient failures (HTTP 429, 503, timeouts, brief network loss) without
overloading the dependency.
**Rules:**
- Retry only transient failures. A validation or authorization error will never succeed on retry: fail fast.
- Wait longer after each attempt (exponential backoff), add random jitter so many clients don't retry in lockstep, cap the attempts and the total time (Amazon Builders' Library, "Timeouts, retries and backoff with jitter").
- **The operation must be idempotent**, or a retried write corrupts state. Use idempotency keys or natural unique constraints.
- Every retry costs time the user waits and load the dependency feels. Pair with a circuit breaker so persistent failure stops being retried.
- Layered retries multiply (3 retries at each of 3 layers is 27 calls): retry at one layer.

**On AWS:** Step Functions `Retry` blocks (max attempts, interval, backoff rate); the AWS SDKs retry throttled calls by default.

## Publish-subscribe

**Intent:** decouple a sender from its receivers through a broker. The publisher doesn't know who
listens, and gets back to its own work immediately.
**Use when:** one event triggers several independent reactions; consumers may be written in other
languages or platforms; eventual consistency is acceptable.
**Watch for:**
- Subscribers might not be listening: messages can be dropped or expire (TTL). Put a queue in front of consumers that must not miss messages.
- Delivery may be at-least-once, so **consumers must be idempotent**. Ordering is not guaranteed unless you use FIFO topics, which have lower throughput.
- Give consumers filtering (topics, content filters) so they receive only what they need.
- Failed deliveries need a dead-letter queue and an alarm on its depth.
- It is one-way. If you need an answer, use request-reply.
- Replay depends on the broker; if you need it, design for it.

**On AWS:** SNS (standard and FIFO topics) for fan-out, often with SQS queues per consumer; EventBridge when you need content-based routing, filtering and many producers.

## Saga (choreography and orchestration)

**Intent:** keep data consistent across services that each own their database, without a
distributed two-phase commit. A saga is a sequence of local transactions; if a step fails, **compensating
transactions** undo the earlier steps.
**Recovery:** *forward* (retry the failed step) after platform failures; *backward* (compensate) after
business failures such as a declined payment.

| | Choreography | Orchestration |
|---|---|---|
| Control | Each service reacts to events from the others | A central orchestrator tells each service what to do |
| Use when | Few participants; you want no single point of failure | Many participants; you want to keep them loosely coupled to each other |
| Costs | Hard to see the whole flow as it grows; cyclic dependencies; resilience policies live in every service; end-to-end tracing is harder | The orchestrator is critical (use a managed workflow engine so it is highly available); logic concentrates in one place |

Both need:
- **Idempotent steps and idempotent compensations**: they will be retried.
- A way to avoid the dual-write problem: use the transactional outbox.
- No isolation: other transactions see intermediate states. Use semantic locks (for example an order status of `PENDING`) and design for it.
- Observability: a correlation id through every step, and a way to find sagas stuck halfway.
- Business agreement that eventual consistency is acceptable. If it is not, reconsider the service boundaries or use one database transaction.

**On AWS:** choreography with EventBridge buses and rules; orchestration with Step Functions standard workflows.

## Scatter-gather

**Intent:** send a request to several recipients in parallel and aggregate their answers.
**Two forms:** *scatter by distribution* (the controller knows the recipients and calls them) and
*scatter by auction* (publish to a topic; any interested recipient answers on a response queue, and an
aggregator collects them by correlation id).
**Use when:** you need quotes, availability or search results from several sources, or want to
split a big job into parallel parts and merge the results.
**Watch for:**
- Total latency is that of the **slowest** recipient. Set a deadline per request.
- Decide what a partial result means and tell the client when an answer is incomplete.
- More recipients means more network overhead; there is a limit to useful fan-out.
- Plan for recipients failing: redundancy and duplicates removed in the aggregator.
- Merged data may conflict; define how.

**On AWS:** Step Functions `Parallel` or `Map` states for distribution; SNS plus SQS with an aggregator for auction.

## Event sourcing

**Intent:** store every state change as an immutable event in an append-only log; derive current
state (and any past state) by replaying events.
**Use when:** you need an audit trail, point-in-time reconstruction, several read models from one
source of truth, or what-if replays. Skip it for plain CRUD: it is hard to retrofit and hard to query ad hoc.
**Watch for:**
- **Optimistic concurrency:** version each aggregate so conflicting writes are detected.
- **Event schema evolution:** include a version in every event and handle old versions on replay. Events are forever.
- **Snapshots:** replaying millions of events is slow; snapshot regularly (based on your recovery point objective).
- **Querying:** the log is awkward to query; build projections with CQRS or materialized views, and accept that they are eventually consistent.
- **Replay side effects:** replaying must not re-send emails or re-charge cards. Gate external effects behind flags, and store responses from external calls you'd otherwise repeat.
- **Growth and cost:** the log only grows. Archive old events to cheap storage.
- Ordering matters: carry events to the store through ordered (FIFO) channels.

**On AWS:** Kinesis Data Streams, MSK or EventBridge as the event store, archived to S3, with Lambda
consumers building projections in a database such as Aurora.

## Hexagonal architecture (ports and adapters)

**Intent:** put business logic in the middle; reach everything else (databases, UIs, queues, other
APIs) through **ports** (interfaces you own) implemented by **adapters** (technology-specific code).
**Use when:** the same domain logic serves several clients or inputs, UI or database technology
will change, or you want to unit-test the domain with no infrastructure.
**Watch for:**
- The adapter layer is only worth its cost when there are several inputs or outputs, or when they will change. For thin CRUD it is overhead and a bit of latency.
- It pairs naturally with domain-driven design. The domain imports no framework, ORM or SDK.
- Test the domain with fakes for the ports, and test each adapter against the real technology.

This is the same dependency rule as `.claude/standards/architecture.md` ("Dependency rule") and
`.claude/rules/core/code-structure.md` (dependency injection, module boundaries).

**On AWS:** a Lambda handler that builds an input port wired to a DynamoDB adapter, with the domain model separate from both.

## Strangler fig

**Intent:** replace a monolith gradually. A proxy in front routes each request to the old or the new
implementation; features move one at a time; when nothing is left, the monolith is switched off.
**Steps:** put a proxy in front (all traffic still goes to the monolith) → build new features as
services → move an existing feature and route it to the service → add an ACL where the monolith still
calls moved features → synchronize data while both sides need it → repeat → remove the ACL and the monolith.
**Use when:** a big-bang rewrite is too risky, the business can't wait, and users must see little change.
**Watch for:**
- You need access to the monolith's code to intercept calls and add the ACL.
- Unclear domain boundaries make early decomposition expensive. Learn the domain first (domain-driven design, event storming).
- The proxy is a single point of failure and a possible bottleneck: use a managed, multi-zone gateway.
- Data is the hard part. Each service should own its data; synchronizing with the monolith's database through a queue is a tactical, eventually consistent bridge, not a destination.
- Small applications are usually cheaper to rewrite than to strangle.
- Synchronous calls between old and new need timeouts and a circuit breaker.

**On AWS:** API Gateway as the routing proxy. AWS Migration Hub Refactor Spaces automated this but, per AWS, is closed to new customers since 2025-11-07, so check the current recommended service before relying on it.

## Transactional outbox

**Intent:** solve the dual-write problem: a service must update its database *and* tell others, and
if only one of the two succeeds the system is inconsistent.
**How:** in the **same database transaction** as the business change, insert the event into an
`outbox` table. A separate relay reads committed rows, publishes them in order, then marks or deletes
them. A rolled-back transaction leaves no outbox row, so no event escapes.
**Variant:** change data capture (DynamoDB Streams, database log readers) publishes changes from the
data itself, saving the extra table.
**Watch for:**
- The relay can publish twice: **consumers must be idempotent** (track processed message ids).
- Preserve order: publish by sequence number, and use FIFO queues with a message group id per aggregate when order matters.
- Polling adds latency and load; tune the interval and batch size, or use CDC.
- Clean up published rows, and alert if the outbox backlog grows.

**On AWS:** an outbox table in RDS with a scheduled relay to SQS, or DynamoDB Streams to Lambda to SQS.

## When applying any of these

1. **Idempotency first.** Retries, redelivery, replay and compensation all re-run work. See `.claude/rules/core/error-handling.md`.
2. **Timeouts everywhere.** A call without a deadline turns a slow dependency into an outage.
3. **Cover the pattern's own failure.** The ACL, proxy, orchestrator, broker and outbox relay can fail: how will you know, and what happens next?
4. **Make it observable.** Correlation ids across hops, metrics for queue depth, circuit state and retry counts (`.claude/standards/logging-observability.md`).
5. **Test the failure paths.** Inject failures: a timeout, a duplicate message, a half-finished saga. A pattern that is only tested when things work isn't tested.
6. **Plan the exit for temporary parts.** An interim ACL or data sync needs an owner and a removal date.
7. **Record the decision** in an ADR with the alternatives you rejected, including doing nothing.

## Sources

- AWS Prescriptive Guidance, *Cloud design patterns, architectures, and implementations* — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/introduction.html
- Michael Nygard, *Release It!* (circuit breaker)
- Alistair Cockburn, "Hexagonal Architecture" — https://alistair.cockburn.us/hexagonal-architecture/
- Martin Fowler, "StranglerFigApplication" — https://martinfowler.com/bliki/StranglerFigApplication.html
- Amazon Builders' Library, "Timeouts, retries, and backoff with jitter" — https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Chris Richardson, microservices.io patterns (saga, transactional outbox) — https://microservices.io/patterns/
- Hohpe and Woolf, *Enterprise Integration Patterns* (scatter-gather, publish-subscribe)
