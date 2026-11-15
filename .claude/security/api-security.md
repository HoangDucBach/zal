# API security (OWASP API Security Top 10:2023)

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner).

APIs expose object IDs and business logic directly, so attackers don't need a UI to find the
gaps. API design conventions are in `.claude/rules/core/api-design.md`; this file covers the
security side.

| Risk | Looks like | Prevent | Test |
|---|---|---|---|
| **API1 Broken Object Level Authorization (BOLA)** | `GET /invoices/{id}` returns any invoice to any logged-in user | Authorize every object access: scope queries by owner or tenant; use opaque, unguessable IDs as defence in depth (never as the control) | User B requests A's object → 403/404, for every endpoint that takes an ID |
| **API2 Broken Authentication** | Tokens without expiry; no throttling on `/login` or `/token`; API keys in URLs | `auth-session.md`; short-lived tokens; rate-limited auth endpoints; keys in headers only | Expired, forged or wrong-audience tokens rejected; the throttle triggers |
| **API3 Broken Object Property Level Authorization** | Mass assignment (`PATCH /users/me {"role":"admin"}`); responses leaking `passwordHash`, `internalNotes` | Explicit input DTOs with allow-listed writable fields; explicit output DTOs; never bind request bodies straight to ORM models | Sending a forbidden field leaves it unchanged; a snapshot test of response fields |
| **API4 Unrestricted Resource Consumption** | No `pageSize` max; unlimited upload size; expensive search with no limit; GraphQL depth bombs | Rate limits per user, key and IP; max page size; request body and upload limits; timeouts; query depth and complexity limits; cost-based quotas | Over-limit requests → 429/413; huge `pageSize` is clamped |
| **API5 Broken Function Level Authorization** | Admin endpoints reachable by regular users because only the UI hides them | Central role and permission checks on every route; deny by default; separate admin routes or services | Each admin route is tested with a non-admin token → 403 |
| **API6 Unrestricted Access to Sensitive Business Flows** | Bots buying all stock; scripted sign-ups; coupon abuse | Identify sensitive flows in the threat model; per-account velocity limits, device fingerprinting, CAPTCHA or step-up auth where justified | Automated burst on the flow gets throttled |
| **API7 Server-Side Request Forgery (SSRF)** | A "fetch from URL" or webhook feature that reaches `169.254.169.254` or internal services | Allow-list destinations; block private, link-local and metadata ranges *after* DNS resolution and on redirects; separate egress proxy. See `input-output.md` | Requests to `http://127.0.0.1`, `http://[::1]`, metadata IPs, and DNS-rebinding hosts are rejected |
| **API8 Security Misconfiguration** | Verbose errors; CORS `*` with credentials; missing TLS; unnecessary HTTP methods | Hardened gateway config; strict CORS allow-list; RFC 9457 errors without internals; TLS only | Header and CORS integration tests; error responses contain no stack traces |
| **API9 Improper Inventory Management** | Forgotten `/v1` or `/beta` endpoints still live; undocumented debug routes | OpenAPI spec as the source of truth; retire old versions with dates; gateway blocks unknown routes; one inventory of hosts | Contract test: every route served is in the spec |
| **API10 Unsafe Consumption of APIs** | Trusting third-party API responses (no validation, following their redirects, unlimited size) | Validate third-party responses against a schema; timeouts and size limits; TLS verification on; treat them as untrusted input | Malformed or oversized upstream responses are handled without crashing |

## Rate limiting

Apply limits at the gateway and in the app for expensive operations. Limit by authenticated
principal first, then by IP. Return `429` with `Retry-After`. Log limit hits as security events.

## Webhooks (in and out)

- **Incoming:** verify the HMAC signature with a constant-time comparison, check the timestamp
  window (for example 5 minutes) to stop replays, and process idempotently.
- **Outgoing:** sign the payloads, send only to registered HTTPS URLs that pass the SSRF checks,
  and never include secrets.

## Sources

- OWASP API Security Top 10:2023 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP REST Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP Mass Assignment Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- OWASP GraphQL Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html
