# Design decisions

These are the choices behind the code. The numbers stay stable so other docs can
refer to them.

## ADR 1. Money stays exact

Store whole kobo as PostgreSQL `BIGINT`, use `bigint` in code and send strings in
JSON. `"150000"` means NGN 1,500. This avoids rounding money through floating-point numbers.

## ADR 2. Transactions use explicit locks

Use `READ COMMITTED` and lock the rows being changed. The transfer reads balances
and restrictions after taking those locks, so parallel requests see the right state.

## ADR 3. Lock users before wallets

Within each group, lock IDs in ascending order. All money and restriction paths
must follow this order. Users use `FOR NO KEY UPDATE`, which allows the foreign-key
check made by an idempotency claim. Wallets use `FOR UPDATE`.

## ADR 4. Save the idempotency result with the money

The key, transfer, ledger entries and balances belong to one transaction. They
commit together or roll back together. A failed transaction cannot leave a stranded key.

## ADR 5. Save business rejections too

Insufficient funds is a known result. Save it against the key so retries give the
same answer, even if the balance changes later. A new payment needs a new key.

## ADR 6. An uncertain transfer needs the same key

A lost response may happen after the money moved. Return `503` for a known temporary
or uncertain database outcome and ask the caller to retry the same details and key.
Do not report that no money moved when that is unknown.

## ADR 7. Compare the details behind a key

`fingerprintTransfer` hashes the normalized transfer details. This is a request hash,
not a biometric or browser fingerprint. Matching details replay the saved result;
different details return `409`. Resolve public wallet IDs before hashing so numeric
and public IDs for the same wallet represent the same payment.

## ADR 8. The transfers table contains completed movements

Business rejections live in idempotency records. Each transfer has one debit and one
credit. Database triggers refuse updates and deletes on transfers and ledger entries.
Corrections must be new records. Database owners can bypass triggers, so deployment
still needs a restricted application role.

## ADR 9. Demo funding uses one system wallet

Only the system wallet may go negative. Its owner has a random, unusable password,
and the transfer API refuses system-wallet transfers. Seeding funds customers through
real transfers, keeping the total balance at zero. A partial unique index permits
only one system wallet.

## ADR 10. Prisma owns normal database access

Use Prisma for models, queries and migrations. Keep raw SQL for row locks and reports
that need it. Qualify raw SQL with the configured schema. Pass the same transaction
client to every operation that must commit together.

## ADR 11. Zod defines request shapes

Validate input before controller work and infer types from schemas. Reject unknown
fields. Domain functions stay pure; the service supplies current, locked database state.

## ADR 12. Generate request IDs on the server

Each request gets a UUID for matching a response to a log. Ignore incoming request
IDs. Keep them in diagnostic data, out of normal frontend alerts and notifications.

## ADR 13. Use one error shape

Return `{ error: { code, message, requestId } }`, with field details when useful.
Clients use the code; people read the message. Never return SQL, stack traces or
server paths. Error middleware covers failures outside controllers too.

## ADR 14. Keep private records private

Wallet reads use the signed-in user's ID. Transfer queries filter by ownership.
A missing transfer and another user's transfer both return `404`.

## ADR 15. Check current admin access

Middleware reads the current role and blocked flag. Restriction writes check them
again after locking the admin and target user. The change and audit entry commit
together. An admin cannot block themselves.

## ADR 16. Keep logs useful and private

Use Pino for request logs, with JSON output when piped. Command-line reports use
plain text. Log request metadata and errors, never passwords, tokens or request bodies.

## ADR 17. Apply separate rate limits

Each minute allows 20 auth requests per IP, 10 login attempts per account and IP,
60 login attempts per account, 60 transfers per caller, 240 reads per caller and
30 admin requests per caller. Transfer `503` responses do not consume transfer quota.

Honor `Retry-After`. These limits reduce guessing and load, but a distributed attacker
can still exhaust an account's allowance. Counters are per process; use a shared store
before adding replicas. Proxy trust must match the deployed network.

## ADR 18. Set admin passwords deliberately

Seeding and registration use the same password requirements. Seeding writes the admin
password once; `admin:password` changes it explicitly. Demo customer passwords are
public fixtures and reset on each seed run. Never use those accounts for real funds.

## ADR 19. Keep database hosting separate from application code

The current deployment uses Neon and Render. The application uses PostgreSQL through
Prisma, so hosting can change without changing the money rules. Schema-scoped tests
use a direct database connection.

## ADR 20. Keep credentials out of Git

Use environment variables for secrets. Examples contain placeholders; test credentials
work only in disposable fixtures. Rotate any real credential exposed in source or logs.

## ADR 21. Separate public wallet IDs from database keys

Wallets have stable `wlt_` IDs generated by PostgreSQL. Numeric keys remain for relations
and older clients. The frontend prefers public IDs but preserves saved numeric attempts.
Public IDs are identifiers, not permission to use a wallet.

## ADR 22. Isolate database tests

Direct test runs require `TEST_DATABASE_URL` with a `wallet_test_` schema.
`verify:prisma` creates and removes a temporary schema, then runs migrations, tests
and seed checks there. Set both Prisma's schema and raw SQL's search path; setting
only one leaves part of the test outside its intended schema.

## ADR 23. Organize the frontend around workflows

Keep screens in `pages/`, forms under their workflow and API hooks by resource.
Use the installed query, form, loading and animation libraries. Save an unresolved
transfer before sending and reuse its exact key during recovery. See [frontend.md](frontend.md).
