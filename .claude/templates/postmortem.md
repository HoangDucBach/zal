# Postmortem: Short description of the incident

- **Date:** YYYY-MM-DD  **Severity:** SEV1 | SEV2 | SEV3  **Status:** Draft | Reviewed | Closed
- **Authors:** names  **Incident commander:** name  **Duration:** HH:MM
- **Detection:** how we found out (alert, customer report, engineer), and how long it took

> **Blameless:** this document describes what happened and how the system allowed it. It does not
> assign fault to people. People acted reasonably on the information they had; if an action
> looks wrong in hindsight, the question is what made it look right at the time.

## Summary

Three or four sentences: what broke, who was affected, how it was fixed.

## Impact

- **Users affected:** number or percentage, and which features
- **Duration of impact:** start to end, in UTC
- **Business impact:** errors, lost orders or revenue, SLA/SLO budget burned, data affected
- **Data loss or security exposure:** yes/no, details

## Timeline (UTC)

| Time | Event |
|---|---|
| HH:MM | Change deployed / trigger occurred |
| HH:MM | First symptom or alert |
| HH:MM | Incident declared; people involved |
| HH:MM | Hypotheses tried, and what was learned |
| HH:MM | Mitigation applied |
| HH:MM | Recovery confirmed |

## Root cause and contributing factors

The chain of causes (5 Whys), from the trigger back to the underlying conditions. Cover
technical factors (a missing limit, an untested path) and process factors (a review gap, an
alert that didn't exist).

## What went well

Things that limited the damage, and are worth keeping.

## What went badly

Things that made it worse or longer: slow detection, unclear ownership, missing runbook.

## Where we got lucky

Things that could have made it worse, and didn't by chance.

## Action items

| Action | Type (prevent / detect / mitigate) | Owner | Due | Issue |
|---|---|---|---|---|

Every item has one owner and a due date. Prefer fixes that remove the class of problem
(guardrails, automation, tests) to reminders ("be more careful").

## Lessons learned

What we know now that we didn't before, and what to share with other teams.
