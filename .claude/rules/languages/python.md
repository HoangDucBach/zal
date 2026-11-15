---
paths:
  - "**/*.{py,pyi}"
  - "**/pyproject.toml"
  - "**/requirements*.txt"
  - "**/setup.cfg"
---

# Python

> **Precedence:** the project's `pyproject.toml` (Ruff, Black, mypy, pytest settings) and the
> style of the surrounding code win over this file. Naming: `.claude/rules/core/naming.md`.

Based on the [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html) and PEP 8.

## Tooling

| Task | Default tool | Typical command (prefer the project's Makefile or tasks) |
|---|---|---|
| Format | Ruff formatter (Black-compatible) | `ruff format --check .` |
| Lint | Ruff (replaces flake8, isort, pyupgrade; Google uses pylint) | `ruff check .` |
| Type check | mypy or pyright | `mypy .` / `pyright` |
| Test | pytest | `pytest -q` (with `--cov` for coverage) |
| Audit | pip-audit, osv-scanner | `pip-audit` |
| Env / deps | uv or Poetry; a virtualenv always | `uv sync --locked` |

## Formatting and imports

- 4-space indent. Line length is set by the formatter (Google uses 80; Black/Ruff default to 88).
- Import groups, each sorted: `__future__`, standard library, third-party, local
  (Ruff `I` rules enforce this).
- Import modules and packages, not individual names: `from sound.effects import echo`, then
  `echo.apply()`. Exceptions: `typing`, `collections.abc`, `typing_extensions`.
- No wildcard imports. Use absolute imports, not relative ones.

## Types

- Annotate all public functions and methods. Run a type checker in CI.
- Use modern syntax (3.10+): `list[int]`, `dict[str, User]`, `X | None`. Take `collections.abc`
  types for parameters (`Sequence`, `Mapping`) and return concrete types.
- Use `dataclasses` (frozen where possible), `NamedTuple`, `TypedDict` or Pydantic models for
  structured data, instead of bare dicts.
- Use `Protocol` for structural interfaces at boundaries (repositories, clients).

## Language rules

- **No mutable default arguments.** `def f(items=None): items = items or []`.
- Compare to `None` with `is` / `is not`. Use implicit truthiness for sequences
  (`if not users:`), but not when `0` or `""` are valid values.
- Catch specific exceptions. No bare `except:`, and no `except Exception: pass`. Use
  `raise … from err` to keep the cause.
- Use context managers (`with`) for files, locks, connections and transactions.
- Keep comprehensions to simple ones: one `for`, one optional `if`. Otherwise write a loop.
- Use lambdas for one-liners only. Use generators for large or lazy sequences.
- No mutable module-level state. Constants are `CAPS_WITH_UNDER` and final.
- Use f-strings for formatting. For logging, pass arguments lazily:
  `logger.info("user %s", user_id)`.
- Executables: put logic in `main()` behind `if __name__ == "__main__":`.
- Avoid power features (metaclasses, `__getattr__` magic, monkey-patching) outside of tests.

## Idioms

```python
# ❌
def get_active(users=[]):
    result = []
    for i in range(len(users)):
        if users[i].active == True:
            result.append(users[i])
    return result

# ✅
def active_users(users: Iterable[User]) -> list[User]:
    return [user for user in users if user.active]
```

Use `pathlib` over `os.path`, `enumerate` and `zip` over index loops, and timezone-aware
`datetime` values (`datetime.now(tz=UTC)`).

## Pitfalls

Mutable defaults; late-binding closures in loops; naive datetimes; `float` for money (use
`Decimal`); blocking calls inside `async` code; `pickle` or `yaml.load` on untrusted data (use
`yaml.safe_load`); `subprocess` with `shell=True`; circular imports.

## Docs

Google-style docstrings: a one-line summary, a blank line, then `Args:`, `Returns:` (or
`Yields:`) and `Raises:` sections. Every public module, class and function gets one.

## Sources

- Google Python Style Guide — https://google.github.io/styleguide/pyguide.html
- PEP 8 — https://peps.python.org/pep-0008/
- Ruff — https://docs.astral.sh/ruff/
- typing best practices — https://typing.python.org/en/latest/reference/best_practices.html
