# Server decisions

I built this service around three operations: creating an account with its wallet,
moving money between wallets, and controlling account access. The choices below
explain how I keep those operations correct, what each choice costs, and where the
current implementation stops.

The frontend has its own [decision guide](frontend-decisions.md). This document
covers the API, database and financial rules.

## 1. I store money as whole kobo

A wallet balance needs exact arithmetic. I store NGN 1,500 as `150000` kobo in a
PostgreSQL `BIGINT`, and use JavaScript `bigint` when calculating with it. Adding or
subtracting an amount therefore does not introduce a rounding error.

I send money as a string in JSON too. JavaScript numbers cannot represent every
integer that fits in PostgreSQL's `BIGINT`, and JSON cannot serialize a `bigint`
directly. A string keeps the value intact from the database to the browser. For
example, the API receives `"150000"`, not `1500.00`.

The amount schema accepts a positive integer string and converts it after checking
the format. Decimal values, scientific notation and JSON numbers are rejected.
I set a separate product limit of NGN 10 million per transfer, below the storage
limit. The receiving balance must also fit in `BIGINT` before money moves.

Code: `server/src/domain/money.ts`, `server/src/domain/transferRequest.ts`.

## 2. I create the account and wallet together

Registration is one operation from the user's point of view. Creating the user and
then failing to create their wallet would leave a half-created account, so both
inserts run in one Prisma transaction. Either both exist afterward or neither does.
Registration assigns the customer role and creates an empty NGN wallet; the request
cannot supply a role or starting balance.

I trim and lowercase email addresses before login, uniqueness and blacklist checks.
That makes `Ada@Example.com` and `ada@example.com` the same identity here. A unique
database constraint handles two requests registering that address at once. The
blacklist check runs before hashing, so a rejected address does not spend time on
password work that cannot lead to an account.

The blacklist is maintained outside the API. Block/unblock uses the locking workflow
below, while direct blacklist edits do not. A future blacklist management endpoint
must coordinate its writes with the account locks.

Code: `server/src/controllers/AuthController.ts`, `server/src/domain/authRequest.ts`.

## 3. I use Prisma and keep SQL locks explicit

Prisma gives me generated model types, ordinary queries and a migration history in
one place. It does not replace PostgreSQL's transaction rules. I use raw SQL for
row-lock clauses and reports that are clearer as one database aggregation.

Every helper participating in a transaction receives its `Prisma.TransactionClient`.
If a helper called the shared Prisma client instead, its query would run outside
that transaction and could escape the locks or commit separately. Passing the client
makes that boundary visible.

Raw SQL names the configured schema explicitly. Prisma's schema setting scopes its
model queries, but does not automatically scope every raw query. Without qualification,
a report or lock could use a different table through `search_path`.

Code: `server/src/models/databaseClient.ts`, `server/src/models/transferLocks.ts`.

## 4. I keep the transfer in one transaction

A transfer includes more than subtracting from one balance and adding to another.
I need the transfer record, both balance changes, both ledger entries and the saved
idempotency response to agree. I commit all of them together. If work throws before
commit, PostgreSQL rolls the transaction back.

For example, an exception after debiting the sender must undo that debit too.
Returning an error while leaving the sender charged would break the financial rule,
even if the receiving wallet had not changed. The integration tests inject that
failure and check the balances, history and saved key afterward.

I keep these steps together in `transferService.ts`. Splitting each write into a
separate service would make it harder to see which operations share the transaction.
The controller stays small because its job is to turn the service result into HTTP.

Code: `server/src/services/transferService.ts`, `server/src/controllers/TransferController.ts`.

## 5. I lock rows before checking balances

A transaction alone does not stop two requests reading the same starting balance.
If a wallet has NGN 1,000 and two parallel requests each send NGN 800, both could
pass an unlocked balance check.

I use `READ COMMITTED` with explicit row locks. The first request locks the wallet,
checks the balance and completes its change. The second waits, then reads the
updated balance and refuses the overdraft. The database's nonnegative customer-balance
constraint provides another check if application code is wrong.

This makes the locking rule visible. The responsibility is that every new path
changing money must follow it; an unlocked balance update would bypass the design.

## 6. I lock users first, then wallets, in ID order

Restrictions need to stay stable while a transfer is decided, so I lock users as
well as wallets. Every path takes user locks before wallet locks. Within each group,
it locks the lower ID first.

The order matters for transfers in opposite directions. If one request locked A
and waited for B while another locked B and waited for A, neither could continue
without PostgreSQL aborting one. A consistent order removes that cycle between
these paths.

User rows use `FOR NO KEY UPDATE`; wallet rows use `FOR UPDATE`. The user lock still
prevents a concurrent block or role change. It also allows the foreign-key check
made when claiming an idempotency key. A stronger user lock would add unnecessary
contention with those claims.

Block/unblock locks the acting admin and target in the same ID order. Whichever
operation gets the relevant user lock first finishes before the other checks that
account. A block does not interrupt a transfer already holding the lock; it affects
the next transfer that reads the blocked state.

Code: `server/src/models/transferLocks.ts`.

## 7. I use an idempotency key for one payment attempt

A caller can lose the response after a transfer commits. Repeating the request must
not turn that uncertainty into a second payment. The caller supplies an
`Idempotency-Key`, scoped to their user ID and the transfer operation.

I claim the key through a unique database index inside the financial transaction.
When two requests use it at once, the index coordinates them. The second waits for
the first transaction. After a commit it reads the saved answer; after a rollback
it can claim the key and execute the transfer. A lock timeout returns a retryable
result rather than waiting indefinitely.

The saved status code and response body include the original transfer ID and
reference. Keeping the claim and response in the same transaction means an incomplete
claim cannot commit on its own.

A different key represents a different payment. Idempotency cannot infer that two
separate keys were accidentally used for the same intention.

## 8. I save rejections and compare request details

I save business rejections, such as insufficient funds, against the key too. If a
payment was refused and the wallet is funded afterward, replaying the old key must
still return the refusal. Otherwise the same attempt could change from rejected
to paid without the user starting a new payment.

`fingerprintTransfer` hashes the normalized source, destination, currency and amount.
I use it to check that a key still belongs to the same details. It has nothing to
do with biometric login or browser tracking. Matching details replay the answer;
different details return `409 IDEMPOTENCY_KEY_REUSED`.

Public wallet IDs resolve to numeric database keys before hashing. An older numeric
request and a newer public-ID request can therefore identify the same wallets. An
unknown wallet is a saved rejection too, rather than a server error.

Code: `server/src/domain/transferPolicy.ts`, `server/src/services/transferService.ts`.

## 9. I distinguish rejection from an uncertain result

Insufficient funds is a known rejection. A connection dropping during commit is
different: the money may have moved even though the server lost the answer. I do
not treat those cases as equivalent.

For a recognized temporary or uncertain database error, the service returns `503`
with `Retry-After` and asks for the same key and details. If the original transaction
committed, the retry gets its saved result. If it rolled back, the retry can execute
it. The frontend preserves the attempt for this reason.

I retry internally only for errors that establish rollback, such as deadlocks or
serialization failures. Those retries are bounded and use a short delay. Unexpected
application errors reach the error handler; the client still keeps the original
key because a server error is not permission to create a new payment.

Code: `server/src/models/transactionErrors.ts`, `server/src/services/transferService.ts`.

## 10. I keep a ledger and protect its history

Each successful transfer writes a negative debit on the source wallet and an equal
positive credit on the destination. The balance column makes wallet reads quick;
the ledger explains how that balance was reached. Rejections belong in idempotency
records because no financial movement happened.

Database triggers refuse updates and deletes on transfers and ledger entries.
A correction must be a new entry, so the history shows both what happened and how
it was corrected. There is no refund endpoint in the current API.

Triggers cannot stop a database owner disabling them or truncating tables. Deployment
still needs a separate migration role and restricted application role. I keep that
boundary explicit rather than claiming the database is tamper-proof.

Code: `server/prisma/migrations/202610290001_protect_financial_history/migration.sql`.

## 11. I fund demo wallets through one system wallet

Writing a starting balance directly into a customer wallet would give that money
no history. The seed creates funding transfers with a debit and credit instead.
One system wallet may go negative, and a partial unique index permits only one.
Its negative balance offsets the money held by demo customers.

The normal API refuses transfers involving the system wallet on either side. Its
owner's password hash comes from random bytes that are not retained, so there is
no published login for the funding account.

The seed is demonstration data. Its customer passwords are public, so those accounts
must not hold real funds. Stable funding references ensure reruns do not add the
starting money again.

Code: `server/src/models/seedData.ts`.

## 12. I use Zod at the request boundary

Zod defines the accepted shape and supplies the TypeScript type. Runtime validation
and the type used by the controller therefore stay in step. Strict request objects
reject extra fields such as a role or invented balance.

Middleware checks format; the transaction checks current business state. A valid
amount does not mean the wallet can afford it. That decision belongs after the
balance lock. Pure domain functions accept supplied values, making their rules easy
to test without pretending an old balance is current.

Code: `server/src/domain/`, `server/src/middleware/validate.ts`.

## 13. I use short-lived tokens and current database permissions

Login verifies a bcrypt password hash and issues an HS256 token lasting one hour.
The signing secret comes from configuration and token verification pins the
algorithm. Passwords are never stored in plain text or returned in responses.

A token identifies the caller. It does not prove they still own a wallet or have
admin permission. Transfers check ownership and restrictions against locked rows.
Admin middleware reads the current role and blocked state; restriction writes check
them again after locking the admin and target.

The second check closes the gap where an admin is blocked or demoted while a
request waits. The restriction and audit entry commit together. An admin cannot
change their own access through these endpoints.

Blocking prevents new logins and transfers. Existing tokens retain read access
until expiry, and password changes do not revoke them. Immediate session revocation
would need additional backend state.

## 14. I validate passwords without silently changing them

I require at least 12 characters after excluding surrounding whitespace, but keep
the actual password unchanged. Trimming before hashing would make the stored secret
different from what the user entered. Login uses the same unchanged value.

bcrypt reads at most 72 UTF-8 bytes, so I reject longer input before hashing or
comparison. This is a byte limit, not a character count; some characters use more
than one byte. The UI gives plain guidance while the schema enforces the boundary.
The policy does not require a fixed uppercase, number and symbol combination.

Seeding validates the admin password with the registration schema. It writes an
admin password once; `npm run admin:password` changes it deliberately. Demo customer
passwords reset on rerun so those fixtures stay usable.

Code: `server/src/domain/authRequest.ts`, `server/src/models/password.ts`.

## 15. I keep errors consistent and logs private

Every error uses `{ error: { code, message, requestId } }`. The code lets the frontend
handle the situation; the message tells the user what happened. Field errors help
correct input. Stack traces, SQL and filesystem paths stay out of responses.

The server generates request IDs before parsing the body, so malformed JSON can
still be matched to a log. I ignore incoming request IDs. The frontend retains
them for diagnostics but keeps them out of normal alerts and notifications.

Pino logs request metadata in JSON when output is piped. Passwords, tokens and
request bodies are excluded. CLI tools print plain reports for terminal use.
Financial records, operational logs and admin actions stay separate: they explain
where money moved, why a request failed, and who changed account access.

## 16. I filter private data in the query

`GET /wallets/me` derives ownership from the signed-in user. Transfer queries only
include wallets belonging to that caller. The API does not need to fetch another
user's transfer and rely on a later ownership check being remembered.

A missing transfer and someone else's transfer both return `404`. This avoids
confirming another person's record exists. Lists use a bounded cursor based on the
transfer ID, so new rows do not shift later pages as they would with an offset.
Large histories still need query-plan measurements at realistic size.

Code: `server/src/controllers/WalletController.ts`, `server/src/controllers/TransferHistoryController.ts`.

## 17. I rate-limit different kinds of work separately

Login, reading, transferring and admin changes have different costs. Separate limits
keep one busy screen from consuming every operation's allowance.

| Operation | Limit per minute |
| --- | --- |
| Public auth requests | 20 per IP |
| Login attempts | 10 per account and IP, plus 60 per account overall |
| Transfers | 60 per caller |
| Wallet and transfer reads | 240 per caller |
| Admin requests | 30 per caller |

The tighter login limit includes the client IP so one source has a small guessing
allowance. The account-wide ceiling also limits distributed attempts, although an
attacker can still consume that allowance. Rate limits reduce abuse without making
account lockout impossible.

Transfer `503` responses do not consume transfer quota because recovery requires
resending the same key. Other transfer responses count. The client respects
`Retry-After` for rate limits and temporary failures.

Counters live in one process. Before adding replicas I need a shared store. IP
limits also depend on `TRUST_PROXY_HOPS` matching the real ingress chain. Its default
is zero, which ignores forwarded headers but may group callers behind a proxy.

Code: `server/src/middleware/rateLimit.ts`, `server/src/proxyConfig.ts`.

## 18. I reconcile using one consistent snapshot

`npm run reconcile` compares balances to ledger totals, checks debit/credit pairs,
amounts, wallet and currency assignments, negative customer balances, the system
total, and transfer IDs and amounts in saved successful responses.

All seven checks run in one read-only `REPEATABLE READ` transaction. Without a shared
snapshot, a transfer committing between checks could make correct queries appear
to disagree.

Reconciliation proves those consistency rules. It cannot prove a database owner
never rewrote a complete history, and two payments with different keys can both
balance correctly. Idempotency and reconciliation address different problems.

Code: `server/src/models/reconciliation.ts`, `server/src/reconcile.ts`.

## 19. I test committed behavior in disposable schemas

Mocked queries cannot prove PostgreSQL locks or constraints work. Integration tests
use real PostgreSQL, while unit tests cover pure validation and policy rules.
Concurrency tests send requests together and check both balances and ledger state.

`npm run verify:prisma` creates a temporary schema, runs migrations, the backend
suite and seed checks, then removes it. Direct test runs require `TEST_DATABASE_URL`
with a test schema. I scope both Prisma and raw SQL to it. A transaction that rolls
back is useful isolation, but is not a reason to test against live tables.

Migration reruns and baseline adoption use disposable data too. I do not reset an
existing database to adopt Prisma. A baseline marks existing SQL as applied only
after the schema has been compared.

Code: `server/scripts/verify-prisma.mjs`, `server/tests/testDatabaseUrl.ts`.

## 20. I separate startup, health and deployment configuration

`app.ts` builds the app; `index.ts` loads configuration, checks the database and
starts listening. Tests can import the app without accidentally starting the deployed
entry point. Warming the connection also moves its initial handshake out of the
first user's request.

Liveness answers whether the process responds. Readiness also queries the database.
Render checks readiness because an API that cannot reach its database cannot serve
wallet requests. A platform cold start can still delay the first request before
the application is running.

The deployment uses Render for the API and static frontend, and Neon for PostgreSQL.
The blueprint records builds and routing; credentials stay in environment variables.
The static frontend and running API have different needs, covered in
[deployment.md](deployment.md).

## 21. I keep public wallet IDs separate from database keys

Small numeric keys work well for database relationships, but are a poor wallet ID
to present in the UI. PostgreSQL creates a stable `wlt_` ID for every wallet. Numeric
keys remain in relations and are still accepted for older clients.

The public ID is stored rather than produced by formatting a number in the browser.
It stays the same across sessions and deployments. The migration fills it for
existing wallets without changing owners or balances. Knowing a wallet ID still
does not grant permission to spend its funds.

The frontend preserves older saved numeric transfer bodies and keys. Replacing
those details during a retry would change an unresolved attempt's identity.

## Reading the flow

[architecture.md](architecture.md) maps files and request order.
[domain.md](domain.md) walks through account and money operations.
[prisma.md](prisma.md) covers database commands and migrations.
[known-limitations.md](known-limitations.md) records the remaining boundaries.
