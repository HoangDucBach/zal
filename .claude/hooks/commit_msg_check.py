#!/usr/bin/env python3
"""PreToolUse hook (Bash): require Conventional Commit messages on `git commit`.

Reads the message from -m / --message (several are joined as paragraphs), -F/--file, or a
`$(cat <<'EOF' ...)` heredoc, and validates it with .claude/scripts/check_commit_msg.py, so
the rules live in one place. When the message can't be determined (editor, amend without -m)
the commit is allowed.

Projects that don't use Conventional Commits can turn this off with the environment variable
WORKFLOW_COMMIT_LINT=off (set it in the project's settings.json "env" block).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import block, expand_nested_shells, fail_closed, git_subcommand, read_event, strip_wrappers  # noqa: E402

HOOK = "commit_msg_check"
VALIDATOR = Path(__file__).resolve().parent.parent / "scripts" / "check_commit_msg.py"
HEREDOC_MSG = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n(.*?)\n[ \t]*\1\b", re.DOTALL)


def message_from(args, cwd, raw_command):
    """Return the commit message given on the command line, or None if it can't be known.

    The heredoc form (-m "$(cat <<'EOF' ... EOF)") is read from the raw command, because the
    shell tokenizer deliberately drops heredoc bodies.
    """
    parts = []
    index = 0
    while index < len(args):
        arg = args[index]
        value = None
        if arg in ("-m", "--message") and index + 1 < len(args):
            value, index = args[index + 1], index + 1
        elif arg.startswith("--message="):
            value = arg.split("=", 1)[1]
        elif arg.startswith("-") and not arg.startswith("--") and arg.endswith("m") and index + 1 < len(args):
            value, index = args[index + 1], index + 1  # clustered, e.g. -am "msg"
        elif arg in ("-F", "--file") and index + 1 < len(args):
            path = Path(cwd) / args[index + 1]
            if args[index + 1] == "-" or not path.is_file():
                return None
            return path.read_text(encoding="utf-8", errors="replace")
        if value is not None:
            if "$(" in value or "`" in value:
                heredoc = HEREDOC_MSG.search(raw_command)
                if not heredoc:
                    return None  # dynamic message we can't evaluate
                value = heredoc.group(2)
            parts.append(value)
        index += 1
    return "\n\n".join(parts) if parts else None


def main():
    with fail_closed(HOOK):
        if os.environ.get("WORKFLOW_COMMIT_LINT", "").lower() in ("off", "0", "false"):
            return
        event = read_event()
        if event.get("tool_name") != "Bash":
            return
        command = (event.get("tool_input") or {}).get("command") or ""
        cwd = event.get("cwd") or os.getcwd()
        for segment in expand_nested_shells(command):
            words = strip_wrappers(segment.words)
            if not words or os.path.basename(words[0]) != "git":
                continue
            sub, args, _ = git_subcommand(words)
            if sub != "commit":
                continue
            # `git commit --trailer "Co-authored-by: ..."` never appears in the message text.
            if any("co-authored-by" in a.lower() for a in args if a.lower().startswith("--trailer")) or any(
                prev.lower() == "--trailer" and "co-authored-by" in a.lower() for prev, a in zip(args, args[1:])
            ):
                block(HOOK, "commits must not carry a Co-authored-by trailer", "Remove the --trailer option.")
            message = message_from(args, cwd, command)
            if not message:
                return
            result = subprocess.run(
                [sys.executable, str(VALIDATOR), "-"], input=message, capture_output=True, text=True, timeout=20
            )
            if result.returncode == 1:
                block(HOOK, "commit message is not a Conventional Commit", result.stderr.strip())
            return


if __name__ == "__main__":
    main()
