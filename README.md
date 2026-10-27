# Wallet Service

## Financial invariants

These are the required guarantees. The foundation does not implement financial operations yet.

1. Customer wallet balances never go negative.
2. Successful transfers debit and credit equal amounts in the same currency.
3. The transfer, both ledger entries, both balance updates, and idempotency result commit together or not at all.
4. Retrying an operation cannot move money twice.
5. Users can transfer only from their own wallet.
6. Users can view only wallets and transfers they are authorized to see.
7. Account restrictions are checked under database locks inside the transfer transaction.
8. Every balance change has matching immutable ledger entries.
9. Financial records are never deleted or rewritten; corrections use compensating entries.
10. A timeout does not mean a transfer failed.

## Current stage

The repository contains an Express/TypeScript foundation with `GET /health/live`, a per-request ID returned in the `X-Request-Id` header and in every error response, the shared JSON error format for unknown routes and unexpected failures. Database connectivity, readiness, authentication, financial operations, automated tests, and deployment are not implemented yet.

The target is one API and PostgreSQL database, deployed on Render. It handles internal NGN transfers. Payment providers, deposits, withdrawals, notifications, queues, Redis, and a UI are outside this build.

## Repository layout

```
server/     the wallet service API, described below
frontend/   placeholder; nothing is built there yet
```

The server has no dependency on the frontend folder. The API is the contract between them.

## Local setup

Use Node.js 22.18 or newer within the 22.x release line and npm. All commands below run from `server/`.

```sh
cd server
npm ci
```

Optionally copy `server/.env.example` to `server/.env` and change `PORT` (default `3000`). In PowerShell use `Copy-Item server/.env.example server/.env`.

```sh
npm run dev
npm run typecheck
npm run build
npm start
```

`dotenv` loads `.env` at startup. Deployed configuration comes from Render environment variables instead.

Run either the development server or the built server at a time. On Windows, use `npm.cmd` if PowerShell execution policy blocks `npm.ps1`.

`GET http://localhost:3000/health/live` returns `200` with `{"status":"ok"}`. It proves only that the HTTP process responds. Database readiness will be a separate endpoint. A port already in use produces a startup error; stop the other server or set a different `PORT`.

## File and request flow

The backend follows a routes / controllers / middleware layout.

```
server/src/
  index.ts                        # dotenv, express, middleware, mount routes, listen
  routes/
    HealthRoute.ts                # one router per resource, wiring only
  controllers/
    HealthController.ts           # one controller per resource
  middleware/
    requestId.ts                  # gives each request a UUID and the X-Request-Id header
    errorHandler.ts               # respondNotFound and respondInternalError
```

Route files hold no logic. As authentication arrives, the order inside each one is authenticate,
authorize, validate, controller. `tsconfig.json` compiles `src/` into `dist/`.

Express handles HTTP routing. TypeScript checks types and produces deployment JavaScript. The Node and Express type packages provide compile-time definitions. Native Node TypeScript support runs development files; it does not replace `npm run typecheck`.

## Account and money contract

- Each user gets one NGN wallet at zero balance, created atomically with registration.
- Emails are trimmed and lowercased for login, registration, uniqueness, and blacklist matching.
- Registration assigns `customer`; supplied `role`, `blocked`, `balance`, and `is_system` fields will be rejected.
- Blocked or blacklisted users cannot send or receive. Unblocking does not remove a blacklist restriction.
- Only admins change blocking status, and each change commits with its audit record. There is no account deletion.
- `amountMinor` is a positive integer string in kobo: `"150000"` means NGN 1,500. Calculation uses `bigint`, storage uses PostgreSQL `BIGINT`, and JSON uses strings.
- Zero, negative, fractional, over-limit, same-wallet, and wrong-currency transfers are rejected. The maximum amount will be fixed and documented with transfer validation.
- Only the seed script can use the system funding wallet. Customer endpoints cannot create it, change its flag, or transfer to/from it.

## Planned API contract

Only liveness is implemented at this stage. Exact authentication payloads and response fields will be documented with their features.

| Endpoint | Access | Required behavior |
| --- | --- | --- |
| `POST /auth/register` | Public | Create customer and zero-balance wallet; reject blacklisted email |
| `POST /auth/login` | Public | Verify credentials and issue JWT |
| `GET /wallets/me` | User | Return own wallet and balance |
| `POST /transfers` | User | Execute idempotent transfer from an owned wallet |
| `GET /transfers` | User | Paginated history involving caller |
| `GET /transfers/:id` | User | Return transfer only to an authorized participant |
| `POST /admin/users/:id/block` | Admin | Block and audit atomically |
| `POST /admin/users/:id/unblock` | Admin | Unblock and audit atomically |
| `GET /health/live` | Public | Confirm process responds |
| `GET /health/ready` | Public | Confirm database is reachable |

Transfer requests will include `sourceWalletId`, `destinationWalletId`, `currency`, and `amountMinor`, plus an `Idempotency-Key` header. The JWT determines the caller; a source wallet ID never grants ownership. Authentication and syntax validation happen before claiming a key.

Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Responses include `X-Request-Id`, generated by the server; a client-supplied value is ignored so log records cannot be forged. Unexpected failures return `INTERNAL_ERROR` with a fixed message; the exception message and stack go to the logs under the same request ID, never to the client.

| Status | Meaning |
| --- | --- |
| `400` | Invalid input |
| `401` / `403` | Missing/invalid authentication or denied access |
| `404` | Resource or route not found |
| `409` | Idempotency key reused with different normalized transfer details |
| `422` | Business rejection such as insufficient funds or account restriction |
| `429` | Rate limit exceeded; include `Retry-After` |
| `500` | Unexpected failure; no internal detail in the response |
| `503` | Database unavailable or lock wait timed out; retry transfers with the same key |

## Financial implementation plan

Seven tables hold users, wallets, successful transfers, ledger entries, idempotency records, blacklist entries, and admin audit entries. Database constraints enforce relationships and prevent negative customer balances.

The transfer service owns one explicit `READ COMMITTED` transaction: claim key, lock users in sorted ID order, lock wallets in sorted ID order, validate, write the transfer and ledger, update balances, store the response, then commit. All queries use the same transaction client. Blocking uses the same user-row locks.

Idempotency keys are unique per authenticated user, operation, and key. Fingerprints use normalized details. Successes and deterministic business rejections are retained and replayed. Different details with the same key produce `409`. A database rollback leaves neither movement nor a claimed key. An uncertain commit is resolved by retrying with the same key. Only recognized deadlock/serialization errors receive bounded whole-transaction retries.

The seed will fund demo customers through ledger-backed transfers with stable references, so rerunning it cannot add money twice. Reconciliation will check balances, paired ledger entries, amounts, wallets, currencies, and system funding inside one read-only `REPEATABLE READ` transaction.

## Decisions

- Follow the routes / controllers / middleware layout, one router and one controller per resource, matching the structure used in earlier projects. `index.ts` sets up and starts the app; there is no separate app module.
- Use Express 5 for a small, direct HTTP layer and strict TypeScript for explicit boundaries. See the [official Express installation guide](https://expressjs.com/en/starter/installing/).
- Use Node's TypeScript support and the compiler without adding a separate runtime transpiler. Type-only imports must say `import type`, because Node resolves the real imports at runtime.
- Load `.env` with `dotenv` at the top of `src/index.ts`. Deployed configuration comes from Render environment variables, not a file.
- Read `PORT` inline with a default of `3000`. `DATABASE_URL` and `JWT_SECRET` will be checked for presence at startup, because a service that starts without them fails every request.
- Generate the request ID on the server with `randomUUID` and return it in `X-Request-Id` and in every error. A client-supplied value is ignored, so log records cannot be forged. A per-process counter was rejected because it repeats after a restart and collides across instances.
- Register one error-handling middleware so unexpected failures use the documented format. Express 5 forwards rejected promises to it, so async route failures are covered. Without it, Express replies with an HTML stack trace.
- Log with `console`. The error handler records the request ID, path and real error; the client receives only the request ID.
- Add dependencies and feature folders only when they solve a current need.
- Keep the blacklist seed-managed initially; optional management endpoints are deferred.
- Never report readiness before a real database check exists.

## Development workflow

### Branches

`main` is the base branch. One branch per feature, named `feature/<thing>`, following the build
spec's order. A branch is merged into `main` once its feature works and its checks pass, and the next
branch starts from the updated `main`. Dependent work does not start on a branch of a branch.

| Branch | Feature |
| --- | --- |
| `feature/project-foundation` | HTTP foundation, request IDs, error format, liveness (current) |
| `feature/database-migrations` | Seven tables with every constraint, including `CHECK (balance >= 0 OR is_system = TRUE)` |
| `feature/seed-data` | System funding wallet, funded demo customers, blacklist, admin |
| `feature/health-ready` | Database connection pool and `/health/ready` |
| `feature/render-deploy` | Live deployment with migrations on deploy |
| `feature/auth` | Registration with the blacklist check, login, JWT, authorization |
| `feature/transfers` | The atomic idempotent transfer |
| `feature/transfer-history` | `GET /transfers` and `GET /transfers/:id` |
| `feature/admin-restrictions` | Block and unblock with audit records |
| `feature/rate-limiting` | Per-user and per-IP limits with `Retry-After` |
| `feature/reconciliation` | The `npm run reconcile` command |

### When to commit

Commit when one idea is finished and the tree still works, not at the end of a session. In practice
that means a commit for each of these, separately:

- One migration file.
- One route plus its controller.
- One middleware.
- One pure function plus its test.
- A documentation change that describes work already committed.

Two rules that keep the history readable:

- **Never mix a refactor with a behaviour change.** Moving code and changing what it does in one
  commit makes both impossible to review.
- **Never commit a tree that does not type-check.** Run the gate below first. A commit that does not
  build cannot be bisected to, which defeats the point of frequent commits.

Before every commit:

```sh
npm run typecheck
npm run build
```

Once tests exist, `npm test` joins that list, and a commit that breaks a test is not made.

### Commit messages

Conventional prefixes, a short imperative subject, and a body that says *why* when the subject cannot:

| Prefix | Use |
| --- | --- |
| `feat:` | New behaviour a caller can observe |
| `fix:` | A defect corrected |
| `refactor:` | Structure changed, behaviour identical |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `chore:` | Dependencies, configuration, tooling |

For anything touching money, the body states which invariant the change protects and what happens on
failure. A reviewer should be able to read the log and see the financial reasoning without opening
the diff.

### Remote

No remote is configured, so the history is local only. If the commit history itself needs to be
visible to a reviewer, add a remote and push each feature branch before merging.

The original guidance documents remain local and are excluded by `.gitignore`, along with secrets,
dependencies, generated output, and local tooling files.

## Next stages and evidence

Foundation checks, run by hand against the compiled build:

- `npm run typecheck` and `npm run build` pass, and `dist/` mirrors `src/`.
- `GET /health/live` returned `200` with `{"status":"ok"}` and a UUID `X-Request-Id`.
- An unknown route returned `404` in the documented error format, carrying the same ID as the header.
- A throwing route and a rejecting route each returned `500` in that format with no exception message or stack, while the real error and the request ID went to the server log.

**There are no automated tests yet, so none of this is reproducible from a single command.** It also establishes no financial guarantee: no database, authentication, or concurrency behaviour exists. The build spec's definition of done requires integration tests against real PostgreSQL for concurrent overspending, duplicate idempotency keys, mismatched fingerprints, opposite-direction transfers, mid-transfer rollback, and the block-versus-transfer race. Those arrive with the transfer, and they need to drive the app without binding the configured port.

1. Database migrations and constraints.
2. Repeatable seed funding, blacklist, and admin.
3. Database readiness and early Render deployment.
4. Registration, login, JWT, and wallet authorization.
5. Atomic transfers and real PostgreSQL integration tests.
6. History, admin restrictions, audit records, rate limits, and logging.
7. Reconciliation, deployed checks, and final documentation.

Financial tests must cover concurrent overspending, concurrent duplicate keys, mismatched fingerprints, opposite-direction transfers, rollback after the first balance update, response loss after commit, ownership, restriction races, blacklist rejection, system-wallet exclusion, privileged registration input, and repeated seeding. Check financial records as well as responses. Inject application failures through test dependencies; do not claim they simulate process crashes.

Deployment will run migrations and expose database readiness; seeding remains manual. Record database creation/expiry and verify it remains available through the review window. Deployment settings and provider policies must be checked at that stage.
