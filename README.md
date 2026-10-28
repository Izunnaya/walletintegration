# Wallet Service

An internal NGN wallet service. Users hold one wallet each and transfer between them.
Transfers cannot duplicate, lose or invent money under concurrent requests, retries or
failures.

Closed system. No banks, no payment providers, no queues. Every transfer completes inside one
PostgreSQL transaction.

**Live API:** https://walletintegration-6t6r.onrender.com

## Invariants

The design exists to hold these.

1. Customer wallet balances never go negative.
2. A successful transfer debits and credits the same amount in the same currency.
3. The transfer, both ledger entries, both balance updates and the idempotency result commit
   together or not at all.
4. Retrying an operation cannot move money twice.
5. A user can transfer only from a wallet they own.
6. A user can read only wallets and transfers they are party to.
7. Account restrictions are checked under row locks, inside the transfer transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten. Corrections are new compensating entries.
10. A timeout does not mean a transfer failed.

Invariant 9 is enforced by convention, not by the database. See
[known limitations](docs/known-limitations.md).

## Quick start

Requires Node 22.18 or newer, within the 22.x line. Run everything from `server/`.

```sh
cd server
npm ci
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run migrate
npm run seed
npm run dev              # http://localhost:3000
```

Confirm it answers:

```sh
curl -i http://localhost:3000/health/live
```

Returns `200`, `{"status":"ok"}` and an `X-Request-Id` header. Liveness does not touch the
database. Readiness is separate, so a database outage is not reported as a dead process.

### Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Runs `src/index.ts` with `--watch` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled server |
| `npm test` | Every suite. Database suites need `DATABASE_URL`. Takes about 15 minutes |
| `npm run test:unit` | Suites that need no database |
| `npm run test:integration` | PostgreSQL suites only |
| `npm run migrate` | Applies Prisma migrations |
| `npm run seed` | Seeds demo wallets. Repeatable |
| `npm run reconcile` | Audits the ledger against the balances |
| `npm run admin:password` | Sets or rotates the admin password |

## API

Full reference in [docs/api.md](docs/api.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | The process answers |
| `GET` | `/health/ready` | The database is reachable |
| `POST` | `/auth/register` | Create a user and their wallet |
| `POST` | `/auth/login` | Exchange credentials for a JWT |
| `GET` | `/wallets/me` | The caller's wallet and balance |
| `POST` | `/transfers` | Move money. Requires an `Idempotency-Key` header |
| `GET` | `/transfers` | The caller's transfers, keyset paginated |
| `GET` | `/transfers/:id` | One transfer the caller is party to |
| `POST` | `/admin/users/:id/block` | Block an account. Requires a reason |
| `POST` | `/admin/users/:id/unblock` | Lift a block. Requires a reason |
| `GET` | `/admin/audit` | The admin action trail |

Two conventions apply to every call.

Money is a string of minor units. `"150000"` is NGN 1,500.00. A JSON number is a float and
loses precision at scale. Parse the string. Never do arithmetic on a formatted value.

Every response carries `X-Request-Id`, and every error repeats it as `error.requestId`. Quote
it when reporting a failure.

A `503` on a transfer means the outcome is unconfirmed, not that it failed. Retry with the
same `Idempotency-Key`.

**Postman:** import
[docs/wallet-service.postman_collection.json](docs/wallet-service.postman_collection.json).
Run a Login request first. It stores the token in a `{{token}}` collection variable.

## Demo credentials

Created by `npm run seed`. Local fixtures, published so a reviewer can sign in without being
sent anything.

| Account | Password | Holds | Use for |
| --- | --- | --- | --- |
| `ada@example.com` | `demo-password-2026` | NGN 500,000 | The funded sender |
| `bode@example.com` | `demo-password-2026` | NGN 250,000 | The recipient |
| `chidi@example.com` | `demo-password-2026` | NGN 10 | Insufficient funds |
| `admin@wallet.internal` | not published | NGN 0 | Admin endpoints |
| `fraudster@example.com` | no account | | Blacklisted. Registration refuses it |

The customer passwords reset on every seed run, so the database always matches this table.
Nothing of value is behind them.

`system@wallet.internal` owns the funding wallet and cannot be signed into. Its password hash
comes from random bytes nobody holds, so the one wallet allowed to go negative has no usable
login.

The admin password is not in this repository. It grants block and unblock on any account. Set
it from `SEED_ADMIN_PASSWORD`:

```sh
SEED_ADMIN_PASSWORD='...' npm run admin:password
```

The seed writes it once and never resets it. See [ADR 18](docs/decisions.md).

## How it works

```
request -> middleware -> route -> controller -> service -> model -> PostgreSQL
```

Nothing travels back up. A model never imports a controller. Nothing below `routes/` knows
HTTP exists except the controllers. [docs/architecture.md](docs/architecture.md) covers each
layer and the middleware order.

The transfer is the part to read first. It claims an idempotency key, locks the user rows then
the wallet rows in sorted id order, checks restrictions, and commits the debit, credit, both
ledger entries and the stored response together.
[docs/domain.md](docs/domain.md) covers the money rules and the difference between a known and
an unknown failure.

## Testing

```sh
cd server
npm test
```

21 suites. Unit tests cover money arithmetic, request validation, the fingerprint and the
transfer policy. PostgreSQL suites cover row locking, idempotency under concurrency, fault
injection mid-transfer, the rate limiters, the HTTP surface and the reconciliation checks.

There is one database. Integration tests isolate themselves with a per-run schema named by
UUID, or by working inside a transaction that is always rolled back. `fileParallelism` is off
because some suites `TRUNCATE`, which locks out every other transaction on those tables.

Never point the test commands at a deployed database.

[docs/known-limitations.md](docs/known-limitations.md) lists what the suite does not establish.

## Deployment

Live on Render, built from `server/` as the monorepo root. Steps and verification in
[docs/deployment.md](docs/deployment.md).

- Secrets live in Render environment variables: `DATABASE_URL`, `JWT_SECRET`,
  `SEED_ADMIN_PASSWORD`.
- Migrations run during the deploy. The seed is run manually, once.
- The health check points at `/health/ready`, so a process that cannot reach the database is
  not sent traffic.
- Logs are JSON when stdout is a pipe and pretty-printed in a terminal. `LOG_LEVEL` defaults
  to `info`: one line per request, carrying the request id.
- Set `TRUST_PROXY_HOPS` to the number of proxies in front of the service. It defaults to `0`,
  which trusts no forwarded header. The deployed value is still outstanding; see
  [known limitations](docs/known-limitations.md).
- The free plan sleeps when idle. The first request after a pause takes up to a minute.

### Rate limits

Per minute: 60 transfers per caller, 240 reads per caller, 20 auth requests per IP, 10 login
attempts per account and client, 60 login attempts per account, 30 admin requests per caller.

A `503` on a transfer does not consume the transfer quota. Honor `Retry-After` on `429` and
`503`. Keep the original `Idempotency-Key` on every retry. Counters are held in one process;
use a shared store before adding replicas.

## Repository layout

```
server/                 The API: Express 5 and TypeScript over PostgreSQL
  src/
    app.ts              Builds the app and its middleware stack
    index.ts            Loads .env, proves the database is reachable, listens
    routes/             One router per resource. Wiring only
    controllers/        One controller per resource. The HTTP work
    services/           The transfer: locking, idempotency, retries
    middleware/         Request ids, auth, validation, CORS, limits, errors
    domain/             Zod schemas and the money rules
    models/             Prisma client, locking reads, seed, reconciliation
  prisma/               Schema and migrations
  tests/                Unit and PostgreSQL integration suites
frontend/               The wallet UI: React 19 on Vite
docs/                   Architecture, domain, API, decisions, limitations
CONTRIBUTING.md         Branches, commits, conventions, required checks
```

The API is the contract between `server/` and `frontend/`. The server depends on nothing in
the frontend folder.

## Documentation

| Document | Read for |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the server is put together and what each layer may do |
| [docs/domain.md](docs/domain.md) | Wallets, transfers and ledger entries. The money rules |
| [docs/api.md](docs/api.md) | Every endpoint and every error code |
| [docs/decisions.md](docs/decisions.md) | The design decisions and what they cost |
| [docs/known-limitations.md](docs/known-limitations.md) | What the service does not do or does not prove |
| [docs/deployment.md](docs/deployment.md) | Deploying it and verifying the deploy |
| [docs/prisma.md](docs/prisma.md) | Read before migrating an existing database |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to make and land a change |
| [server/README.md](server/README.md) | Commands, environment and structure |

## Stack

Node 22, Express 5, strict TypeScript, PostgreSQL 18, Prisma 7 with its pg adapter. Zod
validates external input. `pino` writes structured logs. `helmet` sets security headers.
`express-rate-limit` holds the quotas. Vitest runs the tests. The database is Neon; see
[ADR 19](docs/decisions.md).

Read [docs/prisma.md](docs/prisma.md) before migrating an existing database. Client generation
runs on install and build. Seeding is explicit. Existing data is preserved through verified
baselining, never a reset.
