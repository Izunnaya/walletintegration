# Prisma workflow

Prisma manages models, ordinary queries and migrations. PostgreSQL handles storage,
constraints and locks. The seed and transfer rules are handwritten application code.

## Files

| File or folder | Purpose |
| --- | --- |
| `server/prisma/schema.prisma` | Models and column mappings |
| `server/prisma/migrations/` | Committed SQL, including custom checks and triggers |
| `server/prisma.config.ts` | CLI connection and seed command |
| `server/src/generated/prisma/` | Generated client; ignored by Git |
| `server/src/models/databaseClient.ts` | PostgreSQL adapter and connection settings |
| `server/src/models/seedData.ts` | Demo accounts and funding operations |
| `server/src/seed.ts` | Seed transaction, reporting and cleanup |

Run commands from `server/` using Node 22.18 or later in the 22.x line.
`npm ci` and `npm run build` generate the client. Do not edit generated files.

## Fresh database

Set `DATABASE_URL` in the ignored `.env`, then run:

```sh
npm run migrate
npm run seed
```

Migrations and seeding are separate. A non-local seed requires `SEED_ADMIN_PASSWORD`
that meets the registration password rules. The seed resets demo customer passwords
but preserves an existing admin password. Funding uses stable references so reruns
do not add money again. Reporting runs after commit; a report error cannot undo it.

## Adopting the old migration history

Back up the database and compare it with the archived SQL in `server/migrations/`,
including custom constraints and indexes. Only if it already matches `0_init`, run:

```sh
npm run migrate:baseline
npm run migrate
npm run migrate:status
```

Baselining marks `0_init` as applied without running its SQL. It does not validate
the database. Never baseline an empty or different schema. Do not use a reset or
`db push` to adopt existing balances.

## New schema changes

Use `npm run migrate:dev -- --name <change>` on a disposable development database.
Review the SQL before committing. Add custom SQL for features such as row-protection
triggers that Prisma's model cannot express. Never edit an applied migration.

Deployment runs `npm run migrate`, which applies pending committed SQL. Financial
history protection rejects updates and deletes; rollback of a transfer still works,
and seeding remains repeatable.

## Safe verification

After `npm run build`, run `npm run verify:prisma` against a development database.
The script creates a generated `wallet_test_` schema and checks:

- Fresh migrations and a migration rerun.
- The full backend test suite.
- Compiled seeding and a repeat seed with unchanged balances.
- Baseline adoption with unchanged balances.

The script sets `DATABASE_URL` and `TEST_DATABASE_URL` for its child processes and
removes its schema in `finally`. A forced process termination may leave that temporary
schema behind. Check that no test is using it before removing it.

Direct test runs require `TEST_DATABASE_URL` with a migrated `wallet_test_` schema.
The helpers scope both Prisma and raw SQL to it. Tests use a direct connection because
they need PostgreSQL startup options for `search_path`. Do not set these test options
on the application's pooled connection.
