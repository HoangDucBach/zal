# Naming

> **Precedence:** the project's own linter/formatter config and the style of the surrounding code
> win over this file. If you deviate from it, say why in the PR description.

Code is read far more often than it is written. A good name removes the need for a comment
and makes a wrong use look wrong.

## Principles (all languages)

- **Say what it is or does, in domain terms.** `unpaidInvoices`, not `list2` or `filteredData`.
- **Scale length with scope.** `i` is fine in a three-line loop; a module-level name needs to
  stand on its own.
- **Functions are verbs, types are nouns.** `calculateTax()`, `TaxCalculator`. Booleans read as
  questions: `isActive`, `hasAccess`, `canRetry`, `shouldNotify`.
- **Put units and formats in the name** when the type doesn't carry them: `timeoutMs`,
  `priceCents`, `createdAtUtc`.
- **One word per concept, everywhere.** Pick one of `fetch`/`get`/`load`/`retrieve` and use it
  across the codebase.
- **No noise words or type tags.** Avoid `data`, `info`, `manager`, `util`, `helper`, and
  avoid type tags like `strName` or the `I` prefix (except in C#, below).
- **No negative booleans.** `isEnabled`, not `isNotDisabled`; double negatives cause bugs.
- **Name collections as plurals**, and maps after what they map: `usersById`, `priceBySku`.
- **Avoid abbreviations** unless they are better known than the long form (`id`, `url`, `http`).
  Case acronyms the way your language's row below says.

```js
// ❌
const d = getData(u, true);
// ✅
const overdueInvoices = fetchInvoices(customer, { overdueOnly: true });
```

## Conventions per language

These come from Google's style guides. Rust has no Google guide, so it follows the Rust API
Guidelines. To support another language, add a row here and a file in `.claude/rules/languages/`.

| Language | Types | Functions / methods | Variables | Constants | Files | Packages / modules |
|---|---|---|---|---|---|---|
| TypeScript / JavaScript | `UpperCamelCase` (no `I` prefix) | `lowerCamelCase` | `lowerCamelCase` | `CONSTANT_CASE` | `lowercase` with `_` or `-` (follow the project) | — |
| Python | `CapWords` | `lower_with_under` | `lower_with_under` | `CAPS_WITH_UNDER` | `lower_with_under.py` | `lower_with_under` (no dashes) |
| Rust | `UpperCamelCase` (types, traits, enum variants) | `snake_case`; no `get_` prefix | `snake_case` | `SCREAMING_SNAKE_CASE` | `snake_case.rs` | `snake_case` crates and modules |
| SQL | tables `snake_case` | — | columns `snake_case` | — | the migration tool's convention | — |
| JSON (APIs) | — | — | property names `camelCase` | enum values as strings | — | — |

Acronyms are cased as words in all three languages: `HttpClient`, `userId`, `parse_url`, `Uuid`.

## Verify

Use the linter's naming rules: ESLint `@typescript-eslint/naming-convention`, Ruff `N`
(pep8-naming), and the Rust compiler's built-in naming lints plus Clippy.

## Sources

- Google TypeScript / Python style guides — https://google.github.io/styleguide/
- Rust API Guidelines, naming — https://rust-lang.github.io/api-guidelines/naming.html
- SQL Style Guide (Simon Holywell) — https://www.sqlstyle.guide/
