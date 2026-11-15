---
paths:
  - "**/migrations/**"
  - "**/migration/**"
  - "**/db/**"
  - "**/*.sql"
  - "**/prisma/**"
  - "**/schema.prisma"
  - "**/alembic/**"
  - "**/flyway/**"
  - "**/liquibase/**"
  - "**/entities/**"
  - "**/repositories/**"
  - "**/{knexfile,drizzle.config,ormconfig}.*"
---

# Database

> **Precedence:** the project's existing schema conventions and migration tool win over this
> file. If you deviate from it, say why in the PR description.

Data outlives code. A bad query can be fixed with a deploy; a bad migration or lost data
cannot. Treat schema changes with the most care of anything in this workflow.

## Schema naming

- Tables and columns are `snake_case`. Pick plural (`orders`) or singular and stay consistent.
- Primary key: `id`. Foreign key: `<referenced_table_singular>_id` (`customer_id`).
- Timestamps: `created_at`, `updated_at`, stored as `timestamptz` in UTC.
- Booleans read as facts: `is_active`, `has_verified_email`.
- Constraints and indexes get explicit names: `pk_orders`, `fk_orders_customer_id`,
  `uq_users_email`, `ix_orders_created_at`. Generated names differ between environments and
  make migrations brittle.
- No reserved words as names (`user`, `order`, `group`), and no type prefixes (`tbl_`, `str_`).

## Integrity lives in the database

Use `NOT NULL`, foreign keys, `UNIQUE` and `CHECK` constraints. Application-only validation
gets bypassed by scripts, backfills and the next service. Money is `numeric`/integer minor
units, never `float`.

## Migrations

- **Every schema change is a migration in version control**, applied by the tool (Flyway,
  Liquibase, Alembic, Prisma Migrate, EF Core, golang-migrate). Never hand-edit production.
- **Never edit a migration that has run anywhere shared.** Write a new one.
- **Reversible:** provide the down migration, or document why it's impossible (dropped data)
  and how to restore from backup instead.
- **One concern per migration.** Schema changes and large data backfills are separate migrations.
- **Test it:** apply, roll back and re-apply against a production-like copy (size matters for
  locks and duration).

## Zero-downtime changes: expand, migrate, contract

Old and new versions of the app run at the same time during a deploy, so every step must work
with both.

| Change | Safe sequence |
|---|---|
| Add column | Add as nullable or with a default (instant on modern Postgres/MySQL), deploy code that writes it, backfill in batches, then add `NOT NULL` |
| Rename column | Add the new column, dual-write, backfill, switch reads, stop writing the old one, drop it in a later release |
| Drop column | Stop reading, then stop writing (deploy), then drop in a later release |
| Add index | `CREATE INDEX CONCURRENTLY` (Postgres) / online DDL (MySQL); never inside a transaction that locks writes |
| Add FK / check | Add as `NOT VALID`, then `VALIDATE CONSTRAINT` separately (Postgres) |
| Change type | Treat it as a rename into a new column |

Set a `lock_timeout` on migrations so a blocked DDL fails fast instead of queueing every query
behind it.

## Queries

- **Always use parameterized queries.** Never concatenate input into SQL (see
  `.claude/security/input-output.md`).
- **No N+1:** load related rows with a join or a batched `IN (...)`. Watch ORM lazy loading in loops.
- Select the columns you need, not `SELECT *`. Paginate every unbounded list (keyset pagination
  for large tables).
- Check the plan with `EXPLAIN (ANALYZE, BUFFERS)` for new queries on large tables.

## Indexes

Index foreign keys, columns in frequent `WHERE`/`JOIN`/`ORDER BY` clauses, and uniqueness rules.
In composite indexes, put equality columns first, then range or sort columns. Every index slows
writes and costs storage, so remove unused ones (`pg_stat_user_indexes`).

## Transactions

- Keep transactions short. Never hold one open across a network call or user think-time.
- Choose the isolation level deliberately. Use optimistic locking (a version column) or
  `SELECT … FOR UPDATE` for read-modify-write.
- To publish events reliably alongside a write, use the transactional outbox pattern rather than
  a dual write to DB and broker.

## Verify

Run migration linters: `squawk` (Postgres), `atlas migrate lint`, `strong_migrations` (Rails),
Django `makemigrations --check`. Use SQLFluff for SQL style. Run integration tests against the
real engine (Testcontainers), not SQLite standing in for Postgres.

## Sources

- SQL Style Guide (Simon Holywell) — https://www.sqlstyle.guide/
- PostgreSQL docs, "ALTER TABLE" and "CREATE INDEX CONCURRENTLY" — https://www.postgresql.org/docs/current/
- Martin Fowler & Pramod Sadalage, "Evolutionary Database Design" — https://martinfowler.com/articles/evodb.html
- Use The Index, Luke — https://use-the-index-luke.com/
