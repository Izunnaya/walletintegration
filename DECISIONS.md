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

**Reversed by [Q31](#q31--the-service-logs-json-the-command-line-tools-do-not).** The
prediction held: it was nine call sites and the library went back in without a redesign. The
reason it was reversible is that every call site already had the shape `("event_name", { fields })`,
which is pino's signature with the arguments the other way round.

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


## Authentication review follow-up

- Keep bcrypt and enforce its 72-byte UTF-8 input limit through Zod on both
  registration and login. Keep the registration minimum of 12 characters. Do not
  trim passwords or silently truncate them; pre-existing over-limit passwords need
  reset. Cost 12 is a tunable work factor, not a guarantee against guessing.
- Validate once in route middleware, pass parsed output through `res.locals.body`,
  and use Zod-inferred types in controllers. The validator must precede its handler.
- Keep detailed rationale in WALKTHROUGH.md and short, accurate reasons in code.
- Export the Express app separately from the listening entrypoint so HTTP tests
  exercise production routing without starting the normal server port.
- Verify auth behavior against a disposable PostgreSQL schema with real transactions.
  A failing wallet-insert trigger demonstrates registration rollback. Only the
  connection is substituted; hashing, tokens, SQL and HTTP handling remain real.
- Rate limits remain a later implementation stage, not a completed auth guarantee.


## API latency review (28 October 2026)

The shared Prisma client now keeps idle connections for 60 seconds instead of the
pg default of 10 seconds, and bounds new connection attempts to 10 seconds. This
reduces repeated TCP/TLS setup during short pauses; it is not a SQL execution
timeout. The server runs SELECT 1 before listening, so connection setup happens
at startup and startup fails if the database is unreachable. This moves work out
of the first request; it does not remove that work.

Wallet lookup uses the existing unique (ownerId, currency) key and selects only
id, currency and balance. Blacklist lookup selects only id, and login selects only
the identity, restriction and password fields it consumes. No new index is needed:
email and the wallet owner/currency pair already have unique indexes. Blacklist
results are not cached, password cost is unchanged, and registration remains atomic.

Local HTTP measurements against the configured hosted database:

| Request | Before | After |
| --- | --- | --- |
| Blacklist rejection, first measured request | 17,415 ms | 248 ms |
| Blacklist rejection, subsequent requests | 221-228 ms | 228-235 ms |
| Wallet read, three requests | 10,165-16,957 ms | 221-228 ms |
| Login rejection | 456-485 ms | 467-472 ms |
| Database read after 11 seconds idle | 1,787 ms | 223 ms |

These are a small sequential sample, not a load test or a latency guarantee. The
initial database readiness request still took 1.6-2 seconds in the probe, which
bypassed the startup entrypoint. The results do not establish the exact cause of
every earlier outlier. Neon can suspend idle compute; a long-idle wakeup or network
latency can still affect responses. No hosting plan or scale-to-zero setting was
changed. Keep the deployed API and database geographically close when deploying.

References: https://node-postgres.com/apis/pool and
https://neon.com/docs/introduction/compute-lifecycle.


## Atomic transfers: implementation and defense

The flow is `TransferRoute` -> authentication -> key and body validation ->
`TransferController` -> `transferService`. The controller handles HTTP; the service
owns one READ COMMITTED Prisma transaction. `transferLocks` contains only the SQL
needed for explicit row locks, because Prisma's model operations do not express
these locks. Parameters remain bound and the schema identifier is validated
configuration, never request input.

1. Validate IDs as decimal strings and convert to bigint, keeping exact values
   beyond 2^53. The same database range now applies to JWT subjects.
2. Claim (caller, POST /transfers, key) with Prisma createMany/skipDuplicates, which
   uses conflict-aware insertion. A duplicate waits for the original transaction.
   A matching fingerprint replays the stored result; different details return 409.
3. Discover immutable wallet owners, lock user rows in ascending ID order, then
   lock wallet rows in ascending ID order. Recheck ownership under those locks.
4. Read both restrictions and blacklist matches after locking. Check funds, system
   wallet exclusion, currency, and recipient BIGINT capacity before financial writes.
5. Create the transfer, debit sender, credit recipient, insert the ledger pair and
   save the success response. Only then commit. A business rejection saves only the
   idempotency response and commits without moving money.

### Why the user lock is FOR NO KEY UPDATE

The idempotency row's foreign key takes a KEY SHARE lock on the caller. With FOR
UPDATE on user rows, two opposite transfers could each hold a foreign-key lock the
other needs to upgrade. FOR NO KEY UPDATE still excludes restriction changes and
other transfer locks, but is compatible with KEY SHARE. Wallet rows use FOR UPDATE.
Future admin restriction operations must acquire user locks before wallet locks,
in ascending order, and update restrictions/audit together. Blacklist mutations
must follow the same user-lock protocol. No blacklist management API exists yet.
See https://www.postgresql.org/docs/17/explicit-locking.html.

### Why there is no pending status migration

The existing schema accepts only succeeded/rejected. The initial claim uses an
uncommitted provisional rejected row with an empty body. Every normal new-claim
return replaces it with a real rejection or success; thrown errors roll it back.
It is never committed as a pending result or exposed to other requests. The unique
constraint coordinates concurrent duplicates; no in-memory mutex is involved.

### Timeouts and failure meaning

Lock waits are bounded to five seconds, pool acquisition to five seconds, and the
interactive transaction to thirty seconds. Deadlock/serialization failures retry
only the entire rolled-back transaction, at most three retries (four attempts),
with a small randomized delay. Other errors are not retried internally. Recognized
connection and timeout errors return 503 with same-key guidance. Unexpected bugs
remain 500 and roll back. If commit acknowledgement is lost, never infer that money
failed to move: retrying the same key resolves whether a commit happened.

Responses store JSON values, not raw response bytes. An error replay retains the
original error.requestId; its HTTP X-Request-Id is fresh. Status, reference, IDs,
amount and timestamp remain unchanged. A previously rejected key stays rejected
even if funds arrive later; that new intent needs a new key. Keys have no automatic
expiry in this MVP.

### Evidence and limits

The HTTP suite uses a disposable schema with real Prisma, PostgreSQL, JWTs and
parallel requests. Setup funds wallets with matching system-wallet ledger entries.
It checks duplicate keys, overspending, opposite directions, rejected-key replay,
restrictions, ownership and system wallets. A test-only Prisma query extension
throws after a real debit to prove application-error rollback. A held database
user lock tests block-before-transfer ordering and lock-timeout recovery. A test
barrier also proves transfer-before-block ordering, and a waiting duplicate is
allowed to claim the key after the first attempt rolls back. The unit
retry tests use a fake transaction runner to exercise retry limits; they do not
prove database locking. No public fault-injection route or request flag exists.

Transfer history, admin endpoints, rate limiting, a reconciliation command and
live deployment verification remain separate work. These tests do not simulate
an abrupt process crash or a network failure during COMMIT.


Transfer feature verification: 82 unit tests and 21 auth/transfer PostgreSQL HTTP
integration tests passed, along with TypeScript checking and the production build.
The 16 transfer integration scenarios include both block/transfer orderings and
rollback of a first claimant while a duplicate waits. The older schema/seed suites
were not rerun for this feature; no schema migration changed. Temporary HTTP-test
schemas were removed by successful teardown. This is not deployed verification.

## Q19 — Rate limits are generous, and the numbers are written down

**Decided:** 60 transfers a minute per caller, 20 auth requests a minute per IP, 240 reads a
minute per caller. In-memory store.

The tension is real: a reviewer demonstrating concurrency fires dozens of simultaneous
transfers at one wallet, and a limit tight enough to look serious would answer `429` and
read as a broken demo rather than a working limiter. Generous, with the numbers documented,
makes the choice visible instead of accidental.

Auth is keyed by **IP**, not by account, and that distinction is the point. Keying a login
attempt by the account being attempted would let someone try one password against a thousand
accounts without ever filling a bucket. Transfers and reads are keyed by account once
authenticated, falling back to IP, because an unauthenticated flood sharing one bucket would
lock every caller out together.

`trust proxy` is set to `1` because Render puts one proxy in front: without it `req.ip` is the
proxy on every request and the IP-keyed limiter would be useless. Not `true`, because
trusting the whole chain would let a caller spoof `X-Forwarded-For` and get a fresh bucket
per request.

**Ruled out:** tight limits with instructions to raise them for testing, which asks a
reviewer to read before testing; an environment switch to disable the limiter, which is one
more surface and a switch that must never be off in deployment.
**Reversible:** yes, they are four numbers. The in-memory store is the real limitation: it is
correct for one instance and wrong for more, since each process keeps its own counts, so N
instances allow N times the limit and a restart forgets everything. A shared store is the fix
and is not needed while this runs as a single service.

## Q20 — The admin blacklist endpoints stay out

**Decided:** the blacklist is managed by the seed only. `POST /admin/blacklist` and
`DELETE /admin/blacklist/:id` are not built.

They are optional in the build spec, and leaving them out buys something concrete rather than
just saving work: with no runtime writes to `blacklist_entries`, there is no race between
blacklisting someone and a transfer involving them, so the transfer's blacklist check needs
no lock on that table. The seeded entry still demonstrates the rule, because registration
refuses `fraudster@example.com`.

Block and unblock *are* built, and they are where the interesting behaviour is: they take the
same user row lock a transfer takes, so the two serialise. A third audited operation would
exercise the same mechanism without proving anything new.

**Ruled out:** adding them audited and locking, which is the cheapest thing to add afterwards
and the most expensive to debug while the transfer is still settling.
**Reversible:** yes. It is additive, and the audit table and locking pattern already exist.

## Q21 — The database is Neon, so the expiry deadline is gone

**Decided:** PostgreSQL on Neon, with the API on Render. Not Render's own PostgreSQL.

A free Render database becomes inaccessible 30 days after creation, and the 14-day grace
period does not keep it working. The build spec is explicit that a README warning does not
satisfy "a live URL we can hit", so that clock would have to be tracked and the database
upgraded before submission. Neon's free tier does not expire that way, and Render reaches it
over the network like any other host.

That removes a deadline rather than managing one, which is why this is settled rather than
open.

Two consequences worth knowing. The pooled Neon endpoint is PgBouncer, which rejects startup
parameters and shares session state between clients — the application uses it and sets none,
while the integration tests use the direct endpoint because they scope a schema. And an
outbound block on port 5432 on the developer's network means local work needs a VPN, while
Render is unaffected because it connects from its own network.

**Ruled out:** Render PostgreSQL with a diary note; creating the database late to push the
expiry out, which contradicts deploying early.
**Reversible:** yes, it is a connection string.
## Q30 — The admin password is set by its own command, and never published

**Decided:** the seed writes the admin password once and never resets it. Changing it
deliberately is `npm run admin:password`, which reads `SEED_ADMIN_PASSWORD`. The README does
not contain it.

The build spec already required the first half: a deployed admin credential changes
deliberately, not because somebody ran the seed again. What that rule did not cover is what
happens to a database seeded *before* the variable existed. There was no way to change the
password at all, so it kept whatever default it was given.

**This went wrong in the real deployment, which is why it has an entry.** An earlier README
published `admin-password-2026` as the admin credential, and the live database was seeded
with it. Anyone reading a public repository could sign in as admin on the deployed service
and block or unblock any account. It was rotated, the README no longer carries an admin
password, and the seed's local fallback is now named `local-development-only-change-me` so
it cannot be mistaken for a real one.

The command is deliberately narrow. It requires the variable, refuses a value under twelve
characters or over 72 bytes, refuses to touch a row that is not an admin, and verifies the
new password by reading it back rather than trusting the write. It never runs as part of a
deploy.

The demo customers are the opposite case: their password *is* published, and is reset on
every seed run so the database always matches the README. Nothing of value is protected by
it, and a fixture credential that disagrees with its documentation is worse than a known one.

**Ruled out:** having the seed reset the admin password, which is the rule the spec sets out
to prevent; keeping the password in the README and treating it as a demo value, which is what
caused this; deleting and reseeding the admin row, which the audit entries referencing it now
make impossible.
**Reversible:** yes. It is one command and one row.

## Q31 — The service logs JSON, the command-line tools do not

**Decided:** `pino` and `pino-http` for everything in the request path. `console.log` stays
in `reconcile.ts`, `seed.ts`, `setAdminPassword.ts` and the seed's balance table.

This reverses [Q5](#q5--logging-is-console-not-a-logging-library), which is the one decision
the build spec argued against. Q5 said the reversal would be cheap and it was: nine call
sites, each already written as `("event_name", { fields })`, which is pino's own signature
with the arguments swapped.

**The split is the actual decision.** Structured logging is not "JSON everywhere". It is
JSON for output a machine filters, and text for output a person reads. The service writes to
Render's log stream, where the only way to find one failed transfer among thousands of lines
is to query a field — so every line is one JSON object carrying the request ID the caller was
given in `X-Request-Id`. The reconciliation report is read by an operator at a terminal, and
an aligned table of balances is the readable form; wrapping it in JSON would make the one
audience it has worse off.

Three details are deliberate rather than default:

- **`genReqId` reuses the existing ID.** `attachRequestId` already generated it and put it in
  the response header. pino-http would otherwise generate its own, and the request line and
  the error line would carry two unrelated IDs — which looks perfectly fine until somebody
  tries to use one.
- **The `Authorization` header is redacted, and headers are dropped from the serializer
  anyway.** pino-http logs the full header set by default, so a bearer token valid for the
  rest of its lifetime would sit in a log aggregator that far more people can read than can
  read the database. Two independent defences, tested separately so removing one breaks a test.
- **`/health` is not logged.** Render calls `/health/ready` every few seconds forever, and
  those lines would bury the requests somebody cares about.

Pretty-printing is chosen by `process.stdout.isTTY`, not by `NODE_ENV`: a terminal gets
colour, a pipe gets JSON. That means Render and the test runner both get JSON with nothing
configured, and keeps pino-pretty's worker thread out of the test process.

**Ruled out:** keeping `console` and accepting the spec gap, which was Q5 and is no longer
worth the cost now that the deployment produces real logs to search; JSON everywhere,
including the reconciliation report, which serves no reader; a wrapper around pino so call
sites do not depend on it, which is the abstraction this project keeps refusing — callers use
pino's own methods and `src/logger.ts` holds configuration only.
**Reversible:** yes, and Q5 proved it in both directions.

---

## Nothing is open

Every question raised during the build has been answered. [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)
is empty, and stays in the repository because the next question goes there first.


## Production audit and hardening (28 October 2026)

See docs/production-audit-2026-10-28.md for live observations, latency samples,
financial restoration, and fixes awaiting deployment. The main live financial
checks passed: duplicate intents moved money once, overspending was rejected,
opposite-direction transfers conserved balances, and source/history/admin access
checks held. A fresh-account test proved the read quota works; earlier probes
crossed a reset boundary and were inconclusive.

Code fixes reuse the bounded ID schema on history/admin routes, use the rate-limit
library's IPv6 subnet helper, add a login-account quota and an admin quota, and
re-read current admin permissions from PostgreSQL. Helmet supplies security headers,
no-store applies to API responses, JSON is limited to 16 KB, and preflights now carry
request IDs. Admin transient failures use the shared database classifier.

Q32 is still a deployment question: TRUST_PROXY_HOPS is explicit configuration,
zero when unconfigured, including on Render. Startup logs a warning until configured. The actual production value
requires the logged ingress chain; it must not be guessed. Local correctness is
not proof that a running deployment has received the fix. Re-test after deploying.

In-memory quotas are intentionally limited to one process. A shared limiter store
is required before adding workers/replicas. No financial correctness check was
weakened to make a stress test faster, and no password cost was reduced.


Final verification: 105 unit/security tests and 71 distinct PostgreSQL API tests
passed across the targeted runs. This includes 20 concurrent duplicate transfers,
12 concurrent overspending attempts, both block/transfer orderings, admin quota
and stale-role checks. The optimized lock-query version passed all 16 transfer
tests. TypeScript checking, the production build and audit-script syntax check
passed. The production dependency audit reported zero known vulnerabilities.
Schema/seed/reconciliation suites were not rerun; no migration changed.
