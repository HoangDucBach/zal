# Privacy and data protection

> **Precedence:** a project security policy that is *stricter* than this file wins, and legal
> requirements (GDPR, CCPA, HIPAA, PCI DSS, local law) outrank both. This file is engineering
> guidance, not legal advice. Ask the project's privacy or legal owner when unsure.

The safest personal data is data you never collected. Every field you store is a liability: it
can leak, be subpoenaed, and must be protected, exported and deleted on request.

## Classify data

| Class | Examples | Handling |
|---|---|---|
| **Public** | Marketing pages, published docs | No special handling |
| **Internal** | Internal docs, non-sensitive metrics | Authenticated access |
| **Confidential / PII** | Name, email, phone, address, IP address, device IDs, precise location, order history | Encrypted in transit and at rest, access-controlled and logged, redacted from logs |
| **Restricted** | Credentials, payment card data, government IDs, health, biometrics, children's data | Field-level encryption or tokenization, minimal access, strict retention, often legal controls |

Tag each field with its class in the schema documentation. If a model or table has no class,
treat it as Confidential until decided.

## Data minimization

- Collect only what the feature needs, and say why in the design doc. "Might be useful later"
  isn't a reason.
- Store a derived value instead of the raw one where possible (a boolean `isOver18` instead of
  the birth date; the last 4 digits instead of the full number).
- Prefer pseudonymous IDs. Keep the identity mapping in a separate, more restricted store.
- Don't copy production PII into dev, test or analytics environments. Use synthetic or
  masked data.

## Retention and deletion

- Define a **retention period per data class** and enforce it with automated jobs (TTL columns,
  scheduled deletion), not good intentions.
- Support **deletion and export** requests: know every place a person's data lives (primary DB,
  search index, caches, backups, analytics, logs, third parties) and have a way to remove or
  expire it.
- Soft-delete is not deletion for privacy purposes. Hard-delete or anonymize when required.
- Backups age out on a documented schedule.

## Protection

- **In transit:** TLS everywhere (`crypto.md`). **At rest:** encrypted storage and backups; add
  application-level field encryption for Restricted data.
- **Access:** least privilege, audited, with no shared admin accounts. Production data access by
  engineers is exceptional, time-bound and logged.
- **Tokenize** card data through the payment provider so it never touches your servers (keeps
  you out of most PCI scope).

## Logs, analytics and telemetry

Personal data stays out of logs, traces, metrics labels, error reports and analytics events
(`.claude/standards/logging-observability.md`).

- Redact at the logger with a deny-list of field names and an allow-list for request logging.
- Log opaque user IDs, not emails. Truncate IPs if you need them at all.
- Check that crash reporters and session replay tools mask inputs.

## Third parties

Each processor that receives personal data needs: a purpose, a contract (DPA), a documented
data list, a region check, and an entry in the data inventory. Review it in the threat model.
Don't paste real customer data into external tools, including AI assistants, without approval.

## Privacy checklist for a feature

- [ ] Data fields listed and classified; each one justified.
- [ ] Retention period and deletion path defined.
- [ ] Access control and audit logging in place.
- [ ] No PII in logs, URLs, analytics or error messages.
- [ ] Third parties and regions reviewed.
- [ ] User-facing notice or consent updated if the purpose changed.

## Sources

- GDPR — https://gdpr-info.eu/ (Art. 5 principles, Art. 25 privacy by design, Art. 17 erasure)
- OWASP Top 10 Privacy Risks — https://owasp.org/www-project-top-10-privacy-risks/
- OWASP User Privacy Protection Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/User_Privacy_Protection_Cheat_Sheet.html
- NIST Privacy Framework — https://www.nist.gov/privacy-framework
- PCI DSS — https://www.pcisecuritystandards.org/
