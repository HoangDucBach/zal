# Release checklist

Used by `release-management`. Complete top to bottom; each item needs evidence, not just a
tick. The security-specific gate is a separate file so that it can also run on its own:
`.claude/security/checklists/pre-release-security-checklist.md`.

## 1. Prepare
- [ ] Scope confirmed: the list of changes in this release, from merged PRs since the last tag.
- [ ] Version chosen by SemVer: breaking → major, features → minor, fixes → patch
      (`.claude/skills/release-management/references/semver-rules.md`).
- [ ] CHANGELOG: `Unreleased` moved under the new version and date, written for users, with
      breaking changes and migration steps called out.
- [ ] Docs and API reference match what ships; deprecations announced with dates.
- [ ] Feature flags set for the staged rollout; flags to remove after the release are ticketed.

## 2. Verify
- [ ] CI is green on the release commit (lint, type check, unit, integration, e2e).
- [ ] Pre-release security checklist passed, or each exception has an owner and an expiry date.
- [ ] Migrations tested on a production-sized copy; backward-compatible with the running version.
- [ ] Performance checked against targets for changed hot paths.
- [ ] Release candidate verified on staging with a smoke test of the critical user journeys.

## 3. Rollback readiness
- [ ] Rollback plan written, with exact steps, owner, and expected duration
      (`.claude/skills/release-management/references/rollback-plan-template.md`).
- [ ] The previous artifact is still available (image digest, package version).
- [ ] The rollback has been tried, or has a documented reason why it can't be.
- [ ] Backup taken and a restore tested recently, if data is touched.

## 4. Ship
- [ ] Tag created from the verified commit (`vX.Y.Z`, annotated), and the artifact built by CI
      from that tag.
- [ ] Artifacts signed, SBOM and provenance attached.
- [ ] Deploy with progressive rollout (canary or blue-green), watching error rate, latency and
      saturation at each step.
- [ ] Release notes published; internal stakeholders and support informed of what's changing.
- [ ] On-call engineer knows what is shipping, and when.

## 5. Verify in production
- [ ] Health checks green; key dashboards normal for 30 minutes (or the agreed window).
- [ ] Smoke test of the critical journeys on production.
- [ ] No new error patterns in logs; alerts quiet.
- [ ] Rollout completed to 100%, or rolled back with the reason recorded.

## 6. Close out
- [ ] Release marked complete; issues and milestones closed.
- [ ] Temporary flags, scaffolding and old code paths scheduled for removal.
- [ ] Anything that went wrong gets a note or a postmortem (`.claude/templates/postmortem.md`).
- [ ] Next version's `Unreleased` section is ready in the CHANGELOG.
