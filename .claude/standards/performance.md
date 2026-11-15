# Performance

> **Precedence:** the project's own performance budgets, SLOs and benchmarking setup win over
> this file.

Performance work without measurement is guessing, and guesses are usually wrong about where
time goes. Measure, fix the biggest bottleneck, and measure again.

## Measure first

1. **Define the target:** "p95 latency of `GET /orders` under 200 ms at 500 rps", not "make it fast".
2. **Reproduce** with realistic data volume and concurrency. A 100-row dev database hides N+1
   queries and missing indexes.
3. **Profile** to find where the time actually goes (CPU, wall clock, allocations, I/O wait,
   lock contention). Tools per language are in `.claude/skills/performance-review/references/profiling-tools.md`.
4. **Fix the top bottleneck only**, then re-measure. Record before/after numbers in the PR.
5. **Guard the result** with a benchmark or a load test in CI, so it doesn't regress.

Don't micro-optimize code that isn't on the hot path. Readable code that is 2% slower is
usually the better trade.

## Usual suspects, in order of how often they matter

| Issue | Symptom | Fix |
|---|---|---|
| **N+1 queries** | Latency grows with result size; many identical queries in the trace | Join, batch-load (`IN (...)`), or the ORM's eager loading / DataLoader |
| **Missing index** | Slow queries; sequential scans in `EXPLAIN` | Add an index matching the `WHERE` / `ORDER BY` (`.claude/rules/core/database.md`) |
| **Unbounded work** | Memory spikes, timeouts on big tenants | Paginate, stream, set limits on every list and upload |
| **Chatty network calls** | Many sequential calls per request | Batch, parallelize independent calls, cache |
| **Synchronous heavy work in the request** | High p99; thread pool exhaustion | Move it to a background job or queue |
| **Algorithmic complexity** | Time grows quadratically with input | Use the right data structure (hash lookup instead of a nested loop) |
| **Excess allocation / GC** | Sawtooth memory, GC pauses | Reuse buffers, avoid boxing in hot loops, stream instead of loading everything |
| **Lock contention** | CPU idle but latency high | Reduce critical sections, partition, use lock-free structures |
| **Frontend payload** | Slow LCP / INP | Code splitting, compression, image optimization, cache headers |

## Big-O awareness

Know the complexity of what you call: `list.contains` in a loop is O(n²); string
concatenation in a loop can be quadratic in some languages; sorting is O(n log n). Choose the
data structure for the dominant operation (lookup → hash map; ordered range → tree or index).

## Caching

- Cache only after measuring that the source is the bottleneck. Every cache adds staleness and
  invalidation bugs.
- Decide explicitly: the key (including tenant or user scope, to avoid cross-user leaks), the
  TTL, how it is invalidated, and what happens on a stampede (request coalescing, jittered TTLs).
- Layers: HTTP caching (`Cache-Control`, `ETag`), CDN, application cache (Redis), in-process
  memoization. Prefer the layer closest to the user that is still correct.

## Concurrency and resources

- Set timeouts on every external call, size connection pools against the database's limits, and
  bound queues and worker counts. Unbounded concurrency moves the bottleneck into an outage.
- Use async or non-blocking I/O for I/O-bound work. CPU-bound work needs parallel workers, not
  more async.

## Frontend budgets

Core Web Vitals targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75. Set a JavaScript bundle
budget and enforce it in CI (`size-limit`, Lighthouse CI).

## Verify

Profiles and before/after numbers in the PR; `EXPLAIN ANALYZE` for new heavy queries; load tests
(k6, Gatling, Locust) for endpoints with SLOs; benchmarks (`pytest-benchmark`, JMH, Go
`testing.B`, `criterion`, `tinybench`) for hot functions; Lighthouse CI for web pages.

## Sources

- Google SRE Book, "Handling Overload" — https://sre.google/sre-book/handling-overload/
- web.dev, Core Web Vitals — https://web.dev/articles/vitals
- Brendan Gregg, USE Method — https://www.brendangregg.com/usemethod.html
- Use The Index, Luke — https://use-the-index-luke.com/
- Donald Knuth, "Structured Programming with go to Statements" (on premature optimization)
