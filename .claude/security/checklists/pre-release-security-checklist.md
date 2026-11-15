# Pre-release security checklist

Run before cutting a release or promoting to production. It complements the per-change review
(`security-review-checklist.md`): that one asks "is this change safe?", this one asks "is the
whole release safe to ship, and can we cope if it isn't?". Used by `release-management`.

## Code and dependencies
- [ ] All changes in the release passed `appsec-review` where they touched auth, input, data,
      dependencies or infra, with no open high or critical findings.
- [ ] Full SCA run on the release commit: no reachable high or critical vulnerabilities with an
      available fix. Accepted exceptions are listed with an owner and an expiry date.
- [ ] Secret scan of the full release range is clean (`gitleaks detect --log-opts "<prev-tag>..HEAD"`).
- [ ] Licenses of new dependencies are within policy (`.claude/standards/dependencies.md`).
- [ ] SAST (for example `semgrep --config auto`) has no unresolved high findings.

## Build and artifacts
- [ ] The artifact is built by CI from a tagged commit, not from a developer machine.
- [ ] Image scan is clean for high or critical findings with fixes; base image is pinned by digest.
- [ ] SBOM generated and attached to the release.
- [ ] Artifacts and images are signed, and provenance is published (`supply-chain.md`).

## Configuration and environment
- [ ] Production config differs from staging only through environment variables and secrets.
- [ ] Debug mode, test accounts, sample data and verbose errors are off in production.
- [ ] Security headers, CORS allow-list and TLS settings verified against the deployed environment.
- [ ] Secrets are rotated if any were exposed or the team changed; none are shared with staging.
- [ ] IaC changes in the release passed the IaC scan; the `plan` was reviewed.

## Data
- [ ] Migrations are backward-compatible with the running version and have a rollback plan
      (`.claude/rules/core/database.md`).
- [ ] New personal data fields are classified, covered by retention, and absent from logs
      (`privacy-data.md`).
- [ ] A backup was taken and a restore was tested recently.

## Detection and response
- [ ] Security events for the new features are logged, and alerts exist for abuse of new flows.
- [ ] Dashboards and alerts cover error rate and latency for the release.
- [ ] A rollback procedure is written and was tried; the rollback owner is named.
- [ ] The on-call engineer knows what is shipping, and the runbooks are linked.

## Sign-off
- [ ] Threat models for new components are filed (`threat-modeling.md`).
- [ ] Security reviewer sign-off recorded: name, date, release version.

If any item fails: fix it, or record an explicit risk acceptance (owner, reason, expiry) in the
release notes. An unchecked box with no explanation blocks the release.
