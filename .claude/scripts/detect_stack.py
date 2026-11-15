#!/usr/bin/env python3
"""Detect a project's languages, package manager, and lint/format/test/type-check tooling.

Used by the SessionStart hook and by skills, so that Claude loads only the relevant
`rules/languages/*.md` and runs the project's own commands instead of guessing.

Usage: detect_stack.py [project_dir] [--json]
Exit code is always 0; an empty result means nothing recognizable was found.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Languages that have a rule file in .claude/rules/languages/.
RULE_FILES = {
    "typescript": "typescript.md",
    "javascript": "typescript.md",
    "python": "python.md",
    "rust": "rust.md",
}

# Manifests that signal other languages. They are reported, but have no rule file.
OTHER_MANIFESTS = {
    "go.mod": "go",
    "pom.xml": "java",
    "build.gradle": "java/kotlin",
    "build.gradle.kts": "java/kotlin",
    "Gemfile": "ruby",
    "composer.json": "php",
    "Package.swift": "swift",
    "pubspec.yaml": "dart",
}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def has_any(root: Path, names: list[str]) -> bool:
    return any((root / name).exists() for name in names)


def detect_node(root: Path, result: dict) -> None:
    pkg_path = root / "package.json"
    if not pkg_path.exists():
        return
    try:
        pkg = json.loads(read_text(pkg_path))
    except ValueError:
        pkg = {}
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    is_ts = (root / "tsconfig.json").exists() or "typescript" in deps
    language = "typescript" if is_ts else "javascript"
    result["languages"].append(language)
    commands = result["commands"].setdefault(language, {})

    if (root / "pnpm-lock.yaml").exists():
        manager = "pnpm"
    elif (root / "yarn.lock").exists():
        manager = "yarn"
    elif (root / "bun.lockb").exists() or (root / "bun.lock").exists():
        manager = "bun"
    else:
        manager = "npm"
    result["package_managers"].append(manager)

    scripts = pkg.get("scripts", {})
    run = "npm run" if manager == "npm" else manager
    for key in ("test", "lint", "format", "typecheck", "build"):
        if key in scripts:
            commands[key] = f"{manager} test" if key == "test" else f"{run} {key}"
    if "vitest" in deps:
        result["test_runners"].append("vitest")
    if "jest" in deps:
        result["test_runners"].append("jest")
    if "@playwright/test" in deps:
        result["test_runners"].append("playwright")
    if "eslint" in deps or has_any(root, ["eslint.config.js", "eslint.config.mjs", ".eslintrc.json", ".eslintrc.js"]):
        result["linters"].append("eslint")
    if "prettier" in deps or has_any(root, [".prettierrc", ".prettierrc.json", "prettier.config.js"]):
        result["formatters"].append("prettier")
    if is_ts:
        result["type_checkers"].append("tsc")
        commands.setdefault("typecheck", "npx tsc --noEmit")


def detect_python(root: Path, result: dict) -> None:
    pyproject = root / "pyproject.toml"
    if not (pyproject.exists() or has_any(root, ["requirements.txt", "setup.py", "setup.cfg", "Pipfile"])):
        return
    result["languages"].append("python")
    commands = result["commands"].setdefault("python", {})
    text = read_text(pyproject)

    if (root / "uv.lock").exists():
        manager, prefix = "uv", "uv run "
    elif (root / "poetry.lock").exists() or "[tool.poetry]" in text:
        manager, prefix = "poetry", "poetry run "
    elif (root / "Pipfile").exists():
        manager, prefix = "pipenv", "pipenv run "
    else:
        manager, prefix = "pip", ""
    result["package_managers"].append(manager)

    if "[tool.ruff" in text or has_any(root, ["ruff.toml", ".ruff.toml"]):
        result["linters"].append("ruff")
        result["formatters"].append("ruff")
        commands.setdefault("lint", f"{prefix}ruff check .")
        commands.setdefault("format", f"{prefix}ruff format --check .")
    if "[tool.black" in text:
        result["formatters"].append("black")
    if "[tool.mypy" in text or (root / "mypy.ini").exists():
        result["type_checkers"].append("mypy")
        commands.setdefault("typecheck", f"{prefix}mypy .")
    if "pyright" in text or (root / "pyrightconfig.json").exists():
        result["type_checkers"].append("pyright")
    uses_pytest = (
        "pytest" in text
        or "pytest" in read_text(root / "requirements.txt")
        or has_any(root, ["pytest.ini", "conftest.py", "tox.ini"])
    )
    if uses_pytest:
        result["test_runners"].append("pytest")
        commands.setdefault("test", f"{prefix}pytest -q")
    elif (root / "tests").is_dir() or any(root.glob("test_*.py")):
        result["test_runners"].append("unittest")
        target = " discover -s tests" if (root / "tests").is_dir() else ""
        commands.setdefault("test", f"{prefix}python3 -m unittest{target}")


def detect_rust(root: Path, result: dict) -> None:
    if not (root / "Cargo.toml").exists():
        return
    result["languages"].append("rust")
    result["package_managers"].append("cargo")
    result["formatters"].append("rustfmt")
    result["linters"].append("clippy")
    result["test_runners"].append("cargo test")
    result["commands"]["rust"] = (
        {
            "test": "cargo test",
            "lint": "cargo clippy --all-targets -- -D warnings",
            "format": "cargo fmt --all -- --check",
            "build": "cargo build",
        }
    )


def detect_make(root: Path, result: dict) -> None:
    """Makefile targets are the project's own entry points, so surface them as such."""
    makefile = root / "Makefile"
    if not makefile.exists():
        return
    targets = set(re.findall(r"^([A-Za-z0-9_-]+):", read_text(makefile), re.MULTILINE))
    found = {t: f"make {t}" for t in ("test", "lint", "format", "typecheck", "check", "build") if t in targets}
    if found:
        result["commands"]["make"] = found


def detect(root: Path) -> dict:
    result: dict = {
        "root": str(root),
        "languages": [],
        "package_managers": [],
        "formatters": [],
        "linters": [],
        "type_checkers": [],
        "test_runners": [],
        "commands": {},
        "other_languages": [],
        "rule_files": [],
        "infra": [],
    }
    detect_node(root, result)
    detect_python(root, result)
    detect_rust(root, result)
    detect_make(root, result)

    for manifest, language in OTHER_MANIFESTS.items():
        if (root / manifest).exists():
            result["other_languages"].append(language)

    if has_any(root, ["Dockerfile", "docker-compose.yml", "compose.yaml"]):
        result["infra"].append("docker")
    if any(root.glob("*.tf")) or (root / "terraform").is_dir():
        result["infra"].append("terraform")
    if (root / ".github" / "workflows").is_dir():
        result["infra"].append("github-actions")
    if (root / ".gitlab-ci.yml").exists():
        result["infra"].append("gitlab-ci")
    if has_any(root, ["k8s", "kubernetes", "helm", "charts"]):
        result["infra"].append("kubernetes")

    result["rule_files"] = sorted(
        {f".claude/rules/languages/{RULE_FILES[lang]}" for lang in result["languages"] if lang in RULE_FILES}
    )
    for key in ("languages", "package_managers", "formatters", "linters", "type_checkers", "test_runners"):
        result[key] = list(dict.fromkeys(result[key]))
    return result


def format_text(result: dict) -> str:
    if not (result["languages"] or result["other_languages"] or result["infra"]):
        return "No recognizable project manifests found."
    lines = ["Detected project stack:"]
    for label, key in (
        ("Languages", "languages"),
        ("Package manager", "package_managers"),
        ("Formatter", "formatters"),
        ("Linter", "linters"),
        ("Type checker", "type_checkers"),
        ("Test runner", "test_runners"),
        ("Infra", "infra"),
    ):
        if result[key]:
            lines.append(f"- {label}: {', '.join(result[key])}")
    for language, commands in result["commands"].items():
        if commands:
            lines.append(f"- Commands ({language}): " + "; ".join(f"{k}: `{v}`" for k, v in commands.items()))
    if result["other_languages"]:
        lines.append(
            f"- Also present, with no rule file in this workflow: {', '.join(result['other_languages'])}."
            " Follow the project's own config and the surrounding code."
        )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    root = Path(args[0]).resolve() if args else Path.cwd()
    result = detect(root)
    print(json.dumps(result, indent=2) if "--json" in argv else format_text(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
