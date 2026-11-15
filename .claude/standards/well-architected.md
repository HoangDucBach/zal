# Well-Architected review

> **Precedence:** the project's own architecture principles, SLOs and compliance requirements win
> over this file. The pillars are provider-neutral ideas; the AWS-specific examples are labelled.
> A pillar review is a constructive conversation about trade-offs, not an audit or a pass/fail test.

The AWS Well-Architected Framework (published November 2024) describes six pillars: the qualities a
cloud workload should have, and the questions that show whether it does. Use it to *review a design
or a running workload* against all six at once, because teams under pressure tend to optimize the
one they can see (features, speed) and quietly neglect the others (recovery, cost, security). It
complements the other files in this workflow, which hold the detailed rules; this one is the checklist
that makes sure none of them was forgotten.

## When to use it

- A **design doc** for a new service, a big change in scale, or a new dependency: add the pillar check from `.claude/templates/design-doc.md`.
- **Before a launch**, alongside `.claude/checklists/release-checklist.md` and `.claude/security/checklists/pre-release-security-checklist.md`.
- After an **incident**, to see which pillar the gap came from (`.claude/templates/postmortem.md`).
- Periodically for a long-lived workload, since traffic, team and technology change.

For small changes, skip it. A review that takes longer than the change is a cost, not a safeguard.

## The pillars at a glance

| Pillar | The ability to... | Design principles |
|---|---|---|
| **Operational excellence** | build software correctly, run it at scale and keep improving how you operate it | Organize teams around business outcomes; Implement observability for actionable insights; Safely automate where possible; Make frequent, small, reversible changes; Refine operations procedures frequently; Anticipate failure; Learn from all operational events and metrics; Use managed services |
| **Security** | protect data, systems and assets | Implement a strong identity foundation; Maintain traceability; Apply security at all layers; Automate security best practices; Protect data in transit and at rest; Keep people away from data; Prepare for security events |
| **Reliability** | perform the intended function correctly and consistently when expected, across the whole lifecycle (operating and testing it too) | Automatically recover from failure; Test recovery procedures; Scale horizontally to increase aggregate workload availability; Stop guessing capacity; Manage change through automation |
| **Performance efficiency** | use resources efficiently to meet performance requirements, and stay efficient as demand and technology change | Democratize advanced technologies; Go global in minutes; Use serverless architectures; Experiment more often; Consider mechanical sympathy |
| **Cost optimization** | deliver business value at the lowest price point | Implement Cloud Financial Management; Adopt a consumption model; Measure overall efficiency; Stop spending money on undifferentiated heavy lifting; Analyze and attribute expenditure |
| **Sustainability** | reduce environmental impact, above all energy consumption | Understand your impact; Establish sustainability goals; Maximize utilization; Anticipate and adopt new, more efficient hardware and software offerings; Use managed services; Reduce the downstream impact of your cloud workloads |

The framework groups its questions into these best-practice areas:

| Pillar | Best-practice areas |
|---|---|
| Operational excellence | Organization, Prepare, Operate, Evolve |
| Security | Security foundations, Identity and access management, Detection, Infrastructure protection, Data protection, Incident response, Application security |
| Reliability | Foundations, Workload architecture, Change management, Failure management |
| Performance efficiency | Architecture selection, Compute and hardware, Data management, Networking and content delivery, Process and culture |
| Cost optimization | Practice Cloud Financial Management, Expenditure and usage awareness, Cost-effective resources, Manage demand and supply resources, Optimize over time |
| Sustainability | Region selection, Alignment to demand, Software and architecture, Data management, Hardware and services, Process and culture |

The official question text is in the framework itself (and the AWS Well-Architected Tool). The
questions below are this workflow's own prompts, written for engineers reviewing a design.

## Review questions, and where this workflow already covers them

### Operational excellence
- Can we see what the workload is doing (logs, metrics, traces) and tell when business outcomes are at risk? → `.claude/standards/logging-observability.md`
- Are deployments automated, small and reversible, with a rollback we have tried? → `.claude/rules/core/devops.md`, `.claude/standards/git-workflow.md`, `.claude/checklists/release-checklist.md`
- Does an on-call engineer have a runbook, and have we practised failure? → `.claude/templates/runbook.md`
- Do we learn from incidents and feed it back? → `.claude/templates/postmortem.md`
- Could a managed service remove an operational burden we would otherwise carry?

### Security
- Is access least-privilege, with no long-lived static credentials where an identity can be federated? → `.claude/security/auth-session.md`, `.claude/security/secrets.md`
- Can we trace who did what, and are we alerted? → `.claude/security/secure-coding.md` (A09), `.claude/standards/logging-observability.md`
- Is there defence in depth, not one control at one layer? → `.claude/security/infra-container.md`, `.claude/security/api-security.md`
- Is data classified and protected at rest and in transit, with people kept away from it? → `.claude/security/privacy-data.md`, `.claude/security/crypto.md`
- Is security built into the delivery pipeline and is there an incident plan? → `.claude/security/supply-chain.md`, `.claude/security/threat-modeling.md`

### Reliability
- What happens when each dependency fails or slows down: timeouts, retries, circuit breakers, fallbacks? → `.claude/rules/core/error-handling.md`, `.claude/standards/cloud-design-patterns.md`
- Is the failure of one component contained, with no shared point of failure and capacity scaled automatically?
- Are backups taken, restores tested, and recovery objectives (RTO, RPO) stated and met? → `.claude/rules/core/database.md`
- Are changes automated and tested, including the ability to roll back? → `.claude/rules/core/devops.md`
- Have we actually tested recovery (game days, fault injection), not only the happy path? → `.claude/rules/core/testing.md`

### Performance efficiency
- Is the architecture, compute and datastore choice justified by the access patterns (mechanical sympathy)? → `.claude/standards/architecture.md`, `.claude/rules/core/database.md`
- Do we have performance targets, measurements and a way to catch regressions? → `.claude/standards/performance.md`
- Is latency to users acceptable (regions, caching, content delivery)?
- Have we compared alternatives by experiment instead of by habit?

### Cost optimization
- Do we know what the workload costs, per environment and per unit of business output (a request, a user, an order)?
- Is every resource tagged with an owner and purpose? → `.claude/rules/core/devops.md`
- Are resources right-sized, and are non-production environments switched off when idle? (A dev environment used 40 of 168 hours a week costs about 75% less when stopped outside those hours.)
- Is there a budget with alerts, and someone who reads them?
- Is a managed service cheaper than the engineering time to run our own, counted honestly?
- Does the design record its main cost drivers, so a later change doesn't blow the budget unnoticed?

### Sustainability
- Do we measure resource use per unit of work and have a goal for it?
- Is utilization high (right-sized, autoscaled, nothing idle), and do we avoid doing unnecessary work?
- Is data kept only as long as needed, and moved to cheaper, lower-energy storage as it ages? → `.claude/security/privacy-data.md` (retention)
- Did we consider region choice and efficient hardware or runtimes where we have the choice?

## Trade-offs between pillars

The pillars pull against each other, and the review's job is to make the trade-off visible, not to
maximize every pillar. Examples:
- More redundancy (reliability) costs more (cost) and uses more energy (sustainability).
- Aggressive caching (performance) adds staleness and invalidation risk (reliability, correctness).
- Tight security controls (security) can slow delivery (operational excellence).
- Serverless and managed services often help operations, cost and sustainability together, at the price of less control.

Record the chosen trade-off in an ADR (`.claude/templates/adr.md`): which pillar you favoured, why,
and what would make you revisit it.

## Doing a review

1. Pick the scope: one workload and its dependencies, with its stated SLOs and constraints.
2. Walk the six pillars with the prompts above; for each, note **evidence** (a dashboard, a test, a doc), not opinions.
3. Mark each gap as **high risk** (could cause an outage, breach or serious loss), **medium** or **low**, and say which pillar it belongs to.
4. Turn the high and medium gaps into owned, dated tasks (`task-breakdown`). Record accepted risks with an owner and an expiry date.
5. Re-run after significant changes.

AWS offers a free Well-Architected Tool and hands-on labs if the workload runs on AWS; the process
above works without them.

## Sources

- AWS Well-Architected Framework — https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- The pillars of the framework — https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html
- Pillar pages: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability (same site)
- Google SRE Book, for the shared ideas on reliability and operations — https://sre.google/sre-book/table-of-contents/
