# Wallet Service

I built this NGN wallet application to support account creation, transfers and
admin account restrictions. The backend uses Express, Prisma and PostgreSQL; the
frontend uses React and Vite.

The main requirement is that a payment stays correct when requests arrive together
or a client retries after losing the response. I keep the financial work in one
database transaction and preserve the payment key across retries. The decision
guides explain how those guarantees fit the implementation.

## Start locally

Use Node 22.18 or later in the 22.x line and a development PostgreSQL database.

```sh
cd server
npm ci
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Set `DATABASE_URL` and a random
`JWT_SECRET` in `.env`, then run:

```sh
npm run migrate
npm run seed
npm run dev
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3001. The API uses http://localhost:3000 by default.

**Live frontend**: [walletintegration.vercel.app](https://walletintegration.vercel.app/)

**Live API**: [walletintegration-6t6r.onrender.com](https://walletintegration-6t6r.onrender.com/)

## What it does

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | The process answers |
| `GET` | `/health/ready` | The database is reachable |
| `POST` | `/auth/register` | Create a user and their wallet |
| `POST` | `/auth/login` | Exchange credentials for a JWT |
| `GET` | `/wallets/me` | The caller's wallet and balance |
| `POST` | `/transfers` | Move money. Requires an `Idempotency-Key` header |
| `GET` | `/transfers` | The caller's transfers, keyset paginated |
| `GET` | `/transfers/:id` | One transfer the caller is party to |
| `POST` | `/admin/users/:id/block` | Block an account. Requires a reason |
| `POST` | `/admin/users/:id/unblock` | Lift a block. Requires a reason |
| `GET` | `/admin/audit` | The admin action trail |

Money is whole kobo and crosses the API as a string. `"150000"` means NGN 1,500.
Public wallet IDs start with `wlt_`; older numeric IDs remain supported.

## Transfer rules

I lock users and wallets before checking balances and restrictions.
The transfer, debit, credit, balance updates and saved response commit together.
Customer balances cannot go negative. Only the wallet owner can send its funds.

Every transfer request needs an `Idempotency-Key`. Repeating the same request with
that key returns its saved answer without moving money again. After a timeout or
uncertain result, keep the same details and key. A new key means a new payment.

Database triggers reject updates and deletes on financial history. A restricted
application database role is still needed to prevent bypassing those protections.

## Demo accounts

The seed creates these fixtures. Their public passwords are for demonstrations,
not real funds.

| Account | Password | Holds | Use for |
| --- | --- | --- | --- |
| `ada@example.com` | `demo-password-2026` | NGN 500,000 | The funded sender |
| `bode@example.com` | `demo-password-2026` | NGN 250,000 | The recipient |
| `chidi@example.com` | `demo-password-2026` | NGN 10 | Insufficient funds |
| `admin@wallet.internal` | not published | NGN 0 | Admin endpoints |
| `fraudster@example.com` | no account | | Blacklisted. Registration refuses it |

Set `SEED_ADMIN_PASSWORD` before seeding a non-local database. The seed preserves an
existing admin password. `npm run admin:password` changes it explicitly. Demo customer
passwords reset on each seed run; repeat funding does not change balances.

## Check the project

From `server/`:

```sh
npm run typecheck
npm run build
npm run verify:prisma
```

Verification creates a temporary schema on a development database and removes it
afterward. `npm run test:unit` needs no database. Direct `npm test` runs require a
prepared test schema in `TEST_DATABASE_URL`.

From `frontend/`, run `npm run build` and `npm test`. Install a Playwright browser or
use installed Edge. Browser tests use intercepted API responses.

## Deployment

The API runs on Render from `server/`, with its configuration in
[`render.yaml`](render.yaml). I deploy the Vite frontend separately on Vercel from
`frontend/`. The frontend needs the public API URL at build time and its deployed
origin in the API's CORS allowlist. [The deployment guide](docs/deployment.md)
covers the settings and route handling. The frontend is available at
[walletintegration.vercel.app](https://walletintegration.vercel.app/).

## Read next

| Document | Covers |
| --- | --- |
| [Backend structure](docs/architecture.md) | Folders, responsibilities and request flow |
| [Money and account rules](docs/domain.md) | Transfers, restrictions and recovery |
| [API contract](docs/api.md) | Endpoints, response shapes and errors |
| [Frontend guide](docs/frontend.md) | Screens, forms, API hooks, sessions and loading |
| [Server decisions](docs/server-decisions.md) | Why I chose the money, locking, security and database rules |
| [Frontend decisions](docs/frontend-decisions.md) | Why I chose the screen structure, API hooks and recovery workflow |
| [Known limits](docs/known-limitations.md) | Security and scaling boundaries |
| [Prisma workflow](docs/prisma.md) | Migrations, seeding and test isolation |
| [Deployment](docs/deployment.md) | Hosting configuration and release checks |
| [Contributing](CONTRIBUTING.md) | Branches, commits and code conventions |

Import [the Postman collection](docs/wallet-service.postman_collection.json) to try
the API. Keep credentials out of Git. Private project guidance stays local.
