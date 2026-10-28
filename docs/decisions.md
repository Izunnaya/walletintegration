# Architecture decisions

Why the service is built this way, and what each choice costs. Read the relevant entry before
changing one of these. Superseded entries are kept and marked.

## ADR 1. Money is whole kobo in bigint, and a string in JSON

NGN amounts need exact arithmetic. A JSON number is an IEEE 754 double and stops being exact
above the safe integer range.

Money is an integer count of kobo. Stored in `BIGINT`, held as `bigint`, serialized as a
string. `₦1,500.00` is `"150000"`.

Every arithmetic path uses `bigint`, never `Number`. Clients parse the string. Formatting
happens at the edge only.

## ADR 2. READ COMMITTED with explicit row locks, not SERIALIZABLE

Concurrent transfers on the same wallet must not interleave into a wrong balance.

Keep PostgreSQL's default `READ COMMITTED`. Lock the rows a transfer touches.

Correctness is visible in the code instead of depending on the planner raising a serialization
error. The locking becomes the service's responsibility, which is what ADR 3 covers.

## ADR 3. Lock users first, then wallets, each in sorted id order

Two transfers moving money in opposite directions between the same two wallets deadlock if
they lock in different orders.

A transfer locks user rows before wallet rows. Within each group it orders by `id`. Users take
`FOR NO KEY UPDATE`; wallets take `FOR UPDATE`.

Deadlock is prevented by ordering, not detected and retried. Any new query that locks these
tables must use the same order.

`FOR NO KEY UPDATE` on users does not conflict with the `FOR KEY SHARE` the idempotency
record's foreign key takes, so claiming a key and then locking the user cannot self-deadlock.

The ordering comes from one statement that selects users through a subquery on wallets.
PostgreSQL places `LockRows` above the `Sort`, so rows are still locked in ascending id order.
Verified with `EXPLAIN` and covered by a concurrency test that reads
`pg_stat_database.deadlocks`.

## ADR 4. The idempotency record is written inside the transfer transaction

A client retrying after a lost response must not move money twice.

The key is claimed with `INSERT ... ON CONFLICT DO NOTHING` inside the transaction that moves
the money, before the balances change.

The claim and the money commit or roll back together. A failed transfer leaves no claim, so
the key is reusable as a first attempt. A claim that exists always corresponds to a real
outcome. Claiming first in a separate transaction can strand a key against a transfer that
never happened.

## ADR 5. A business rejection is committed as the key's result

An insufficient-funds refusal is an answer, not a system failure.

A rejection is stored against the key with its status code and body, the same as a success.

Retrying returns the same refusal instead of re-running the transfer against a balance that
may have changed. One stable answer per key is what makes a blind retry safe.

## ADR 6. An unconfirmed outcome is a 503, never a failure

If the connection drops after commit, the service cannot tell whether the money moved.

Return `503` with `Retry-After` and an instruction to retry with the same `Idempotency-Key`.

Reporting failure would tell the user money did not move when it may have. The transfer quota
does not count a `503`, because retrying is the documented behavior.

## ADR 7. The request fingerprint catches a reused key

A key replayed with different details must not replay the earlier transfer.

The claim stores a fingerprint of the normalized request. A matching fingerprint replays the
stored answer. A different one is refused `409`.

A `409` can never succeed, so the only route forward is a new key. The UI offers a new transfer
rather than a retry.

## ADR 8. Only successful transfers are stored in `transfers`

The table holds transfers that happened. A rejection lives on the idempotency record.

Any row in `transfers` is money that moved, so reconciliation can sum the table without
filtering. There is no pending or failed state to reason about.

## ADR 9. One system wallet may go negative and cannot be signed into

Money has to enter the system from somewhere.

A single funding wallet is exempt from the non-negative balance constraint. Its owner's
password hash comes from random bytes nobody holds.

The system-wide total still sums to zero: what customers hold is what the funding wallet is
down.

`wallets_single_system` is load-bearing. It is the only thing stopping a customer wallet being
relabeled as the system wallet, which would exempt it from the non-negative constraint and
hide an overdraft.

## ADR 10. Prisma for data access, raw SQL where locking requires it

Row-level lock clauses are not expressible through the query builder.

Prisma owns the schema, migrations and ordinary queries. The locking reads are raw SQL.

Raw SQL resolves unqualified table names through `search_path`, so every raw query qualifies
its schema explicitly. Getting this wrong once meant reconciliation read a different schema
and reported it clean.

## ADR 11. Zod validates every request at the edge

Schemas in `src/domain/` define the accepted shape. Middleware rejects anything else before a
controller runs. Schemas use `strictObject`, so unknown fields are refused rather than ignored.

Types come from `z.infer`, so the validator and the type cannot drift.

Route parameters use the same bounded id schema as request bodies. An unbounded `BigInt()` on a
well-formed but oversized id previously produced a `500` from PostgreSQL.

## ADR 12. Request ids are generated by the server

Correlating a user's report with a log line needs an identifier.

The server generates a UUID per request and returns it in `X-Request-Id` and in every error
body. A client-supplied `X-Request-Id` is ignored.

A caller cannot poison the logs by sending the same id on every request. The id is assigned
before body parsing, so a malformed body still produces a quotable id.

## ADR 13. Every error returns the same envelope

Express's default error handler returns an HTML stack trace.

All errors return `{ error: { code, message, requestId } }`. The code is stable and
machine-readable. The message is for a person. Internals never reach the client.

Clients branch on `code`, not message text, so wording stays free to change. A transient
database failure is classified and returned as `503` rather than `500`.

## ADR 14. A refusal is indistinguishable from absence

Returning `403` for another customer's record confirms the record exists.

A record belonging to someone else returns what a nonexistent id returns: same status, same
code, same message. Only the request id differs.

Ids cannot be enumerated. `403` is still used where the route is the thing being refused
rather than the record.

## ADR 15. Privileged requests re-read role and blocked state

A signed JWT carries whatever role it was issued with.

`requireRole` reads the role and blocked flag from PostgreSQL on every privileged request.

Blocking or demoting an account takes effect immediately instead of when the token expires. It
costs one query per privileged request.

## ADR 16. The service logs JSON. The command-line tools do not

`pino` and `pino-http` for everything in the request path. `console.log` in `reconcile`, `seed`
and `admin:password`.

Structured logging means JSON for output a machine filters and text for output a person reads.
A reconciliation report is an aligned table for an operator at a terminal.

Pretty-printing is chosen by `process.stdout.isTTY`. A terminal gets color; a pipe gets JSON.

The `Authorization` header is redacted and request headers are dropped from the serializer.
`pino-http` logs the full header set by default, which would put bearer tokens in the logs.

Supersedes an earlier decision to use `console` throughout.

## ADR 17. Two login limits, because one cannot do both jobs

Per minute: 60 transfers per caller, 240 reads per caller, 20 auth requests per IP, 10 login
attempts per account and client, 60 login attempts per account, 30 admin requests per caller.

A tight per-account limit on its own stops password guessing and also locks the owner out:
ten wrong passwords a minute from anywhere and the real owner is refused. So the tight limit
is per account and per client. Guessing from one place stays capped. Locking someone out would
mean sending from their own address.

The looser per-account ceiling bounds the bcrypt work one account can be made to do from many
addresses. It sits far above anything a person does.

Transfers do not count a `503`; see ADR 6. The store is in memory, which is correct for one
process and wrong for more than one.

## ADR 18. The admin password is set by its own command

A deployed credential should not change because somebody ran the seed again.

The seed writes the admin password once and never resets it. `npm run admin:password` sets or
rotates it.

The command requires `SEED_ADMIN_PASSWORD`. It refuses a value under twelve trimmed characters
or over 72 bytes, because bcrypt ignores anything past 72. It refuses to touch a non-admin row
and verifies by reading the hash back.

Demo customer passwords are the opposite case: published, and reset on every seed run so the
database matches the documentation.

## ADR 19. Neon rather than Render PostgreSQL

A free Render database becomes inaccessible 30 days after creation.

Use Neon, which has no equivalent expiry. There is no deadline to track.

Tests connect on Neon's direct endpoint, not the pooled one. A pooled connection leaks
`SET search_path` between sessions.

## ADR 20. The repository is public, so a credential in it is a working credential

No credential belongs in any committed file, including seed data, tests, fixtures and
documentation.

This went wrong once. An admin password was published in the README and the live database was
seeded with it. It has been rotated.

Scripts that act on a deployed service are not committed, and require their target and
credentials to be supplied explicitly.

## Superseded

- **One entry file, no separate app module.** The app is built in `app.ts` and started by
  `index.ts`. Splitting them lets integration tests mount the app without binding a port.
- **`console` logging throughout.** Replaced by ADR 16.
- **`trust proxy` fixed at 1.** Replaced by the configurable `TRUST_PROXY_HOPS`. See
  [known-limitations.md](known-limitations.md).
