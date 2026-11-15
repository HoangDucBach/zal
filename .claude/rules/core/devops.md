---
paths:
  - "**/Dockerfile*"
  - "**/*.dockerfile"
  - "**/{docker-compose,compose}*.{yml,yaml}"
  - "**/.github/workflows/**"
  - "**/.gitlab-ci.yml"
  - "**/Jenkinsfile"
  - "**/azure-pipelines.yml"
  - "**/*.{tf,tfvars}"
  - "**/Pulumi.*"
  - "**/k8s/**"
  - "**/kubernetes/**"
  - "**/helm/**"
  - "**/charts/**"
  - "**/kustomization.{yml,yaml}"
  - "**/Makefile"
  - "**/.env.example"
---

# DevOps

> **Precedence:** the project's existing CI system, deployment tooling and infrastructure
> conventions win over this file. If you deviate from it, say why in the PR description.

A change isn't delivered until it runs in production and can be rolled back. These rules keep
builds reproducible, deploys boring and environments alike. Hardening details for containers
and IaC live in `.claude/security/infra-container.md`.

## Twelve-Factor essentials

| Factor | Rule | Why |
|---|---|---|
| Config | All config comes from the environment. No per-environment code branches or files baked into images | One artifact promotes through every environment |
| Build, release, run | Build once, then promote the same immutable artifact (image digest) to every environment | What you tested is what you ship |
| Dependencies | Declared and locked; nothing assumed on the host | Reproducible builds |
| Processes | Stateless; state lives in backing services | Scale and restart freely |
| Backing services | DB, cache and queue are attached resources selected by URL/credentials | Swap without code changes |
| Disposability | Fast start; graceful shutdown on `SIGTERM` (drain, then exit) | Safe deploys and autoscaling |
| Dev/prod parity | Same engine versions locally (containers) as in prod | "Works on my machine" bugs disappear |
| Logs | Write to stdout as structured events; the platform routes them | No log files inside containers |

Commit `.env.example` with every variable documented and dummy values. Never commit a real `.env`.

## CI pipeline stages

Run cheap, fast checks first so feedback arrives in minutes:

1. **Validate:** format check, lint, type check, commit-message lint.
2. **Test:** unit tests, then integration tests (services via containers), with coverage.
3. **Security:** secret scan, SAST, SCA/dependency audit, IaC scan (see `.claude/security/`).
4. **Build:** an immutable, versioned artifact or image, with an SBOM, signed.
5. **Scan the artifact:** image vulnerability scan; fail on high or critical findings that have a fix.
6. **Deploy:** to staging automatically, smoke test, then promote to production (gated or
   continuous) with progressive rollout.

Pipeline rules:

- **Fast and deterministic:** cache dependencies keyed on the lockfile, run independent jobs in
  parallel, and pin tool and action versions (actions by commit SHA).
- **Least privilege:** use OIDC federation to the cloud instead of long-lived keys, read-only
  default tokens (`permissions: contents: read`), and secrets scoped to the jobs that need them.
- **Main is always releasable:** a red main build is the team's top priority to fix.
- **No manual steps** between merge and deploy except an explicit approval gate.

## Infrastructure as Code

- All infrastructure is code, reviewed in PRs. No click-ops in shared environments.
- Remote state with locking and encryption, one state per environment and component.
- `plan` in CI on every PR, posted for review. `apply` only from CI on merge.
- Modules are versioned. Environments differ by variables, not by copy-pasted code.
- Tag every resource (`owner`, `env`, `service`, `cost-center`).
- Detect drift on a schedule.

## Deploys and rollback

- Every deploy has a tested rollback path (previous image digest, feature-flag off, or a
  backward-compatible migration). See `.claude/rules/core/database.md`.
- Prefer progressive delivery (canary or blue-green) with automated health checks over big-bang deploys.
- Deploys are visible: an annotation in monitoring, a link to the change, and an owner.

## Containers (short version)

Use multi-stage builds, a minimal pinned base image (digest), a non-root user, one process per
container, a `HEALTHCHECK` or probes, and a `.dockerignore` that excludes `.git`, `.env` and
tests. The full checklist is in `.claude/security/infra-container.md`.

## Verify

`actionlint` (GitHub Actions), `gitlab-ci-lint`, `hadolint` (Dockerfiles),
`terraform fmt -check` / `terraform validate` / `tflint`, `checkov` or `trivy config` (IaC),
`kubeconform` (Kubernetes manifests), `helm lint`.

## Sources

- The Twelve-Factor App — https://12factor.net/
- Google SRE Book, "Release Engineering" — https://sre.google/sre-book/release-engineering/
- DORA research — https://dora.dev/
- GitHub Actions security hardening — https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- HashiCorp Terraform recommended practices — https://developer.hashicorp.com/terraform/cloud-docs/recommended-practices
