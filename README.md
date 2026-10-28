# Wallet Service

An internal wallet service: users, one NGN wallet each, and transfers between them that
cannot duplicate, lose or invent money — under concurrent requests, retries and failures.

Closed system. No banks, no payment providers, no queues. Every transfer completes inside one
PostgreSQL transaction, which is why there is nothing to wait on and no event system.

**Live API:** https://walletintegration-6t6r.onrender.com

---

## What it guarantees

Everything else in this repository exists to keep these. When a design choice looks
over-careful, the question to ask is which one it protects.

1. Customer wallet balances never go negative.
2. A successful transfer debits and credits exactly the same amount in the same currency.
3. The transfer, both ledger entries, both balance updates and the idempotency result commit
   together or not at all.
4. Retrying the same operation cannot move money twice.
5. A user can only transfer from a wallet they own.
6. Users can only view wallets and transfers they are authorised to see.
7. Account restrictions are checked under database locks, inside the transfer transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten. Corrections are new compensating entries.
10. A timeout does not mean a transfer failed.

Numbers 9 and 10 are the two most often got wrong elsewhere, and
[docs/known-limitations.md](docs/known-limitations.md) is honest about where number 9 is
documented rather than enforced.

## Quick start

Needs Node 22.18 or newer, within the 22.x line.

```sh
cd server
npm ci
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run migrate          # applies Prisma migrations
npm run seed             # demo users, wallets and a funded float
npm run dev              # http://localhost:3000
```

```sh
curl -i http://localhost:3000/health/live
```

returns `200` with `{"status":"ok"}` and an `X-Request-Id` header. It proves the process
answers and nothing more — readiness is a separate endpoint, deliberately, so a database
outage is never reported as a dead process.

### Commands

Run from `server/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs `src/index.ts` with `--watch` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled server |
| `npm test` | Every Vitest suite. Database suites need `DATABASE_URL`; takes ~11 minutes |
| `npm run test:unit` | Only the suites that need no database |
| `npm run test:integration` | Only the PostgreSQL suites |
| `npm run migrate` | Applies Prisma migrations |
| `npm run seed` | Seeds demo wallets. Running it twice changes nothing |
| `npm run reconcile` | Audits the ledger: balances, entry pairs, system total |
| `npm run admin:password` | Sets or rotates the admin password deliberately |

## The API

Full reference, including every error code and what it means, in
[docs/api.md](docs/api.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | The process answers |
| `GET` | `/health/ready` | The database is reachable |
| `POST` | `/auth/register` | Create a user and their wallet |
| `POST` | `/auth/login` | Exchange credentials for a JWT |
| `GET` | `/wallets/me` | The caller's wallet and balance |
| `POST` | `/transfers` | Move money. Requires an `Idempotency-Key` header |
| `GET` | `/transfers` | The caller's transfer history, keyset paginated |
| `GET` | `/transfers/:id` | One transfer the caller is a party to |
| `POST` | `/admin/users/:id/block` | Block an account, with an audit reason |
| `POST` | `/admin/users/:id/unblock` | Lift a block, with an audit reason |
| `GET` | `/admin/audit` | The admin action trail |

Two conventions worth knowing before you call it:

- **Money is a string of minor units.** `"150000"` is ₦1,500.00. A JSON number is a float, so
  a large enough balance would stop being exact. Parse the string; never do arithmetic on a
  formatted value.
- **Every response carries `X-Request-Id`**, and every error repeats it as
  `error.requestId`. Quote it when reporting a failure — it is what ties a report to a log
  line.

A `503` on a transfer means the outcome could not be confirmed, **not** that it failed.
Retry with the same `Idempotency-Key`; that is what makes the retry safe.

**Postman:** import
[docs/wallet-service.postman_collection.json](docs/wallet-service.postman_collection.json).
Run any Login request first; it stores the token in a `{{token}}` collection variable that
every protected request then uses.

## Demo credentials

Created by `npm run seed`. Local fixtures, published deliberately so a reviewer can sign in
without being sent anything.

| Account | Password | Holds | Use it for |
| --- | --- | --- | --- |
| `ada@example.com` | `demo-password-2026` | NGN 500,000 | The funded sender |
| `bode@example.com` | `demo-password-2026` | NGN 250,000 | The recipient |
| `chidi@example.com` | `demo-password-2026` | NGN 10 | Insufficient funds |
| `admin@wallet.internal` | **not published** | NGN 0 | Admin-only endpoints |
| `fraudster@example.com` | no account | — | Blacklisted; registration refuses it |

`system@wallet.internal` owns the funding wallet and **cannot be signed into at all**. The
seed gives it a hash of random bytes nobody holds the input to, so the one wallet allowed to
go negative has no usable login.

The customer passwords are reset on every seed run, so the database always matches this
table. Nothing of value is protected by them.

**The admin password is not in this repository.** It grants the ability to block and unblock
any account, so it comes from `SEED_ADMIN_PASSWORD` and is shared with reviewers privately.
The seed writes it once and never resets it; `npm run admin:password` is the deliberate path
for setting or rotating it. See [ADR 18](docs/decisions.md).

## How it works

```
request → middleware → route → controller → service → model → PostgreSQL
```

Nothing travels back up. A model never imports a controller, and nothing below `routes/`
knows HTTP exists except the controllers. [docs/architecture.md](docs/architecture.md) covers
each layer and why the middleware order is behaviour rather than style.

The transfer is the part worth reading first. It claims an idempotency key, locks the user
rows then the wallet rows — each in sorted id order, so two opposite-direction transfers
cannot deadlock — checks restrictions, and commits the debit, credit, both ledger entries and
the stored response together. [docs/domain.md](docs/domain.md) explains the money rules and
the difference between a known and an unknown failure.

## Testing

```sh
cd server
npm test
```

17 suites. The unit tests cover money arithmetic, request validation, the fingerprint and the
transfer policy. The PostgreSQL suites exercise real row locking, idempotency under
concurrency, fault injection mid-transfer, the rate limiters, the HTTP surface and the
reconciliation checks.

Two things about the database the suite needs:

- There is **one** database. Integration tests isolate themselves either with a per-run schema
  named by UUID, or by doing their work inside a transaction that is always rolled back.
- `fileParallelism` is off deliberately. Some suites `TRUNCATE`, which takes a lock that
  blocks every other transaction on those tables.

Never point the test commands at a deployed database.

What the suite does **not** establish is listed in
[docs/known-limitations.md](docs/known-limitations.md).

## Deployment

Live on Render, built from `server/` as the root of this monorepo.
[docs/deployment.md](docs/deployment.md) has the step-by-step and the checks that prove it
is up.

- Secrets (`DATABASE_URL`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`) live in Render environment
  variables, never in the repository.
- Migrations run as part of the deploy. The seed is run manually, once.
- The health check points at `/health/ready`, so a process that is up but cannot reach the
  database is not sent traffic.
- Logs are JSON on Render and pretty-printed in a terminal, chosen by whether stdout is a
  TTY. `LOG_LEVEL` defaults to `info` — one line per request, carrying the request id.
- `TRUST_PROXY_HOPS` must match the number of proxies in front of the service. It defaults to
  `0`, which trusts no forwarded header. See
  [docs/known-limitations.md](docs/known-limitations.md) for why the deployed value is still
  outstanding and what it does and does not affect.
- The free plan sleeps when idle, so the first request after a pause takes up to a minute.
  The UI shows a notice rather than appearing to hang.

### Rate limits

Per minute: 60 transfers per caller, 240 reads per caller, 20 auth requests per IP, 10 login
attempts per account **and** client, 60 login attempts per account overall, 30 admin requests
per caller.

A `503` on a transfer does not consume the transfer quota, because retrying it is the
documented behaviour. Honour `Retry-After` on both `429` and `503`, and keep the original
`Idempotency-Key` on every retry. The counters live in one process; a shared store is needed
before adding replicas.

## Repository layout

```
├── server/              The API: Express 5 + TypeScript over PostgreSQL
│   ├── src/
│   │   ├── app.ts           Builds the app and its middleware stack
│   │   ├── index.ts         Loads .env, proves the database is reachable, listens
│   │   ├── routes/          One router per resource, wiring only
│   │   ├── controllers/     One controller per resource, the HTTP work
│   │   ├── services/        The transfer: locking, idempotency, retries
│   │   ├── middleware/      Request ids, auth, validation, CORS, limits, errors
│   │   ├── domain/          Zod schemas and the money rules
│   │   └── models/          Prisma client, locking reads, seed, reconciliation
│   ├── prisma/              Schema and migrations
│   ├── scripts/             The bounded production audit
│   └── tests/               Unit and PostgreSQL integration suites
├── frontend/            The wallet UI: React 19 on Vite
├── docs/                Architecture, domain, API, decisions, limitations
└── CONTRIBUTING.md      Branches, commits, conventions, and the checks a change must pass
```

The API is the contract between `server/` and `frontend/`. The server depends on nothing in
the frontend folder.

## Documentation

| Document | Read it for |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the server is put together and what each layer may do |
| [docs/domain.md](docs/domain.md) | What a wallet, transfer and ledger entry are; the money rules; known versus unknown failure |
| [docs/api.md](docs/api.md) | Every endpoint, every error code, and which status means what |
| [docs/decisions.md](docs/decisions.md) | The design decisions, why they were made, and what they cost |
| [docs/known-limitations.md](docs/known-limitations.md) | What the service does not do, or does not yet prove |
| [docs/deployment.md](docs/deployment.md) | Deploying it, and the checks that prove it worked |
| [docs/prisma.md](docs/prisma.md) | Read before migrating an existing database |
| [docs/production-audit-2026-10-28.md](docs/production-audit-2026-10-28.md) | A bounded audit of the deployed service and what it changed |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to make and land a change |
| [server/README.md](server/README.md) | API detail: commands, environment, structure |

## Stack

Node 22, Express 5, strict TypeScript, PostgreSQL 18, Prisma 7 with its pg adapter. Zod
validates external input, `pino` writes structured logs, `helmet` sets the security headers,
`express-rate-limit` holds the quotas, and Vitest runs the tests. The database is Neon; see
[ADR 19](docs/decisions.md) for why not Render PostgreSQL.

Read [docs/prisma.md](docs/prisma.md) before migrating an existing database. Client
generation is automatic on install and build; seeding is explicit. Existing application data
is preserved through verified baselining, never a reset.
