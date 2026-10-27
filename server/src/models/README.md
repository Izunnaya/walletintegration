# models/

`db.ts` exports the shared Prisma client. `databaseClient.ts` configures its
PostgreSQL adapter. `seedData.ts` contains the seed fixtures and database writes.
Models do not handle HTTP requests or responses.

All helpers participating in a transaction receive `Prisma.TransactionClient`
explicitly. They must use it for every query; using the shared Prisma client would
run outside the caller's transaction. Transfers and ledger entries remain append-only.

Prisma models and migrations live in `server/prisma/`. Generated client code lives
in ignored `src/generated/prisma/`; never edit it. See [the Prisma workflow](../../../docs/prisma.md)
and [the financial rules](../../../docs/domain.md).
