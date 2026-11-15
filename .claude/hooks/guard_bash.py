#!/usr/bin/env python3
"""PreToolUse hook (Bash): block destructive or safety-bypassing shell commands.

The deny rules in settings.json catch the obvious spellings. This hook parses the command
properly, so it also catches variants a pattern can't: `rm -r -f`, `git -C dir push -f`,
`bash -c "rm -rf ..."`, `curl ... | sudo bash`, `cat .env`, and `--no-verify` hidden behind
other flags. Quoted text is not treated as a command, so a commit message may mention `rm -rf`.
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    block, expand_nested_shells, fail_closed, git_subcommand, is_secret_path, read_event,
    strip_wrappers,
)

HOOK = "guard_bash"
DANGEROUS_RM_TARGETS = {"/", "/*", "~", "~/", "$HOME", "$HOME/", "${HOME}", ".", "./", "..", "../", "*", ".*"}
DOWNLOADERS = {"curl", "wget", "fetch"}
INTERPRETERS = {"sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python2", "python3", "node", "perl", "ruby", "php"}
SECRET_READERS = {
    "cat", "less", "more", "head", "tail", "bat", "nl", "tac", "grep", "egrep", "fgrep", "rg", "ag",
    "sed", "awk", "cut", "sort", "uniq", "strings", "xxd", "hexdump", "od", "base64", "cp", "mv",
    "scp", "rsync", "tar", "zip", "source", ".", "open", "curl", "wget", "vim", "vi", "nano", "code",
}
COMMIT_VALUE_FLAGS = {"-m", "-F", "-C", "-c", "--message", "--file", "--author", "--date", "--template", "--reuse-message"}


def short_flags(args):
    """Letters of all short-option clusters (`-rf` -> r, f), skipping `--long` options."""
    return "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--") and len(a) > 1)


def check_rm(words):
    args = words[1:]
    letters = short_flags(args)
    recursive = "r" in letters or "R" in letters or "--recursive" in args
    force = "f" in letters or "--force" in args
    targets = [a for a in args if not a.startswith("-")]
    if recursive and force:
        return "recursive forced delete (rm -rf)"
    if recursive and any(t in DANGEROUS_RM_TARGETS for t in targets):
        return "recursive delete of a root, home, parent or wildcard target"
    return None


def check_git(words):
    sub, args, config_values = git_subcommand(words)
    if any(v.lower().startswith("core.hookspath") for v in config_values):
        return "overriding core.hooksPath bypasses the repository hooks"
    if sub == "push":
        letters = short_flags(args)
        if (
            "f" in letters
            or any(a.startswith("--force") for a in args)
            or any(a.startswith("+") and len(a) > 1 for a in args)
        ):
            return "force push rewrites shared history"
        if "--no-verify" in args:
            return "--no-verify skips the pre-push hooks"
        if "--delete" in args or "-d" in args or any(a.startswith(":") and len(a) > 1 for a in args):
            return "deleting remote branches or tags"
    elif sub == "commit":
        if "--no-verify" in args:
            return "--no-verify skips the commit hooks (secret scan, lint)"
        index = 0
        while index < len(args):
            arg = args[index]
            if arg in COMMIT_VALUE_FLAGS:
                index += 2
                continue
            if arg.startswith("-") and not arg.startswith("--") and len(arg) > 1:
                if "n" in arg[1:]:
                    return "-n (--no-verify) skips the commit hooks (secret scan, lint)"
                if arg[-1] in "mFCc":
                    index += 2
                    continue
            index += 1
    elif sub == "reset" and "--hard" in args:
        return "git reset --hard discards uncommitted work"
    elif sub == "clean":
        letters = short_flags(args)
        if ("f" in letters or "--force" in args) and "n" not in letters and "--dry-run" not in args:
            return "git clean -f deletes untracked files permanently"
    return None


def check_chmod(words):
    if any(a in ("777", "0777", "a+rwx", "ugo+rwx") for a in words[1:]):
        return "world-writable permissions (chmod 777)"
    return None


def check_secret_read(words):
    name = os.path.basename(words[0])
    if name not in SECRET_READERS:
        return None
    for arg in words[1:]:
        candidate = arg.split("=", 1)[-1].lstrip("@<")
        if candidate and not candidate.startswith("-") and is_secret_path(candidate):
            return f"{name} would read or copy a credentials file ({os.path.basename(candidate)})"
    return None


def analyze(command):
    segments = expand_nested_shells(command)
    pipeline_has_download = False
    for segment in segments:
        words = strip_wrappers(segment.words)
        if not words:
            continue
        name = os.path.basename(words[0])

        continues_pipeline = segment.sep_before.startswith("|") and segment.sep_before != "||"
        if not continues_pipeline:
            pipeline_has_download = False
        if continues_pipeline and pipeline_has_download and name in INTERPRETERS:
            return "piping a download straight into an interpreter (curl | sh)"
        if name in DOWNLOADERS:
            pipeline_has_download = True

        checks = {"rm": check_rm, "git": check_git, "chmod": check_chmod}
        reason = checks[name](words) if name in checks else None
        reason = reason or check_secret_read(words)
        if reason:
            return reason

    # Constructs the segment parser does not model.
    if re.search(r"\b(?:sh|bash|zsh|source|\.)\s+<\(\s*(?:curl|wget)\b", command):
        return "executing a downloaded script via process substitution"
    if re.search(r"\b(?:sh|bash|zsh)\s+-c\s+[\"']?\$\(\s*(?:curl|wget)\b", command):
        return "executing the output of a download"
    return None


HINTS = {
    "rm": "Delete specific files by name, or ask the user to run this one themselves.",
    "git": "Ask the user to run this themselves if it is really intended. Don't bypass hooks or rewrite shared history.",
    "download": "Download to a file, read it, verify a checksum, then run it.",
    "secret": "Read the .env.example or the config schema instead. Never open real credentials.",
}


def hint_for(reason):
    if "download" in reason or "curl" in reason:
        return HINTS["download"]
    if "credentials" in reason:
        return HINTS["secret"]
    if "delete" in reason and "git" not in reason:
        return HINTS["rm"]
    return HINTS["git"]


def main():
    with fail_closed(HOOK):
        event = read_event()
        if event.get("tool_name") != "Bash":
            return
        command = (event.get("tool_input") or {}).get("command") or ""
        reason = analyze(command)
        if reason:
            block(HOOK, reason, hint_for(reason))


if __name__ == "__main__":
    main()
