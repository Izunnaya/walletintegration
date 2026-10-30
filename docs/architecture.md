# Backend structure

I use routes, controllers, services, middleware, domain functions and database
helpers. Each layer has a specific job. The transfer service keeps the financial
transaction visible instead of distributing its writes across unrelated helpers.

## Finding the code

| Location | Responsibility |
| --- | --- |
| `app.ts` | Set up middleware and mount routers without starting a listener |
| `index.ts` | Load configuration, check the database and start the server |
| `routes/` | List endpoints, their middleware and controller functions |
| `controllers/` | Read validated input and build HTTP responses |
| `services/transferService.ts` | Run the transfer transaction, locks and retries |
| `middleware/` | Identity, roles, validation, limits, CORS and error handling |
| `domain/` | Request schemas and pure financial rules |
| `models/` | Prisma setup, SQL locks, seed operations and reports |
| `prisma/` | Models, migrations, constraints and history protection |
| `tests/` | Unit, HTTP, concurrency and database checks |

`app.ts` and `index.ts` are separate so tests can import the Express app without
also starting the deployed entry point. At startup I check the database before
accepting requests. A database handshake should not be the first customer's job.

## Following a request

The app sets security headers and disables caching, assigns a request ID, handles
CORS, starts request logging and parses JSON. Routers run next. The not-found
handler and error handler come last.

This order has practical effects. Preflight requests need an answer without a
bearer token. Malformed JSON still needs a request ID and a consistent error.
The 16 KB body cap stops the parser accepting a body much larger than any supported
wallet operation needs.

Protected routes verify identity before using a per-user limit. Admin routes apply
the limit before their role query, so repeated forbidden requests do not receive
unlimited database work. Login applies an IP limit first, validates and normalizes
email, then applies the account limits.

Validation middleware puts parsed data in `res.locals`. A controller uses that
value rather than interpreting raw input again. Unexpected errors reach the shared
handler, which keeps server details out of the response.

## Following a transfer

`TransferRoute` verifies the token, applies the limit, validates the key and body,
then calls `TransferController`. The controller passes the caller and parsed details
to `createTransfer`.

The service opens the transaction, resolves wallet IDs, claims the key, locks users
and wallets, checks policy and writes the result. `checkTransferPolicy` is pure:
it decides from supplied values. The service is responsible for making those values
current by reading them under locks.

Every operation inside the transaction receives the same
`Prisma.TransactionClient`. Calling the shared client from a helper would put that
query outside the transaction. I keep the commit, balance updates, locks and retry
loop easy to find because those are the parts that protect the money.

## Following a restriction change

Admin middleware checks current access before the controller runs. The transaction
locks both the admin and target in ID order, then rechecks the admin's role and block
status. This closes the gap where permission changes while the request is waiting.
The target change and audit row commit together.

Transfers lock those same user rows before wallets, so a restriction cannot change
halfway through a transfer decision. A repeated block on an already-blocked account
returns the current state without another audit entry.

## Database and application rules

I use Prisma for ordinary queries and SQL for explicit locks and reconciliation.
Raw SQL qualifies its schema. The database adds checks for nonnegative customer
balances, positive amounts, unique keys and financial history that cannot be updated
or deleted through ordinary writes.

These checks support the application rules; they do not replace them. A valid
foreign key does not prove a caller owns a wallet, for example. Ownership and current
restrictions still belong in the transfer transaction.

## Keeping the structure maintainable

A route file stays focused on wiring. Models do not know about HTTP, and domain
functions do not read the database. I extract a helper when it makes a real rule
clearer or removes repeated work. I avoid extra layers whose only job is forwarding.

The detailed reasoning is in [server-decisions.md](server-decisions.md).
[domain.md](domain.md) walks through the account and money rules, and
[frontend.md](frontend.md) explains how the UI calls them.
