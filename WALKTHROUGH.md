# Development Walkthrough

This is the explanation of the code that exists, with its decisions and limits.
Use the implementation and test results to support an answer; do not memorize a
claim the code cannot demonstrate. [DECISIONS.md](DECISIONS.md) records the trade-offs.

## What exists

The project has an Express/TypeScript HTTP foundation, seven PostgreSQL tables
represented by Prisma models and migration SQL, a repeatable ledger-backed seed,
Zod domain validation, transfer policy, a request-fingerprint helper, and unit and
PostgreSQL integration tests.

The current HTTP app mounts only the liveness route. Registration, login, JWT,
wallet endpoints, the transfer endpoint and locking service, durable idempotency
execution, admin endpoints, readiness, reconciliation, and deployment remain work
to do. Seed funding is not a public deposit feature.

## Why Prisma now?

The user chose Prisma to reduce handwritten database infrastructure and make
routine queries easier to follow. Q13 supersedes the original pg-only decision.
Prisma generates model types and a query client from `server/prisma/schema.prisma`.
Its PostgreSQL adapter still uses pg internally.

Prisma does not prevent explicit transactions, ordered row locks, or financial
constraints. Those remain our responsibility. CHECK constraints and the partial
single-system-wallet index live in reviewed migration SQL; future row-lock queries
will use parameterized SQL through the Prisma transaction client.

## Files and their responsibilities

| File | What to explain |
| --- | --- |
| `server/src/index.ts` | Loads dotenv **first**, proves the database is reachable, then listens. Nothing else |
| `server/src/app.ts` | Builds the app and its middleware stack, and exports it **without listening**, so tests can mount it |
| `server/src/logger.ts` | The one `pino` instance plus the `pino-http` options: redaction, request-ID reuse, health-check silence |
| `server/src/middleware/cors.ts` | The origin allowlist, and the two headers a browser client cannot work without |
| `server/src/routes/HealthRoute.ts` | Wires `/health/live` to its controller |
| `server/src/controllers/HealthController.ts` | Returns process liveness, without claiming database readiness |
| `server/src/middleware/requestId.ts` | Generates a UUID for logs and error correlation. Runs **before** `express.json()` |
| `server/src/middleware/errorHandler.ts` | Returns JSON 404/500 responses and keeps unexpected error details in server logs |
| `server/src/middleware/validate.ts` | Uses a Zod schema and formats invalid fields; transfer wiring is still pending |
| `server/src/domain/money.ts` | Amount/currency schemas and bigint-to-string serialization |
| `server/src/domain/transferRequest.ts` | Strict request shape and inferred validated type |
| `server/src/domain/transferPolicy.ts` | Ordered eligibility checks and the request fingerprint helper |
| `server/prisma/schema.prisma` | Handwritten model definitions mapped to existing tables and columns |
| `server/prisma/migrations/0_init/migration.sql` | Preserved SQL financial constraints and initial schema |
| `server/prisma.config.ts` | Prisma CLI connection, migration path, seed command |
| `server/src/generated/prisma/` | Ignored, generated client; recreate with `npm run generate` |
| `server/src/models/databaseClient.ts` | Builds Prisma with the pg adapter, schema, TLS, and channel binding configuration |
| `server/src/models/db.ts` | Exports one shared application client |
| `server/src/models/seedData.ts` | Seed fixtures, ORM writes, ledger-backed funding, report aggregation |
| `server/src/seed.ts` | Owns seed transaction, post-commit reporting, and disconnect |
| `server/tests/database.ts` | Connects on the **direct** Neon endpoint, one shared schema, every test rolled back |
| `server/scripts/verify-prisma.mjs` | Verifies migrations, tests, seed repeats, and baseline adoption in a disposable schema |

The old `server/src/migrate.ts` runner is removed. The seven original SQL files
under `server/migrations/` are archival reference, not a second migration system.

## Trace the seed command

Run `npm run seed` from `server/`. Prisma CLI executes the configured handwritten
`src/seed.ts`; Prisma does not generate our seed script.

1. Load `.env`, then import the configured Prisma client and seed operations.
2. Call `prisma.$transaction(transaction => applySeed(transaction), ...)` with
   ReadCommitted isolation, a 5-second acquisition wait and a 30-second transaction
   timeout. Prisma reserves the connection and manages commit/rollback.
3. `applySeed` uses only that transaction client. It creates or finds the system
   owner, system wallet, admin, customer wallets, and blacklist entries.
4. For each customer, insert a transfer with a stable funding reference using
   `createMany({ skipDuplicates: true })`. If nothing was inserted, skip funding.
5. For a newly inserted transfer, create its negative debit and positive credit,
   then decrement the system balance and increment the customer balance. Money
   and database IDs are bigint, never converted through number.
6. A callback error rolls back its writes. A successful callback is committed by
   Prisma before the transaction promise resolves.
7. Only after that promise resolves does the command print the funding result and
   query the balance/ledger report. The report uses one schema-qualified SQL
   aggregation through Prisma so all figures come from one statement snapshot.
8. Disconnect Prisma in `finally` after the transaction/reporting phases.

The system wallet is the only wallet allowed below zero. Funding customers through
paired ledger entries leaves a record of where every demo kobo came from. Stable
references and one transaction prevent repeated runs from crediting money twice.
Existing user passwords are not overwritten. The current placeholder password hash
has since been replaced with bcrypt hashing by the authentication work; see the authentication section below.

### Why reporting errors are separate

A report can fail after money is already committed. Its catch explicitly says
"Seed committed, but reporting failed" and suggests rerunning the repeatable seed.
It sets a nonzero exit status because the whole command did not finish, not because
it can undo the saved data.

Prisma's transaction promise includes commit. If it rejects during a connection
failure, the command cannot always determine whether commit was acknowledged.
It reports that uncertainty and never claims all errors mean no money moved.
Q28 records the original manual implementation; Q13/Q29 describe the Prisma update.

## Validation: why Zod and why the old switch disappeared

`amountMinorSchema` trims a string, checks digits, converts directly with BigInt,
and checks positivity and the existing maximum. `" 000150000 "` becomes `150000n`.
Numbers, signs, exponent notation, decimals, and zero are rejected. The current
limit is 1,000,000,000 kobo (NGN 10,000,000); Q16 remains open for product approval.
A per-transfer cap does not by itself prevent accumulated recipient balance overflow.

We removed `parseAmountMinor`, `AmountParseResult`, and `AmountRejection` because
they only translated the result Zod already provides. Its success result contains
`data`; its failure result contains `error.issues`. The switch existed only for
that translation. A forEach callback return would not return from the enclosing
function and was not a useful replacement. See Q23.

`transferRequestSchema` composes the amount/currency schemas and wallet IDs. Its
output type is inferred, and unknown fields are rejected. Middleware currently
validates then calls next without handing the parsed result to a controller.
There is no transfer route yet; define that output handoff before wiring one.

## Why transfer policy keeps its types and conditions

`TransferPolicyInput` describes the state needed for the decision. The result
separates approval from rejection and restricts reasons to known values. These
are the business function's contract, not a wrapper around a Zod result.

Ownership is checked first, before restrictions or balance, so an unauthorized
caller does not learn those details. The function assumes validated amounts and
correctly associated records. It neither reads nor locks the database. The future
transaction must acquire user locks first, wallet locks second, in sorted ID order,
and supply current state from those locks. See Q24.

## What fingerprintTransfer means in a web app

It hashes transfer request details; it does not identify a device, browser, or
biometric. The key identifies one intended operation. The fingerprint checks
whether retries under that key still describe the same operation.

First send 100000 kobo with key `payment-123`. A retry with the same normalized
wallets, currency, and amount should replay the saved result. Reusing that key
with 500000 kobo must produce 409 under our build spec. Equal fingerprints under
different keys still represent separate operations.

The helper hashes source wallet, destination wallet, currency, and canonical amount
using SHA-256 and a fixed order with separators. Current validated fields cannot
contain the separator. If those field types change, review the encoding. A hash
is not a signature or authentication mechanism, and collisions are theoretically
possible. Durable key coordination and saved-response replay are not built yet.

"Idempotency fingerprint" appears in the [IETF draft, section 2.4](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-2.4).
The function name is not standardized. `createTransferRequestFingerprint` in a
separate file is the documented naming recommendation; current code still uses
`fingerprintTransfer` in `transferPolicy.ts`. See Q25.

## Running and checking the project

All npm commands run from `server/`. `npm ci` and `npm run build` generate Prisma
Client. Type checking covers source, tests, and tool configuration; the build
compiles only source. Node runs TypeScript directly during development.

- `npm run dev`: starts the HTTP app.
- `npm run typecheck`: checks TypeScript.
- `npm run build`: generates Prisma Client and compiles the server.
- `npm run test:unit`: pure domain and mocked seed-command checks.
- `npm run verify:prisma`: real PostgreSQL verification in a temporary schema.
- `npm run migrate`: applies committed Prisma migrations to a fresh/prepared database.
- `npm run seed`: explicitly populates demo data.

Existing databases must be checked and baselined instead of recreated. Follow
[docs/prisma.md](docs/prisma.md); never reset them merely to adopt Prisma. The
application database is not automatically baselined by this code change.

Constraint tests use pg directly to verify PostgreSQL's exact constraint names.
Seed integration tests use real Prisma transactions. Tests require an isolated
TEST_DATABASE_URL and run serially because setup truncates tables within rollback
transactions. The verification script creates and removes its own temporary schema.
These tests do not establish concurrent transfer or process-crash guarantees.

The Prisma migration verification passed all 81 tests (50 unit/command, 21 schema,
10 seed), schema validation, typecheck, and build. Fresh deployment, migration
rerun, compiled/CLI seed runs, and data-preserving baseline adoption passed in the
temporary schema, which was removed afterward. The application schema was untouched.

Earlier HTTP liveness and 404/500 checks were manual; temporary error routes are
not part of the public API. No load test or security review is implied.

## Workflow and boundaries

Each feature gets its own branch, focused commits, and relevant checks. This Prisma
branch builds on the unmerged seed work so that work is preserved. Git author and
committer use `Izunnaya <ugorjimicheal.um@gmail.com>` as requested.

The original guidance documents and `.env` stay ignored. Generated Prisma files
are ignored too. Environment examples contain placeholders. A previously exposed
credential still requires rotation; changing files cannot erase historical exposure.

Remaining stages include readiness and deployment, atomic transfers,
admin restrictions, history, rate limits, reconciliation, and deployed verification.
Prisma changes database tooling; it does not remove those requirements.


## Authentication: request to database

`src/app.ts` assembles Express without opening a port. `src/index.ts` loads the
local environment and starts listening. This lets tests use the same routes on an
ephemeral local port.

Registration and login pass through Zod middleware once. It places the normalized,
validated output in `res.locals.body`; controllers declare its inferred schema type
and consume it without parsing again or casting the raw request body. Routes must
keep the validator before its controller. The response-local value lives only for
that request. The shared email schema trims and lowercases email; passwords are
never trimmed or normalized. Strict objects reject unknown fields, including
privileged fields such as role and balance.

We kept bcrypt, as permitted by the build spec, with cost 12. Bcrypt uses only the
first 72 UTF-8 bytes, so both endpoints reject longer passwords through Zod. A
character count alone is insufficient: accented letters and emoji can take multiple
bytes. Registration retains its 12-character minimum; login allows existing shorter
passwords. Previously accepted passwords over 72 bytes need a password reset before
login under this rule. Do not silently truncate them. Cost should be measured on the
deployment hardware; hashing makes guessing more expensive, not impossible.

Registration checks the normalized email against the blacklist before hashing.
Prisma then creates the customer and zero-balance NGN wallet in one transaction.
A failed wallet insert rolls back the user. The database unique constraint handles
duplicate email races; the controller returns 409. Login returns the same 401 for
unknown users and incorrect passwords, using a dummy bcrypt comparison to reduce
timing differences. A correctly authenticated blocked user gets 403 and no token.
The dummy hash is not a credential; the missing-user check always rejects the login.

JWT signing and verification use jsonwebtoken with HS256 pinned and a one-hour
expiry. JWT_SECRET must be configured with at least 32 characters; generate it
randomly. The token identifies the caller. Transfer authorization and restrictions
still need database checks inside the transfer transaction. `/wallets/me` finds the
wallet using the authenticated caller ID, never a supplied owner ID.

Auth integration tests use real HTTP requests, bcrypt, JWT and PostgreSQL. Only the
database module is redirected to a uniquely named temporary schema. The tests apply
the baseline migration there and remove that exact schema afterward. They cover
normalized registration/login, one empty wallet, blacklist and privileged-field
rejection, duplicate emails, invalid credentials, blocked login, and a database
trigger that forces wallet creation to fail so rollback can be observed. This is
separate from the older schema/seed tests, which currently use DATABASE_URL and
rollback transactions in the application's schema. These auth tests do not prove
transfer concurrency, rate limiting, or deployed behavior.


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

## Structured logging: what to say if asked

The build spec asks for structured logs carrying a request ID. The service uses
**`pino`** and **`pino-http`**; the command-line tools still use `console.log`.
That split is the decision, and it is **Q31** in `DECISIONS.md`.

**Why the split.** Structured logging is not "JSON everywhere". It is JSON for
output a machine filters and text for output a person reads. The service writes
to Render's log stream, where the only way to find one failed transfer among
thousands of lines is to query a field. The reconciliation report is read by an
operator at a terminal, and an aligned table of balances is the readable form —
JSON would make the one audience it has worse off.

**Why this reverses an earlier decision, and why that is a good sign.** Q5
decided against a logging library: the standard for this project is the earlier
backend, which uses `console`, and the person defending the code should not have
to defend a dependency he did not choose. Q5 also recorded the limitation
honestly, said the reversal would be cheap, and said why. It was: nine call
sites, every one already written as `("event_name", { fields })`, which is pino's
signature with the arguments the other way round. **If asked about Q5, the answer
is not that it was wrong — it is that the log named its own cost and the cost
came due.**

**The three details that are deliberate**, each worth a sentence:

1. **`genReqId` reuses the existing ID.** `attachRequestId` generated it and put
   it in `X-Request-Id` before the logger runs. Left to itself, pino-http makes
   its own, and the request line and the error line carry two unrelated IDs —
   which looks fine until somebody tries to use one to trace a failure.
2. **The `Authorization` header never reaches the log.** pino-http logs the full
   header set by default. A bearer token is valid until it expires, and a log
   aggregator is readable by far more people than the database is. There are two
   independent defences — the serializer drops headers, `redact` censors the
   value — and they are tested separately, so removing one breaks a test.
3. **`/health` is not logged.** Render calls `/health/ready` every few seconds
   forever; those lines would bury the requests somebody cares about.

**Pretty vs JSON is decided by `process.stdout.isTTY`,** not `NODE_ENV`. A
terminal gets colour, a pipe gets JSON. So Render and the test runner both get
JSON with nothing configured, and pino-pretty's worker thread stays out of the
test process.

**Why there is no wrapper.** `logger.ts` holds configuration only. Call sites use
pino's own methods. A wrapper is the abstraction this project keeps refusing, and
it would mean learning a second API to defend the first.

**What `tests/logger.test.ts` proves** (9 tests, no database, milliseconds): one
JSON object per request with method, URL, status and duration; the logged ID
equals the one in the `X-Request-Id` response header; a 4xx logs at `warn` and a
5xx at `error`; a bearer token does not appear in the output; `redact` censors an
`authorization` field directly, independent of the serializer; `/health` produces
no line; and an `Error` serialises to type, message and stack rather than the
`{}` that `JSON.stringify` gives for one.


## Frontend: screens backed by the real API

The frontend now follows the Restaurant project's practical conventions: `pages/` compose screens, `api/` owns resource hooks, and `forms/<workflow>-form/` owns fields and validation. The existing animation, skeleton, toast and loading-button libraries remain in use. Money and intent comparisons are pure functions; network, storage and timers are explicit effects.

Start with `frontend/src/api/client.ts` and `contracts.ts`: every response is validated by Zod, then resource hooks put it in TanStack Query. A page reads those hooks. It does not fetch directly. Query keys include the current user; signing in or out cancels reads and clears cached private data. Registration is public and returns to login because the backend does not issue a registration token. Backend permissions remain authoritative even though the UI hides admin routes from customers.

The important financial path is `forms/transfer-form/`: `TransferForm.tsx` validates the recipient wallet ID and naira amount, `attempt.ts` compares and saves exact intents, and `useTransferAttempt.ts` coordinates review, send and recovery. Saving the original key and body happens before the request. Unknown outcomes must be checked using that same request; editing is locked until resolved. A known rejection permits a fresh intent. Browser tests exercise reload, navigation, 401, 429, network failure and switching accounts. This protects the frontend workflow; the server remains responsible for concurrent correctness and ledger atomicity.

Unsupported demo features were removed: no role switcher, fake account directory, recipient names, notes, wallet statuses or invented monthly summaries. The admin supplies a user ID and audited reason, then can inspect the real audit log. Customers see their actual wallet, transfer history and receipts. CLI-only backend operations have no UI controls. See [frontend/README.md](frontend/README.md) for the endpoint map, session-storage tradeoff, recovery limits and test commands.


### User-facing error messages (2026-10-28)

Login failures explain the problem without displaying internal request IDs. The same rule applies to shared error alerts and toasts. Request IDs remain in the API error and backend logs for tracing; they are diagnostic metadata rather than instructions for the user. Browser regression checks cover failed login and read errors, including successful retry.

Password guidance recommends a mix of uppercase and lowercase letters, numbers and symbols. The bcrypt byte limit stays an internal validation detail; an overlong password gets a plain-language error. This copy does not introduce new character requirements that the backend does not enforce.
