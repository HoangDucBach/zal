# Software supply chain

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner).

Your application is mostly other people's code, built by tools you don't control, and shipped
through a pipeline an attacker may target. This file covers keeping that chain trustworthy
(OWASP A03:2025). Choosing and updating dependencies: `.claude/standards/dependencies.md`.

## Dependencies

- **Commit lockfiles and install from them** (`npm ci`, `pnpm install --frozen-lockfile`,
  `uv sync --locked`, `cargo build --locked`). A build that resolves fresh versions is not
  reproducible and can be hijacked by a malicious new release.
- **Vet new packages** before adding them: exact name (typosquatting and dependency confusion),
  maintainers, age, download history, and any install scripts. In npm, consider
  `ignore-scripts=true` and allow-listing the packages that need install scripts.
- **Use a private registry or proxy** for internal package names, and reserve those names on
  the public registry, to prevent dependency confusion.
- **Wait out new releases** for the dependency bot (Renovate `minimumReleaseAge` of a few
  days). Most malicious versions are caught and pulled within days.

## Scanning (SCA)

Run software composition analysis on every PR and on a schedule, because new CVEs appear
against code that didn't change.

| Ecosystem | Tool |
|---|---|
| Any (lockfile based) | `osv-scanner scan --lockfile=<file>` or `osv-scanner scan -r .` |
| npm / pnpm / yarn | `npm audit --omit=dev` (or `pnpm audit`, `yarn npm audit`) |
| Python | `pip-audit -r requirements.txt` / `uv run pip-audit` |
| Rust | `cargo audit`, `cargo deny check advisories` |
| Containers | `trivy image <image>` |

**Triage policy:** fail the build on high or critical vulnerabilities that are reachable and
have a fix; track the rest with an owner and a due date. A suppression (VEX or an ignore
entry) needs a reason and an expiry date.

## Builds and CI

- **Pin CI actions and base images by digest or commit SHA**, not by mutable tags
  (`uses: actions/checkout@<40-char-sha> # v4.2.0`).
- **Least privilege tokens:** `permissions: contents: read` by default, and elevate per job.
  Use OIDC federation to the cloud instead of stored keys.
- **Untrusted PRs:** never run fork code with secrets. In GitHub, avoid `pull_request_target`
  with a checkout of the PR head; never interpolate `${{ github.event.* }}` strings into
  `run:` scripts (script injection) and pass them through `env:` instead.
- Build on ephemeral, isolated runners. Don't `curl | sh` installers; pin and checksum-verify
  downloaded tools.

## Provenance and artifacts

- **SBOM:** generate one for each release (`syft`, `cyclonedx-*` plugins, `cargo cyclonedx`)
  in SPDX or CycloneDX, and publish it with the artifact.
- **Sign** release artifacts and images (Sigstore `cosign`, keyless via OIDC) and **verify**
  signatures at deploy time (admission policy).
- **Provenance:** produce SLSA build provenance (GitHub `actions/attest-build-provenance`,
  `slsa-github-generator`).

| SLSA Build level | Meaning | Practical step |
|---|---|---|
| L1 | Provenance exists | Build script produces provenance |
| L2 | Hosted build, signed provenance | Build on CI, sign it |
| L3 | Hardened, isolated, non-forgeable builds | Isolated builder, secrets unavailable to build steps |

Aim for L2 on all releases and L3 for critical services.

## Source repository

Protected main branch, required reviews and status checks, signed commits or tags where policy
needs them, `CODEOWNERS` for sensitive paths (CI, auth, infra), 2FA for all maintainers, and
OpenSSF Scorecard run on the repo.

## Sources

- OWASP Top 10:2025, A03 Software Supply Chain Failures — https://owasp.org/Top10/
- SLSA — https://slsa.dev/spec/
- OpenSSF Scorecard — https://securityscorecards.dev/
- OSV-Scanner — https://google.github.io/osv-scanner/
- Sigstore — https://docs.sigstore.dev/
- GitHub Actions security hardening — https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- NIST SSDF (SP 800-218) — https://csrc.nist.gov/pubs/sp/800/218/final
