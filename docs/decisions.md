# Architecture decisions

The design choices behind this service, why they were made, and what they cost. Each entry
is written so you can tell a deliberate trade-off from an oversight before you change it.

Superseded entries are kept and marked rather than deleted.

---

## ADR 1 — Money is whole kobo in `bigint`, and a string in JSON

**Context.** NGN amounts need exact arithmetic. A JSON number is an IEEE 754 double, so a
large enough balance stops being exact once it crosses the safe integer range.

**Decision.** Money is an integer count of kobo, stored in `BIGINT`, held in JavaScript as
`bigint`, and serialised in JSON as a **string**. `₦1,500.00` is `"150000"`.

**Consequences.** Every arithmetic path uses `bigint` and never `Number`. Clients must parse
the string rather than letting a JSON parser produce a float. Formatting for display happens
at the edge; nothing does arithmetic on a formatted value.

---

## ADR 2 — `READ COMMITTED` with explicit row locks, not `SERIALIZABLE`

**Context.** Concurrent transfers against the same wallet must not interleave into a wrong
balance.

**Decision.** Keep PostgreSQL's default `READ COMMITTED` and take explicit row locks on the
rows a transfer touches.

**Consequences.** Correctness is visible in the code — you can read which rows are locked —
rather than relying on the planner to detect a conflict and raise a serialisation error. The
cost is that the locking is now the service's responsibility, so ADR 3 matters.

---

## ADR 3 — Locks are taken users first, then wallets, each in sorted id order

**Context.** Two transfers moving money in opposite directions between the same pair of
wallets will deadlock if they lock the same rows in a different order.

**Decision.** A transfer locks user rows before wallet rows, and within each group it orders
by `id`. Users take `FOR NO KEY UPDATE`; wallets take `FOR UPDATE`.

**Consequences.** Deadlock is prevented by ordering rather than detected and retried. Any new
query that locks these tables must use the same order. `FOR NO KEY UPDATE` on users is
deliberate: it does not conflict with the `FOR KEY SHARE` that the idempotency record's
foreign key takes, so claiming a key and then locking the user cannot self-deadlock.

The ordering now comes from a single statement that selects users through a subquery on
wallets. PostgreSQL applies `LockRows` above the `Sort`, so rows are still locked in
ascending id order — verified with `EXPLAIN`, and covered by a concurrency test that watches
`pg_stat_database.deadlocks`.

---

## ADR 4 — The idempotency record is written inside the transfer transaction

**Context.** A client that retries after a lost response must not move money twice.

**Decision.** The key is claimed with `INSERT ... ON CONFLICT DO NOTHING` **inside** the same
transaction that moves the money, before the balances change.

**Consequences.** The claim and the money commit or roll back together, so a failed transfer
leaves no claim behind and the key is reusable as a first attempt. A claim that exists always
corresponds to a real outcome. The alternative — claiming first in its own transaction — can
strand a key against a transfer that never happened.

---

## ADR 5 — A business rejection is committed as the key's result

**Context.** An insufficient-funds refusal is an answer, not a failure of the system.

**Decision.** A rejection is stored against the idempotency key with its status code and
body, the same as a success.

**Consequences.** Retrying the same key returns the same refusal rather than re-running the
transfer against a balance that may since have changed. The caller gets one stable answer per
key, which is what makes a retry safe to issue blindly.

---

## ADR 6 — An outcome that cannot be confirmed is reported as `503`, never as a failure

**Context.** If the service loses its connection after committing, it cannot tell whether the
money moved.

**Decision.** Return `503` with `Retry-After` and an instruction to retry **with the same
Idempotency-Key**. Never report a failure when only the answer was lost.

**Consequences.** This is the reason the idempotency design exists. Reporting failure would
tell the user money did not move when it may have. The transfer quota does not count a `503`
against the caller, because retrying is the documented behaviour rather than abuse.

---

## ADR 7 — The request fingerprint identifies the details, so a reused key is caught

**Context.** A key replayed with different details must not replay the earlier transfer.

**Decision.** The claim stores a fingerprint of the request. A repeat with a matching
fingerprint replays the stored answer; a repeat with a different one is refused `409`.

**Consequences.** A `409` can never succeed, so the client's only route forward is a new key.
The UI reflects that: it offers a new transfer rather than a retry.

---

## ADR 8 — Only successful transfers are stored in `transfers`

**Context.** A rejected transfer could be stored with a status, or not stored at all.

**Decision.** The `transfers` table holds transfers that happened. A rejection lives on the
idempotency record.

**Consequences.** Any row in `transfers` is money that moved, so reconciliation can sum the
table without filtering. There is no "pending" or "failed" state to reason about.

---

## ADR 9 — One system wallet may go negative, and nothing can sign into it

**Context.** Money has to enter the system from somewhere.

**Decision.** A single funding wallet is exempt from the non-negative balance constraint. Its
owner's password hash is derived from random bytes nobody holds.

**Consequences.** The system-wide total still sums to zero: what customers hold is exactly
what the funding wallet is down. `wallets_single_system` is load-bearing — it is the only
thing stopping a customer wallet being relabelled as the system wallet, which would exempt it
from the non-negative constraint and hide an overdraft.

---

## ADR 10 — Prisma for database access, with raw SQL where locking requires it

**Context.** The service needs a typed data layer, but row-level lock clauses are not
expressible through the query builder.

**Decision.** Prisma owns the schema, migrations and ordinary queries. The locking reads are
raw SQL.

**Consequences.** Raw SQL resolves unqualified table names through `search_path`, so **every
raw query qualifies its schema explicitly**. Getting this wrong once meant reconciliation
read a different schema and reported it clean.

---

## ADR 11 — Zod validates every request at the edge

**Context.** Input validation could live in controllers, in the domain, or in a schema layer.

**Decision.** Zod schemas in `src/domain/` define the accepted shape, and middleware rejects
anything else before a controller runs. Schemas use `strictObject`, so unknown fields are
refused rather than ignored.

**Consequences.** Types come from `z.infer`, so the validator and the type cannot drift. Route
parameters use the same bounded id schema as request bodies — an unbounded `BigInt()` on a
well-formed but oversized id previously produced a `500` from PostgreSQL.

---

## ADR 12 — Server-generated request IDs, never read from the caller

**Context.** Correlating a user's report with a log line needs an identifier.

**Decision.** The server generates a UUID per request and returns it in `X-Request-Id` and in
every error body. A client-supplied `X-Request-Id` is ignored.

**Consequences.** A caller cannot poison the logs by sending the same id on every request.
The id is assigned before body parsing, so a malformed body still produces a quotable id.

---

## ADR 13 — Every error returns the same envelope

**Context.** Express's default error handler returns an HTML stack trace.

**Decision.** All errors return `{ error: { code, message, requestId } }`. The code is stable
and machine-readable; the message is for a person. Internals never reach the client.

**Consequences.** Clients branch on `code`, not on message text, so wording stays free to
change. A transient database failure is classified and returned as `503` rather than `500`,
so a client knows retrying is reasonable.

---

## ADR 14 — Refusals are indistinguishable from absence

**Context.** Returning `403` for another customer's record confirms the record exists.

**Decision.** A record belonging to someone else returns exactly what a nonexistent id
returns — same status, same code, same message. Only the request id differs.

**Consequences.** Ids cannot be enumerated. `403` is still used where the route, not the
record, is the thing being refused: the caller is known and the route exists.

---

## ADR 15 — Privileged requests re-read the current role and blocked state

**Context.** A signed JWT carries whatever role it was issued with.

**Decision.** `requireRole` reads the role and blocked flag from PostgreSQL on every
privileged request rather than trusting the token claim.

**Consequences.** Blocking or demoting an account takes effect immediately instead of when
the token expires. It costs one query per privileged request, which is the price of
revocation that does not depend on token lifetime.

---

## ADR 16 — The service logs JSON; the command-line tools do not

**Context.** The brief asks for structured logs carrying a request ID.

**Decision.** `pino` and `pino-http` for everything in the request path. `console.log` stays
in `reconcile`, `seed` and `admin:password`.

**Consequences.** Structured logging is JSON for output a machine filters and text for output
a person reads. A reconciliation report is an aligned table for an operator at a terminal;
JSON would make its only audience worse off. Pretty-printing is chosen by
`process.stdout.isTTY`, so a terminal gets colour and a pipe gets JSON with nothing
configured.

The `Authorization` header is redacted and request headers are dropped from the serialiser —
`pino-http` logs the full header set by default, which would put bearer tokens in the logs.

**Supersedes** an earlier decision to use `console` throughout.

---

## ADR 17 — Rate limits, and why each number is what it is

**Context.** The service must resist abuse without refusing a reviewer demonstrating
concurrency.

**Decision.** Five limits, all per minute: transfers 60 per caller; reads 240 per caller;
auth 20 per IP; login 10 per account **and** client; login 60 per account overall; admin 30
per caller.

**Consequences.** The two login limits do different jobs. A tight per-account limit alone
hands anyone who knows your email address a lockout: ten wrong passwords a minute and the
real owner is refused. Making the tight limit per account *and* per client means guessing
from one place is capped while locking somebody out would require sending from their own
address. The looser per-account ceiling caps total bcrypt work across many addresses.

Transfers do not count a `503` — see ADR 6. The store is in memory, which is correct for one
process and wrong for more than one.

---

## ADR 18 — The admin password is set by its own command and never published

**Context.** The seed writes the admin account. A deployed credential should not change
because somebody ran the seed again.

**Decision.** The seed writes the admin password once and never resets it. `npm run
admin:password` is the deliberate path for setting or rotating it.

**Consequences.** The command requires the variable, refuses a value under twelve trimmed
characters or over 72 **bytes** — bcrypt silently ignores anything past 72 — refuses to touch
a non-admin row, and verifies by reading the hash back.

Demo customer passwords are the opposite case on purpose: published, and reset on every seed
run so the database always matches the documentation.

---

## ADR 19 — Neon rather than Render PostgreSQL

**Context.** A free Render database becomes inaccessible 30 days after creation.

**Decision.** Use Neon, which has no equivalent expiry.

**Consequences.** There is no deadline to diary, and the database outlives any review window.
Tests connect on Neon's **direct** endpoint, not the pooled one — a pooled connection leaks
`SET search_path` between sessions.

---

## ADR 20 — The repository is public, and a credential in it is a real credential

**Context.** The repository is readable by anyone.

**Decision.** No credential belongs in any committed file, including seed data, tests,
fixtures and documentation.

**Consequences.** This went wrong once: an admin password was published in the README and the
live database was seeded with it. It was rotated. Scripts that act on a deployed service
require their target and credentials to be supplied explicitly, with no defaults.

---

## Superseded

- **One entry file, no separate app module.** The app is now built in `app.ts` and started by
  `index.ts`. Splitting them lets integration tests mount the app without binding a port.
- **`console` logging throughout.** Replaced by ADR 16.
- **`trust proxy` fixed at 1.** Replaced by the configurable `TRUST_PROXY_HOPS`; see
  [known-limitations.md](known-limitations.md).
