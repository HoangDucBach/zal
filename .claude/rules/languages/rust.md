---
paths:
  - "**/*.rs"
  - "**/Cargo.{toml,lock}"
  - "**/{rustfmt,.rustfmt,clippy,deny}.toml"
---

# Rust

> **Precedence:** the project's `rustfmt.toml`, Clippy lint levels and the style of the surrounding
> code win over this file. `rustfmt` output is not negotiable. Naming: `.claude/rules/core/naming.md`.

Google has no Rust style guide. This file follows the [Rust Style Guide](https://doc.rust-lang.org/style-guide/)
(what `rustfmt` implements), the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/),
and Google's [Comprehensive Rust](https://google.github.io/comprehensive-rust/) course.

## Tooling

| Task | Default tool | Command |
|---|---|---|
| Format | rustfmt | `cargo fmt --all -- --check` |
| Lint | Clippy | `cargo clippy --all-targets --all-features -- -D warnings` |
| Test | `cargo test` (or `cargo nextest`) | `cargo test --all-features` |
| Audit | cargo-audit, cargo-deny (advisories, licenses, bans) | `cargo deny check` |
| Unsafe checks | Miri | `cargo +nightly miri test` |

Pin the toolchain in `rust-toolchain.toml`. Build with `--locked` in CI. Commit `Cargo.lock`
for binaries (recommended for libraries too).

## Errors

- Return `Result<T, E>` for anything that can fail, and propagate with `?`.
- **Libraries** define typed errors (an `enum` deriving `thiserror::Error`, with `#[source]` or
  `#[from]` keeping the cause). **Applications** may use `anyhow::Result` with `.context("…")`
  at each layer.
- No `unwrap()` / `expect()` in library code or request paths. `expect("why this can't fail")`
  is fine for real invariants, and in tests and examples.
- `panic!` is for bugs (broken invariants), not for expected failures like bad input or I/O.
- Error messages are lowercase with no trailing punctuation, so they compose when chained.

## Ownership and API design

- Borrow by default (`&str`, `&[T]`, `&T`) in parameters. Take ownership only when you store or
  consume the value. Accept `impl AsRef<str>` / `impl Into<String>` for ergonomic constructors.
- Don't `.clone()` to silence the borrow checker. Restructure first; clone deliberately when
  it's cheap or needed.
- Conversion names follow the API guidelines: `as_` (cheap borrow), `to_` (expensive or
  allocating), `into_` (consumes self). Getters have no `get_` prefix.
- Implement the standard traits where they make sense: `Debug` always; `Clone`, `PartialEq`,
  `Eq`, `Hash`, `Default` and `Display` as appropriate. `From` for conversions (which gives you `Into`).
- Use newtypes for domain values (`struct UserId(Uuid)`) so the compiler catches mix-ups.
- Mark functions whose result must be used with `#[must_use]`. Use `#[non_exhaustive]` on public
  enums and structs that may grow.
- Keep the public API minimal: `pub(crate)` by default, with re-exports in `lib.rs` defining the surface.

## Unsafe

- Add `#![forbid(unsafe_code)]` to crates that don't need unsafe.
- Every `unsafe` block gets a `// SAFETY:` comment explaining why its invariants hold. Every
  `unsafe fn` gets a `# Safety` doc section.
- Wrap unsafe in a small safe abstraction, and test it under Miri.

## Async

- Use one runtime per binary (usually Tokio). Libraries stay runtime-agnostic where possible.
- Never block inside async code: use `tokio::task::spawn_blocking` for CPU-heavy or blocking I/O.
- Don't hold a `std::sync::Mutex` guard across `.await`. Use `tokio::sync::Mutex`, or restructure.
- Every spawned task is joined or tracked (`JoinSet`), and respects cancellation.

## Idioms

```rust
// ❌
fn first_admin(users: Vec<User>) -> User {
    let mut found = None;
    for u in users.iter() { if u.role == "admin" { found = Some(u.clone()); } }
    found.unwrap()
}

// ✅
fn first_admin(users: &[User]) -> Option<&User> {
    users.iter().find(|user| user.role == Role::Admin)
}
```

Prefer iterators and combinators over index loops, `match` and `if let` / `let … else` over
nested conditionals, and enums over boolean flags or stringly-typed fields.

## Pitfalls

`unwrap()` in production paths; integer overflow (wrapping in release builds; use
`checked_`/`saturating_` for untrusted arithmetic); blocking in async; holding locks across
`.await`; `Rc`/`RefCell` cycles leaking memory; overusing `Arc<Mutex<…>>` where message passing
is clearer; huge generic signatures (consider `dyn Trait` when monomorphization bloat matters).

## Docs

`///` doc comments on every public item, with a summary line, then `# Examples` (compiled and
run as doctests), `# Errors`, `# Panics` and `# Safety` sections where they apply. Crate-level
docs go in `//!` at the top of `lib.rs`. Use `#![warn(missing_docs)]` for libraries.

## Sources

- Rust Style Guide — https://doc.rust-lang.org/style-guide/
- Rust API Guidelines — https://rust-lang.github.io/api-guidelines/
- Comprehensive Rust (Google) — https://google.github.io/comprehensive-rust/
- Clippy lints — https://rust-lang.github.io/rust-clippy/master/
- The Rustonomicon (unsafe) — https://doc.rust-lang.org/nomicon/
