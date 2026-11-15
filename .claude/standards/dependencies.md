# Dependencies

> **Precedence:** the project's own package manager, lockfile policy, allowed-license list and
> update tooling win over this file.

Every dependency is code you ship but didn't write and can't fully review. It brings bugs,
vulnerabilities, license obligations and upgrade work. Add one when it clearly pays for that.
The security side (SCA, SBOM, signing, SLSA) is in `.claude/security/supply-chain.md`.

## Before adding a dependency

Ask, and answer in the PR description:

1. **Is it needed?** Could the standard library or an existing dependency do it? A dozen lines
   of your own code can beat a transitive tree of 40 packages (remember `left-pad`).
2. **Is it healthy?** Recent releases, active maintainers (more than one), responsiveness to
   issues, a security policy, adoption. Check the OpenSSF Scorecard (`scorecard` or deps.dev).
3. **Is it safe?** No known open vulnerabilities (`osv-scanner`, deps.dev). Check that the
   package name is spelled correctly (typosquatting) and the install scripts do nothing unusual.
4. **Is the license compatible?** See below.
5. **What does it cost?** Transitive dependency count, bundle size for frontend
   (`bundlephobia`), native build requirements.

## Pinning and lockfiles

- **Commit the lockfile** (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`,
  `uv.lock`, `Cargo.lock`, `go.sum`, `Gemfile.lock`, `packages.lock.json`). Applications must;
  libraries should commit one for CI reproducibility.
- **Install from the lockfile in CI** (`npm ci`, `pnpm install --frozen-lockfile`, `uv sync --locked`,
  `poetry install --sync`, `cargo build --locked`). A drifted lockfile fails the build.
- **Applications** pin exact versions through the lockfile. **Libraries** declare compatible
  ranges, so consumers aren't forced into conflicts.
- **Pin by digest** for container base images and CI actions; tags can be moved.
- Never hand-edit a lockfile. Regenerate it with the package manager.

## Update cadence

- Use automated update PRs (Renovate or Dependabot), grouped by ecosystem or risk, with CI as
  the gate.
- **Security fixes:** critical and high within days (according to the project's SLA), others in
  the next regular cycle.
- **Patch and minor:** batched weekly or bi-weekly; auto-merge if the tests are good.
- **Major:** scheduled work. Read the changelog and migration guide, upgrade one major at a
  time, and keep it in its own PR.
- Don't fall more than one major version behind on core frameworks. Big-bang upgrades are
  where projects stall.

## Licenses

| Category | Examples | Typical policy |
|---|---|---|
| Permissive | MIT, BSD-2/3, Apache-2.0, ISC | Allowed; keep notices (Apache-2.0 also requires NOTICE files) |
| Weak copyleft | LGPL, MPL-2.0, EPL | Usually allowed when unmodified and dynamically linked; check with legal |
| Strong copyleft | GPL, AGPL | Often disallowed in proprietary or SaaS code (AGPL affects network use) |
| None / unknown / custom | No license file, "do what you want" | Not allowed until clarified. No license means no permission |

Enforce the policy in CI (`license-checker`, `pip-licenses`, `cargo deny`, `go-licenses`, ORT).
Details: `.claude/skills/dependency-audit/references/license-compatibility.md`.

## Hygiene

- Remove unused dependencies (`depcheck`, `knip`, `deptry`, `cargo machete`, `go mod tidy`).
- Split dev and prod dependencies, so test tools don't ship.
- Use one package manager per project; don't mix npm and yarn lockfiles.
- Keep transitive overrides (`overrides`, `resolutions`, `constraints`) commented with the reason
  and an issue to remove them.

## Verify

The lockfile is present and CI installs frozen; SCA and license checks run in CI; the update bot is
configured; a new dependency's PR answers the five questions above.

## Sources

- OpenSSF Scorecard — https://securityscorecards.dev/
- deps.dev (Open Source Insights, Google) — https://deps.dev/
- OpenSSF Concise Guide for Evaluating Open Source Software — https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software
- Renovate docs — https://docs.renovatebot.com/
- SPDX license list — https://spdx.org/licenses/
