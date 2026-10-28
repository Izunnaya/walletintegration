# Frontend

The UI design for the wallet service. **It runs on dummy data and talks to no API yet** — every
screen reads from `lib/wallet-demo.ts`, and the sign-in button is disabled and labelled as such.

Next.js App Router, Tailwind and shadcn/ui. It installs with **pnpm**, not npm; the server is a
separate package with its own npm lockfile.

```sh
cd frontend
pnpm install
pnpm dev          # http://localhost:3000
```

The server also defaults to port 3000, so run one at a time or give the API a different `PORT`.

## What is in it

One route. `app/page.tsx` renders `<WalletWorkspace />`, and every screen is a state transition
inside that component rather than a separate page:

```ts
type Screen = 'Overview' | 'Transfer' | 'Transactions' | 'User management' | 'Create account'
```

**Five screens in the sidebar:**

| Screen | Access | Holds |
| --- | --- | --- |
| Overview | Customer | Balance, wallet id with copy, status badge, money in and out, recent transactions |
| Transfer | Customer | From wallet read-only, recipient wallet id, amount, note, then a review step |
| Transactions | Customer | The full list |
| User management | Admin | Searchable user table, block and unblock per row |
| Create account | Admin | Name, email, password, creating the account and its wallet together |

**Five further views that are not in the nav:** the login preview and its session-expired variant,
the transfer receipt (which doubles as transfer detail), the transaction detail panel, the
block/unblock confirmation dialog, and the create-account success panel.

Three demo states layer on top of any screen through `viewState`: `Default`, `Loading` (skeletons)
and `Empty`.

## Two rules the API has already fixed

**Money is kobo, and it crosses the wire as a string.** `"150000"` means NGN 1,500. A JSON number is
an IEEE double, so a large amount would lose precision silently on the way out. The UI currently
takes a decimal naira amount (`inputMode="decimal"`, placeholder `0.00`) and formats through
`lib/money.ts`, so **wiring this up needs one conversion at the boundary** — naira to integer kobo on
the way in, kobo to display on the way out — and arithmetic must never run on a formatted value.

**Every response carries `X-Request-Id`, and every error repeats it as `error.requestId`.** Surface it
on an error screen. It is the value a user quotes when something fails, and it leads straight to the
server log line for that exact request.

## The demo response selector is not decoration

The Transfer screen has a "Demo response" dropdown listing the outcomes the API is built around:

- **Success / wallet validation (422)** — a business rule refusing a well-formed request
- **Unknown outcome, then successful retry** — the idempotency story. A lost response does not mean
  the transfer failed; retrying with the same `Idempotency-Key` returns the original result
- **409 Conflict** — the same key reused with different transfer details
- **429 Rate limited**
- **401 Session expired**

Those are worth building for real rather than removing. The unknown-outcome one is the entire reason
a transfer carries an idempotency key.

User management already says blacklist restrictions cannot be lifted from there, which matches the
rule that unblocking does not lift a blacklist.

## State of it

Design only: no API calls, no authentication, no routing between pages, no tests. Checked on import
rather than by building — every local import resolves and no package is imported without being
declared — but `pnpm install` and `next build` have not been run here.

The contract to build against is in [../docs/api.md](../docs/api.md), and the money and restriction
rules are in [../docs/domain.md](../docs/domain.md).
