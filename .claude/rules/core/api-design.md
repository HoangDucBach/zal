---
paths:
  - "**/api/**"
  - "**/routes/**"
  - "**/controllers/**"
  - "**/handlers/**"
  - "**/endpoints/**"
  - "**/resolvers/**"
  - "**/*.proto"
  - "**/openapi*.{yaml,yml,json}"
  - "**/swagger*.{yaml,yml,json}"
  - "**/*.{graphql,gql,graphqls}"
---

# API design

> **Precedence:** the project's existing API conventions (URL style, error envelope,
> pagination) win over this file. Consistency within one API matters more than any rule here.
> If you deviate from it, say why in the PR description.

An API is a contract with people you can't see. Once a client depends on it, every change is a
migration. These rules follow Google's API Improvement Proposals (AIP), adapted for REST,
gRPC and GraphQL.

## Resource-oriented design (AIP-121, 122)

- Model the API as **resources** (nouns) with a small set of **standard methods**, not as RPC
  verbs: `POST /v1/orders`, not `POST /v1/createOrder`.
- Collections are plural, lowercase, and use `kebab-case` in URLs: `/v1/users/{user_id}/payment-methods/{id}`.
- Field names in JSON bodies are `camelCase` (proto fields are `snake_case` and map to camelCase in JSON).
- Nest only for true ownership, and at most 2–3 levels deep.

## Standard methods (AIP-131 to 135)

| Method | HTTP | Success | Notes |
|---|---|---|---|
| Get | `GET /things/{id}` | 200 | No side effects |
| List | `GET /things` | 200 | Always paginated |
| Create | `POST /things` | 201 + `Location` | Accept a client-supplied ID or idempotency key |
| Update | `PATCH /things/{id}` | 200 | Partial update with a field mask; `PUT` only for full replacement |
| Delete | `DELETE /things/{id}` | 204 or 200 | Idempotent: deleting a missing resource is 404 or a no-op, consistently |
| Custom | `POST /things/{id}:cancel` | 200 | Only when no standard method fits (AIP-136) |

## Pagination, filtering, ordering (AIP-158, 160, 132)

- Every List is paginated from day one. Adding pagination later breaks clients.
- Prefer **cursor tokens** (`pageSize`, `pageToken` → `nextPageToken`) over offsets. They stay
  stable under concurrent writes and scale.
- Enforce a maximum `pageSize` on the server. A missing size gets a sensible default.
- Filtering and ordering are explicit query parameters (`filter`, `orderBy`) validated
  against an allow-list of fields.

## Errors (AIP-193)

One error shape across the API. For REST, use RFC 9457 Problem Details
(`application/problem+json`):

```json
{ "type": "https://api.example.com/errors/insufficient-funds", "title": "Insufficient funds",
  "status": 422, "detail": "Balance is 30.00, charge is 50.00.", "instance": "/v1/charges/ch_123",
  "traceId": "7f3a…", "errors": [{ "field": "amount", "reason": "EXCEEDS_BALANCE" }] }
```

| Status | When |
|---|---|
| 400 | Malformed request, failed validation (include field-level details) |
| 401 / 403 | Not authenticated / authenticated but not allowed |
| 404 | Not found, *or* exists but the caller may not know it does (avoids leaking existence) |
| 409 | Conflict: duplicate, stale version (ETag mismatch) |
| 422 | Valid syntax, but violates a business rule |
| 429 | Rate limited; include `Retry-After` |
| 5xx | Server fault; never caused by client input |

Error messages are for developers, never contain stack traces or internals, and carry a
machine-readable `reason` code that clients can switch on.

## Compatibility and versioning (AIP-180, 185)

- **Backward-compatible changes** can ship any time: adding optional fields, adding endpoints,
  adding enum values (if clients tolerate unknown ones).
- **Breaking changes** need a new major version: removing or renaming fields, changing types or
  meanings, making optional fields required, changing defaults or error codes.
- Version in the path (`/v1/`) or package (`acme.billing.v1`). Run old and new side by side, and
  announce deprecation with a date (`Deprecation` and `Sunset` headers).
- Clients must ignore unknown fields. Servers must not rely on field order.

## Safety and concurrency

- `GET`, `PUT` and `DELETE` are idempotent; `POST` is made idempotent with an `Idempotency-Key` header.
- Use optimistic concurrency with `ETag` / `If-Match` (or an `etag` field) on update.
- Timestamps are RFC 3339 in UTC; money is an integer of minor units plus a currency code;
  IDs are opaque strings.
- Security requirements (authZ per object, rate limits, mass assignment) live in
  `.claude/security/api-security.md`.

## gRPC and GraphQL notes

- **gRPC:** follow the AIPs directly. Use `google.rpc.Status` with error details, never reuse or
  renumber proto fields (`reserved` them), and run `buf lint` and `buf breaking` in CI.
- **GraphQL:** nullable by default for resilience, Relay-style connections for pagination,
  errors in `extensions.code`, depth/complexity limits, and persisted queries for public APIs.
  Deprecate with `@deprecated(reason:)`; don't version.

## Verify

Lint the spec with Spectral (OpenAPI), `buf lint` / `buf breaking` (proto) or GraphQL Inspector.
Check breaking changes against the previous spec with `oasdiff`. Contract-test the
implementation against the spec (Schemathesis, Dredd, Pact).

## Sources

- Google AIP — https://google.aip.dev/ (121, 122, 131–136, 158, 160, 180, 185, 193)
- RFC 9457 Problem Details — https://www.rfc-editor.org/rfc/rfc9457
- Google Cloud API design guide — https://cloud.google.com/apis/design
- GraphQL best practices — https://graphql.org/learn/best-practices/
