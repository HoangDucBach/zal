---
paths:
  - "**/*.{ts,tsx,mts,cts}"
  - "**/*.{js,jsx,mjs,cjs}"
  - "**/tsconfig*.json"
  - "**/package.json"
---

# TypeScript (and JavaScript)

> **Precedence:** the project's `tsconfig`, ESLint and Prettier config and the style of the
> surrounding code win over this file. Naming: `.claude/rules/core/naming.md`.

Based on the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
and the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html).
Plain `.js` files (configs, scripts) follow the same rules minus the type annotations. Add
`// @ts-check` and JSDoc types to get type checking in them.

## Tooling

| Task | Default tool | Typical command (prefer the project's `package.json` scripts) |
|---|---|---|
| Format | Prettier | `npx prettier --check .` |
| Lint | ESLint + typescript-eslint (or Google's `gts`) | `npx eslint .` |
| Type check | `tsc` with `strict: true` | `npx tsc --noEmit` |
| Test | Vitest / Jest; Playwright for e2e | `npm test` |
| Audit | `npm audit`, `osv-scanner` | `npm audit --omit=dev` |

## Modules and imports

- ES modules only. No `namespace` and no `require()`.
- **Named exports, not default exports.** Names stay consistent across imports and refactors.
- Import order: side-effect imports, then external packages, then internal aliases, then
  relative paths, sorted within groups (let the linter's import-order rule enforce it).
- Use `import type { X }` for type-only imports.

## Types

- `strict` mode on. Don't use `any`; use `unknown` and narrow it. If `any` is unavoidable,
  comment why.
- Prefer `interface` for object shapes and `type` for unions, intersections and mapped types.
- No `@ts-ignore`. If suppression is really needed, use `@ts-expect-error` with a reason.
- Avoid non-null assertions (`x!`) and unchecked casts (`as Foo`). Narrow with type guards
  instead. Validate external data at runtime (zod, valibot) rather than casting `JSON.parse`.
- Don't use wrapper types (`String`, `Number`, `Object`) or `{}`. Use `T[]` for simple types and
  `Array<T>` for complex ones.
- Prefer union types of string literals over `enum`. If you use enums, never `const enum`.
- Optional fields (`x?: T`) rather than `x: T | undefined`. Return `undefined`, not `null`,
  unless the API is a `null` API.

## Classes and members

- `readonly` for anything not reassigned; `private`/`protected` modifiers. Google prefers
  TypeScript's `private` over `#private` fields; follow the project if it already uses `#`.
- Use parameter properties for constructor-injected dependencies:
  `constructor(private readonly repo: OrderRepo) {}`.
- No `_` prefix or suffix for private members.

## Idioms

```ts
// ❌
function total(items: any) { let t = 0; for (let i = 0; i < items.length; i++) t += items[i].price; return t; }
// ✅
function totalCents(items: readonly LineItem[]): number {
  return items.reduce((sum, item) => sum + item.priceCents, 0);
}
```

- `const` by default, `let` when reassigned, never `var`.
- `===` and `!==` only (except `== null` to check both null and undefined, if the project allows it).
- `async`/`await` over raw `.then` chains. Every promise is awaited, returned or explicitly
  `void`-ed (no floating promises).
- Use exhaustive `switch` over discriminated unions with a `never` check in `default`.
- Use optional chaining `?.` and nullish coalescing `??`, not `||` for defaults (`||` treats `0`
  and `''` as missing).
- `for…of` for iteration, never `for…in` over arrays. Throw `Error` objects, never strings.
  No `eval`, `new Function` or `with`. Never modify built-in prototypes.
- In `package.json`: set `"type"` and `"engines"`, an `"exports"` map for libraries, and
  `test` / `lint` / `format` / `build` scripts so tools and agents can find them.

## Pitfalls

Floating promises swallow errors; `JSON.parse` returns `any`; `Array.sort()` without a
comparator sorts numbers as strings; mutating props or state in React or Angular; `Date` time
zones (use `Temporal` or a date library, and store UTC).

## Docs

TSDoc/JSDoc (`/** … */`) on exported symbols: describe behavior, `@param`, `@returns`,
`@throws`. Don't repeat the types; TypeScript already has them.

## Sources

- Google TypeScript Style Guide — https://google.github.io/styleguide/tsguide.html
- gts (Google TypeScript style tooling) — https://github.com/google/gts
- typescript-eslint — https://typescript-eslint.io/
- TypeScript handbook — https://www.typescriptlang.org/docs/handbook/
