# Cryptography

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner). Compliance regimes
> (FIPS 140, PCI DSS) may narrow the choices further.

The first rule: **don't implement cryptography; use a vetted library's high-level API.**
Subtle mistakes (nonce reuse, unauthenticated modes, timing leaks) break security while
every test still passes.

## Approved choices

| Need | Use | Avoid |
|---|---|---|
| Password storage | Argon2id (see `auth-session.md`) | MD5, SHA-*, fast or unsalted hashes |
| General hashing / integrity | SHA-256, SHA-384/512, SHA-3, BLAKE2/3 | MD5, SHA-1 (collisions) |
| Message authentication | HMAC-SHA-256 | Hash-of-secret-plus-message constructions |
| Symmetric encryption | AES-256-GCM or ChaCha20-Poly1305 (authenticated, AEAD); a unique nonce for every message | ECB, unauthenticated CBC/CTR, DES/3DES, RC4 |
| Asymmetric encryption / key exchange | X25519, ECDH P-256; RSA ≥ 3072 with OAEP | RSA < 2048, PKCS#1 v1.5 encryption |
| Signatures | Ed25519, ECDSA P-256, RSA-PSS ≥ 3072 | RSA-1024, DSA |
| Random values | The OS CSPRNG: `secrets` (Python), `crypto.randomBytes` / `crypto.randomUUID()` (Node), `getrandom` / `rand::rngs::OsRng` (Rust) | `Math.random()`, `random.random()`, time-seeded generators |
| Key derivation | HKDF (from high-entropy keys), Argon2id/scrypt (from passwords) | A single hash round |
| Comparing secrets / MACs | Constant-time comparison (`hmac.compare_digest`, `crypto.timingSafeEqual`, `subtle`) | `==` |

## Transport (TLS)

- **TLS 1.2 minimum, TLS 1.3 preferred** for all traffic, including internal service-to-service.
  Disable older protocols and weak ciphers; use the platform's modern profile (Mozilla "modern"
  or "intermediate" configurations).
- **Never disable certificate verification** (`verify=False`, `rejectUnauthorized: false`,
  `danger_accept_invalid_certs`, `InsecureSkipVerify`). For a private CA, add the CA to the trust
  store instead.
- HSTS on web origins (`max-age=31536000; includeSubDomains`). Automate certificate
  renewal (ACME), and alert on upcoming expiry.
- mTLS or workload identity for service-to-service traffic where the threat model needs it.

## Key management

- Keys live in a KMS or HSM (AWS KMS, GCP KMS, Azure Key Vault, Vault Transit), not in code,
  config files or the database next to the data they protect.
- **Envelope encryption:** a KMS-held key encrypts per-record or per-file data keys.
- Separate keys per purpose and per environment. Never reuse one key for encryption and signing.
- Plan **rotation** from the start: store a key ID with each ciphertext or signature, so old
  data stays readable while new data uses the new key.
- Record who can use each key. Audit key usage.

## Data at rest and in transit

Encrypt sensitive data at rest (database, volumes and backups with provider-managed or
customer-managed keys) and encrypt specific high-risk fields at the application level (for
example national IDs or payment tokens). Classification and retention: `privacy-data.md`.

## Review red flags

`md5(`, `sha1(`, `DES`, `ECB`, `Math.random` near tokens, hardcoded `iv`/`nonce`/`salt`, a
fixed key or seed in source, `verify=False`, home-made "encryption" (XOR, base64 as protection),
signature checks that don't pin the algorithm, and custom password hashing.

## Sources

- OWASP Cryptographic Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Transport Layer Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
- NIST SP 800-57 (key management) — https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- Mozilla Server Side TLS — https://wiki.mozilla.org/Security/Server_Side_TLS
- Google Tink — https://developers.google.com/tink
