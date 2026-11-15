# Container and infrastructure security

> **Precedence:** a project security policy that is *stricter* than this file wins. A weaker one
> needs a documented risk acceptance (an ADR or ticket with an owner). General DevOps rules:
> `.claude/rules/core/devops.md`.

Containers and cloud config are code with the largest blast radius: one permissive setting can
expose a whole environment (OWASP A02). Everything here is checked by tools, so wire the tools
into CI rather than relying on reviewers to remember.

## Dockerfile hardening

| Rule | Why | Example |
|---|---|---|
| Minimal, pinned base image (distroless, `-slim`, Alpine, or `scratch` for static binaries) pinned by **digest** | Smaller attack surface; tags can move | `FROM gcr.io/distroless/cc-debian12@sha256:…` |
| **Multi-stage builds**: compile in a builder, copy only the artifact | No compilers, caches or source in the final image | `COPY --from=build /out/app /app` |
| **Run as non-root** with a numeric UID | A compromised process shouldn't be root | `USER 10001:10001` |
| No secrets in layers (`ENV`, `ARG`, `COPY .env`) | Layers are readable by anyone with the image | `RUN --mount=type=secret,id=npmrc …` |
| `.dockerignore` for `.git`, `.env*`, tests, local config | Keeps secrets and bloat out of the build context | |
| One process per container, `exec` form for `CMD`/`ENTRYPOINT` | Correct signal handling and clean shutdown | `CMD ["/app"]` |
| `COPY` over `ADD`; verify downloaded files by checksum; no `curl \| sh` | `ADD` auto-extracts and fetches URLs | |
| Pin package versions, clean caches in the same `RUN` | Reproducibility, smaller layers | `apt-get install -y --no-install-recommends … && rm -rf /var/lib/apt/lists/*` |
| `HEALTHCHECK` (or Kubernetes probes) | Orchestrators can replace bad instances | |

Never use `--privileged`, mount the Docker socket, or add capabilities you don't need
(`--cap-drop=ALL`, then add back only specific ones). Prefer a read-only root filesystem.

## Image scanning

- Scan every built image in CI: `trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 <image>`.
- Rescan registry images on a schedule: new CVEs appear after the build.
- Rebuild on base image updates, using the update bot to bump digests.
- Sign images and verify them at admission (see `supply-chain.md`).

## Infrastructure as Code scanning

Scan IaC in CI before `plan` or `apply`:

| Tool | Covers |
|---|---|
| `checkov -d .` | Terraform, CloudFormation, Kubernetes, Dockerfile, Helm, GitHub Actions |
| `trivy config .` | Terraform, Kubernetes, Dockerfile misconfigurations |
| `tflint`, `terraform validate` | Correctness and provider-specific errors |
| `hadolint Dockerfile` | Dockerfile best practices |
| `kubeconform`, `kube-linter` | Kubernetes manifest validity and hygiene |

Benchmarks to map findings to: CIS Docker Benchmark, CIS Kubernetes Benchmark, CIS cloud
foundations benchmarks.

Common findings to fix on sight: public buckets or databases, `0.0.0.0/0` on SSH/RDP/DB ports,
`*` in IAM actions or resources, unencrypted storage, no logging or audit trail, default VPC use.

## Kubernetes workloads

Set a restrictive `securityContext` on every pod:

```yaml
securityContext:           # pod level
  runAsNonRoot: true
  seccompProfile: { type: RuntimeDefault }
containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities: { drop: ["ALL"] }
    resources:
      requests: { cpu: 100m, memory: 128Mi }
      limits:   { memory: 256Mi }
```

- Enforce the **Pod Security Standards** `restricted` profile per namespace (Pod Security
  Admission, Kyverno or OPA Gatekeeper).
- **NetworkPolicies:** default-deny ingress and egress per namespace, then allow only needed flows.
- **RBAC:** least privilege, per-workload service accounts, `automountServiceAccountToken: false`
  unless the pod calls the API. No `cluster-admin` for workloads.
- Secrets come from an external secret manager (External Secrets, CSI driver), with encryption
  at rest enabled for etcd. Don't commit `Secret` manifests.
- Images from trusted registries only, by digest.

## Cloud and IaC state

- IAM: least privilege, no long-lived user keys, role-based or federated access, MFA on humans.
- Terraform state is remote, encrypted and access-controlled, because it can contain secrets.
- Enable audit logging (CloudTrail, Cloud Audit Logs) and alerts on risky changes.
- Encrypt data at rest and in transit by default. Tag resources with the owner and the data class.

## Sources

- CIS Benchmarks — https://www.cisecurity.org/cis-benchmarks
- Docker security best practices — https://docs.docker.com/build/building/best-practices/
- Kubernetes Pod Security Standards — https://kubernetes.io/docs/concepts/security/pod-security-standards/
- NSA/CISA Kubernetes Hardening Guide — https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF
- Trivy — https://trivy.dev/ · Checkov — https://www.checkov.io/ · Hadolint — https://github.com/hadolint/hadolint
- OWASP Docker Security Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
