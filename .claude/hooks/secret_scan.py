#!/usr/bin/env python3
"""PreToolUse hook (Bash): scan what is about to be committed for secrets.

Runs on `git commit` only. Uses gitleaks when installed. Always also runs a built-in pattern
scan, because gitleaks may be missing and a skipped scan must not look like a clean one.
Findings are reported as file:line plus the rule name; the secret value is never printed.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    block, expand_nested_shells, fail_closed, git_subcommand, is_secret_path, read_event,
    strip_wrappers,
)

HOOK = "secret_scan"

PATTERNS = [
    ("AWS access key ID", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("Stripe live key", re.compile(r"\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    (
        "hard-coded credential",
        re.compile(r"""(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']"""),
    ),
]
PLACEHOLDER = re.compile(
    r"(?i)(?:change.?me|example|your[_-]|placeholder|dummy|sample|redacted|xxxx|\*{4}|<[^>]+>|\$\{|\{\{|process\.env|os\.environ|getenv|test[_-]?(?:key|secret|token)|not[_-]?real|fake)"
)


def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, timeout=60, **kwargs)


def commit_flags(words):
    sub, args, _ = git_subcommand(words)
    if sub != "commit":
        return None
    letters = "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--") and len(a) > 1)
    return {"all": "a" in letters or "--all" in args}


def added_lines(diff_args):
    """Yield (path, line_number, text) for every added line in a `git diff` invocation."""
    out = run(["git", "diff", "--no-color", "-U0", "--no-ext-diff", *diff_args])
    path, line_no = None, 0
    for line in out.stdout.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
        elif line.startswith("@@"):
            match = re.search(r"\+(\d+)", line)
            line_no = int(match.group(1)) if match else 0
        elif line.startswith("+") and not line.startswith("+++"):
            yield path, line_no, line[1:]
            line_no += 1


def scan_patterns(include_unstaged):
    findings = []
    sources = [["--cached"]] + ([[]] if include_unstaged else [])
    for diff_args in sources:
        for path, line_no, text in added_lines(diff_args):
            if len(text) > 2000:  # minified bundles and data blobs: too noisy to pattern-match
                continue
            for rule, pattern in PATTERNS:
                match = pattern.search(text)
                if not match:
                    continue
                matched_value = match.group(1) if match.groups() else match.group(0)
                if PLACEHOLDER.search(matched_value) or PLACEHOLDER.search(text):
                    continue
                findings.append(f"{path}:{line_no}  {rule}")
                break
    return findings


def staged_secret_files(include_unstaged):
    args = ["git", "diff", "--name-only", "--diff-filter=AM"]
    names = set(run(args + ["--cached"]).stdout.split("\n"))
    if include_unstaged:
        names |= set(run(args).stdout.split("\n"))
    return sorted(n for n in names if n and is_secret_path(n))


def gitleaks_findings():
    """Returns a list of finding strings, [] when clean, None when gitleaks is unavailable."""
    for args in (
        ["gitleaks", "git", "--staged", "--redact", "--no-banner"],
        ["gitleaks", "protect", "--staged", "--redact", "--no-banner"],
    ):
        try:
            result = run(args)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None
        output = (result.stdout + result.stderr).lower()
        if "unknown command" in output or "unknown flag" in output:
            continue  # older/newer gitleaks CLI: try the other spelling
        if result.returncode == 0:
            return []
        if "leaks found" in output or "leak found" in output:
            return ["gitleaks reported leaks in staged changes (run `gitleaks git --staged --redact` for details)"]
        return None
    return None


def main():
    with fail_closed(HOOK):
        event = read_event()
        if event.get("tool_name") != "Bash":
            return
        command = (event.get("tool_input") or {}).get("command") or ""
        flags = None
        for segment in expand_nested_shells(command):
            flags = commit_flags(strip_wrappers(segment.words))
            if flags is not None:
                break
        if flags is None:
            return

        cwd = event.get("cwd") or os.getcwd()
        os.chdir(cwd)
        if run(["git", "rev-parse", "--is-inside-work-tree"]).returncode != 0:
            return  # not a repository: git itself will report the problem

        problems = [f"{name}  (credentials file staged)" for name in staged_secret_files(flags["all"])]
        problems += scan_patterns(flags["all"])
        leaks = gitleaks_findings()
        if leaks:
            problems += leaks
        if problems:
            listing = "\n".join(f"  - {p}" for p in dict.fromkeys(problems))
            block(
                HOOK,
                "possible secrets in the changes about to be committed:\n" + listing,
                "Remove the secret and load it from the environment (.claude/security/secrets.md). "
                "If a real secret was already exposed, tell the user to rotate it. If this is a false positive, "
                "make the value an obvious placeholder or ask the user to approve an allow-list entry. "
                "Do not bypass the hook.",
            )


if __name__ == "__main__":
    main()
