#!/usr/bin/env python3
"""PostToolUse hook (Edit, Write, MultiEdit): format the edited file with the project's formatter.

Formats only when the project already configures a formatter, so it never imposes a style on a
project that has none. Formats just the edited file, and never runs lint autofixes: those can
change behavior and belong in a reviewed step. Failures are ignored on purpose; formatting is a
convenience and must never get in the way of the edit.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import read_event  # noqa: E402

PRETTIER_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss"}
PRETTIER_CONFIGS = (
    ".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.js",
    ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.toml", "prettier.config.js",
    "prettier.config.cjs", "prettier.config.mjs", "prettier.config.ts",
)


def find_up(start: Path, names, stop: Path):
    for directory in [start, *start.parents]:
        for name in names:
            candidate = directory / name
            if candidate.exists():
                return candidate
        if directory == stop or directory == directory.parent:
            break
    return None


def run(args, cwd):
    subprocess.run(args, cwd=cwd, capture_output=True, timeout=30, check=False)


def format_python(path: Path, root: Path):
    ruff = shutil.which("ruff")
    config = find_up(path.parent, ("ruff.toml", ".ruff.toml", "pyproject.toml"), root)
    if not ruff or not config:
        return
    if config.name == "pyproject.toml" and "[tool.ruff" not in config.read_text(errors="replace"):
        return
    run([ruff, "format", str(path)], root)


def format_with_prettier(path: Path, root: Path):
    prettier = find_up(path.parent, ("node_modules/.bin/prettier",), root)
    if not prettier:
        return
    has_config = find_up(path.parent, PRETTIER_CONFIGS, root)
    if not has_config:
        package = find_up(path.parent, ("package.json",), root)
        try:
            has_config = package and "prettier" in json.loads(package.read_text()).keys()
        except ValueError:
            has_config = False
    if has_config:
        run([str(prettier), "--write", "--log-level", "silent", str(path)], root)


def format_rust(path: Path, root: Path):
    rustfmt = shutil.which("rustfmt")
    cargo = find_up(path.parent, ("Cargo.toml",), root)
    if not rustfmt or not cargo:
        return
    match = re.search(r'edition\s*=\s*"(\d{4})"', cargo.read_text(errors="replace"))
    args = [rustfmt] + (["--edition", match.group(1)] if match else []) + [str(path)]
    run(args, root)


def main():
    try:
        event = read_event()
        raw = (event.get("tool_input") or {}).get("file_path")
        if not raw:
            return
        root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd()).resolve()
        path = (Path(event.get("cwd") or root) / raw).resolve()
        if not path.is_file() or root not in path.parents:
            return  # outside the project, or gone
        suffix = path.suffix.lower()
        if suffix == ".py":
            format_python(path, root)
        elif suffix in PRETTIER_EXTENSIONS:
            format_with_prettier(path, root)
        elif suffix == ".rs":
            format_rust(path, root)
    except Exception:  # noqa: BLE001 - never interfere with the edit
        return


if __name__ == "__main__":
    main()
