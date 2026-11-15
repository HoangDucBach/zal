# Authentication, sessions and authorization

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner).

Auth code is the most attacked and least forgiving code in a system. **Don't build it yourself
when a mature identity provider or framework module exists** (Auth0/Okta/Cognito/Keycloak,
Django auth, NextAuth/Auth.js, Spring Security, Devise). Most of the rules below are what those
tools already do; check that they are configured to do it. Aligned with OWASP ASVS 5.0
(V6 Authentication, V7 Session Management, V8 Authorization).

## Passwords

- **Hash with Argon2id** (minimum m=19 MiB, t=2, p=1), or scrypt. Use **bcrypt** (cost ≥ 10)
  only for existing systems; it truncates input at 72 bytes. Use PBKDF2-HMAC-SHA256 with
  ≥ 600,000 iterations only where FIPS is required. Never MD5, SHA-*, or unsalted hashes.
- **Policy (NIST SP 800-63B-4):** at least 15 characters when the password is the only factor
  (8 with MFA), allow at least 64, allow all characters including spaces and unicode, **no
  composition rules and no forced periodic rotation**, and check new passwords against breached
  lists (Have I Been Pwned k-anonymity API).
- Compare hashes with the library's verify function (constant time). Rehash on login when
  parameters are upgraded.

## Login and account flows

- **Throttle** by account and by IP (progressive delays or temporary lockout). Alert on
  credential stuffing patterns.
- **Generic errors:** "Invalid email or password". Registration and reset flows say "If an
  account exists, we've sent an email", so they don't reveal which accounts exist.
- **MFA:** offer it to everyone, require it for admins and sensitive actions. Prefer passkeys
  (WebAuthn) or TOTP over SMS.
- **Password reset tokens:** random from a CSPRNG (≥ 128 bits), single-use, stored hashed,
  expiring in ≤ 1 hour, and invalidating existing sessions on use.
- **Step-up re-authentication** for changing the email, password or MFA settings, and for
  payments.

## Sessions (cookie-based)

- Session IDs come from the framework's CSPRNG (≥ 128 bits of entropy), are never in URLs, and
  are **regenerated on login and privilege change** (prevents session fixation).
- Cookie flags: `Secure; HttpOnly; SameSite=Lax` (or `Strict`), with the `__Host-` prefix, a
  narrow `Path`, and no `Domain`.
- Use an idle timeout (for example 30 minutes for sensitive apps) and an absolute timeout (for
  example 12–24 hours). **Logout invalidates the session server-side.**
- CSRF: `SameSite` plus a synchronizer or double-submit token for state-changing requests made
  with cookie auth.

## Tokens (JWT, OAuth 2.0, OIDC)

- **OAuth 2.0 / OIDC:** use the Authorization Code flow **with PKCE for every client** (RFC 9700).
  No implicit flow, and no resource-owner password grant. Match redirect URIs exactly. Validate
  `state` and the OIDC `nonce`.
- **JWT validation:** pin the expected algorithm (never accept `alg: none`, and never let the
  token choose between HS and RS), verify the signature with the right key (JWKS with `kid`), and
  check `iss`, `aud`, `exp` and `nbf`, allowing small clock skew.
- **Short-lived access tokens** (5–15 minutes). Refresh tokens are rotated on use, with reuse
  detection, and are revocable.
- **No sensitive data in JWT payloads.** They are only base64-encoded, not encrypted.
- **Browser storage:** prefer `HttpOnly` cookies (with CSRF protection) or a backend-for-frontend
  over `localStorage`, which any XSS can read.
- Service-to-service: mTLS or workload identity (OIDC federation), not shared static API keys.

## Authorization

- **Deny by default.** Every endpoint declares its required permission, and a missing
  declaration fails closed.
- **Check on the server, on every request, for every object.** The UI hiding a button is not
  authorization. Scope data access in the query (`tenant_id`, `owner_id`).
- **Model:** RBAC for coarse roles. Use ABAC or ReBAC (attribute or relationship based, e.g.
  OpenFGA or Cedar) when access depends on ownership, team or resource attributes. Keep policy
  in one place, not scattered `if role == "admin"` checks.
- **Least privilege** for users, services, database accounts and API keys. Grant time-bound
  elevation for admin tasks.
- Log authorization failures as security events, and alert on spikes.

## Test checklist

Tests cover: login success and failure, the throttle, session rotation, logout invalidation,
expired, tampered and wrong-audience tokens, the `alg: none` / HS-RS confusion attempts, IDOR
(user B gets user A's object), role escalation (regular user calls an admin route), and mass
assignment of a `role` field.

## Sources

- OWASP ASVS 5.0 — https://owasp.org/www-project-application-security-verification-standard/
- OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- NIST SP 800-63B-4 — https://pages.nist.gov/800-63-4/sp800-63b.html
- RFC 9700, OAuth 2.0 Security Best Current Practice — https://www.rfc-editor.org/rfc/rfc9700
- RFC 8725, JWT Best Current Practices — https://www.rfc-editor.org/rfc/rfc8725
