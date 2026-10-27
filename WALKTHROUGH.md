# Development Walkthrough

Preparation document for defending this build. Everything here is in the code today or is a design
decision I can point to in the build spec. Nothing in it is a claim the code does not support.

**If you only read three things:** Section 1 (what exists), Section 3 (every file, with the line to say
about each), Section 7 (the two questions that decide the interview).

---

## 1. What exists today, stated honestly

An Express 5 / TypeScript service with:

- `GET /health/live` returning `{"status":"ok"}`
- A UUID request ID on every response (`X-Request-Id`), also returned inside every error
- One error format for unknown routes and for unexpected failures
- `.env` loading through `dotenv`
- Seven SQL migrations, a migration runner, and a `pg` connection pool
- Reusable Zod schemas for integer-kobo amounts, NGN currency, and strict transfer requests
- Pure transfer policy and SHA-256 transfer-request fingerprint helpers
- 46 passing Vitest unit tests across the money and transfer test files

**What does not exist yet:** no seed, registration, login, wallet endpoints, transfer endpoint,
transaction orchestration, durable idempotency execution, row-lock acquisition, reconciliation,
readiness endpoint, or deployment.

Migration files and a pool module exist; that does not establish that a target database has been
migrated or that the HTTP app connects to it. The app currently mounts only the health route.
Unit tests establish pure-function behavior. Real PostgreSQL integration tests are still needed to
prove transaction, locking, and concurrent-request behavior.

---

## 2. The service in one paragraph

A single Node.js service on PostgreSQL that creates users and wallets and moves money between wallets
we own. No banks, no payment providers, no queues. Every transfer completes inside one database
transaction, so there is nothing external to wait on — which is why the design has no event system or
message broker. One currency, NGN, stored as whole kobo. The entire difficulty is concurrency: money
must never be duplicated, lost, or created by accident, even when two requests arrive at the same
instant or the same request is retried.

---

## 3. Every file, and what to say about it

The repository is split into `server/` and `frontend/`, with nothing in the frontend yet. Inside the
server the layout follows the same shape as the Restaurant backend: `index.ts` sets up and starts the
app, and the work is split across `routes/`, `controllers/`, `middleware/`, plus database code in `models/` and pure rules in `domain/`.

```
server/src/
  index.ts                        dotenv, express, middleware, mount routes, listen
  routes/HealthRoute.ts           one router per resource, wiring only
  controllers/HealthController.ts one controller per resource
  middleware/requestId.ts         gives each request an ID
  middleware/errorHandler.ts      the 404 and 500 responses
  middleware/validate.ts          Zod request validation (not mounted on a transfer route yet)
  models/db.ts                   PostgreSQL pool; requires DATABASE_URL when imported
  migrate.ts                     ordered, transactional SQL migrations
  domain/money.ts                Zod amount/currency schemas and string serialization
  domain/transferRequest.ts      strict request schema and field-error formatting
  domain/transferPolicy.ts       ordered policy checks and request fingerprint helper
```

### `server/src/index.ts`

```ts
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(attachRequestId);

app.use("/health", HealthRoute);

app.use(respondNotFound);
app.use(respondInternalError);

app.listen(PORT, () => {
  console.log(`Server started on localhost:${PORT}`);
});
```

**Say this:** "One entry file. It loads the environment, builds the app, mounts the routers and
listens. Same shape as my last project."

Three questions it invites:

- *Why does the middleware order matter?* `attachRequestId` is before the routes so every handler and
  every error response has an ID. `respondNotFound` is after the routes, because it should only run
  when no route matched. `respondInternalError` is last, because Express only sends errors to a
  middleware registered after everything else.
- *Why `express.json()`?* It reads the JSON body of a request into `req.body`. Without it `req.body`
  is `undefined`, so registration and transfers could not read their own input. Express caps a body
  at 100kb by default, which is left as it is.
- *Why `.ts` in the import paths?* Node 22 runs TypeScript directly, and it resolves the real file on
  disk, so the extension is the actual one. The build rewrites them to `.js`.

### `server/src/routes/HealthRoute.ts`

```ts
const router = express.Router();

router.get("/live", HealthController.getLiveness);

export default router;
```

**Say this:** "Route files are wiring only, no logic. It is mounted at `/health` in `index.ts`, so this
responds on `/health/live`."

As authentication arrives, the order inside each route file is always authenticate, authorize,
validate, controller — for example:

```ts
router.post("/", verifyToken, validateTransferRequest, TransferController.createTransfer);
```

### `server/src/controllers/HealthController.ts`

```ts
const getLiveness = (req: Request, res: Response) => {
  res.json({ status: "ok" });
};

export default {
  getLiveness,
};
```

**Say this:** "Controllers hold the work and default-export an object at the bottom, so a route file
reads `HealthController.getLiveness`. This one is not `async` because there is nothing to await;
controllers become `async` with try/catch as soon as they touch the database."

**Why liveness does not check the database:** it answers "is the process up". A separate
`/health/ready` will answer "is the database reachable", and that is the one Render's health check
points at. Mixing them would make a restart look like a database outage.

### `server/src/middleware/requestId.ts`

```ts
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const attachRequestId = (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
```

**What the request ID is for:** the build spec's error format is
`{ error: { code, message, requestId } }`. When a transfer fails, the client gets an ID and no
internal detail. That same ID is in the server log line, so a user's report leads straight to the
record of what actually happened. Without it, a 500 is unexplainable.

**Why `randomUUID` and not a counter?** A counter restarts at 1 on every deploy, so the same ID would
point at different requests over time, and two instances would hand out the same IDs. A UUID makes accidental collisions extremely unlikely; uniqueness is not an absolute guarantee.

**Why generate it rather than read `X-Request-Id` from the caller?** A client could send the same ID
on every request, or put junk in it, and the logs would be worthless. The server decides.

**Why the `declare global` block?** `req.requestId` is not a property Express knows about. This is how
you tell TypeScript about a property you are adding to the request — the same pattern as
`req.userId` in the Restaurant project's `auth.ts`.

### `server/src/middleware/errorHandler.ts`

Two functions. `respondNotFound` returns the 404. `respondInternalError` catches anything a route threw:

```ts
console.error("request_failed", { requestId: req.requestId, path: req.path, error });

if (res.headersSent) {
  next(error);
  return;
}

res.status(500).json({
  error: {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
    requestId: req.requestId,
  },
});
```

**Why this exists at all.** Without it, Express answers a thrown error with an HTML page containing the
exception message, the full stack and absolute file paths. I checked rather than assumed:

```
/boom -> 500 text/html
<pre>Error: sensitive internal detail
    at C:\Users\MichaelUgorji\Desktop\Projects\Lendsqr\...
```

Setting `NODE_ENV=production` only swaps the stack for `<pre>Internal Server Error</pre>` — still HTML,
still not the documented format. One middleware fixes both.

**Why it takes four arguments.** That is how Express recognizes an error handler. A three-argument
function is treated as ordinary middleware and never receives errors, so `next` stays even though it
is rarely used.

**Why the `headersSent` check.** Once a response has started sending, its status and headers are gone,
so a second `res.json()` would throw. Handing the error back lets Express close the connection, which
is the only honest thing left to do.

**Does it catch `async` errors?** Yes. Express 5 forwards a rejected promise from a route to the error
middleware automatically. In Express 4 it did not, which is why older projects wrap every async
handler. Verified both paths.

### `package.json`

```
npm run dev        node --watch src/index.ts
npm run typecheck  tsc --noEmit
npm run build      tsc -p tsconfig.build.json
npm test           vitest run
npm run migrate    node src/migrate.ts
npm start          node dist/index.js
```

Runtime dependencies: `express` handles HTTP; `dotenv` loads local environment files; `pg` talks to
PostgreSQL; `zod` validates and normalizes external input. Development dependencies are TypeScript,
Vitest, and Node/Express/pg type definitions.

### `tsconfig.json`

Strict mode checks source and tests. `tsconfig.build.json` compiles only `server/src/` into `server/dist/`. All npm commands run from `server/`. Four settings are worth knowing if asked:

- `strict` — the baseline.
- `noUncheckedIndexedAccess` — indexing an array gives `T | undefined`, forcing the check. This matters
  for database result rows: `rows[0]` might not exist.
- `verbatimModuleSyntax` — type-only imports must say `import type`. This is not cosmetic: Node runs
  the TypeScript directly, and an unmarked `import { Request } from "express"` would make Node try to
  import a value express does not export, and crash at startup.
- `erasableSyntaxOnly` — bans TypeScript features that produce runtime code, such as enums. Required
  for Node to strip types safely.

### Database files and failure handling

`models/db.ts` defines one `pg` pool. It requires `DATABASE_URL` when imported and
configures TLS for hosted connections. Pool construction alone does not prove a
successful connection. A transaction must check out one client and pass it to all
queries; calling the pool separately can put queries on different connections and
escape transaction locks.

`migrate.ts` loads configuration, imports the pool, checks out a client, and reads
SQL migrations in filename order. It records applied filenames in `schema_migrations`.
Each file and its tracking row commit in one transaction. A SQL failure rolls that
file back and returns a nonzero exit status; previously committed files remain.
Applied filenames are skipped on rerun. Applied SQL must not be edited: the runner
does not checksum files to detect changes. It also has no migration-runner lock, so
run one migrator at a time. A connection failure before the runner's try/finally
is not covered by that cleanup block; do not claim comprehensive shutdown handling.

The seven migrations define users, wallets, transfers, ledger entries, idempotency
records, blacklist entries, and admin audit entries. They establish schema intent;
execution, immutability enforcement, and concurrency behavior still require database
verification. No seed funding or transfer is executed by the current HTTP service.

### Files not in git

`.gitignore` excludes `node_modules/`, `dist/`, `.env`, logs, and the two guidance documents (the
build spec and the development guide), since those are the brief rather than the deliverable.
`.env.example` is committed and holds a port and a placeholder database URL. Real credentials belong in the ignored `.env` or deployment environment.

### Where the rest will go

| Planned file | Job |
| --- | --- |
| `src/middleware/auth.ts` | `verifyToken` (who are you), `requireRole` (are you allowed) |
| `src/routes/AuthRoute.ts`, `WalletRoute.ts`, `TransferRoute.ts`, `AdminRoute.ts` | Wiring |
| `src/controllers/…Controller.ts` | One per resource |
| `src/controllers/TransferController.ts` | Owns the transfer transaction: claim key, lock, validate, write, commit |

---

## 4. Tracing a request end to end

`GET /health/live`:

1. `index.ts` has already run `dotenv.config()`, built the app and called `listen`.
2. `attachRequestId` puts a UUID on `req.requestId` and in the `X-Request-Id` header.
3. The request matches `/health`, so it goes to `HealthRoute`, which matches `/live` and calls
   `HealthController.getLiveness`.
4. The controller responds `{"status":"ok"}`.

`GET /nope`: steps 1 and 2 as above. No route matches, so Express reaches `respondNotFound`, which
returns 404 with the error format carrying the same ID as the header.

A route that throws: steps 1 and 2 as above. The throw — or a rejected promise — reaches
`respondInternalError`, which logs the real error with the request ID and returns 500 with a fixed
message. The client gets an ID to quote; the message and stack stay on the server.

Confirmed by hand against the compiled build:

```
GET /health/live -> 200  X-Request-Id: 35638df4-21a8-4847-8858-ae632e5749fc
GET /nope        -> 404  {"error":{"code":"NOT_FOUND","message":"Route not found.","requestId":"dd1f28db-..."}}
GET /boom        -> 500  {"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred.","requestId":"072ac170-..."}}
GET /boom-async  -> 500  same shape
```

And the server log for `/boom`, where the detail stayed:

```
request_failed { requestId: '072ac170-44f7-4a0d-b8c6-68b6d2b24b77', path: '/boom', error: Error: sensitive internal detail ... }
```

---

## 5. Decisions, each with its reason and its limitation

| Decision | Reason | Limitation |
| --- | --- | --- |
| One `index.ts`, no separate app file | One entry point to read, same as the last project | Importing it starts a listener; isolated HTTP tests need a revised entry point or a process-based harness. Reopens when the transfer tests are needed |
| Vitest for pure domain behavior | Schemas, fingerprints, and policy decisions are testable without importing the listening server | 46 unit tests do not prove locking, rollback, or idempotent transaction execution |
| `console.error` rather than a logging library | Nothing to configure or defend | Log lines are not machine-parseable JSON, and there is no automatic per-request logging. Fine for one instance; revisit if the spec's structured-log requirement is pressed |
| `dotenv` | The conventional choice, recognized without explanation | Loads but does not validate. On Render the variables come from the dashboard and no file is read |
| `PORT` read inline with `|| 3000` | Nothing to explain | A malformed `PORT` is not caught. `models/db.ts` requires DATABASE_URL when imported; the HTTP entry point does not yet validate database or JWT configuration |
| UUID request IDs, generated not accepted | The error format needs an ID the client can quote, and a counter collides across restarts and instances | A UUID is longer in logs |
| One error middleware with a fixed 500 message | Internals must never reach the client, and Express's default leaks a stack trace | No error taxonomy yet; business errors get real codes as features land |
| Money as `bigint` and kobo, strings in JSON | Floating point cannot represent `0.1` exactly, and rounding errors accumulate across transfers. JSON numbers are doubles, so a `bigint` must cross the wire as a string | Callers must handle strings, and every arithmetic path must avoid `number` |
| `pg` rather than Prisma | The transfer needs `SELECT ... FOR UPDATE` with a specific lock order and an explicit transaction, which is raw SQL territory | More SQL written by hand than with an ORM |
| Shared Zod amount and currency schemas | Request validation and direct callers share one definition; no custom parser-result adapter | Callers handle Zod's typed success/error result; validation does not prove database state is current |
| Explicit transfer policy and result types | Ownership-first decisions and known rejection reasons are visible | Requires validated amounts and state supplied from locked database rows |
| SHA-256 fingerprint of normalized request details | Detects different details under the same idempotency key | The hash alone does not prevent duplicates; unique constraints and the atomic transaction must enforce idempotency |
| No graceful shutdown yet | The thing that needs closing is the database pool, so write it once | In-flight requests are cut on deploy until then |

---

## 6. What has and has not been verified

The latest code checks passed: `npm test` (46 tests in two files), `npm run typecheck`, and
`npm run build`, all run from `server/`. Money tests cover accepted/rejected input, exact boundaries,
whitespace and leading zeroes, and string serialization. Transfer tests cover strict request
validation, stable fingerprints, changed details, and policy decisions including ownership first.

The earlier manual HTTP checks in section 4 are historical observations; `/boom` and `/boom-async`
are not permanent public routes. No automated HTTP test currently reproduces those checks.

No PostgreSQL integration, concurrency, crash, deployment, load, or security-review evidence is
established by these unit checks. A migration runner existing is not proof it succeeded on a database.

---

## 7. The two questions that decide the interview

These are about the design, not code that exists yet. Say so, then answer.

### "Two requests spend from the same wallet at the same time. What stops the balance going negative?"

A wallet holds ₦10,000. Two requests each send ₦8,000. If both read the balance before either writes,
both see ₦10,000, both pass the check, and the wallet ends at minus ₦6,000.

The fix is that each request must take the wallet's row lock *before* reading the balance, using
`SELECT ... FOR UPDATE` inside one transaction. The second request waits, then reads ₦2,000 and is
rejected for insufficient funds. The lock is the single key to one door: whoever holds it goes in,
everyone else queues.

Three follow-ups:

- *Why not `SERIALIZABLE` isolation?* It would also be correct, but it aborts more transactions under
  load and needs retry logic everywhere. `READ COMMITTED` with explicit row locks gives the same
  safety here with more predictable behaviour.
- *Why lock in sorted ID order?* If A to B and B to A run at once and each locks its own sender first,
  each holds what the other needs, forever. That is a deadlock. Sorting by ID means both reach for the
  same row first, so one simply waits. Users are locked before wallets everywhere, including block and
  unblock, so an admin blocking a user and a transfer involving that user serialize through the same
  row.
- *Why keep a balance column at all, if there is a ledger?* The balance makes reads fast; the ledger is
  the history that proves the balance is right, and reconciliation checks they agree. A balance check
  in application code cannot protect against concurrency — only the locked transaction can.

### "The client's connection drops mid-transfer. Did the money move?"

Unknown, and that is the point. The service must never report "failed" when all it knows is that a
response or a commit acknowledgement was lost.

Every `POST /transfers` carries an `Idempotency-Key` header, unique per authenticated user, operation
and key. It is the number on a payment slip: hand the same slip in twice and the cashier says "already
done" and gives back the same receipt. The record is inserted *inside* the transfer transaction with
`INSERT ... ON CONFLICT DO NOTHING`, so nothing half-finished is ever visible to another request. A
concurrent duplicate waits on the unique index, then reads the committed result.

Stored with the key is a fingerprint of the normalized transfer details — source wallet, destination
wallet, currency, amount — never the raw JSON formatting. The same key with different details means
something is wrong, so it is a 409 and no money moves.

Follow-ups:

- *Is a rejection for insufficient funds stored?* Yes, committed as the key's result with no balance
  change. Retrying after a top-up is a new intent and needs a new key.
- *What if the transaction rolled back?* Then neither the key nor the movement committed, and a retry
  with the same key executes normally.
- *What proves there are no duplicates?* Idempotency, not reconciliation. A balanced ledger would still
  balance if a transfer ran twice. Reconciliation proves the books are internally consistent;
  idempotency proves each intent executed once.

---

## 8. Things not to claim

- Do not say the invariants are proven. They are specified; proving them needs the database and tests.
- Describe the tests precisely: 46 unit tests pass; HTTP checks were manual; database concurrency
  and failure-recovery tests have not been established.
- Do not claim performance or security properties. Nothing has been measured or reviewed.
- Do not describe the planned rate limiting as production-grade. It will be in-memory and
  single-instance, and a restart resets it. More instances would need a shared store.
- If something cannot be explained from the code in front of you, say so rather than reciting this
  document. Simplifying it is a better answer than a memorized one.

---

## 9. What comes next, in the spec's order

1. Verify the seven existing migrations on a dedicated database, including constraints and repeat runs.
2. Seed: the system funding wallet, demo customers funded through real ledger-backed transfers,
   blacklist entries, one admin. Running it twice must not fund twice.
3. `/health/ready` and an early Render deploy, to surface configuration problems now rather than the
   night before submission.
4. Registration with the blacklist check, login, JWT, authorization.
5. The atomic idempotent transfer.
6. History, admin block and unblock with audit records, rate limits.
7. Reconciliation, deployed checks, final documentation.

**One open decision, for the transfer stage.** The spec's definition of done requires integration tests
against real PostgreSQL for concurrent overspending, duplicate idempotency keys, mismatched
fingerprints, opposite-direction transfers, mid-transfer rollback and the block-versus-transfer race.
Those tests need to drive the app without binding the configured port, which is the reason the split
entry file existed. When we get there the options are to export the app from `index.ts` and guard the
`listen`, or to test the transfer function directly against a test database without going through
HTTP. Worth deciding then, not now.

**Two deployment facts to carry into tomorrow.** Render's free web services sleep when idle, so the
first request after a pause is slow and that is not a bug. Render's free PostgreSQL becomes
inaccessible 30 days after creation, so if the review window could pass that date the database needs
upgrading — "a live URL we can hit" has to actually answer.


## 10. Explaining the domain changes

### Why use Zod for money and requests?

`amountMinorSchema` accepts a string, trims surrounding whitespace, checks ASCII digits, converts
directly to `bigint`, then enforces positivity and the existing product maximum. Numbers, decimals,
signs, and exponent notation are rejected. `" 000150000 "` becomes exactly `150000n` without modifying
the caller's object. No conversion passes through `number`.

`transferRequestSchema` composes this schema with wallet IDs and the NGN currency schema. It rejects
unknown fields and infers `TransferRequest` from the validated output, so the amount is a `bigint` in
that type. `describeIssues` supplies field names and messages for validation responses.

We removed `parseAmountMinor`, `AmountParseResult`, and `AmountRejection`. They only translated Zod's
existing success/error result into a second format. That translation required the switch statement;
removing the adapter removed the switch. A `forEach` would iterate issues, and a return inside its
callback would not return from the outer function. It was not the right replacement for choosing one
error result.

Direct use:

```ts
const result = amountMinorSchema.safeParse(input);
if (result.success) {
  const amountMinor = result.data; // bigint
} else {
  const issues = result.error.issues;
}
```

**Current integration gap:** `validateTransferRequest` exists, but there is no transfer route. On
success the middleware calls `next()` without passing `result.data` onward; `req.body` remains raw.
Before a controller consumes it, define an explicit handoff of the validated output. Do not claim
that wiring is complete or that the controller already receives a bigint.

The current cap is 1,000,000,000 kobo (NGN 10,000,000). It predates this refactor; we preserved it.
Q16 remains open for product confirmation. A transfer cap also does not guarantee that a recipient's
accumulated balance cannot exceed PostgreSQL BIGINT. That needs consideration in the transaction.

### Why keep the transfer policy types and if statements?

`TransferPolicyInput` names the trusted state the function needs. `TransferPolicyResult` distinguishes
approval from rejection, and `TransferRejection` limits rejection reasons to known values. These are
the business function's contract; there is no existing Zod policy result being translated twice.

Ownership is checked first so an unauthorized caller does not learn whether another account is
blocked or short of funds. Same-wallet, system-wallet, restrictions, currency, and funds checks then
run in order. Moving everything into a schema could obscure that order and mix request validation
with decisions about database state.

The function assumes a validated positive amount and correctly associated party/wallet records. It
does not fetch records, verify their freshness, or take locks. The transaction must supply the
matching records under locks. See Q24 in DECISIONS.md.

### What does fingerprintTransfer mean in a web app?

It hashes normalized transfer details, not a browser, device, user identity, or biometric. A web
client may send a transfer, lose the reply, and retry. The idempotency key names the intended
operation; its fingerprint checks whether the details still match that operation.

For example, first send 100000 kobo with key `payment-123`. Retrying that key with the same normalized
wallets, currency, and amount should replay the original result. Retrying it with 500000 kobo must
return `409` under this project's build spec. A different key is a new intent even if the fingerprint
is identical. The fingerprint is not globally unique per transfer.

The helper joins source wallet, destination wallet, currency, and canonical bigint amount in fixed
order with `|`, then hashes using Node's SHA-256. Validated numeric IDs, a fixed currency, and digit
amounts cannot contain the separator. If those field types change, revisit the encoding. Hash
collisions are theoretically possible; this is not a signature or authentication mechanism.

**Naming:** "idempotency fingerprint" is established terminology in the
[IETF Idempotency-Key draft, section 2.4](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-08#section-2.4).
That is a draft, not a final standard, and it does not prescribe a JavaScript function name. The
clearer proposed name here is `createTransferRequestFingerprint`. The current code still calls it
`fingerprintTransfer` in `transferPolicy.ts`; a dedicated `transferFingerprint.ts` would separate
retry identity from transfer eligibility. Neither rename nor move has been implemented.

The fingerprint helper is unit-tested. Durable idempotency, saved-result replay, and concurrent
key coordination remain planned transaction behavior. See Q25 in DECISIONS.md.

### How do we keep the work reviewable?

Use a branch per feature, focused conventional commits, and relevant checks before committing.
Guidance documents remain excluded from Git. Git author and committer were verified as
`Izunnaya <ugorjimicheal.um@gmail.com>`; the automated assistant does not replace that identity.
The Zod refactor branched from the existing unmerged domain implementation so it could preserve
that work without merging unrelated changes into main. This is an exception to the normal
branch-from-main rule; review the inherited commits when integrating it. See Q27.
