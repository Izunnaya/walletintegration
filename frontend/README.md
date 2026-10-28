# Wallet frontend

React and Vite UI for the wallet API in `../server`. The Restaurant frontend supplied the structure: thin screen components, resource API hooks, workflow form folders, React Hook Form and Zod. Authentication follows this backend's bearer-token contract.

## Run locally

```sh
npm ci
# Copy .env.example to .env.local and set VITE_API_BASE_URL.
npm run dev
npm run typecheck
npm run build
```

Open http://localhost:3001. `VITE_API_BASE_URL` defaults to http://localhost:3000 and is public build configuration; never put secrets in it. To use the deployed API, set it to `https://walletintegration-6t6r.onrender.com` and restart Vite. The API must allow the frontend origin through CORS. A free Render instance can take time to wake; requests time out after 65 seconds and show a slow-request notice.

## Screens and backend coverage

| Screen | API |
| --- | --- |
| Create account | POST /auth/register; creates a customer and wallet, then asks them to sign in |
| Sign in | POST /auth/login |
| Overview | GET /wallets/me and recent GET /transfers |
| Send money | POST /transfers with Idempotency-Key |
| Transactions | GET /transfers using the server's cursor |
| Transfer receipt | GET /transfers/:id |
| Admin account access | POST /admin/users/:id/block or /unblock with a reason |
| Admin audit log | GET /admin/audit (latest 50 entries) |
| Service status footer | GET /health/live and /health/ready |

There is no user directory, recipient lookup, profile editor, deposits, transfer notes, analytics or blacklist editor in the current API. The UI asks for the recipient's wallet ID and the administrator's target user ID. Reconciliation, seeding and admin creation remain server CLI operations. User ID and wallet ID are different identifiers.

## Structure and responsibilities

```text
src/
  api/                         Shared HTTP client, Zod response contracts, resource hooks
  auth/AuthProvider.tsx        Session lifecycle and cache cleanup
  pages/                       Screen composition and workflow actions
  forms/<workflow>-form/       Form schema, fields and workflow-specific logic
    transfer-form/attempt.ts   Pure intent helpers and tab-storage boundary
    transfer-form/useTransferAttempt.ts  Explicit transfer recovery workflow
  layouts/                     Public authentication shell and signed-in shell
  components/                  Reused presentation and loading states
    ui/                        Existing shadcn primitives
  hooks/useRetryAfter.ts       Shared nonfinancial request cooldown
  lib/                         Pure money/validation helpers, motion settings, notifications
```

`apiRequest` handles JSON, bearer headers, cancellation, timeouts, response validation and server errors. Resource hooks own TanStack Query caching and invalidation. Pages do not fetch directly or copy server records into local state. Forms validate with React Hook Form and Zod; the backend still enforces every rule. Query keys include the current user, and changing sessions cancels reads and clears the cache.

Pure functions handle money, IDs, validation and intent comparison. Storage, timers, HTTP and React state remain explicit effects. There is no generic repository or workflow framework. Installed framer-motion, react-loading-skeleton, sonner and LoadingButton provide transitions, placeholders and notifications. Motion respects the system's reduced-motion preference. A captured route outlet prevents an exiting transition from remounting the next screen's form.

## Authentication and errors

The API returns a JWT in JSON and has no cookie or refresh endpoint. The session is kept in per-tab sessionStorage, survives reload, and is removed at sign-out or a protected 401. Passwords are never stored. If storage is blocked, login works in memory. Session storage is accessible to JavaScript and is not protection against XSS; an HttpOnly-cookie session would require a backend change. Client role guards control navigation; the backend authorizes requests.

Errors display the server's message, field details and Retry-After where supplied. Request IDs stay on the API error for diagnostics and are not rendered in alerts or toasts. Authentication and admin writes have no automatic retries. Reads retry a server failure once, and do not automatically retry 401 or 429 responses. Public account forms and admin confirmation honor Retry-After with a disabled countdown. Browser access to response headers depends on the API exposing them through CORS.

## Money and transfer recovery

Money and database IDs stay strings across JSON, and money arithmetic uses bigint. Form amounts in naira convert exactly to kobo. The form mirrors the backend's NGN 10 million transfer ceiling, positive BIGINT identifiers and UTF-8 password length limit.

Reviewing a transfer creates a UUID key. Before sending, its exact source, destination, amount and key are saved under `wallet.transfer:<userId>` in sessionStorage. A network error, server error, invalid success response or expired session leaves that intent unresolved. The user checks it by resending the same key and body; the UI prevents editing it into a different payment. Mutation auto-retries are disabled. A known business rejection permits a new intent and a new key. A 429 keeps the existing key and honors Retry-After. Successful transfers clear the attempt and invalidate wallet and history reads.

Sending is refused when the attempt cannot be saved. Recovery covers reloads, navigation and re-authentication in the same tab. Closing the tab or clearing browser storage loses that recovery record; history and the server's idempotency ledger remain authoritative. Client state does not provide server concurrency or accounting guarantees.

## Verification

```sh
npx playwright install chromium
npm test
# On Windows, use installed Edge instead if preferred:
# $env:PLAYWRIGHT_CHANNEL='msedge'; npm test
```

The 17 checks cover exact large amounts/IDs, password bytes, login/registration, role guards, cursor pagination, receipts, clear errors without internal request IDs, rate limiting, interrupted-transfer recovery, fresh keys after rejection, session expiry, account isolation, admin audit actions and mobile navigation/theme. Browser requests are intercepted with backend-shaped fixtures: these tests verify frontend behavior, not production concurrency or database correctness. Tests use a separate Vite instance on port 3012 and override the API URL, so they never send money to production.

Production smoke verification separately used an existing demo account to read its wallet and display the transfer form. No money or admin changes were submitted.

## Public wallet identifiers

Wallet display, copy, recipient entry, confirmation and history use persisted `wlt_` identifiers. The backend retains numeric primary keys for ledger relationships and accepts numeric transfer inputs for compatibility. Public response fields are optional during rollout, so the UI can still read the previous API and replay older saved responses. Existing numeric transfer attempts keep their original body and key. Deploy the backend migration and API to activate public IDs; frontend formatting alone does not create them.
