# Routing: task, skill, agent

Which skill to use for which job, which agent owns it, and which standards it reads. Agents are
used in **deep** mode or when the user asks; at light depth do the work yourself using the same skill.

## Contents
- Skill and agent routing
- Agent tool access
- Independence rules

## Skill and agent routing

| Need | Skill | Agent | Standards it reads (in addition to the always-on rules) |
|---|---|---|---|
| Turn a vague request into criteria | requirement-analysis | planner | security/threat-modeling, privacy-data |
| Design, RFC, ADR, diagrams | system-design | architect | standards/architecture, design-patterns, cloud-design-patterns, well-architected, performance; rules/core/api-design, database |
| Split work into slices | task-breakdown | planner | standards/git-workflow |
| Build a feature test-first | implement-feature | implementer | rules/core/testing; standards/design-patterns; security/secure-coding, input-output |
| Write or extend tests | write-tests | test-engineer | rules/core/testing |
| Restructure safely | refactor | implementer | rules/core/testing; standards/design-patterns |
| Find a bug's cause | debug-root-cause | debugger | rules/core/testing; standards/logging-observability |
| Schema or data migration | database-migration | implementer | rules/core/database; security/privacy-data |
| Build API endpoints | api-implementation | implementer | rules/core/api-design; security/api-security, auth-session, input-output |
| Review a diff or PR | peer-review | code-reviewer | standards/code-review; security/checklists/security-review-checklist |
| Security audit | appsec-review | security-auditor | all of security/ |
| Dependency risk | dependency-audit | security-auditor | standards/dependencies; security/supply-chain |
| Performance investigation | performance-review | debugger | standards/performance, logging-observability |
| Commit and PR | git-commit-pr | implementer | standards/git-workflow, documentation |
| CI/CD pipeline | ci-pipeline | devops-engineer | rules/core/devops; security/supply-chain, secrets |
| Dockerfile and compose | containerize | devops-engineer | rules/core/devops; security/infra-container |
| Terraform / IaC | infrastructure-as-code | devops-engineer | rules/core/devops; security/infra-container, secrets |
| Version, notes, rollback plan | release-management | release-manager | standards/git-workflow; security/checklists/pre-release |
| Logging, metrics, alerts | observability-setup | devops-engineer | standards/logging-observability; security/privacy-data |
| Blameless postmortem | incident-postmortem | doc-writer | templates/postmortem |
| README, API docs, runbooks | documentation | doc-writer | standards/documentation |

## Agent tool access

Least privilege, so a reviewer cannot quietly "fix" what it is reviewing.

| Agent | Can read | Can write code | Can run commands |
|---|---|---|---|
| planner, architect | yes | docs only (architect) | no |
| implementer, test-engineer, debugger, devops-engineer | yes | yes | yes |
| code-reviewer | yes | **no** | read-only commands (git, test, lint) |
| security-auditor | yes | **no** | scanners and read-only commands |
| doc-writer | yes | docs only | no |
| release-manager | yes | changelog and version files | git and build commands |

## Independence rules

- The agent that wrote a change doesn't review it. Review and security agents get the diff and
  the acceptance criteria, not the implementer's reasoning.
- Reviewers report; the author fixes. After fixes, re-review the changed parts.
- If no agent is available (or the user wants it light), say plainly that the review was a
  self-check, so nobody mistakes it for an independent one.
