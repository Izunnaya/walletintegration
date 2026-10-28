# Wallet Service

An internal wallet service: users, one NGN wallet each, and transfers between
them that cannot duplicate, lose or invent money — under concurrent requests,
retries and failures.

Closed system. No banks, no payment providers, no queues. Every transfer
completes inside one PostgreSQL transaction, which is why there is nothing to
wait on and no event system.

**Live:** not deployed yet.

## The invariants

Everything else in this repository exists to keep these. When a design choice
looks over-careful, the question to ask is which one it protects.

1. Customer wallet balances never go negative.
2. A successful transfer debits and credits exactly the same amount in the same
   currency.
3. The transfer, both ledger entries, both balance updates and the idempotency
   result commit together or not at all.
4. Retrying the same operation cannot move money twice.
5. A user can only transfer from a wallet they own.
6. Users can only view wallets and transfers they are authorised to see.
7. Account restrictions are checked under database locks, inside the transfer
   transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten. Corrections are new
   compensating entries.
10. A timeout does not mean a transfer failed.

**The core transfer is implemented.** The PostgreSQL integration suite exercises
atomicity, idempotency and concurrent requests; this is not a load-test or deployed
availability guarantee.

## Where it stands

Implemented: liveness/readiness, registration, login, JWT authentication, the
caller's wallet, and `POST /transfers`. Prisma owns the seven-table data model and
migrations; Zod validates requests. Transfers claim an idempotency key, lock users
and wallets, check restrictions, and commit the debit, credit, ledger pair and
stored response together.

Next: transfer history, audited admin block/unblock, rate limits, reconciliation,
and deployed verification. There is no live deployment established by this repo.
[WALKTHROUGH.md](WALKTHROUGH.md) explains the request flow and
[DECISIONS.md](DECISIONS.md) records the tradeoffs.

Run commands from `server/`. Auth and transfer HTTP tests create disposable schemas
using DATABASE_URL and remove them afterward. Older schema/seed tests run inside
rollback transactions in the configured application's schema. Do not point test
commands at a production database. Mocked retry tests prove only retry decisions;
real PostgreSQL tests exercise locking and financial writes.

## Running it locally

Needs Node 22.18 or newer, within the 22.x line. Everything runs from `server/`.

```sh
cd server
npm ci
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm run dev              # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs `src/index.ts` with `--watch` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled server |
| `npm test` | Runs all Vitest suites; the database suites need `DATABASE_URL` |
| `npm run test:unit` | Runs only the tests that need no database |
| `npm run migrate` | Applies Prisma migrations |
| `npm run seed` | Seeds demo wallets through Prisma |
| `npm run test:integration` | Runs schema, seed, auth and transfer PostgreSQL tests |

```sh
curl -i http://localhost:3000/health/live
```

returns `200` with `{"status":"ok"}` and an `X-Request-Id` header. It proves the
process answers and nothing more — readiness is a separate endpoint, deliberately,
so a database outage is never reported as a dead process.

A port already in use produces a startup error; stop the other server or set a
different `PORT`.

## Demo credentials

Created by `npm run seed`. Local fixtures, published here deliberately so a reviewer can
sign in without being sent anything.

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

The three customer passwords are reset on every seed run, so the database always matches
this table. Nothing of value is protected by them.

**The admin password is deliberately not in this file.** It is a real credential: it grants
the ability to block and unblock any account, so publishing it here would hand that to
anyone who reads the repository. It comes from `SEED_ADMIN_PASSWORD` and is shared with
reviewers privately.

The seed writes it once and never resets it, because a deployed credential should not change
because somebody ran the seed again. To set or rotate it deliberately:

```sh
SEED_ADMIN_PASSWORD='...' npm run admin:password
```

That command refuses an unset, short or over-long value, refuses to touch a non-admin row,
and verifies the new password by reading it back rather than trusting the write.

An earlier version of this README did publish an admin password, and the deployed database
was seeded with it. It has been rotated. The lesson is recorded rather than quietly fixed:
a credential in a public file is a working credential, not a placeholder.

**Postman:** import [docs/wallet-service.postman_collection.json](docs/wallet-service.postman_collection.json).
Run any Login request first; it stores the token in a `{{token}}` collection variable that
every protected request then uses.

## Repository layout

```
├── server/              The API: Express 5 + TypeScript over PostgreSQL
│   └── src/
│       ├── index.ts         Loads .env, builds the app, mounts routers, listens
│       ├── routes/          One router per resource, wiring only
│       ├── controllers/     One controller per resource, the work
│       ├── middleware/      Request IDs, the error contract, later auth and validation
│       └── models/          Prisma client and repeatable seed operations
├── frontend/            Placeholder; nothing is built there yet
├── docs/                Architecture, domain and API documentation
├── DECISIONS.md         Settled questions, with what was ruled out
├── OPEN-QUESTIONS.md    What is still undecided, and what each question blocks
├── CONTRIBUTING.md      Branches, commits, conventions, and the checks a change must pass
└── WALKTHROUGH.md       The implementation explained file by file, for defending it
```

The API is the contract between `server/` and `frontend/`. The server depends on
nothing in the frontend folder.

## Documentation

| Document | Read it for |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the server is put together, what each layer may do, where the transfer will live |
| [docs/domain.md](docs/domain.md) | What a wallet, transfer and ledger entry are; the rules on money; known versus unknown failures |
| [docs/api.md](docs/api.md) | Every endpoint: success shapes, the error shape, and which status code means what |
| [DECISIONS.md](DECISIONS.md) | Every settled decision, with the reasoning, what was ruled out, and whether it can be undone |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | Empty: every question has been answered, with the options and what each costs |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to make and land a change |
| [server/README.md](server/README.md) | API detail: commands, environment, structure, and what has actually been verified |
| [WALKTHROUGH.md](WALKTHROUGH.md) | A file-by-file walk through the implementation, written to be explained out loud |

Scope comes from the build spec and the development guide. Both live outside this
repository and are excluded by `.gitignore`; where they conflict, the build spec
wins and the conflict is recorded rather than quietly resolved.

## How decisions are recorded

A question raised while building goes into **OPEN-QUESTIONS.md** with its
options, what each costs, and what it blocks. When it is answered it moves to
**DECISIONS.md**, keeping its Q-number, with the reasoning and what was ruled
out. One is open: **[Q32](OPEN-QUESTIONS.md)**, which is the rate limiter keying
on Render's proxy instead of the caller. It is open rather than guessed at
because every available fix needs a number nobody should invent.

The point of keeping the rejected options is that a later reader can tell a
deliberate trade-off from an oversight. Two of the settled ones went against the
obvious answer — [Q2](DECISIONS.md), which cost the test suite, and
[Q5](DECISIONS.md), which went against the build spec's own request for
structured logs. Both say so, and **both have since been reversed** — [Q31](DECISIONS.md)
put `pino` back. Q5 predicted that reversal would be cheap and said why; it was
nine call sites. That is the log earning its keep rather than just recording.

## Deployment

Live on Render, built from `server/` as the root of this monorepo. See
[docs/deployment.md](docs/deployment.md) for the step-by-step and the checks that
prove it is up.

- Secrets (`DATABASE_URL`, `JWT_SECRET`, admin credentials) live in Render
  environment variables, never in the repository.
- Logs are JSON on Render and pretty-printed in a terminal, decided by whether
  stdout is a TTY. `LOG_LEVEL` defaults to `info`, which is one line per request
  carrying the caller's `X-Request-Id`.
- Migrations run as part of the deploy. The seed is run manually, once.
- Render's health check points at `/health/ready`.
- Free web services sleep when idle, so the first request after a pause is slow.
  That is not a bug and the submission should say so.
- **A free Render PostgreSQL database becomes inaccessible 30 days after
  creation**, and the 14-day grace period does not keep it working. That deadline
  is the reason the database is **Neon** and not Render PostgreSQL, so there is no
  expiry date to diary. This is **Q21**.

## Stack

Node 22, Express 5, strict TypeScript, PostgreSQL, and Prisma 7. Zod validates
external input; dotenv loads local configuration; Vitest runs tests. Prisma uses
its pg adapter internally. SQL constraints and future explicit row locks remain
part of the financial design. Q13 supersedes the original pg-only decision.

Read [docs/prisma.md](docs/prisma.md) before migrating an existing database.
Client generation is automatic on install/build; seeding is explicit. Existing
application data is preserved through verified baselining, never a reset.
