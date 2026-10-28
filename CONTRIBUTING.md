# Contributing

## How work is planned

Work follows the build spec's order, one stage per branch — the table is in
[docs/architecture.md](docs/architecture.md#build-order). A stage is finished,
checked and merged before the next begins. Work discovered mid-stage is added to
the plan, not folded in silently.

**Questions are not answered in code.** A question raised during the build goes
into [known limitations](docs/known-limitations.md) with its options, what each costs,
and what it blocks. When it is answered it moves to [decisions](docs/decisions.md),
keeping its Q-number, with the reasoning and what was ruled out.

That rule has one exception, from the build spec itself: where a question is
routine and the simplest call is obvious, make it, record it in docs/decisions.md, and
keep going. The open questions file is for the ones where guessing would be
expensive to undo.

Scope comes from the build spec and the development guide. Both live outside this
repository and are excluded by `.gitignore`. Where they conflict, the build spec
wins, and the conflict gets recorded rather than quietly resolved —
([ADR 16](docs/decisions.md)) is one that did.

## Branches

`main` is the base branch. One branch per unit of work:

- `feature/<area>` for new behaviour
- `fix/<what>` for corrections
- `docs/<what>` for documentation

Branch from `main`, merge back into `main` when the work is finished and the
checks pass, then branch again from the updated `main`. No branches off branches.

## Commits

Each commit is one change that stands on its own and passes every check.

This repository uses conventional prefixes — `feat:`, `fix:`, `refactor:`,
`docs:`, `test:`, `chore:` — with a short imperative subject. The earlier project
here uses plain sentences without a prefix, which reads better; the prefixes stay
because the first commits used them and a log that switches style halfway looks
like two projects rather than one.

The body says **why**: what was wrong or missing, what was considered, and which
Q-number it settles.

```
feat: reject a transfer that would overdraw the sending wallet

The balance is read after SELECT ... FOR UPDATE on the wallet row, so a
second concurrent request sees the updated figure and is refused rather
than both passing the check.

Protects invariant 1: customer balances never go negative.
```

**For anything touching money, the body names the invariant it protects and what
happens on failure.** A reviewer should be able to read the log and follow the
financial reasoning without opening a diff.

Two rules that keep the history reviewable:

- **Never mix a refactor with a behaviour change.** Moving code and changing what
  it does in one commit makes both impossible to review.
- **Never commit a tree that does not build.** A commit that fails the checks
  cannot be bisected to, which defeats the point of committing often.

## When to commit

Commit when one idea is finished and the tree still works — not at the end of a
session. In practice that is a commit each for:

- One migration file.
- One route plus its controller.
- One middleware.
- One pure function plus its test.
- A documentation change describing work already committed.

## Before you push

From `server/`:

```sh
npm run typecheck
npm run build
```

Both must pass, together with `npm test`. Vitest unit tests now exist, and a
commit that breaks them is not made.

There is no CI yet, so these are run by hand. Adding them as a GitHub Actions
workflow is worth doing once there is a test suite for it to run.

## Code conventions

- **Structure is routes, controllers, middleware, models.** Route files are
  wiring only. Controllers hold the work and default-export an object at the
  bottom. Models know about storage and never about HTTP.
- **Middleware order inside a route is fixed:** authenticate, authorise,
  validate, controller.
- **Money is integer kobo as `bigint`**, stored as `BIGINT`, serialised as a
  string. Never a JavaScript `number`. Names carry the unit: `amountMinor`,
  `senderBalanceMinor`.
- **Every query in a transaction takes Prisma.TransactionClient explicitly.** A
  helper that reaches for the root Prisma client instead runs outside the transaction and
  escapes the locks.
- **Locks are users first, then wallets, each in ascending id order**, in every
  operation that takes them. This only works if it holds everywhere.
- **Financial rows are never updated or deleted.** A correction is a new
  compensating entry.
- **Nothing hides a commit, a retry, a balance change or a lock** inside a
  generic helper. Those are what a reviewer has to be able to find.
- **Business rejections are returned deliberately.** Never let an unexpected
  database error surface as insufficient funds or as a success.
- **No new layer** without a concrete job in the code as it stands today. No
  generic repositories, no dependency injection container, no provider
  interfaces, no state machine helpers.
- **Type-only imports say `import type`.** Node runs the TypeScript directly, so
  an unmarked type import makes it try to import a value Express does not export.

## Comments

Comments explain a reason, a constraint or a risk — not what the next line does.
The style here is the earlier backend's: enough prose that someone reading the
file for the first time can follow it, with the *why* close to the code.

Useful:

```ts
// Lock in sorted id order so two transfers in opposite directions cannot deadlock.
```

Not useful:

```ts
// Check whether the user is blocked.
if (user.isBlocked) {
```

Extended reasoning goes in docs/decisions.md, not into the source.

## Tests

Vitest covers the pure money, request, fingerprint and policy behaviour, and a set of
PostgreSQL integration suites that exercise real locking, idempotency under concurrency,
fault injection and the HTTP surface. `npm test` from `server/` runs everything and takes
roughly eleven minutes.

[known limitations](docs/known-limitations.md) lists what the suite still does not
establish — crash recovery mid-commit, multi-instance behaviour, and deployed proxy
attribution.

Test conventions:

- **Pure functions get unit tests** beside them: amount parsing, request
  normalisation, fingerprinting, policy decisions.
- **Locking, rollback, idempotency and restrictions get integration tests against
  a real PostgreSQL.** A mocked database cannot prove that a lock works, so a
  test that mocks one proves nothing about the invariants.
- **Name a test after the behaviour**, as in `returns the original transfer when
  the same key is retried`.
- **Assert on the financial records**, not only the status code and the final
  balance. A test that checks a balance but not the ledger would pass on a
  transfer with no entries.
- **Inject failures through test dependencies**, never a public endpoint or a
  request flag. An endpoint that triggers failures is a production risk.
- **Report what a test establishes.** An application-exception test is not a
  process-crash test, and saying so is part of the test being honest.


## Prisma changes

Generate the client after changing models. Commit schema.prisma and reviewed
migration SQL, never src/generated/prisma. Preserve all custom financial checks
and partial indexes in SQL. Use prisma migrate deploy for committed migrations;
never reset an existing database to adopt or change Prisma. See [docs/prisma.md](docs/prisma.md).
Run database tests against TEST_DATABASE_URL or use npm run verify:prisma for a
new temporary schema. Do not run truncating test setup against application data.
