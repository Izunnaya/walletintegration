# Wallet Service — API

The Express and TypeScript API over PostgreSQL. One service, internal NGN
transfers between wallets we own.

Project-level documentation is one level up: [../README.md](../README.md),
[../docs/architecture.md](../docs/architecture.md),
[../docs/domain.md](../docs/domain.md), [../docs/api.md](../docs/api.md).

## Development

Needs Node 22.18 or newer, within the 22.x line.

```sh
npm ci
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run dev              # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs `src/index.ts` with `--watch`, restarting on save |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled `dist/index.js` |
| `npm test` | Runs Vitest unit tests |
| `npm run migrate` | Prisma migrate deploy, using committed migrations |
| `npm run generate` | Generates Prisma Client |
| `npm run seed` | Runs the explicit seed through Prisma |
| `npm run verify:prisma` | Real PostgreSQL verification in a temporary schema |

`npm test`, `npm run typecheck`, and `npm run build` must pass before committing
completed code changes. There are 50 unit tests, plus PostgreSQL schema and Prisma
seed integration suites. Concurrent transfer tests remain outstanding; see Q15 in [../OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md).

Node runs the TypeScript directly in development, so there is no transpiler in
the dependency list. That is also why imports carry the real `.ts` extension and
type-only imports must say `import type`; `npm run build` rewrites the extensions
for the compiled output.

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | |
| `DATABASE_URL` | Will be | — | Checked at startup once it exists |
| `JWT_SECRET` | Will be | — | Checked at startup once it exists |

`dotenv` loads `.env` at the top of `index.ts`. On Render nothing is loaded:
the variables come from the dashboard into the process environment directly.

`.env` is ignored by git and has never been committed. `.env.example` holds only
non-secret defaults.

## Structure

```
src/
  index.ts                        loads .env, builds the app, mounts routers, listens
  routes/
    HealthRoute.ts                one router per resource, wiring only
  controllers/
    HealthController.ts           one controller per resource
  middleware/
    requestId.ts                  a UUID per request, on req.requestId and X-Request-Id
    errorHandler.ts               respondNotFound and respondInternalError
    validate.ts                   Zod validation; transfer route not wired yet
  domain/                         amount/request schemas, policy, and fingerprint helper
  models/db.ts                    one shared Prisma client
  generated/prisma/               ignored generated client
```

What each layer may do is in
[../docs/architecture.md](../docs/architecture.md#the-layers). The short version:
routes wire, controllers work, models store, and nothing below `routes/` knows
HTTP exists except the controllers.

### The error contract is middleware, not convention

`respondNotFound` and `respondInternalError` are registered last, in that order,
and they are the reason the documented error shape is true for every failure
rather than only the ones a controller remembered to catch.

Without `respondInternalError`, Express answers a thrown error with an HTML page
containing the exception message, the stack and absolute filesystem paths. That
was verified, not assumed; the evidence is in [Q4](../DECISIONS.md).

Controllers still catch their own errors. The middleware is the backstop.

## What is built

The HTTP foundation, Prisma models and migration, repeatable seed, shared Prisma client,
Zod money/request schemas, pure transfer policy, request fingerprint helper, and
50 unit tests exist. Read [../WALKTHROUGH.md](../WALKTHROUGH.md) for file-by-file
reasoning and [../DECISIONS.md](../DECISIONS.md) Q23?Q27 for the domain decisions.

Readiness, authentication, wallet endpoints, the transfer transaction,
durable idempotency, admin endpoints, rate limits, reconciliation, and deployment
are not implemented. Migration files existing does not prove a database was migrated.

## Verified by hand

The following were earlier manual checks against the compiled build. The temporary
`/boom` routes are not permanent API endpoints; unit tests do not reproduce these HTTP checks:

```
GET /health/live -> 200  {"status":"ok"}  X-Request-Id: 35638df4-…
GET /nope        -> 404  {"error":{"code":"NOT_FOUND","message":"Route not found.","requestId":"dd1f28db-…"}}
GET /boom        -> 500  {"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred.","requestId":"072ac170-…"}}
GET /boom-async  -> 500  same shape, confirming Express 5 forwards rejected promises
```

The server log for `/boom` kept what the client did not get:

```
request_failed { requestId: '072ac170-…', path: '/boom', error: Error: sensitive internal detail … }
```

**These historical manual checks establish HTTP behavior, not financial guarantees.**
Database behavior is exercised separately by the integration suites. The two `500` checks cover an application exception, not a process
crash — Postgres atomicity covers that case, which is a claim about the database
rather than about these checks.

## The database

Prisma 7 manages database access and migrations. Follow [../docs/prisma.md](../docs/prisma.md)
for fresh setup, existing-database baselining, transaction behavior, and verification.
The original financial CHECK constraints and partial system-wallet index remain
in the Prisma SQL migration. No database reset is required to adopt Prisma.

The seed uses Prisma transactions and preserves demo funding repeatability.
Seeded passwords are still placeholders until authentication is implemented.
Reconciliation and the public transfer transaction remain future work.
