# Definition of Ready

A task is ready to start when the answer to "how will we know it's done?" is already written
down. Starting earlier means discovering the requirements by building the wrong thing. Used by
`requirement-analysis` as its exit gate. For a small change, a one-line check is enough: only
the items marked **always** apply.

## Always
- [ ] **The goal is stated** as a user or business outcome, not as a solution.
- [ ] **Acceptance criteria are testable**: each is a concrete Given / When / Then, or a measurable
      condition. "Works well" is not testable.
- [ ] **Scope is explicit**: what is in, and what is deliberately out.

## For anything beyond a small change
- [ ] **Edge cases listed**: empty, maximum size, invalid, duplicate, concurrent, unauthorized,
      time zones, partial failure.
- [ ] **Non-functional requirements stated** where they matter: performance target, availability,
      security, scale, accessibility, i18n.
- [ ] **Dependencies identified**: other teams, services, decisions, data, access, and their status.
- [ ] **The task is small enough**: it can ship in a few days, or it is split into slices that each can.
- [ ] **Open questions are answered, or have an owner and a date.** Anything still open that
      could change the design is resolved before building, not during.

## When any of these apply
- [ ] **Threat model done** for a new service, an auth change, new external input, or personal
      data (`.claude/security/threat-modeling.md`).
- [ ] **Design reviewed** for a new component, API or data model (`.claude/templates/design-doc.md`),
      and an ADR written for hard-to-reverse decisions.
- [ ] **Data impact understood**: migrations, backfills, retention, classification.
- [ ] **Rollout and rollback plan sketched** for risky changes.

If an item can't be answered, that is the finding. Record it and ask, rather than guess.
