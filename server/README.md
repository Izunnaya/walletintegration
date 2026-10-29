# Wallet API

Express and TypeScript over PostgreSQL, with Prisma for database access.
See the [project setup](../README.md) and [backend structure](../docs/architecture.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run TypeScript with watch mode |
| `npm run typecheck` | Check source and test types |
| `npm run build` | Generate Prisma Client and compile to `dist/` |
| `npm start` | Run `dist/index.js` |
| `npm run test:unit` | Checks without a database |
| `npm run verify:prisma` | Migrations, all tests and seed checks in a temporary schema |
| `npm test` | All tests using a prepared `TEST_DATABASE_URL` |
| `npm run migrate` | Apply committed migrations |
| `npm run seed` | Create demo accounts and fund them once |
| `npm run reconcile` | Compare balances, ledger entries and saved results |
| `npm run admin:password` | Set the existing admin's password |

## Configuration

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | Application PostgreSQL connection |
| `JWT_SECRET` | Random token-signing secret, at least 32 characters |
| `PORT` | Defaults to 3000 |
| `SEED_ADMIN_PASSWORD` | Required for a non-local seed and password changes |
| `CORS_ORIGINS` | Allowed frontend origins, separated by commas |
| `TRUST_PROXY_HOPS` | Verified proxy count; defaults to 0 |
| `LOG_LEVEL` | Defaults to `info` |
| `TEST_DATABASE_URL` | Prepared test schema for direct test runs |

Keep secrets in the ignored `.env` or hosting environment. Use a disposable
development database for tests. Read [the Prisma workflow](../docs/prisma.md)
before migrating existing data.
