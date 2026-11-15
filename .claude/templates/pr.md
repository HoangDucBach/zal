## What and why

<!-- One or two sentences: what changes, and the problem it solves. Link the issue: Closes #123 -->

## How it works

<!-- The approach, and anything a reviewer should look at first. Mention alternatives you rejected and why. -->

## How it was tested

<!-- Commands you ran and their result, new tests added, manual steps. "Tests pass" is not enough: say which. -->

- [ ] Unit / integration tests added or updated
- [ ] Verified locally: `<test command>` passes, lint and type check clean

## Risk and rollback

<!-- What could go wrong in production? How do we notice, and how do we undo it (revert, flag off, migration down)? -->

## Screenshots / output

<!-- UI changes: before and after. API changes: example request and response. Delete this section if not relevant. -->

## Checklist

- [ ] Small and focused (under about 400 changed lines, excluding lockfiles and generated files)
- [ ] Docs, README and CHANGELOG updated if behavior changed
- [ ] No secrets, debug code or commented-out code
- [ ] Touches auth, user input, personal data, dependencies or infrastructure? If so, a security review was done
- [ ] Breaking change? It is marked `!` in the title and described above, with a migration path
