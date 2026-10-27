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

**The full guarantees are not proven yet.** Migration files, schemas, and pure
rules exist. Proving financial behavior still needs the transaction implementation
and real PostgreSQL concurrency tests.

## Where it stands

The HTTP foundation, seven SQL migrations, migration runner, connection pool
module, Zod schemas, transfer policy, fingerprint helper, and 46 unit tests exist.
The app currently mounts only the health route. Migration execution on a target
database is not established by the existence of those files.

Seeding, readiness, deployment, authentication, wallet endpoints, the atomic
idempotent transfer, history, admin restrictions, rate limits, and reconciliation
remain to be built. [WALKTHROUGH.md](WALKTHROUGH.md) explains the actual files and
limits; Q23?Q27 in [DECISIONS.md](DECISIONS.md) capture recent domain decisions.

`npm test` runs Vitest from `server/`. The earlier HTTP tests described in Q2 were
removed; the current unit suite tests pure behavior without importing the listening
app. Q15 remains open for HTTP/PostgreSQL integration-test access.

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
| `npm test` | Runs Vitest unit tests |
| `npm run migrate` | Applies SQL migrations using DATABASE_URL |

```sh
curl -i http://localhost:3000/health/live
```

returns `200` with `{"status":"ok"}` and an `X-Request-Id` header. It proves the
process answers and nothing more — readiness is a separate endpoint, deliberately,
so a database outage is never reported as a dead process.

A port already in use produces a startup error; stop the other server or set a
different `PORT`.

## Repository layout

```
├── server/              The API: Express 5 + TypeScript over PostgreSQL
│   └── src/
│       ├── index.ts         Loads .env, builds the app, mounts routers, listens
│       ├── routes/          One router per resource, wiring only
│       ├── controllers/     One controller per resource, the work
│       ├── middleware/      Request IDs, the error contract, later auth and validation
│       └── models/          The pg connection pool; feature queries will follow
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
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | The five questions still open, with the options and what each costs |
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
out. Eighteen are settled; five are open.

The point of keeping the rejected options is that a later reader can tell a
deliberate trade-off from an oversight. Two of the settled ones went against the
obvious answer — [Q2](DECISIONS.md), which cost the test suite, and
[Q5](DECISIONS.md), which went against the build spec's own request for
structured logs. Both say so.

## Deployment

Not deployed yet. The plan, with the trap that matters:

- Secrets (`DATABASE_URL`, `JWT_SECRET`, admin credentials) live in Render
  environment variables, never in the repository.
- Migrations run as part of the deploy. The seed is run manually, once.
- Render's health check points at `/health/ready`.
- Free web services sleep when idle, so the first request after a pause is slow.
  That is not a bug and the submission should say so.
- **A free Render PostgreSQL database becomes inaccessible 30 days after
  creation**, and the 14-day grace period does not keep it working. The creation
  and expiry dates go in this README the day it is created. If the review window
  could reach the expiry, the database is upgraded — a README warning does not
  satisfy "a live URL we can hit". This is **Q21**.

## Stack

Node 22, Express 5, TypeScript (strict), PostgreSQL. `dotenv` for configuration.
`pg` rather than an ORM, because the transfer needs `SELECT ... FOR UPDATE` with
a specific lock order ([Q13](DECISIONS.md)).

Two runtime dependencies, three development dependencies. Every one of them is
explainable in a sentence, which is the test applied before adding another.
