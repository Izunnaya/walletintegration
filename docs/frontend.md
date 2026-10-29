# Frontend guide

The frontend lets a customer create an account, view their wallet and send money.
Admins can block or unblock accounts and read the action log. Every screen uses an
existing backend endpoint.

## Run it

From `frontend/`, run `npm ci`, copy `.env.example` to `.env.local`, then run
`npm run dev`. Open http://localhost:3001.

Set `VITE_API_BASE_URL` to the backend URL. It defaults to http://localhost:3000.
Restart Vite after changing it. This value is included in the browser build, so it
must never contain a secret. The backend must allow the frontend origin in CORS.

## Where the code belongs

| Folder or file | Responsibility |
| --- | --- |
| `src/main.tsx` | Router, query cache, session, theme, motion and notifications |
| `src/AppRoutes.tsx` | Routes, lazy page loading and navigation guards |
| `src/pages/` | Screens and their actions |
| `src/forms/<workflow>-form/` | Fields, validation and logic for one workflow |
| `src/api/` | HTTP client, response schemas and resource hooks |
| `src/auth/AuthProvider.tsx` | Sign-in, sign-out and session expiry |
| `src/layouts/` | Public and signed-in page layouts |
| `src/components/` | Shared display components and loading states |
| `src/components/ui/` | Existing UI primitives |
| `src/lib/` | Money, validation, motion and notification helpers |
| `src/hooks/` | Small hooks used by more than one workflow |

Keep a feature near its screen or form. Move a component to the shared folder when
another screen needs it. Pages use API hooks; they do not call `fetch` directly.
Pure functions handle calculations and validation. Hooks handle browser storage,
timers, requests and state.

## Screens and endpoints

| Route | Screen | Backend calls |
| --- | --- | --- |
| `/register` | Create account | `POST /auth/register` |
| `/login` | Sign in | `POST /auth/login` |
| `/` | Overview | `GET /wallets/me`, `GET /transfers` |
| `/transfer` | Send money | `GET /wallets/me`, `POST /transfers` |
| `/transactions` | History | `GET /transfers` with the returned cursor |
| `/transactions/:id` | Receipt | `GET /transfers/:id` |
| `/admin/access` | Account access | `POST /admin/users/:id/block` or `/unblock` |
| `/admin/audit` | Action log | `GET /admin/audit` |
| Shared footer | Service status | `GET /health/live`, `GET /health/ready` |

Registration creates a customer and an empty wallet, then returns the user to
sign-in. It does not create an admin or sign the user in automatically.

The backend has no recipient lookup or user directory. A sender enters the
recipient's wallet ID. An admin enters a **user ID** and a reason. Those IDs have
different meanings. The audit endpoint returns the latest 50 actions.

Deposits, withdrawals, profile editing and blacklist editing have no backend
endpoints, so the UI does not offer them.

## How an API request works

A page calls a resource hook such as `useTransfers`. The hook calls `apiRequest`
with a path, a Zod response schema and any token, body or idempotency key.

`apiRequest` adds the headers, sends JSON and checks the response shape. It combines
query cancellation with a 65-second timeout. Errors become `ApiError` objects with
a code, message, optional field errors and retry delay.

TanStack Query owns server data. Query keys include the user ID. Signing in or out
cancels reads and clears cached data, so one account does not see another's wallet.
A completed transfer refreshes wallet and history queries. A restriction change
refreshes the admin log.

Reads retry a server error once. Writes have no automatic retries. Pagination uses
the backend's `nextCursor`; the browser does not calculate an offset.

## Sessions and access

The backend returns a bearer token and user details. `AuthProvider` keeps them in
`sessionStorage`, which survives a reload in the same tab. If storage is unavailable,
the session stays in memory. Passwords are never saved.

A protected request returning `401` clears the matching session and sends the user
to sign-in. A late response from an old session does not sign out a newer session.
There is no refresh-token endpoint.

Route guards control which screens appear. They are not security checks: the backend
still checks ownership and current admin permissions. Browser storage is readable by
JavaScript, so it does not protect tokens from an XSS attack. Avoid raw HTML injection.

## Sending money safely

`TransferForm` validates the recipient and amount. Money calculations use `bigint`.
Naira entered in the form converts to a string of kobo: `1500.00` becomes `"150000"`.
Never convert money or database IDs through a JavaScript number.

`attempt.ts` compares transfer details and reads or saves the current attempt.
`useTransferAttempt.ts` manages review, sending and recovery:

1. Review creates a new UUID idempotency key.
2. Before sending, save the exact details and key under `wallet.transfer:<userId>`.
3. Send that key in the `Idempotency-Key` header.
4. On success, clear the attempt, show the receipt and refresh balances and history.
5. If the result is uncertain, keep the attempt and check it using the same key and body.

| Result | UI action |
| --- | --- |
| Network failure, `5xx`, invalid response or expired session | Keep the attempt unresolved; retry the same details and key |
| `429` | Wait for `Retry-After` and keep the key |
| Known rejection | Allow a new transfer with a new key |
| Success | Show the receipt and clear the saved attempt |

An unresolved transfer cannot be edited or discarded as if it failed. A timeout may
happen after the backend committed the transfer. Reusing the key asks for the saved
result without paying twice. Sending is disabled if the attempt cannot be saved.

Recovery works across navigation, reloads and signing back into the same account in
the same tab. Closing the tab or clearing storage loses the local recovery record.
Check transaction history before starting another payment in that case.

Public wallet IDs start with `wlt_`. Numeric IDs remain supported for older API
responses and saved attempts. Never replace the body or key of an older attempt.

## Forms, loading and errors

React Hook Form manages forms; Zod validates input. Frontend validation gives quick
feedback, while backend validation remains authoritative. Password guidance should
be plain language and must not claim rules the server does not enforce.

Use the installed libraries and shared components:

| Tool | Use |
| --- | --- |
| `LoadingButton` | Pending label and disabled submit button |
| `react-loading-skeleton` | Placeholders while screen data loads |
| `framer-motion` | Page transitions; respects reduced motion |
| `sonner` | Short success or failure notifications |
| `ApiFeedback` | Request errors and field feedback |
| `useRetryAfter` | Countdown for login, registration and admin rate limits |

Request IDs stay available for diagnostics in `ApiError`; they do not appear in
alerts or toasts. Use clear messages and keep a way to retry safe reads. A delayed
request is not proof that it failed.

## Adding a screen

Start with the backend contract in [api.md](api.md). Add its response schema to
`src/api/contracts.ts` and its hook to the relevant API file. Build the screen in
`pages/` and keep any form beside its workflow in `forms/`. Add the route, navigation
and browser coverage. Reuse existing loading, error and motion components.

Do not copy query data into a second state store or add a generic framework for one
screen. Keep data conversion in pure helpers so it can be checked on its own.

## Checks and deployment

From `frontend/`:

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

On Windows, installed Edge can run the tests:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm test
```

Browser tests start a separate Vite server on port 3012. They intercept API requests
with fixtures, covering screens, errors, sessions, retries and account isolation.
They do not prove database concurrency or production response times; backend tests
cover the database rules.

Deploy `dist/` after setting the production `VITE_API_BASE_URL` at build time. Configure
the host to serve `index.html` for application routes so refreshing a receipt page
works. Add the deployed frontend origin to backend CORS. Never put a token or password
in a `VITE_` variable.
