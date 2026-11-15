# Secrets management

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner).

A secret in a repository is a secret that has leaked: git history is copied to every clone,
CI cache and fork, and deleting the file later removes nothing. Secrets are API keys, tokens,
passwords, private keys, connection strings with credentials, signing keys and webhook secrets.

## Rules

- **Never hardcode a secret**, in source, tests, fixtures, Dockerfiles, CI files, notebooks or docs.
  Tests use obviously fake values (`test-key-not-real`).
- **Load secrets from the environment or a secret manager** at runtime (AWS Secrets Manager,
  GCP Secret Manager, Azure Key Vault, HashiCorp Vault, Doppler, 1Password CLI). Prefer
  workload identity (OIDC, IAM roles) so there is no long-lived secret to store at all.
- **`.env` files are local only.** `.env*` is in `.gitignore`; commit `.env.example` with
  placeholder values and a comment per variable.
- **Don't pass secrets as command-line arguments** (visible in `ps` and shell history) or bake
  them into images (`ENV`, `ARG`, `COPY .env`). Use BuildKit secret mounts (`--mount=type=secret`)
  at build time, and runtime injection when running.
- **Don't log, print or return secrets.** Redact them in logs, errors and debug output
  (`.claude/standards/logging-observability.md`).
- **Scope and rotate:** one secret per purpose and environment, least-privilege permissions, an
  expiry or rotation schedule (90 days or less for static keys), and a documented rotation procedure.
- **Fail closed:** if a required secret is missing, the app refuses to start. It doesn't fall back
  to a default.

## Scanning

Scan for secrets at three points, so one miss doesn't ship:

1. **Locally, before commit:** the `secret_scan` hook (`gitleaks protect --staged`).
2. **In CI, on every PR:** `gitleaks detect` or `trufflehog` (verified findings only, to cut noise).
3. **Platform-level:** GitHub secret scanning with push protection.

Commit a `.gitleaks.toml` for project-specific rules and a reviewed allow-list. An allow-list
entry needs a comment saying why the value is not a secret.

## If a secret leaks

1. **Revoke and rotate it first.** Assume it was already copied. History rewriting doesn't un-leak it.
2. Check the provider's audit logs for use of the key during the exposure window.
3. Remove it from the code and history (`git filter-repo`, BFG) only after rotation, and tell
   everyone with a clone.
4. Write a short incident note (`.claude/templates/postmortem.md`), and add the check that
   would have caught it.

## For the agent

Don't read `.env*`, `*.pem`, `*.key`, `secrets/` or cloud credential files, even to "check the
config" (the deny rules block it). If you need to know which variables a project expects, read
`.env.example` or the config schema. If you encounter a secret in output, don't repeat it in
your response, commits or PR text. Flag it to the user so they can rotate it.

## Sources

- OWASP Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- The Twelve-Factor App, III. Config — https://12factor.net/config
- Gitleaks — https://github.com/gitleaks/gitleaks
- GitHub secret scanning — https://docs.github.com/en/code-security/secret-scanning
- Docker build secrets — https://docs.docker.com/build/building/secrets/
