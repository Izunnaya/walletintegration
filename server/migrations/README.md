# Archived migrations

These seven files were applied by the original handwritten runner. They remain
unchanged for reference. They are no longer executed by `npm run migrate`.

Prisma owns migration history now. Its `prisma/migrations/0_init/migration.sql`
contains these statements, including all CHECK constraints and the partial
single-system-wallet index. New schema changes belong in Prisma migrations.

See `docs/prisma.md` at the repository root for fresh setup and adoption of an
existing database. Never reset a database to adopt Prisma.
