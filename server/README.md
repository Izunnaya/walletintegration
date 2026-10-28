# Wallet Service API

Express 5 and TypeScript over PostgreSQL. Internal NGN transfers between wallets.

Project documentation is one level up: [../README.md](../README.md),
[../docs/architecture.md](../docs/architecture.md), [../docs/domain.md](../docs/domain.md),
[../docs/api.md](../docs/api.md).

## Development

Requires Node 22.18 or newer, within the 22.x line.

```sh
npm ci
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run migrate
npm run seed
npm run dev              # http://localhost:3000
```

| Command | Does |
| --- | --- |
| `npm run dev` | Runs `src/index.ts` with `--watch` |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled `dist/index.js` |
| `npm test` | Every Vitest suite. About 15 minutes |
| `npm run test:unit` | Suites that need no database |
| `npm run test:integration` | PostgreSQL suites only |
| `npm run migrate` | `prisma migrate deploy`, using committed migrations |
| `npm run generate` | Generates Prisma Client |
| `npm run seed` | Runs the seed. Repeatable |
| `npm run reconcile` | Audits the ledger against the balances |
| `npm run admin:password` | Sets or rotates the admin password |
| `npm run verify:prisma` | PostgreSQL verification in a temporary schema |

`npm run typecheck`, `npm run build` and `npm test` must pass before a commit.

Node runs the TypeScript directly in development, so there is no transpiler in the
dependencies. That is why imports carry the real `.ts` extension and type-only imports say
`import type`. `npm run build` rewrites the extensions for the compiled output.

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | |
| `DATABASE_URL` | Yes | | Checked at startup with `SELECT 1` |
| `JWT_SECRET` | Yes | | At least 32 characters |
| `SEED_ADMIN_PASSWORD` | For seeding | | Required against a non-local database |
| `CORS_ORIGINS` | No | localhost 3000 and 3001 | Comma-separated |
| `TRUST_PROXY_HOPS` | No | `0` | Proxies in front of the service |
| `LOG_LEVEL` | No | `info` | `silent` under Vitest |

`dotenv` loads `.env` at the top of `index.ts`. On Render nothing is loaded; the variables
arrive in the process environment from the dashboard.

`.env` is gitignored and has never been committed. `.env.example` holds non-secret defaults.

## Structure

```
src/
  app.ts              builds the app and its middleware stack, exports it unlistened
  index.ts            loads .env, proves the database is reachable, listens
  logger.ts           the pino instance and the pino-http options
  proxyConfig.ts      the validated trust-proxy hop count
  routes/             one router per resource, wiring only
  controllers/        one controller per resource, the HTTP work
  services/           the transfer: locking, idempotency, bounded retries
  middleware/         request ids, auth, validation, CORS, rate limits, errors
  domain/             Zod schemas, money rules, transfer policy, fingerprint
  models/             Prisma client, locking reads, seed, reconciliation
  generated/prisma/   gitignored generated client
tests/                unit and PostgreSQL integration suites
prisma/               schema and migrations
```

What each layer may do is in [../docs/architecture.md](../docs/architecture.md). Routes wire,
controllers work, models store. Nothing below `routes/` knows HTTP exists except the
controllers.

`app.ts` exports the app without listening so integration tests can mount it without binding a
port. `index.ts` is the only thing that listens.

## The error contract is middleware

`respondNotFound` and `respondInternalError` are registered last, in that order. They are why
the documented error shape holds for every failure rather than only the ones a controller
remembered to catch.

Without `respondInternalError`, Express answers a thrown error with an HTML page containing the
exception message, the stack and absolute filesystem paths. See [ADR 13](../docs/decisions.md).

Controllers still catch their own errors. The middleware is the backstop.

## The database

Prisma 7 manages access and migrations. Read [../docs/prisma.md](../docs/prisma.md) before
migrating an existing database.

The financial `CHECK` constraints and the partial system-wallet index live in the migration
SQL, not only in application code. Adopting Prisma required no database reset.

The seed runs in a transaction and is repeatable. Customer passwords are reset on every run.
The admin password is written once and never reset; see [ADR 18](../docs/decisions.md).
