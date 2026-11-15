# Secure coding (OWASP Top 10:2025)

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner), not silent deviation.

Most breaches exploit ordinary bugs in ordinary code. This file maps the OWASP Top 10:2025 to
what each risk looks like in a diff, how to prevent it, and how to test for it. The detailed
standards are linked from each row. Detection recipes for review live in
`.claude/skills/appsec-review/references/owasp-test-cases.md`.

## A01 Broken Access Control

- **Looks like:** a handler loads `orders/{id}` without checking that the order belongs to the
  caller; authorization in the UI only; role checks scattered and missing on one route; CORS `*`
  with credentials; path traversal (`../`).
- **Prevent:** deny by default; check authorization server-side on every request *for every
  object* (ownership or tenant scoping in the query itself: `WHERE id = ? AND tenant_id = ?`);
  one central policy layer; least privilege. Details: `auth-session.md`, `api-security.md`.
- **Test:** for each endpoint, a test where user B requests user A's resource and gets 403/404;
  an unauthenticated request gets 401; a lower role is denied admin actions.

## A02 Security Misconfiguration

- **Looks like:** debug mode or stack traces in production; default credentials; permissive
  CORS; missing security headers; open cloud buckets; verbose error pages; unused features enabled.
- **Prevent:** hardened, identical config per environment from code; secure defaults; security
  headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `frame-ancestors`); disable what you don't use. Details: `infra-container.md`.
- **Test:** an integration test asserts headers and that error responses contain no stack trace;
  IaC and container scans in CI.

## A03 Software Supply Chain Failures

- **Looks like:** a new dependency with no lockfile update; `curl | sh` in a Dockerfile; unpinned
  GitHub Actions; typosquatted package names; a build that pulls `latest`.
- **Prevent:** lockfiles, pinned versions and digests, SCA in CI, an SBOM, signed artifacts,
  vetted new dependencies. Details: `supply-chain.md`, `.claude/standards/dependencies.md`.
- **Test:** SCA (`osv-scanner`, `npm audit`, `pip-audit`, `cargo deny`) fails the build on known
  high or critical vulnerabilities that have a fix.

## A04 Cryptographic Failures

- **Looks like:** MD5/SHA-1 for passwords; `Math.random()` for tokens; hard-coded keys; ECB mode;
  disabled TLS verification (`verify=False`, `rejectUnauthorized: false`); sensitive data
  stored in plaintext.
- **Prevent:** vetted libraries and approved algorithms only; a CSPRNG for every secret; TLS
  everywhere; keys in a KMS. Details: `crypto.md`.
- **Test:** grep and SAST rules for weak algorithms and disabled verification; a test that
  stored passwords are Argon2id/bcrypt hashes.

## A05 Injection

- **Looks like:** string-built SQL, shell commands, LDAP or NoSQL queries; `eval`; unescaped
  output in HTML (XSS); template injection; header injection.
- **Prevent:** parameterized queries; argument arrays instead of shells; context-aware output
  encoding; allow-list validation at the boundary. Details: `input-output.md`.
- **Test:** unit tests with payloads (`' OR 1=1 --`, `<script>`, `; rm -rf /`, `{{7*7}}`) asserting
  they are treated as data; SAST (Semgrep) in CI.

## A06 Insecure Design

- **Looks like:** a password reset that reveals whether an account exists; no rate limit on a
  costly flow; trusting client-side prices; business logic that can be replayed or reordered.
- **Prevent:** threat-model new features (`threat-modeling.md`); abuse cases next to use cases;
  server-side enforcement of business rules; rate and resource limits by design.
- **Test:** abuse-case tests: replay, out-of-order steps, negative quantities, race conditions on
  balance updates.

## A07 Authentication Failures

- **Looks like:** passwords compared in plaintext or with fast hashes; no lockout or throttling;
  session IDs in URLs; JWTs accepted without signature or audience checks; missing MFA on admin.
- **Prevent:** a mature auth library or identity provider; Argon2id; MFA; throttling; secure
  session management. Details: `auth-session.md`.
- **Test:** tests for the brute-force throttle, session rotation on login, logout invalidation,
  and rejection of expired, unsigned or wrong-audience tokens.

## A08 Software or Data Integrity Failures

- **Looks like:** deserializing untrusted data (`pickle`, Java native, `yaml.load`); auto-update
  without signature checks; CI that runs untrusted PR code with secrets; unsigned webhooks.
- **Prevent:** safe formats (JSON with schema validation); verified signatures on artifacts,
  updates and webhooks (HMAC with constant-time compare); protected CI for fork PRs.
- **Test:** webhook tests with a bad signature or a replayed timestamp are rejected; SAST rules
  for unsafe deserialization.

## A09 Security Logging and Alerting Failures

- **Looks like:** failed logins not logged; logs without user or request IDs; secrets in logs;
  no alert on repeated authorization failures.
- **Prevent:** log security events (login success and failure, access denied, privilege change,
  input validation failures at volume) with correlation IDs, no secrets or PII; alert on
  anomalies. Details: `.claude/standards/logging-observability.md`, `privacy-data.md`.
- **Test:** a test asserts an audit event is emitted for denied access; a log redaction test.

## A10 Mishandling of Exceptional Conditions

- **Looks like:** fail-open error handling (`catch` → allow access); swallowed exceptions;
  stack traces returned to clients; resources not released on error; inconsistent state after
  a partial failure.
- **Prevent:** fail closed; typed errors; generic client messages with a correlation ID;
  transactions or compensation for multi-step writes. Details: `.claude/rules/core/error-handling.md`.
- **Test:** inject failures in the auth or permission service and assert access is *denied*;
  force DB errors mid-operation and assert no partial writes.

## Sources

- OWASP Top 10:2025 — https://owasp.org/Top10/
- OWASP Cheat Sheet Series — https://cheatsheetseries.owasp.org/
- OWASP ASVS 5.0 — https://owasp.org/www-project-application-security-verification-standard/
- CWE Top 25 — https://cwe.mitre.org/top25/
