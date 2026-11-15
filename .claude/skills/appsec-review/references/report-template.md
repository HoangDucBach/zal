# Security review report template

Findings first, because those are what must be acted on. Keep each finding self-contained so it
can be pasted into an issue. Drop empty sections.

## Contents
- Report template
- Finding fields
- Filled example

## Report template

```markdown
## Security review: <scope: PR, branch, paths, or design>

**Verdict:** BLOCK | FIX BEFORE RELEASE | PASS
**Reviewer:** <independent agent | self-review>   **Date:** <YYYY-MM-DD>   **Depth:** <light | deep>
**Findings:** critical <n>, high <n>, medium <n>, low <n>, info <n>

### Scope
- **Reviewed:** <files, routes, configs, standards applied>
- **Not reviewed:** <anything skipped or out of scope, and why>
- **Threat model:** <written (link) | needed, not done | not needed: reason>

### Scanner results
| Scanner | Result | Notes |
|---|---|---|
| gitleaks | PASS / FINDINGS / not run | |
| semgrep | | |
| osv-scanner / audit | | |
| trivy / checkov | | |
"not run" means not run, never clean.

### Findings

#### SEC-1: <short title>   [HIGH]
- **Category:** <OWASP A01:2025 Broken Access Control | CWE-639>
- **Location:** `path/to/file.ext:LINE`
- **What:** <the flaw, in one or two sentences>
- **Trigger / evidence:** <the input or state that exploits it; the code path>
- **Impact:** <what an attacker gains>
- **Fix:** <concrete change, with a code sketch if short>
- **Test:** <the test that proves the fix>
- **Status:** open

### Accepted risks
<each with an owner, a reason, and an expiry date. None unless the user decided.>

### Recommendations
<hardening ideas that are not findings; missing scanners to install>
```

## Finding fields

- **ID:** `SEC-n`, stable within the report.
- **Severity:** Critical, High, Medium, Low, Info (see the table in `SKILL.md`). In deep mode add a
  CVSS 3.1 or 4.0 vector if the team uses CVSS.
- **Category:** OWASP Top 10:2025 id and, if useful, a CWE.
- **Evidence:** enough that someone else can verify it in a minute. Never include a real secret value.
- **Fix:** what to change, not just what is wrong.

## Filled example

```markdown
## Security review: feat/share-document (vs main)

**Verdict:** BLOCK
**Reviewer:** independent agent   **Depth:** light
**Findings:** critical 0, high 1, medium 1, low 0, info 0

### Scope
- **Reviewed:** documents/share.py, documents/routes.py, tests/; applied secure-coding, api-security, auth-session
- **Not reviewed:** email template rendering (generated); infrastructure
- **Threat model:** not needed: no new service or external input

### Scanner results
| Scanner | Result | Notes |
|---|---|---|
| gitleaks | not run | not installed |
| semgrep | not run | not installed |
| osv-scanner | PASS | no lockfile changes |

### Findings

#### SEC-1: Any signed-in user can share any document   [HIGH]
- **Category:** OWASP A01:2025 Broken Access Control (CWE-639)
- **Location:** `documents/routes.py:57`
- **What:** `share_document()` loads the document by id without checking that it belongs to the caller.
- **Trigger / evidence:** user B sends `POST /documents/<A's id>/share`; the query at line 57 is `Document.get(id)` with no owner filter.
- **Impact:** a user can grant themselves or others access to documents they do not own.
- **Fix:** load with the caller scope: `Document.get(id, owner=request.user)` and return 404 when missing.
- **Test:** user B shares user A's document and gets 404; the share list for A is unchanged.
- **Status:** open

#### SEC-2: No rate limit on sharing   [MEDIUM]
...
```
