# Logging and observability

> **Precedence:** the project's existing logging library, field names and telemetry backend
> win over this file.

You can't fix what you can't see. Observability means you can answer new questions about
production ("why is checkout slow for EU users?") without shipping new code. Logs, metrics and
traces each answer a different question; use all three, connected by IDs.

## Structured logs

Log events as key-value data (JSON in production), not prose strings, so they can be queried.

```ts
// ❌
logger.info(`User ${userId} paid ${amount} for order ${orderId}`);
// ✅
logger.info("payment.captured", { userId, orderId, amountCents, currency, durationMs });
```

Every line carries: `timestamp` (UTC, RFC 3339), `level`, `service`, `env`, `version`, an event
`message` or name, and `trace_id` / `span_id` when available. Use stable field names
(OpenTelemetry semantic conventions where they exist) and keep them consistent across services.

## Levels

| Level | Use for | Example |
|---|---|---|
| `ERROR` | A failure that needs attention; a request or job failed | Payment provider returned 500 after retries |
| `WARN` | Unexpected but handled; may need attention if it repeats | Retry succeeded; config fallback used |
| `INFO` | Significant business or lifecycle events | Order placed, service started, migration done |
| `DEBUG` | Diagnostic detail, off in production by default | Request payload shape, cache decision |

Log each error once, where it is handled (`.claude/rules/core/error-handling.md`). Don't log
in hot loops, and sample high-volume events.

## Correlation

- Accept or generate a request ID at the edge, propagate it via W3C Trace Context
  (`traceparent`), and include it in every log line and every error response.
- Pass context through async boundaries: queue message headers, background jobs, outbound HTTP.

## Never log secrets or personal data

Passwords, tokens, API keys, session IDs, full card numbers, and personal data (email, phone,
address, national IDs, health data) don't go into logs. Logs are widely accessible, retained
for a long time, and copied to third parties.

- Redact at the logger level with an allow-list of fields or a redaction processor, not by
  remembering at each call site.
- Log user IDs (opaque) instead of emails. Truncate or hash where you need to correlate.
- Details: `.claude/security/privacy-data.md`, `.claude/security/secrets.md`.

## Metrics

- **RED** for request-driven services: Rate, Errors, Duration (as histograms, so you can read p50/p95/p99).
- **USE** for resources: Utilization, Saturation, Errors (CPU, memory, pools, queue depth).
- Business metrics for what the product cares about (orders per minute, sign-up conversion).
- Labels have **bounded cardinality**: no user IDs, emails or raw URLs as labels. Use route
  templates (`/users/{id}`).
- Naming: `<namespace>_<what>_<unit>`, e.g. `http_server_request_duration_seconds`.

## Tracing

- Instrument with OpenTelemetry (SDK plus auto-instrumentation for HTTP, DB and messaging),
  and export over OTLP to whatever backend the project uses.
- One span per meaningful unit of work, with attributes that help debugging (route, DB
  operation, item count), never PII.
- Use head-based sampling for volume, and keep all error traces where the backend supports it.

## Alerts and SLOs

- Alert on **symptoms users feel** (error rate, latency SLO burn), not on causes (CPU 80%).
- Define SLIs and SLOs for each user-facing service. Page on fast burn-rate alerts; send
  ticket alerts for slow burns.
- Every alert links to a runbook (`.claude/templates/runbook.md`) and is actionable. If no
  action is possible, it's a dashboard, not an alert.

## Health endpoints

`/healthz` (liveness: the process is up) and `/readyz` (readiness: dependencies reachable,
ready for traffic). They are cheap, unauthenticated only on internal networks, and expose no details.

## Verify

Check logs are JSON and carry `trace_id`; grep tests and log fixtures for secret patterns; the
metrics endpoint exposes RED metrics; a trace for one request spans all services; every alert
has a runbook link.

## Sources

- OpenTelemetry docs and semantic conventions — https://opentelemetry.io/docs/
- Google SRE Book, "Monitoring Distributed Systems" — https://sre.google/sre-book/monitoring-distributed-systems/
- Google SRE Workbook, "Alerting on SLOs" — https://sre.google/workbook/alerting-on-slos/
- W3C Trace Context — https://www.w3.org/TR/trace-context/
- OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
