#!/usr/bin/env python3
"""Keep packages/web on the HeroUI CLI.

Project-owned hook (not part of the shared workflow, so install.sh leaves it alone).

- `record` (PostToolUse: Bash, HeroUI MCP): remembers each component the session looked up
  with `heroui doc <name>`, `heroui info <name>`, or the HeroUI MCP docs tools.
- `check` (PreToolUse: Edit, Write, MultiEdit, Bash):
  - blocks a web source edit that imports a component from `@heroui/react` that this session
    never looked up, because HeroUI v3 differs from what models remember;
  - blocks adding or upgrading `@heroui/*` with a package manager instead of
    `heroui install` / `heroui upgrade`;
  - keeps HeroUI and xyflow on their default look: no inline styles, no arbitrary Tailwind
    values, no decorative utilities (raw-colour gradients, blur, glow, big shadows, animations;
    token-coloured linear/radial gradients and backdrop-blur-sm..2xl are allowed), no CSS
    file other than the theme in styles/globals.css, and no `.react-flow` overrides.
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import block, fail_closed, read_event  # noqa: E402

HOOK = "heroui_cli_guard"
WEB_DIR = "packages/web/"
SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs")

LOOKUP_CMD = re.compile(r"\bheroui(?:-cli(?:@[\w.-]+)?)?\s+(?:doc|info)\s+([A-Za-z0-9-]+)")
PM_INSTALL = re.compile(r"(?:^|[;&|\n(])\s*(?:\w+=\S*\s+)*(?:pnpm|npm|yarn|bun)\b[^;&|\n]*\b(?:add|install|i|up|update|upgrade)\b[^;&|\n]*@heroui/")
THEME_CSS = WEB_DIR + "styles/globals.css"
CLASS_LITERAL = re.compile(r"className=\{?\s*[\"'`]([^\"'`]*)[\"'`]")
# Subtle gradients are allowed (ADR 0006, amended): linear or radial, with colour stops taken only from the
# HeroUI theme tokens, so a theme change still recolours them. Raw palette colours and arbitrary values are not.
THEME_TOKEN = r"(?:accent|background|foreground|surface(?:-secondary|-tertiary)?|default|muted|success|warning|danger|border|separator|overlay|transparent)"
DECORATIVE = re.compile(
    r"(?:^|\s)(?:[\w-]+:)*(?:bg-conic\S*"
    r"|(?:from|via|to)-(?!" + THEME_TOKEN + r"(?:/\d{1,3})?(?=\s|$))(?!\d{1,3}%(?=\s|$))\S+"
    r"|blur\S*|backdrop-(?!blur-(?:sm|md|lg|xl|2xl)(?=\s|$))\S+|drop-shadow\S*|shadow-(?:lg|xl|2xl|inner)\S*|animate-\S+"
    r"|[\w-]+-\[[^\]]*\])"
)
# Two icon sets only: Solar (primary) and gravity-ui (HeroUI's own docs use it). Any other icon package is a third look.
BANNED_ICON_IMPORT = re.compile(r"from\s*[\"'](?:lucide-react|react-icons[^\"']*|@heroicons/[^\"']*|@tabler/icons-react|@phosphor-icons/react|@radix-ui/react-icons|react-feather|@iconify/react)[\"']")
HEROUI_IMPORT = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*[\"']@heroui/react[\"']", re.S)


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def state_file(event: dict) -> str:
    root = os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd()
    session = re.sub(r"[^A-Za-z0-9_-]", "", str(event.get("session_id") or "default"))
    return os.path.join(root, ".claude", ".state", f"heroui-{session}.txt")


def looked_up(event: dict) -> set[str]:
    try:
        with open(state_file(event)) as f:
            return {line.strip() for line in f if line.strip()}
    except FileNotFoundError:
        return set()


def remember(event: dict, names: list[str]) -> None:
    if not names:
        return
    path = state_file(event)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        f.writelines(normalize(n) + "\n" for n in names)


def strings_in(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings_in(v)]
    if isinstance(value, list):
        return [s for v in value for s in strings_in(v)]
    return []


def record(event: dict) -> None:
    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    if tool == "Bash":
        remember(event, LOOKUP_CMD.findall(tool_input.get("command", "")))
    elif tool.startswith("mcp__heroui"):
        remember(event, [s for s in strings_in(tool_input) if re.fullmatch(r"[A-Za-z][A-Za-z0-9 -]{1,40}", s)])


def imported_components(source: str) -> list[str]:
    names = []
    for group in HEROUI_IMPORT.findall(source):
        for part in group.split(","):
            part = re.sub(r"^\s*type\s+", "", part).split(" as ")[0].strip()
            if part and part[0].isupper():
                names.append(part)
    return names


def new_text(tool: str, tool_input: dict) -> str:
    if tool == "Write":
        return tool_input.get("content", "")
    if tool == "Edit":
        return tool_input.get("new_string", "")
    if tool == "MultiEdit":
        return "\n".join(e.get("new_string", "") for e in tool_input.get("edits", []))
    return ""


def web_path(event: dict, path: str) -> str:
    """Repo-relative path when `path` is inside packages/web, else ""."""
    root = os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd()
    absolute = os.path.normpath(os.path.join(event.get("cwd") or root, path))
    rel = os.path.relpath(absolute, root).replace(os.sep, "/")
    if not rel.startswith(WEB_DIR) or "/.heroui-docs/" in rel or "/node_modules/" in rel:
        return ""
    return rel


def check_style(rel: str, text: str) -> None:
    hint = ("Use HeroUI component props and variants, and the xyflow defaults. "
            "Theme colours come from the tokens in styles/globals.css (HeroUI theme builder).")
    if rel.endswith(".css"):
        if rel != THEME_CSS:
            block(HOOK, f"{rel} adds custom CSS; the only stylesheet is the HeroUI theme.", hint)
        if ".react-flow" in text:
            block(HOOK, "this edit restyles xyflow; keep its default stylesheet.", hint)
        return
    if BANNED_ICON_IMPORT.search(text):
        block(HOOK, "this edit imports a third icon set; Zal uses @solar-icons/react, with @gravity-ui/icons as the second set.", hint)
    if re.search(r"\bstyle=\{\{", text):
        block(HOOK, "inline `style={{...}}` in web source.", hint)
    for classes in CLASS_LITERAL.findall(text):
        hit = DECORATIVE.search(classes)
        if hit:
            block(HOOK, f"decorative or arbitrary Tailwind class `{hit.group(0).strip()}`.", hint)


def check(event: dict) -> None:
    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    if tool == "Bash":
        if PM_INSTALL.search(tool_input.get("command", "")):
            block(HOOK, "HeroUI packages are installed and upgraded through the HeroUI CLI.",
                  "Run `pnpm --filter @zal/web exec heroui install` or `... heroui upgrade` instead.")
        return
    rel = web_path(event, tool_input.get("file_path", ""))
    if not rel:
        return
    text = new_text(tool, tool_input)
    check_style(rel, text)
    if not rel.endswith(SOURCE_EXTS):
        return
    seen = looked_up(event)
    missing = [
        name for name in imported_components(text)
        if not any(normalize(name).startswith(s) for s in seen)
    ]
    if missing:
        commands = "; ".join(f"heroui doc {re.sub(r'(?<!^)(?=[A-Z])', '-', n).lower()}" for n in missing)
        block(HOOK, f"this edit imports {', '.join(missing)} from @heroui/react, "
                    "but the session has not read their docs through the HeroUI CLI.",
              f"Run `pnpm --filter @zal/web exec {commands}` (or the HeroUI MCP get_component_docs tool), "
              "then retry with the API the docs show.")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "record":
        try:
            record(read_event())
        except Exception:  # noqa: BLE001 - recording is best effort; check() fails closed
            pass
        return
    with fail_closed(HOOK):
        check(read_event())


if __name__ == "__main__":
    main()
