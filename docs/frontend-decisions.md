# Frontend decisions

I built the frontend around the actions the wallet API supports. These are the
choices behind the screens, API integration and transfer recovery. The
[frontend guide](frontend.md) explains the files and commands;
[server-decisions.md](server-decisions.md) explains the backend guarantees.

## 1. I organize code around screens and workflows

I followed the structure from my Restaurant frontend: screens in `pages/`, forms
under their workflow in `forms/`, and API hooks grouped by resource in `api/`.
Sending-money code stays close to the send-money screen instead of being spread
across general-purpose folders.

A page composes the screen and connects its actions. A form owns fields and
validation. Shared components cover real reuse, such as receipts, loading buttons
and error displays. I move workflow code into a shared folder when there is a
second use for it.

`useTransferAttempt` has a separate file because recovery needs state beyond ordinary
form submission. I kept it in the transfer workflow instead of building a general
workflow framework around one payment form.

## 2. I let the API contract define the screens

The app supports registration, login, the wallet overview, sending money, history,
receipts, account restrictions and the admin action log. Each screen has an endpoint
behind it. Registration creates a customer and wallet, then returns to login because
that endpoint does not issue a session token.

The API has no recipient lookup or user directory, so a sender enters a wallet ID
and an admin enters a user ID. Those identify different records. I do not display
a recipient name the backend has not supplied or offer a deposit action without
an endpoint that can complete it.

When the backend gains a capability, I can add its screen with a response contract,
API hook and the loading, success and failure states needed to use it.

## 3. I keep HTTP handling in one client

`apiRequest` handles shared HTTP work: JSON bodies, bearer headers, the idempotency
header, cancellation, timeouts and error parsing. Pages do not rebuild those rules
for every request.

Resource hooks describe the operation and its cache behavior. For example, sending
money refreshes wallet and history queries; changing a restriction refreshes the
admin log. A page uses the result without copying server records into another store.

I validate successful responses with Zod too. A `200` response with the wrong shape
is still unusable. For a transfer, an invalid response is uncertain because the
backend may already have committed the payment.

Code: `frontend/src/api/client.ts`, `frontend/src/api/contracts.ts`, `frontend/src/api/`.

## 4. I separate server data from local interaction state

TanStack Query owns balances, history, receipts and audit entries. Local React state
owns interactions such as whether confirmation is open. React Hook Form owns field
values and field errors.

This avoids two copies of a balance needing to stay synchronized. Query keys include
the signed-in user's ID, and session changes cancel reads and clear cached data.
An account switch should not briefly show the previous person's wallet.

History uses the API's returned cursor. The browser does not guess offsets or assume
no transfer was inserted while someone was reading the previous page.

## 5. I keep calculations pure and effects visible

Money conversion, input validation and transfer comparison receive values and return
a result. They can be checked without mounting a screen or starting a server.

Requests, browser storage and timers are effects. They stay in the API layer or
hooks where their lifecycle is visible. `attempt.ts` holds transfer-detail helpers
and the explicit storage boundary; `useTransferAttempt.ts` connects them to React
state and the request.

I do not force every function to be pure by hiding effects elsewhere. The aim is
to see which code calculates a value and which code changes something outside it.

## 6. I keep money and IDs exact in the browser

The form accepts naira, while the API accepts whole kobo. `toMinor` converts
`1500.25` into `"150025"` without floating-point multiplication. Formatting uses
integer values too. A large balance must not lose a kobo at the browser boundary.

Wallet and transfer IDs remain strings. Numeric keys can exceed JavaScript's safe
integer range. I prefer `wlt_` public wallet IDs for display and new transfers, while
keeping numeric compatibility for older responses and saved attempts.

Code: `frontend/src/lib/money.ts`, `frontend/src/lib/validation.ts`.

## 7. I match validation to the server

React Hook Form manages fields and submission. Zod checks email, wallet IDs, amounts
and password boundaries before sending. This gives quick feedback; the backend
repeats every rule because browser input is untrusted.

Password guidance stays readable. I can recommend a strong mix of characters, but
must not claim a particular mix is mandatory when the backend enforces length and
the bcrypt byte boundary. Technical UTF-8 wording does not belong in normal helper
text for someone creating an account.

I normalize email like the backend and keep the actual password unchanged. Silently
trimming a password would make login disagree with what the user typed.

## 8. I use the session contract the backend provides

The API returns a bearer token in JSON. It has no cookie session or refresh-token
endpoint, so `AuthProvider` stores the session in per-tab `sessionStorage`. It
survives reloads in that tab and is removed at sign-out. If storage is blocked,
login can work in memory for that page session. Passwords are never stored.

A protected `401` clears the session that made the request and sends the user to
login. The expiry event includes its token, so a late response from an old request
does not sign out a newer session.

Route guards decide which screen appears. The backend still checks ownership and
current admin access. A copied token remains useful until expiry, and JavaScript
can read tab storage, so this does not protect against XSS. An HttpOnly-cookie
session would require backend changes as well as frontend work.

Code: `frontend/src/auth/AuthProvider.tsx`, `frontend/src/AppRoutes.tsx`.

## 9. I create a payment key during review and save it before sending

Disabling a button reduces accidental clicks, but cannot prevent duplicate payments
after a timeout or reload. I rely on backend idempotency and make the frontend
preserve the identity of one payment attempt.

Reviewing details creates a UUID key. Before sending, I save the source, destination,
amount and key under `wallet.transfer:<userId>`. Only then does the request start.
If the tab reloads after commit but before the receipt arrives, the exact attempt
is still available to check.

If the attempt cannot be saved, I stop before sending. Login can work without
storage, but this payment workflow needs a recovery record. Saved details are
separated by user ID so another account does not inherit a pending transfer.

## 10. I keep an uncertain transfer unchanged

A network failure does not establish that no money moved. Neither does a server
error, invalid success response or expired session during the request. I keep the
attempt unresolved and check it with the same body and key. It cannot be edited
into a different payment while its outcome is unknown.

| Result | Frontend action |
| --- | --- |
| Success | Show receipt, clear attempt, refresh wallet and history |
| Known rejection | Allow a new attempt with a new key |
| `429` | Wait for `Retry-After` and keep the key |
| Network/server error or invalid response | Keep the attempt unresolved and reuse its details |
| Expired session | Sign in again and check that user's attempt |

Automatic mutation retries are disabled so recovery stays explicit. A new key means
a new payment to the server; it does not check the old one. Older numeric-wallet
attempts keep their original body and key too.

Closing the tab or clearing storage loses the browser record. Backend history and
saved results still exist, so history must be checked before starting another
payment if local recovery data is gone.

Code: `frontend/src/forms/transfer-form/attempt.ts`, `frontend/src/forms/transfer-form/useTransferAttempt.ts`.

## 11. I distinguish safe read retries from write retries

Repeating a read cannot create a payment or account action. Queries retry a server
error once, but do not automatically retry an expired session or a rate limit.
Login, registration, transfer and admin mutations have automatic retries disabled.

The client reads `Retry-After` and shows a countdown for rate-limited actions. Transfer
recovery retains its key while waiting. Requests combine query cancellation with
a 65-second timeout so a screen cannot wait indefinitely.

That timeout is a UI boundary, not a promise that backend work stopped. The transfer
remains unresolved when it fires. A slow-request notice explains the wait without
claiming a payment failed.

## 12. I use shared loading, error and motion components

`ApiFeedback` shows a useful message and field errors. Request IDs remain available
for diagnostics but stay out of login alerts and toasts. Users need to know what
action they can take, rather than see internal tracing data.

`LoadingButton` changes its label and disables submission while pending. Skeletons
preserve the rough layout during data loading. Sonner handles short notifications;
a receipt shows the full completed-transfer result.

I use Framer Motion for transitions and respect reduced motion. The layout captures
the route outlet for each transition so an outgoing screen does not mount the
incoming form again while it exits. Shared motion components keep this behavior
consistent across pages.

## 13. I deploy the frontend as static files

Vite builds the frontend into `dist/`. The API is a running Node process with a
database connection on Render. I deploy the frontend separately on Vercel, using
`frontend` as its project root and `dist` as the output directory.

`VITE_API_BASE_URL` is public build configuration. It ships in the JavaScript, so
changing it needs a rebuild and secrets must never go there. The API's CORS allowlist
must contain the frontend's actual origin.

React Router handles `/transfer` after loading, but a direct visit reaches the host
first. The static site needs an `index.html` rewrite for application routes. Without
it the homepage can work while refreshing a receipt fails. Settings and checks are
in [deployment.md](deployment.md).

## 14. I test browser workflows separately from database rules

Playwright covers routes, forms, errors, admin actions and transfer recovery across
reloads, navigation and session expiry. Tests use a separate Vite instance and
intercept API calls with backend-shaped fixtures.

This makes browser checks repeatable without submitting payments to the deployed
service. It does not establish PostgreSQL concurrency; server integration tests
cover that. Deployment checks still need the built UI, real API URL, CORS origin
and direct-route refreshes.

Code: `frontend/tests/wallet.spec.ts`, `frontend/playwright.config.ts`.
