# Scanner commands

Run the scripted version first: `bash .claude/scripts/run_scanners.sh [dir]` runs whatever is
installed and prints a summary with `PASS`, `FINDINGS` or `SKIPPED` per tool. Use the commands
below to dig into one tool's output. A scanner that isn't installed has **not run**; report it
that way.

## Contents
- Quick reference
- Reading results
- Triage and suppression
- Install

## Quick reference

| Purpose | Tool | Command | Exit code |
|---|---|---|---|
| Secrets in history | gitleaks | `gitleaks detect --redact --no-banner` | 1 = leaks found |
| Secrets in staged changes | gitleaks | `gitleaks git --staged --redact --no-banner` | 1 = leaks found |
| Static analysis (all languages) | semgrep | `semgrep scan --config auto --error --metrics=off` | 1 = findings |
| Static analysis, a single rule pack | semgrep | `semgrep scan --config p/owasp-top-ten --metrics=off` | |
| Dependencies, any lockfile | osv-scanner | `osv-scanner scan --recursive .` | 1 = vulnerabilities |
| npm / pnpm / yarn | npm audit | `npm audit --omit=dev --audit-level=high` | non-zero = findings |
| Python | pip-audit | `pip-audit` | non-zero = findings |
| Rust | cargo-deny / cargo-audit | `cargo deny check advisories` / `cargo audit` | non-zero = findings |
| Container image | trivy | `trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 IMAGE` | 1 = findings |
| Dockerfile, Terraform, Kubernetes | trivy | `trivy config --severity HIGH,CRITICAL --exit-code 1 .` | 1 = findings |
| IaC (alternative) | checkov | `checkov -d . --quiet --compact` | 1 = failed checks |
| Dockerfile lint | hadolint | `hadolint Dockerfile` | 1 = findings |

Prefer the project's own scripts when they exist (`npm run audit`, `make security`).

## Reading results

- **gitleaks:** each finding has a rule, file, line and commit. Don't paste the secret. Tell the
  user the file and line, and that the credential must be rotated, since history is already exposed.
- **semgrep:** the rule id says the class of issue. Open the file at the reported line and trace the
  data flow: a taint finding with a validated source is a probable false positive.
- **osv-scanner / audit tools:** check three things per advisory: is the vulnerable function reachable
  from this code, is it a production or dev-only dependency, and is a fixed version available.
- **trivy (image):** fix by updating the base image or the package. `--ignore-unfixed` hides issues
  with no available fix; mention that when you use it.
- **checkov / trivy config:** map findings to the rule in `.claude/security/infra-container.md`.

## Triage and suppression

- Report by severity and reachability. Summarize the long tail instead of pasting output.
- A false positive is documented, not deleted: where it is, why it is safe, and who decided.
- Suppress only in the tool's config (`.gitleaks.toml`, `.semgrepignore` / `# nosemgrep: rule-id`,
  `.trivyignore`, `osv-scanner.toml`), with a reason and an expiry where the tool supports one.
  Suppressions are reviewed in `peer-review` like code.
- Never suppress a finding just to make a check pass.

## Install

| Tool | macOS | Other |
|---|---|---|
| gitleaks | `brew install gitleaks` | github.com/gitleaks/gitleaks releases |
| semgrep | `brew install semgrep` or `pipx install semgrep` | |
| osv-scanner | `brew install osv-scanner` | `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest` |
| trivy | `brew install trivy` | aquasecurity.github.io/trivy |
| checkov | `pipx install checkov` | |
| hadolint | `brew install hadolint` | |
| pip-audit | `pipx install pip-audit` | |
| cargo-audit / cargo-deny | `cargo install cargo-audit cargo-deny` | |
