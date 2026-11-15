#!/usr/bin/env python3
"""Validate a commit message against Conventional Commits 1.0.0.

Usage:
  check_commit_msg.py "feat(auth): add login endpoint"
  check_commit_msg.py --file .git/COMMIT_EDITMSG
  echo "fix: handle null total" | check_commit_msg.py -

Exit codes: 0 valid, 1 invalid (reasons on stderr), 2 usage error.
"""
from __future__ import annotations

import re
import sys

TYPES = ("feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "style", "revert")
HEADER_RE = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^()\s][^()]*)\))?(?P<bang>!)?: (?P<subject>.+)$")
MAX_HEADER = 72
# Git-generated messages that are legitimately not conventional.
AUTO_PREFIXES = ("Merge ", "Revert \"", "fixup! ", "squash! ", "amend! ")
# Commits carry one author: no co-author trailers, whoever or whatever helped write them.
COAUTHOR_RE = re.compile(r"^\s*co-authored-by\s*:", re.IGNORECASE | re.MULTILINE)
COAUTHOR_PROBLEM = "remove the Co-authored-by trailer: commits in this workflow never carry co-author lines"


def validate(message: str) -> list[str]:
    problems: list[str] = []
    lines = message.splitlines()
    # Strip comment lines that git adds in the editor template.
    lines = [line for line in lines if not line.startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return ["commit message is empty"]

    if COAUTHOR_RE.search("\n".join(lines)):
        problems.append(COAUTHOR_PROBLEM)

    header = lines[0]
    if header.startswith(AUTO_PREFIXES):
        return problems

    match = HEADER_RE.match(header)
    if not match:
        return [
            f"header must look like 'type(scope): subject' (got: {header!r}). "
            f"Types: {', '.join(TYPES)}"
        ]
    if match.group("type") not in TYPES:
        problems.append(f"unknown type {match.group('type')!r}; use one of: {', '.join(TYPES)}")
    subject = match.group("subject")
    if len(header) > MAX_HEADER:
        problems.append(f"header is {len(header)} characters; keep it to {MAX_HEADER} or fewer")
    if subject.endswith("."):
        problems.append("subject should not end with a period")
    if subject[0].isupper():
        problems.append("subject should start lowercase (imperative mood: 'add', not 'Added')")

    if len(lines) > 1 and lines[1].strip():
        problems.append("leave a blank line between the header and the body")
    # Spec rule 11: a breaking change is valid on any type, so there is no type check here.
    lowercase_breaking = [line for line in lines if re.match(r"(?i)breaking[ -]change\s*:", line)
                          and not line.startswith(("BREAKING CHANGE:", "BREAKING-CHANGE:"))]
    if lowercase_breaking:
        problems.append("BREAKING CHANGE must be uppercase in the footer (spec rule 15)")
    return problems


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    if argv[1] == "--file":
        if len(argv) < 3:
            print("--file needs a path", file=sys.stderr)
            return 2
        with open(argv[2], encoding="utf-8") as handle:
            message = handle.read()
    elif argv[1] == "-":
        message = sys.stdin.read()
    else:
        message = argv[1]

    problems = validate(message)
    if problems:
        print("Commit message does not follow Conventional Commits:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print("Reference: .claude/standards/git-workflow.md", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
