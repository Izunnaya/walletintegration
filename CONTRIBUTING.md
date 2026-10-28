# Contributing

## Branches

`main` is the base branch. One branch per unit of work:

- `feature/<area>` for new behavior
- `fix/<what>` for corrections
- `docs/<what>` for documentation
- `test/<what>` for test-only work

Branch from `main` and merge back when the checks pass. Stack a branch on another only when
the second genuinely depends on the first, and say so in the pull request.

## Commits

One commit is one change that stands on its own.

Use conventional prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. Keep the
subject short and imperative.

The body says why: what was wrong, what was considered, what it costs.

```
feat: reject a transfer that would overdraw the sending wallet

The balance is read after SELECT ... FOR UPDATE on the wallet row, so a
second concurrent request sees the updated figure and is refused rather
than both passing the check.

Protects invariant 1: customer balances never go negative.
```

For anything touching money, name the invariant it protects and what happens on failure. A
reviewer should follow the financial reasoning from the log without opening a diff.

Two rules keep the history reviewable:

- Never mix a refactor with a behavior change. Moving code and changing what it does in one
  commit makes both impossible to review.
- Never commit a tree that does not build.

Commit when one idea is finished, not at the end of a session. In practice that is one commit
each for a migration, a route plus its controller, a middleware, a pure function plus its
test, or a documentation change describing work already committed.

Stage by path. `git commit` records the whole index, so an unrelated staged file lands in the
commit whatever the message says.

## Before you push

From `server/`:

```sh
npm run typecheck
npm run build
npm test
```

All three must pass. There is no CI, so run them by hand.

`npm test` takes about 15 minutes. Use `npx vitest run <file>` while iterating, then the full
suite before pushing. Suites interfere with each other in ways a single file does not show.

## Code conventions

- **Structure is routes, controllers, services, middleware, domain, models.** Route files are
  wiring only. Controllers hold the HTTP work and default-export an object. Models know about
  storage and never about HTTP.
- **Middleware order inside a route is fixed:** authenticate, authorize, validate, controller.
- **Money is integer kobo as `bigint`**, stored as `BIGINT`, serialized as a string. Never a
  JavaScript `number`. Names carry the unit: `amountMinor`, `senderBalanceMinor`.
- **Every query in a transaction takes `Prisma.TransactionClient` explicitly.** A helper that
  reaches for the root client runs outside the transaction and escapes the locks.
- **Locks are users first, then wallets, each in ascending id order.** This only works if it
  holds everywhere.
- **Raw SQL qualifies its schema.** An unqualified table name resolves through `search_path`
  and can read a different schema than you intended.
- **Financial rows are never updated or deleted.** A correction is a new compensating entry.
- **Nothing hides a commit, a retry, a balance change or a lock** inside a generic helper.
  Those are what a reviewer has to be able to find.
- **Business rejections are returned deliberately.** Never let an unexpected database error
  surface as insufficient funds, or as a success.
- **No new layer** without a concrete job in the code as it stands. No generic repositories, no
  dependency injection container, no provider interfaces.
- **Type-only imports say `import type`.** Node runs the TypeScript directly, so an unmarked
  type import makes it try to import a value Express does not export.

## Comments

Comments explain a reason, a constraint or a risk, not what the next line does.

Useful:

```ts
// Lock in sorted id order so two transfers in opposite directions cannot deadlock.
```

Not useful:

```ts
// Check whether the user is blocked.
if (user.isBlocked) {
```

Extended reasoning goes in [docs/decisions.md](docs/decisions.md).

## Tests

Unit tests cover money arithmetic, request normalization, fingerprinting and policy decisions.
PostgreSQL suites cover locking, rollback, idempotency under concurrency, restrictions, the
rate limiters and the reconciliation checks.

- **Pure functions get unit tests.**
- **Locking, rollback, idempotency and restrictions get integration tests against real
  PostgreSQL.** A mocked database cannot prove a lock works.
- **Name a test after the behavior**, as in `returns the original transfer when the same key is
  retried`.
- **Assert on the financial records**, not only the status code and the final balance. A test
  that checks a balance but not the ledger would pass on a transfer with no entries.
- **Inject failures through test dependencies**, never a public endpoint or a request flag.
- **Report what a test establishes.** An application-exception test is not a process-crash
  test.

### The test database

There is one database and the suites share it. Isolation comes from one of two things:

- A per-run schema named by UUID, created and dropped by the suite. See
  `server/tests/apiDatabase.ts`.
- Work inside a transaction that is always rolled back. See `server/tests/database.ts`.

Connect on Neon's direct endpoint, not the pooled one. A pooled connection leaks
`SET search_path` between sessions.

`fileParallelism` is off in `vitest.config.ts`. Some suites `TRUNCATE`, which locks out every
other transaction on those tables. Do not turn it on.

Never point the test commands at a deployed database.

## Prisma changes

Generate the client after changing models. Commit `schema.prisma` and the reviewed migration
SQL. Never commit `src/generated/prisma`.

Preserve the custom financial checks and partial indexes in SQL. Use `prisma migrate deploy`
for committed migrations. Never reset an existing database to adopt or change Prisma.

See [docs/prisma.md](docs/prisma.md).
