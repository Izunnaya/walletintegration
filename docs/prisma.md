# Prisma database workflow

Prisma 7 now owns database queries, generated model types, migrations, and the
seed transaction. This replaces the earlier `pg`-only decision at the user's
request. PostgreSQL remains the database; `@prisma/adapter-pg` uses the `pg` driver
under Prisma. Direct `pg` queries remain only in database-constraint tests and
the disposable verification script.

## Files to understand

- `server/prisma/schema.prisma`: handwritten models mapped to existing table and
  column names. Monetary values and database IDs are `BigInt`.
- `server/prisma/migrations/0_init/migration.sql`: the original seven migrations
  combined without weakening their constraints. CHECK constraints and the partial
  unique system-wallet index remain SQL because they are not modeled here.
- `server/prisma.config.ts`: CLI connection, migration directory, and seed command.
- `server/src/generated/prisma/`: generated client code. Ignored by Git; recreate
  it with `npm run generate`. Do not edit it.
- `server/src/models/databaseClient.ts`: creates a Prisma client with its PostgreSQL
  adapter, schema, and certificate-verified TLS for hosted connections.
- `server/src/models/db.ts`: the application's shared Prisma client.
- `server/src/models/seedData.ts`: handwritten seed records and operations using
  `Prisma.TransactionClient`; it never opens or commits its own transaction.
- `server/src/seed.ts`: handwritten command orchestration, reporting, and cleanup.

Prisma generates the database client and model types. It does not generate our
seed data, business rules, or transaction orchestration.

## Install and generate

Run commands from `server/` with Node 22.18+ in the 22.x release line:

```sh
npm ci
npm run generate
npm run typecheck
npm run build
```

Installation and build generate the client automatically. `DATABASE_URL` belongs
in the ignored `.env`, not source control. Client generation and schema validation
do not need a live database. Commands that execute SQL do.

## Fresh database

```sh
npm run migrate
npm run seed
```

`migrate` uses `prisma migrate deploy` to apply committed migrations. It does not
generate new migrations or run the seed. Seeding is always explicit.

## Existing database from the original runner

Do not run migrate reset or db push to adopt existing data. First back up the
database and confirm it matches the seven archived SQL files in
`server/migrations/`, including CHECK constraints and the single-system index.
Prisma's schema diff is useful for supported features but is not proof that all
custom checks match.

Only after confirming that the baseline already exists:

```sh
npm run migrate:baseline
npm run migrate
npm run migrate:status
```

The baseline command marks `0_init` applied in `_prisma_migrations`; it does not
execute the table-creation SQL. The old `schema_migrations` table can remain as
historical metadata and is no longer used. Never baseline an empty or different
database: marking a migration applied does not validate its contents.

The existing application database has not been baselined automatically. The
verification command rehearses this adoption procedure on disposable data instead.
See [Prisma's baseline workflow](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/baselining).

## Schema changes

Change `schema.prisma`, then use `npm run migrate:dev -- --name <change>` on a
disposable development database. Review migration SQL before committing. Use
`--create-only` when adding SQL features that the model cannot express. Preserve
existing financial checks and partial indexes. Never accept a reset prompt on a
database whose data must be kept. Deploy committed migrations using `npm run migrate`.

## Transaction and seed behavior

`seed.ts` calls `prisma.$transaction(transaction => applySeed(transaction), ...)`
with explicit `ReadCommitted` isolation and a 30-second transaction timeout.
Prisma reserves the transaction connection, commits a successful callback, and
rolls back a callback that throws. Every seed operation uses that callback's
transaction client, never the shared client.

User and wallet inserts skip existing unique records. Funding first inserts a
transfer under a stable reference. Only an inserted transfer receives its debit,
credit, and balance updates. All of these writes commit together. Existing user
passwords are not reset. Amounts and IDs remain bigint throughout Prisma operations.

Reporting starts only after the transaction promise succeeds. A report error says
the seed committed. A rejected transaction promise does not by itself distinguish
every network/commit uncertainty, so the error message does not promise that no
data was saved. Retrying the repeatable seed is the recovery path. The client is
disconnected in `finally`.

The balance/ledger report uses one schema-qualified SQL aggregation through Prisma
to observe one database snapshot. Explicit SQL will also be appropriate for future
`SELECT ... FOR UPDATE` locks and conflict-aware idempotency claims inside a Prisma
transaction. Prisma does not replace those financial rules.

The seed still has a placeholder password hash; adopting Prisma does not make the
accounts login-ready. Password hashing and deployed admin credentials remain work
for authentication. There is no transfer endpoint yet.

## Verification

```sh
npm run test:unit
npm run verify:prisma
```

`verify:prisma` uses DATABASE_URL to create a uniquely named `wallet_test_...`
schema, applies migrations twice, runs all tests there, runs the compiled and CLI
seeds, and rehearses baselining existing data. It drops only its temporary schema
in `finally`. It requires permission to create schemas and reach PostgreSQL. If the
process is forcibly killed, cleanup may not run; remove only the recorded temporary
schema after confirming no verification process is using it.

For an already prepared, separate test database/schema, set TEST_DATABASE_URL and
run `npm test`. Tests refuse to use the application schema. Run database test files
sequentially because they truncate tables inside rolled-back transactions. The
constraint suite deliberately uses `pg` to check the exact PostgreSQL constraints;
the seed suite exercises Prisma's actual transactions and ORM writes.

## Verified result for the Prisma migration

Prisma schema validation, TypeScript checking, and the production build passed.
All 81 tests passed: 50 unit/command tests, 21 PostgreSQL constraint tests, and
10 Prisma seed integration tests. The disposable-schema verification also passed
fresh migration, migration rerun, the compiled seed, CLI seed rerun with unchanged
balances, and baseline adoption with existing balances unchanged. Temporary schema
cleanup completed. The actual application schema was not reset or baselined.
