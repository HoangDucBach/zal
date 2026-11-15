# Runbook: Service or alert name

- **Owner / on-call team:** name and channel  **Last reviewed:** YYYY-MM-DD
- **Dashboards:** link  **Logs:** link  **Traces:** link  **Repo:** link

> Written for someone woken at 3 a.m. who has never touched this service. Every step is a command
> or a click they can do, with the expected result. If a step needs judgment, say how to decide.

## What this service does

Two sentences, what depends on it, and what it depends on (database, queue, third parties).

## Severity and impact

| Symptom | Likely impact | Severity |
|---|---|---|

## Triage: first five minutes

1. **Confirm the problem is real.** Check dashboard X: error rate, latency p95, saturation.
2. **Check what changed.** Recent deploys, config or flag changes, upstream incidents:
   `<command or link>`.
3. **Decide whether to roll back now.** If a deploy happened in the last hour and metrics
   degraded after it, roll back first and investigate later (see Rollback).
4. **Declare an incident** if user impact is confirmed. Post in the incident channel.

## Diagnosis by alert or symptom

### Alert: HighErrorRate

- **Meaning:** more than 2% of requests return 5xx for 5 minutes.
- **Check:** `<log query>`. Look for the most common error message and the endpoint.
- **If errors mention the database:** go to "Database connection exhaustion".
- **If one endpoint:** check its recent changes; consider disabling its feature flag.

### Database connection exhaustion

- **Symptom:** `too many connections` in logs; latency rising.
- **Check:** `<query for active connections>`.
- **Fix:** restart the leaking pods one at a time (`<command>`), then find the leak.
- **Do not:** increase the pool size without checking database limits.

## Common operations

| Task | Command | Notes |
|---|---|---|
| Roll back | `<command>` | Verify with `<health check>` |
| Scale up | `<command>` | Limits: max N replicas |
| Toggle feature flag | `<command or link>` | |
| Restart | `<command>` | Rolling; wait for readiness |

## Rollback

Exact steps, expected duration, and how to verify. Migrations: whether the schema change is
backward-compatible and what, if anything, must be undone.

## Escalation

| When | Who | How |
|---|---|---|
| Not resolved in 30 minutes | Service owner | page `<team>` |
| Data loss or security exposure | Security on-call | page immediately; do not alter logs |

## After the incident

Capture the timeline while it's fresh, then write a blameless postmortem
(`.claude/templates/postmortem.md`). Update this runbook with anything that was missing.
