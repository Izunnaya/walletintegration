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

The repository contains an Express/TypeScript foundation with `GET /health/live`, request IDs, a JSON 404 response, and port validation. Database connectivity, readiness, authentication, financial operations, and deployment are not implemented yet.

The target is one API and PostgreSQL database, deployed on Render. It handles internal NGN transfers. Payment providers, deposits, withdrawals, notifications, queues, Redis, and a UI are outside this build.

## Local setup

Use Node.js 22.18 or newer within the 22.x release line and npm.

```sh
npm ci
```

Optionally copy `.env.example` to `.env` and change `PORT` (default `3000`). In PowerShell use `Copy-Item .env.example .env`.

```sh
npm run dev
npm run typecheck
npm run build
npm start
```

Run either the development server or the built server at a time. On Windows, use `npm.cmd` if PowerShell execution policy blocks `npm.ps1`.

`GET http://localhost:3000/health/live` returns `200` with `{"status":"ok"}`. It proves only that the HTTP process responds. Database readiness will be a separate endpoint. An invalid port stops startup; correct the configuration and restart. A port already in use produces a startup error; stop the other server or select another port.

## File and request flow

- `src/server.ts` reads configuration and starts the HTTP listener.
- `src/config.ts` validates the port before the server starts.
- `src/app.ts` builds the application, assigns a server-generated request ID, and handles liveness and unknown routes.
- `tsconfig.json` enables strict checking and compiles source into `dist/`.

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

Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Responses include `X-Request-Id`.

| Status | Meaning |
| --- | --- |
| `400` | Invalid input |
| `401` / `403` | Missing/invalid authentication or denied access |
| `404` | Resource or route not found |
| `409` | Idempotency key reused with different normalized transfer details |
| `422` | Business rejection such as insufficient funds or account restriction |
| `429` | Rate limit exceeded; include `Retry-After` |
| `503` | Database unavailable or lock wait timed out; retry transfers with the same key |

## Financial implementation plan

Seven tables hold users, wallets, successful transfers, ledger entries, idempotency records, blacklist entries, and admin audit entries. Database constraints enforce relationships and prevent negative customer balances.

The transfer service owns one explicit `READ COMMITTED` transaction: claim key, lock users in sorted ID order, lock wallets in sorted ID order, validate, write the transfer and ledger, update balances, store the response, then commit. All queries use the same transaction client. Blocking uses the same user-row locks.

Idempotency keys are unique per authenticated user, operation, and key. Fingerprints use normalized details. Successes and deterministic business rejections are retained and replayed. Different details with the same key produce `409`. A database rollback leaves neither movement nor a claimed key. An uncertain commit is resolved by retrying with the same key. Only recognized deadlock/serialization errors receive bounded whole-transaction retries.

The seed will fund demo customers through ledger-backed transfers with stable references, so rerunning it cannot add money twice. Reconciliation will check balances, paired ledger entries, amounts, wallets, currencies, and system funding inside one read-only `REPEATABLE READ` transaction.

## Decisions

- Use Express 5 for a small, direct HTTP layer and strict TypeScript for explicit boundaries. See the [official Express installation guide](https://expressjs.com/en/starter/installing/).
- Use Node's development runtime and TypeScript compiler without adding a separate runtime transpiler.
- Add dependencies and feature folders only when they solve a current need.
- Keep the blacklist seed-managed initially; optional management endpoints are deferred.
- Add database and JWT configuration validation with the features that need those values.
- Never report readiness before a real database check exists.

## Development workflow

`main` is the base branch. Each feature uses its own `feature/<name>` branch. Keep commits focused and describe the change clearly. Run relevant checks before committing completed work; merge reviewed features before starting dependent branches.

The original guidance documents remain local and are excluded by `.gitignore`, along with secrets, dependencies, generated output, and local tooling files. No remote or deployment is configured yet.

## Next stages and evidence

Foundation checks passed: `npm run typecheck`, `npm run build`, and a local HTTP smoke check against the compiled application for liveness, request IDs, JSON 404 responses, and absent readiness. Port validation rejected empty, non-integer, zero, and out-of-range values. Git exclusion checks confirmed both original guidance documents are ignored. These checks do not establish any financial guarantees; no database tests have run yet.

1. Database migrations and constraints.
2. Repeatable seed funding, blacklist, and admin.
3. Database readiness and early Render deployment.
4. Registration, login, JWT, and wallet authorization.
5. Atomic transfers and real PostgreSQL integration tests.
6. History, admin restrictions, audit records, rate limits, and logging.
7. Reconciliation, deployed checks, and final documentation.

Financial tests must cover concurrent overspending, concurrent duplicate keys, mismatched fingerprints, opposite-direction transfers, rollback after the first balance update, response loss after commit, ownership, restriction races, blacklist rejection, system-wallet exclusion, privileged registration input, and repeated seeding. Check financial records as well as responses. Inject application failures through test dependencies; do not claim they simulate process crashes.

Deployment will run migrations and expose database readiness; seeding remains manual. Record database creation/expiry and verify it remains available through the review window. Deployment settings and provider policies must be checked at that stage.
