# Security review checklist

Use during `appsec-review`, and as a quick pass in `peer-review`. Mark each item **pass**,
**fail** (with `file:line`), or **n/a** (with the reason). A fail is a finding; severity rules
are in `.claude/skills/appsec-review/references/`. Standards behind each item are linked.

## Access control (`secure-coding.md` A01, `auth-session.md`)
- [ ] Every endpoint or action requires authentication unless intentionally public.
- [ ] Every object access checks the caller's right to that object (owner or tenant in the query).
- [ ] Admin or privileged functions check the role on the server, and deny by default.
- [ ] Mass assignment is blocked: request bodies map to allow-listed fields only.
- [ ] Responses contain no fields the caller shouldn't see.

## Input and output (`input-output.md`)
- [ ] Input is parsed against a schema at the boundary (type, length, range, allow-list).
- [ ] SQL uses parameters; no string-built queries. Identifiers are allow-listed.
- [ ] No shell invocation with input; arguments passed as arrays.
- [ ] Output is encoded for its context; no unsafe HTML sinks with untrusted data.
- [ ] URL fetches are protected against SSRF; redirects are validated.
- [ ] File uploads: size, type by content, random names, safe storage; archive paths checked.
- [ ] No unsafe deserialization of untrusted data.

## Authentication and sessions (`auth-session.md`)
- [ ] Passwords hashed with Argon2id (or bcrypt for legacy); no fast hashes.
- [ ] Login and reset flows are throttled and don't reveal whether an account exists.
- [ ] Sessions rotate on login; cookies are `Secure`, `HttpOnly`, `SameSite`; logout invalidates server-side.
- [ ] JWTs: algorithm pinned, signature, `iss`, `aud`, `exp` validated; short-lived.
- [ ] State-changing requests with cookie auth are protected against CSRF.

## Secrets and crypto (`secrets.md`, `crypto.md`)
- [ ] No secrets, tokens or keys in code, config, tests, fixtures, logs or docs.
- [ ] Secrets come from the environment or a secret manager; the app fails closed if missing.
- [ ] Only approved algorithms; randomness from a CSPRNG; TLS verification enabled.

## Errors and logging (`.claude/rules/core/error-handling.md`, `logging-observability.md`)
- [ ] Errors fail closed; none are swallowed; clients get generic messages with a correlation ID.
- [ ] Security events (login failures, access denied, privilege changes) are logged.
- [ ] Logs contain no secrets or PII.

## Dependencies and supply chain (`supply-chain.md`)
- [ ] New dependencies are vetted; the lockfile is updated and committed.
- [ ] SCA shows no reachable high or critical vulnerabilities with a fix.
- [ ] CI actions and base images are pinned; workflow permissions are minimal.

## API (`api-security.md`)
- [ ] Rate limits and size limits exist on expensive and unauthenticated endpoints.
- [ ] CORS is an explicit allow-list; security headers are set.
- [ ] Webhooks verify signatures and timestamps.

## Infrastructure (`infra-container.md`)
- [ ] Containers run as non-root with a minimal pinned base image; no secrets in layers.
- [ ] IaC scan is clean of high findings; no public storage, wildcard IAM or open admin ports.

## Privacy and design (`privacy-data.md`, `threat-modeling.md`)
- [ ] New personal data is justified, classified, retained for a defined period, and deletable.
- [ ] A threat model exists where the change needs one (new service, auth change, new input, PII).

## Verdict

`BLOCK` (any critical or high open) · `FIX BEFORE RELEASE` (medium) · `PASS` (low or none).
