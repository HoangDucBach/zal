#!/usr/bin/env python3
"""SessionStart hook: tell Claude which stack this project uses.

Plain stdout from a SessionStart hook is added to Claude's context. Knowing the language and
the project's own lint/test commands up front stops guessing, and it points to the matching
language rule file, so only the relevant rules get read.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def main():
    try:
        import detect_stack

        event_cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        result = detect_stack.detect(Path(event_cwd).resolve())
        text = detect_stack.format_text(result)
        lines = [text]
        if result["rule_files"]:
            lines.append("- Matching rule files: " + ", ".join(result["rule_files"]))
        lines.append("The project's own tooling and code style take precedence over the workflow defaults.")
        print("\n".join(lines))
    except Exception:  # noqa: BLE001 - a missing banner must never block a session
        return


if __name__ == "__main__":
    main()
