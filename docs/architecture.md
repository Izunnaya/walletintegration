# Backend structure

The API uses Express, TypeScript, Prisma and PostgreSQL. Each folder has one job.

| Location | Job |
| --- | --- |
| `app.ts` | Connect middleware and routes without starting a server |
| `index.ts` | Load configuration, check the database and start listening |
| `routes/` | Connect each endpoint to its middleware and controller |
| `controllers/` | Handle HTTP input and responses |
| `services/transferService.ts` | Own the transfer transaction, locks and retries |
| `middleware/` | Identity, roles, validation, limits, CORS and errors |
| `domain/` | Pure rules and Zod schemas |
| `models/` | Prisma client, locking queries, seed data and reports |
| `prisma/` | Database models and migrations |
| `tests/` | Unit, HTTP and PostgreSQL checks |

Read a transfer from the route to the controller, then `transferService.ts`.
The service keeps the financial steps together so a reviewer can see what commits.
Models do not handle HTTP. Domain functions do not read the database.

## Request order

The app sets security headers and disables caching, assigns a request ID, handles
CORS, starts request logging and parses JSON. The body limit is 16 KB. Routers run
next, followed by the not-found and error handlers.

Protected routes verify the token before the per-user limit. Admin routes then
check current permissions. Validation runs before controller work. Login has an IP
limit before validation and account limits after email normalization.

The order matters: preflight requests need no token, malformed JSON still needs a
request ID, and rate-limited requests should not spend an admin database query.

## Transactions

Pass `Prisma.TransactionClient` to every helper inside a transaction. Calling the
shared client from that helper would perform work outside the transaction.

Transfers lock users first and wallets second, in ID order. Restriction changes
lock the acting admin and affected user in the same order, then recheck permission.
Keep commits, locks, balance changes and retries visible in the code.

Use schema-qualified SQL for locks and reconciliation. Prisma handles ordinary
queries. The database also enforces positive transfer amounts, nonnegative customer
balances, unique keys and protection against rewriting financial history.

## Keeping changes simple

Add a folder or helper when it has a clear job. Reuse schemas and pure functions,
but avoid layers that only forward calls. Route files should stay small. Comments
should explain a rule or a surprising choice, not repeat the next line of code.

See [domain.md](domain.md) for the money rules, [decisions.md](decisions.md) for the
reasons behind them and [frontend.md](frontend.md) for the browser application.
