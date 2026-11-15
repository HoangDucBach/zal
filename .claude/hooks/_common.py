"""Helpers shared by the hook scripts (not a hook itself).

Hook contract (Claude Code): the event arrives as JSON on stdin. Exit code 2 blocks a
PreToolUse call and sends stderr to Claude as the reason. Any other non-zero exit is a
non-blocking error, which means a crashing guard would silently stop guarding. Blocking hooks
therefore wrap their work in `fail_closed` so an unexpected error blocks instead of allowing.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys
from contextlib import contextmanager
from typing import Iterator, List, NamedTuple, NoReturn

SEPARATOR_CHARS = set(";&|\n()")
MAX_SHELL_DEPTH = 3


def read_event() -> dict:
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        return {}
    return event if isinstance(event, dict) else {}


def block(hook: str, reason: str, hint: str = "") -> NoReturn:
    message = f"[{hook}] Blocked: {reason}"
    if hint:
        message += f"\n{hint}"
    print(message, file=sys.stderr)
    sys.exit(2)


@contextmanager
def fail_closed(hook: str) -> Iterator[None]:
    """Turn an unexpected error into a block, so a bug in a guard cannot disable the guard."""
    try:
        yield
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - deliberate: any failure must block
        block(
            hook,
            f"internal error ({type(error).__name__}: {error})",
            "The check could not run, so the action was stopped to stay safe. Fix or report "
            f"the hook at .claude/hooks/{hook}.py.",
        )


# --- Secret-looking paths ----------------------------------------------------------------------

_ENV_EXAMPLE_SUFFIXES = (".example", ".sample", ".template", ".dist", ".defaults", ".schema")
_KEY_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx")
_PRIVATE_KEY_NAMES = ("id_rsa", "id_dsa", "id_ecdsa", "id_ed25519")
_CREDENTIAL_FILES = (".netrc", ".pypirc", ".git-credentials")
_SECRET_DIRS = (".ssh", ".aws", ".gnupg", ".kube", "secrets", "secret")


def is_secret_path(path: str) -> bool:
    """True for files that normally hold credentials. Example/template env files are fine."""
    normalized = path.replace("\\", "/")
    parts = [p for p in normalized.split("/") if p]
    if not parts:
        return False
    name = parts[-1].lower()
    if name == ".env" or (name.startswith(".env.") and not name.endswith(_ENV_EXAMPLE_SUFFIXES)):
        return True
    if name.endswith(_KEY_SUFFIXES) or name in _CREDENTIAL_FILES:
        return True
    if name in _PRIVATE_KEY_NAMES or any(name.startswith(n + ".") and not name.endswith(".pub") for n in _PRIVATE_KEY_NAMES):
        return True
    return any(part.lower() in _SECRET_DIRS for part in parts[:-1])


# --- Shell command parsing ---------------------------------------------------------------------

class Segment(NamedTuple):
    words: List[str]
    sep_before: str  # the operator that preceded this segment ("" for the first)


_HEREDOC_RE = re.compile(
    r"(<<-?[ \t]*(['\"]?)(\w+)\2[^\n]*\n)(.*?)(^[ \t]*\3[ \t]*$)", re.DOTALL | re.MULTILINE
)


def strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc bodies: they are data (file or message text), not commands to analyze."""
    return _HEREDOC_RE.sub(lambda m: m.group(1) + m.group(5), command)


def split_segments(command: str) -> List[Segment]:
    """Split a shell command line into simple commands, honouring quotes.

    Quoted text stays inside one word, so a commit message that mentions `rm -rf` is not
    mistaken for a command. Comments are NOT stripped: shlex would swallow the newline that
    follows a comment and merge two commands into one.
    """
    command = strip_heredoc_bodies(command)
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|<>()\n")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        # Unbalanced quotes: fall back to a crude split that over-matches rather than misses.
        tokens = []
        for chunk in re.split(r"([;&|\n]+)", command):
            if chunk and set(chunk) <= set(";&|\n"):
                tokens.append(chunk)
            else:
                tokens.extend(chunk.split())

    segments: List[Segment] = []
    current: List[str] = []
    sep = ""
    for token in tokens:
        if token and set(token) <= SEPARATOR_CHARS:
            if current:
                segments.append(Segment(current, sep))
            current, sep = [], token
        else:
            current.append(token)
    if current:
        segments.append(Segment(current, sep))
    return segments


_WRAPPERS = {"sudo", "command", "nohup", "time", "nice", "exec", "builtin", "env", "doas"}
_ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}


def strip_wrappers(words: List[str]) -> List[str]:
    """Drop `sudo`, `env VAR=x`, `nohup` ... so the real command is words[0]."""
    words = list(words)
    while words:
        first = os.path.basename(words[0])
        if _ENV_ASSIGN_RE.match(words[0]):
            words.pop(0)
        elif first in _WRAPPERS:
            words.pop(0)
            while words and (words[0].startswith("-") or _ENV_ASSIGN_RE.match(words[0])):
                words.pop(0)
        else:
            break
    return words


def expand_nested_shells(command: str, depth: int = 0) -> List[Segment]:
    """Segments of the command plus those of any `bash -c '...'` / `eval '...'` it contains."""
    result: List[Segment] = []
    for segment in split_segments(command):
        result.append(segment)
        words = strip_wrappers(segment.words)
        if not words or depth >= MAX_SHELL_DEPTH:
            continue
        name = os.path.basename(words[0])
        if name in _SHELLS:
            for index, word in enumerate(words[1:], start=1):
                is_c_flag = word.startswith("-") and not word.startswith("--") and "c" in word[1:]
                if is_c_flag and index + 1 < len(words):
                    result.extend(expand_nested_shells(words[index + 1], depth + 1))
                    break
        elif name == "eval" and len(words) > 1:
            result.extend(expand_nested_shells(" ".join(words[1:]), depth + 1))
    return result


def git_subcommand(words: List[str]):
    """For `git [-C dir] [-c k=v] <sub> args`, return (subcommand, args, global_config_values)."""
    config_values: List[str] = []
    index = 1
    while index < len(words):
        word = words[index]
        if word in ("-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"):
            index += 2
        elif word == "-c" and index + 1 < len(words):
            config_values.append(words[index + 1])
            index += 2
        elif word.startswith("-"):
            index += 1
        else:
            return word, words[index + 1:], config_values
    return None, [], config_values
