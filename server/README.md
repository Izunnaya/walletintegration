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
| `npm run typecheck` | `tsc --noEmit` over `src/` |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled `dist/index.js` |

`npm run typecheck` and `npm run build` must both pass before a commit. There is
no `npm test` yet — see **Q15** in
[../OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md).

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
  models/                         the database and the records. Nothing here yet
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

| Built | Not yet built |
| --- | --- |
| `GET /health/live` | Every other endpoint in [../docs/api.md](../docs/api.md) |
| A UUID request ID on every response and in every error | The seven tables and their constraints |
| The shared error format for 404 and 500, both verified | The pool, `/health/ready`, and deployment |
| `.env` loading, and `PORT` with a default | Registration, login, JWT, authorisation |
| | The transfer, idempotency, and locking |
| | Rate limiting, the audit trail, reconciliation |
| | Any automated test |

## Verified by hand

There is no test command yet, so these were run against the compiled build and
are reproducible by repeating them:

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

**This establishes the HTTP contract and nothing financial.** No database has
been touched. The two `500` checks cover an application exception, not a process
crash — Postgres atomicity covers that case, which is a claim about the database
rather than about these checks.

## The database

Not connected yet. When it is:

- Migrations live in `migrations/`, are applied in order, and are never edited
  once applied.
- `npm run seed` is explicit and never runs on startup. Running it twice must not
  fund demo balances twice.
- `npm run reconcile` checks balances against the ledger in one read-only
  `REPEATABLE READ` transaction.
- The pool is created in `models/`, and `index.ts` connects it before listening.

Schema conventions, the constraints, and why the system wallet may go negative
are in [../docs/domain.md](../docs/domain.md).
