# Decisions

## Q28 - Seed reporting cannot roll back committed data

**Prisma update:** the original implementation below used manual BEGIN/COMMIT.
Prisma now owns commit and rollback through `$transaction`. The report remains
outside the transaction. A rejected transaction promise reports possible outcome
uncertainty; mocked command tests do not prove a rollback. See Q13 and docs/prisma.md.


**Decided:** separate write, commit, and reporting failure handling in
`server/src/seed.ts`. A failure while applying the seed attempts rollback. A
commit error reports an unacknowledged outcome without claiming rollback. After
an acknowledged commit, report failures explicitly state that the changes are
saved and suggest rerunning the repeatable seed to print the report.

**Reason:** the old shared catch attempted rollback even if a report failed
after commit. A rollback at that point cannot undo saved data and gives the wrong
impression of the financial result. This protects invariant 10: losing an
acknowledgement does not establish failure.

**Trade-off:** reporting failure still sets exit status 1, while its message
distinguishes that from a write failure. Operators must read that outcome rather
than interpreting every nonzero exit as no changes saved. Automatic retries and
generic transaction wrappers were unnecessary for this correction.

**Evidence:** four focused mocked command tests cover successful commit before
reporting, write failure/rollback, reporting failure after commit, and commit
acknowledgement loss. These establish control flow and messages, not PostgreSQL
atomicity or crash behavior. Existing funding references and database constraints
continue to provide seed repeatability; this change does not alter them.

Settled questions, with the reasoning behind them. Each entry says what was
ruled out as well as what was chosen, so a later reader can tell a deliberate
trade-off from an oversight.

Questions keep their number when they move here from
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Any of these can be overruled — the cost
of doing so is noted in each.

---

## Q1 — Money is whole kobo in `bigint`, and a string in JSON

**Decided:** every amount is an integer count of kobo. It is parsed and
calculated as `bigint`, stored as PostgreSQL `BIGINT`, and serialised to JSON as
a string. `"150000"` means NGN 1,500. No value ever passes through a JavaScript
`number`.

Floating point cannot represent `0.1` exactly. The error is tiny on one sum and
compounds across thousands of transfers, which in a wallet is real money that
does not reconcile. Whole kobo in an integer is exact, and a balance is then the
plain sum of its ledger entries rather than an approximation of it.

The string in JSON is the part that is easy to get wrong. JSON numbers are IEEE
doubles, so a `bigint` large enough to matter loses precision the moment it is
written as a number — silently, on the way out, after all the careful arithmetic.
A string crosses the wire intact.

The cost is that callers handle strings, and every arithmetic path has to resist
the convenience of `Number()`. Naming carries the unit — `amountMinor`,
`senderBalanceMinor` — so a mixed-unit bug is visible at the call site.

**Ruled out:** decimals or floats for money; naira as a fractional value; JSON
numbers for amounts.
**Reversible:** no. This is the storage unit and the wire format; changing it
later is a migration plus a breaking API change.

## Q2 — One entry file; there is no separate app module

**Decided:** `server/src/index.ts` loads the environment, builds the Express app,
mounts the routers and listens. There is no `app.ts` that exports an app without
a listener.

An earlier version split the two, on the standard argument that a test can then
drive the app without binding a port. That is true, and it is why the split is
the usual Express convention. It was rejected anyway: one entry file is the shape
used in the earlier projects here, and the person who has to explain this code
should not have to explain an extra file first.

**What it cost, stated plainly.** Eleven passing tests were deleted. `supertest`
needs an app it can import without starting a server, and nothing can import
`index.ts` without `app.listen` running. The HTTP behaviour that those tests
covered — the error envelope, request ID uniqueness, the 404 and both 500 paths —
is now verified by hand and recorded in [WALKTHROUGH.md](WALKTHROUGH.md) rather
than by a command anyone can run.

That trade is affordable now, with one endpoint that touches nothing. It stops
being affordable at the transfer, where the build spec's definition of done
requires integration tests for concurrent overspending, duplicate idempotency
keys and the block-versus-transfer race. How those tests reach the app is
**Q15**, still open.

**Ruled out:** `index.ts` plus `app.ts`, which is the conventional answer and the
one that keeps tests cheap.
**Reversible:** yes, cheaply — the split is a file move and an export.

## Q3 — Request IDs are generated by the server, never read from the caller

**Decided:** `attachRequestId` generates a UUID for every request, puts it on
`req.requestId` and returns it in `X-Request-Id`. An inbound `X-Request-Id` is
ignored.

The build spec's error format is `{ error: { code, message, requestId } }`. The
point of that field is that a client whose transfer failed can quote one value
and have it lead straight to the log line describing what actually happened.
That only works if the value is unique and ours.

Accepting the caller's value breaks both halves. A client could send the same ID
on every request, collapsing the whole log into one apparent conversation, or put
crafted text in it and have it written into our records.

A UUID rather than a counter, because a counter restarts at 1 on every deploy:
the same ID would describe different requests a week apart, and two instances
would hand out the same numbers at the same time.

**Ruled out:** honouring an inbound `X-Request-Id` for end-to-end tracing, which
would matter if this sat behind other services and does not today; a per-process
counter.
**Reversible:** yes, one middleware.

## Q4 — An unexpected failure returns the error envelope, not Express's default

**Decided:** `respondInternalError` is registered last and answers any thrown or
rejected error with `500` and
`{ error: { code: "INTERNAL_ERROR", message, requestId } }`. The real error goes
to the log with the request ID. The client gets neither the message nor the
stack.

Without it Express answers a thrown error with an HTML page containing the
exception message, the full stack and absolute filesystem paths. That was
verified rather than assumed:

```
/boom -> 500 text/html
<pre>Error: sensitive internal detail
    at C:\Users\MichaelUgorji\Desktop\Projects\Lendsqr\...
```

Setting `NODE_ENV=production` only replaces the stack with
`<pre>Internal Server Error</pre>` — still HTML, still not the documented
contract. So the choice is not between this and a safe default; it is between
this and leaking.

Two details that look like noise and are not. The function takes four arguments
because that is how Express recognises an error handler; a three-argument version
is treated as ordinary middleware and never receives errors. And it checks
`res.headersSent` first, because once a response has begun its status and headers
are gone, so handing the error back to Express to destroy the connection is the
only honest outcome left.

**Ruled out:** per-controller try/catch alone, which is still wanted but cannot
catch what it does not wrap; relying on `NODE_ENV=production` to hide internals.
**Reversible:** yes, but there is no reason to.

## Q5 — Logging is `console`, not a logging library

**Decided:** `console.log` on startup and `console.error` in the error handler,
which records the request ID, the path and the real error.

`pino` and `pino-http` were in place and were removed. They were better on the
merits — JSON by default, a child logger per request carrying the ID, automatic
request logging — and the build spec does ask for structured JSON logs with a
request ID. They went because the standard for this project is the earlier
backend here, which uses `console`, and because the person defending this code
should not have to defend a dependency he did not choose.

**The limitation, honestly.** Log lines are not machine-parseable JSON, there is
no automatic per-request line, and there is no redaction helper for when
authentication arrives. The rule for that, enforced by review rather than by
code, is that no password and no token is ever logged.

This is the one decision here that the build spec argues against. It is recorded
so that if a reviewer presses on structured logging, the answer is that it was a
deliberate choice about who maintains the code, not an oversight.

**Ruled out:** `pino` with `pino-http`; a hand-written JSON log helper, which was
also tried and was worse than both.
**Reversible:** yes, cheaply, and the call sites are few.

## Q6 — `.env` is loaded by `dotenv`

**Decided:** `dotenv` is a dependency and `dotenv.config()` runs at the top of
`index.ts`.

Node 22 can load an env file natively with `--env-file-if-exists`, which needs no
dependency. It was rejected because it puts a flag on every script and ties the
project to a Node version, and because `dotenv` needs no explanation to anyone
reading the code.

`dotenv` loads; it does not validate. `PORT` is read with a default of `3000`.
When `DATABASE_URL` and `JWT_SECRET` arrive, `index.ts` checks they are present
and exits if not, because a service that starts without them fails every request
while looking healthy.

On Render nothing is loaded at all: the variables come from the dashboard
straight into the process environment, and no `.env` file exists.

**Ruled out:** Node's `--env-file-if-exists`; a config module that validates
every variable, which was written and removed as a file that earned nothing at
one variable.
**Reversible:** yes.

## Q7 — Only successful transfers are stored in `transfers`

**Decided:** the `transfers` table holds movements that happened. A rejection —
insufficient funds, a restricted account — is recorded on the idempotency record
and in the logs, never as a transfer row. There is no `pending` state and no
transfer state machine.

The table is the financial history, and its value comes from every row being
money that moved. Mixing attempts into it means every later query, every total
and every reconciliation has to remember to filter, and one that forgets reports
a number that is wrong rather than merely incomplete.

Nothing is lost by it. The idempotency record already has to store the outcome of
every claimed key so a retry can be answered, so the rejection is durable and
replayable without the transfer table carrying it.

**Ruled out:** a status column with pending, failed and succeeded rows; a
separate attempts table, which is the idempotency record under another name.
**Reversible:** no, once there is data. Rejections that were never stored as rows
cannot be recovered into them.

## Q8 — `READ COMMITTED` with explicit row locks, not `SERIALIZABLE`

**Decided:** the transfer runs in a `READ COMMITTED` transaction and takes
explicit `SELECT ... FOR UPDATE` locks on the rows it touches before reading any
balance.

The danger is two requests spending the same money. A wallet holds NGN 10,000 and
two requests each send NGN 8,000; if both read the balance before either writes,
both see 10,000, both pass the check, and the wallet ends at minus 6,000. Taking
the row lock before the read makes the second request wait, read 2,000, and be
rejected.

`SERIALIZABLE` would also be correct. It was rejected because it aborts
transactions under contention and pushes retry logic into every write path,
trading a predictable wait for an unpredictable failure. Explicit locks make the
contention visible in the code that causes it.

A balance check in application code cannot provide this, however carefully
written. Only the lock can, which is why the policy functions take a balance and
decide, and the transfer service is what obtains that balance under lock.

**Ruled out:** `SERIALIZABLE` isolation; optimistic concurrency with a version
column and a retry loop; checking the balance before opening the transaction.
**Reversible:** yes in principle, but every test of the transfer is written
against this behaviour.

## Q9 — Locks are taken users first, wallets second, each in sorted id order

**Decided:** every operation that locks rows locks user rows before wallet rows,
and within each kind in ascending id order. Transfers, block and unblock all
follow it.

Two transfers in opposite directions are the case that forces this. A to B and B
to A, each locking its own sender first, leaves each holding what the other needs
and neither able to continue — a deadlock, resolved only by the database killing
one. Sorting by id means both reach for the same row first, so one waits and the
other proceeds.

Users before wallets gives the admin operations a defined relationship with
transfers. Blocking a user and transferring from their wallet both need that
user's row, so they serialise: a block that commits first causes the transfer to
be rejected, and a transfer that takes the lock first completes before the block
applies. Either is correct; what matters is that neither interleaves.

Wallet ownership cannot change, but it is revalidated after the locks are taken
anyway, because a check made before a lock is a check made against a value that
could already have moved.

**Ruled out:** locking in the order the wallets appear in the request; a single
table-level lock, which would serialise every transfer in the system; retrying on
deadlock without an ordering rule, which treats a design problem as a transient
one.
**Reversible:** no, in the sense that it has to hold everywhere at once to hold
at all. Adding one query that locks in a different order reintroduces the
deadlock.

## Q10 — The idempotency record is written inside the transfer transaction

**Decided:** the key is claimed with `INSERT ... ON CONFLICT DO NOTHING` as the
first statement of the same transaction that moves the money, under a configured
`lock_timeout`.

A key written in its own earlier transaction would be visible to other requests
while the transfer was still in flight. A duplicate arriving in that window would
see a claimed key with no stored result and have nothing true to say: the first
request may still commit, or may roll back.

Inside the transaction the database does the coordination. A concurrent duplicate
blocks on the unique index until the first transaction finishes, then either
reads the committed result or — if the first rolled back — claims the key and
runs. If the wait exceeds the timeout, the waiter rolls back and returns a
retryable response telling the client to reuse the same key, which is true in
every case.

**Ruled out:** claiming the key in a prior transaction; an in-memory set of
in-flight keys, which would be wrong across restarts and across instances; a
`pending` status on the record, which is the same visibility problem with extra
states.
**Reversible:** no. Everything about how a retry is answered depends on this.

## Q11 — A business rejection is committed as the key's result

**Decided:** insufficient funds, a blocked sender, a blacklisted recipient — each
is stored on the idempotency record and committed, with no balance change.
Retrying with the same key returns the same rejection.

The alternative is to roll back and leave the key unclaimed, so a retry runs the
transfer again. That sounds harmless and is not: it makes "retry with the same
key" mean two different things depending on why the first attempt failed, and the
client cannot tell which it is holding.

A rejection is a real, deterministic answer to the intent the key names. Topping
up and trying again is a *new* intent, and needs a new key. That keeps the rule
the client has to understand down to one sentence: the same key always returns
the same answer.

**Ruled out:** rolling back on rejection; storing rejections only in logs.
**Reversible:** no, once clients depend on it.

## Q12 — One system wallet may go negative, and nothing can reach it

**Decided:** `wallets` carries `is_system BOOLEAN NOT NULL DEFAULT FALSE` and the
constraint `CHECK (balance >= 0 OR is_system = TRUE)`. Exactly one wallet has the
flag, created by the seed script, and it is the source of every demo balance.

Demo money has to come from somewhere, and the honest options are to write
balances directly into customer wallets or to move them from a wallet allowed to
be overdrawn. Writing them directly breaks the invariant that every balance
change has matching ledger entries, on the very data a reviewer will inspect
first. Funding from a system wallet means each demo balance arrives through a real
transfer with real ledger rows.

The flag is dangerous, so it is fenced: no endpoint reads it from a request, no
endpoint can create or modify it, registration always creates customer wallets,
and a customer transfer naming the system wallet on either side is rejected.
Only the seed uses it.

The database constraint is the point of the design. Even with a bug in the
application, Postgres refuses to store a negative customer balance.

**Ruled out:** seeding balances with direct `UPDATE`s; allowing any wallet to go
negative with an overdraft limit; a separate ledger-only funding entry with no
counterparty.
**Reversible:** no. It is a column, a constraint and the shape of the seed.

## Q13 - Prisma for database access (supersedes the original pg-only choice)

**Updated at the user's request:** use Prisma 7 for model definitions, generated
client types, database queries, migrations, and seed transaction orchestration.
The original choice was direct pg and handwritten SQL to keep constraints and
locks visible. Prisma can preserve both by retaining custom SQL in migrations and
using parameterized raw queries inside its interactive transactions where needed.

Routine seed operations now use Prisma delegates; every transactional helper
receives `Prisma.TransactionClient`. The transaction remains visible at the call
site. Future locks must still follow users-first, wallets-second order and use the
transaction client. An ORM is not a substitute for lock ordering or idempotency.

The initial Prisma SQL migration preserves the original seven migrations,
including all CHECK constraints and the partial system-wallet index. The old SQL
files are archived, not executed by the CLI. Existing databases require verified
baselining; no data reset is part of adopting Prisma. See [docs/prisma.md](docs/prisma.md).

**Cost:** generated client files, an ORM dependency, and raw SQL for unsupported
constraints and explicit locks. `pg` remains the PostgreSQL adapter's underlying
driver and is used directly by constraint tests, not application persistence code.
The earlier claim that Prisma cannot preserve SQL financial constraints was too
strong; preserving them requires reviewed custom migration SQL.

**Reversible:** possible, but query code, transaction tests, and migration ownership
would need another deliberate migration. No financial schema change is implied.

## Q14 — The repository is split into `server/` and `frontend/`

**Decided:** the API lives in `server/`, with `frontend/` a placeholder holding
only a README. All npm commands run from `server/`.

A frontend is planned but not started. Making room for it now costs one directory
move and keeps the API's own dependencies and scripts to itself; retrofitting it
later would move every path in the documentation a second time.

The API is the contract between the two. The server does not depend on anything
in `frontend/`, and `frontend/README.md` records the two things a frontend will
have to honour — the request ID returned on every response, and money as a string
of kobo — so they are not rediscovered.

**Ruled out:** a flat repository with the API at the root; two separate
repositories, which would split the history of one product.
**Reversible:** yes, a directory move.

## Q22 — The repository is public

**Decided:** public, and it stays public. Verified rather than assumed —
`repos/Izunnaya/walletintegration` reports `private=false`.

A reviewer opens the link and reads the code with no account, no invitation and
no extra step. For a take-home that is the whole point: friction in getting to
the work counts against the work.

It is only a safe answer because nothing in the repository needs protecting, and
that was checked before the first push rather than afterwards. Across the entire
history — every commit, not just the current files — the build spec and the
development guide were never committed, `.env` was never committed at either
path, and `server/.env.example` holds only `PORT=3000`. The `.gitignore`
excluded the two guidance documents from the very first commit.

The consequence worth being deliberate about: [DECISIONS.md](DECISIONS.md) and
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) are readable by anyone with the link.
That is an argument for keeping them honest rather than for hiding them — a
decision record that admits [Q2](#q2--one-entry-file-there-is-no-separate-app-module)
cost the test suite reads better than one that omits it. But it does mean a
half-written entry is public too, so an entry lands finished or not at all.

When secrets do arrive they live in Render environment variables, never in the
repository, and that rule does not change with visibility.

**Ruled out:** private with the reviewer invited, which adds a step and gains
nothing while there is nothing to protect.
**Reversible:** yes, instantly, in the repository settings. What a force-push
cannot reverse is anything already published, which is why the history was
audited before it was pushed rather than after.

---

**Later correction to Q22's security observation:** the current `.env.example`
was found to contain a credential-bearing hosted database URL during this review.
It has been replaced with a local placeholder. The earlier audit statement above
is historical, not an assurance about subsequent commits. The exposed credential
needs rotation; replacing a file does not remove it from existing history. Remote
exposure was not re-audited in this documentation pass.

## Q23 ? Zod owns amount and request validation directly

**Decided:** `amountMinorSchema` validates a trimmed digit string, converts directly to
`bigint`, and enforces positivity and the existing cap. `currencySchema` defines NGN.
`transferRequestSchema` composes them, rejects unknown fields, and supplies its inferred
output type. Both schemas are in the current code.

`parseAmountMinor`, `AmountParseResult`, and `AmountRejection` were removed at the user's
request. Their switch mapped Zod issues into a second result format without adding a
rule. Callers now consume `safeParse`'s success/data or error/issues directly. A loop
would not simplify selecting one outcome; returning from a `forEach` callback would not
return from the enclosing function.

**Cost and limitation:** callers use Zod's error model. The validation middleware still
needs an explicit handoff of parsed output when the transfer controller is implemented;
currently it validates and calls next without replacing the raw body. This decision does
not settle Q16: the existing NGN 10,000,000 cap was preserved, not newly approved.

**Ruled out:** handwritten checks duplicated beside the schema; a second parser-result
adapter; number coercion for money. **Reversible:** callers could adopt a new result
contract later, but there is no current need for one.

## Q24 ? Transfer eligibility remains explicit business logic

**Decided:** keep `TransferPolicyInput`, `TransferPolicyResult`, `TransferRejection`, and
the ordered conditions in `checkTransferPolicy`. These describe its actual business
inputs and outcome; they are not duplicate representations of a Zod validation result.
Ownership is checked first, followed by wallet/restriction/currency/funds rules.

Zod validates request shape and amounts. Policy operates on supplied account and wallet
state. Keeping the conditions visible makes rejection precedence reviewable and keeps
unauthorized callers from learning restriction or balance details through later reasons.

**Cost and limitation:** policy assumes a validated positive amount and party records
associated with the supplied wallets. It cannot guarantee fresh balances or restrictions.
The future transaction must obtain the correct state under locks. Unit tests prove
supplied-state decisions, not concurrency safety.

**Ruled out:** replacing policy with Zod refinements merely to remove if statements.
**Reversible:** yes, provided ordering and rejection behavior remain deliberate.

## Q25 ? The fingerprint identifies request details for safe retries

**Decided:** retain SHA-256 over the normalized source wallet, destination wallet,
currency, and bigint amount. Fixed order and `|` separators avoid ambiguous concatenation
for the currently validated field types. Formatting differences normalize before hashing.
It is not browser/device fingerprinting or caller authentication.

The idempotency key identifies an intended operation. The fingerprint checks that retries
under that key still contain the same details. The build spec requires `409` for changed
details; identical details with a different key remain a new operation. A hash alone does
not enforce idempotency: the unique key record, saved result, and atomic transaction must
do that. Those parts are not implemented yet.

**Naming:** the [IETF Idempotency-Key draft, section 2.4](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-2.4)
uses "idempotency fingerprint." This supports the terminology; it does not establish a
mandatory function name or final standard. The project's status codes follow its build
spec rather than adopting every recommendation in that draft.

**Recommendation, not an implemented decision:** `createTransferRequestFingerprint` in
`transferFingerprint.ts` would make the purpose clearer. Current code and tests still use
`fingerprintTransfer` from `transferPolicy.ts`. The rename and move remain recommendations; this documentation update does not
change the helper or its imports.

**Cost and limitation:** SHA-256 collisions are theoretically possible. The encoding
assumes fields cannot contain `|`; revisit it if IDs or currency rules change. Hashing
provides no authentication or tamper-proof signature.

**Ruled out:** hashing raw JSON formatting; treating equal fingerprints across different
keys as duplicate operations. **Reversible:** rename/move is cheap; changing canonical
encoding after fingerprints are stored requires backward-compatibility planning.

## Q26 ? Vitest establishes pure behavior; database proof is still outstanding

**Decided:** Vitest runs the unit tests via `npm test` from `server/`. Current verified
result is 46 passing tests across money and transfer-policy/request/fingerprint tests.
Typecheck includes tests; the build configuration compiles source only.

The earlier Q2 history describes removed HTTP tests, not the absence of all tests today.
Pure functions do not need to import the listening app, so they can be tested now while
Q15 remains open for integration-test access.

**Cost and limitation:** these tests do not establish row locks, concurrent key handling,
rollback, database migration execution, or crash recovery. Real PostgreSQL tests remain
required before financial guarantees can be claimed.

**Ruled out:** claiming mocked or pure-state checks prove database guarantees.
**Reversible:** the runner can change; behavioral evidence must be retained.

## Q27 ? Feature branches and commits retain the user's identity

**Decided:** keep separate feature branches, focused conventional commits, and relevant
checks before completed changes are committed. Guidance documents stay local and ignored.
Git author and committer were verified as `Izunnaya <ugorjimicheal.um@gmail.com>`.

Normally branches begin from main, as CONTRIBUTING.md specifies. The Zod follow-up branch
began at the existing unmerged domain implementation on `feature/database-migrations`.
That preserved the user's current code without merging unrelated work into main. Treat
this as a recorded exception and review the inherited commits during integration.

**Cost and limitation:** stacked history requires care when merging. Local Git metadata
records authorship; it is separate from remote account authentication or commit signing.
**Ruled out:** attributing these commits to OpenAI; silently merging the database branch
as part of a domain refactor. **Reversible:** future branch policy can change; published
history should not be rewritten casually.

## What is still open

| Question | Blocks |
| --- | --- |
| **Q15** How the transfer integration tests reach the app | The transfer, and the spec's definition of done |
| **Q18** Which identifier the blacklist matches on | The blacklist seed and both checks |
| **Q19** The rate limit numbers | Rate limiting |
| **Q20** Whether admin blacklist endpoints are in scope | The admin routes |
| **Q21** Whether the free Render database outlives the review window | Deployment |

All of them are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), with the options and
what each costs.


## Q29 - Prisma adoption preserves data and requires isolated evidence

**Decided:** generate Prisma Client into ignored source output, generate it on
install/build, and keep all seven model/table mappings and bigint money intact.
The legacy custom migration runner is removed. Prisma Migrate deploy applies the
preserved baseline; existing tables are adopted only after checking their schema
and running migrate resolve. The original app database is not reset or baselined
silently.

Tests use TEST_DATABASE_URL and refuse the application's database/schema.
A repeatable verification script creates and removes its own temporary schema,
checks migration reruns, seed repeatability and ORM rollback, and rehearses
baselining data without rewriting balances. Constraint tests intentionally bypass
Prisma and inspect PostgreSQL errors. The ORM transaction client cannot be replaced
by a pool or root client halfway through a financial operation.

**Limitation:** custom CHECK constraints and the partial index still require SQL
review when generating later migrations. Existing seed passwords remain placeholders.
Unit tests do not establish concurrent transfer guarantees; no transfer endpoint
has been implemented by this migration.

**Evidence:** schema validation, typecheck, build, and all 81 tests passed in
disposable-schema verification. Fresh and repeated migrations, compiled and CLI
seed execution, and baseline adoption preserved the expected balances. Cleanup
removed the temporary schema; the application schema was not altered.
