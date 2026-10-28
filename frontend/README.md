# Frontend

The wallet UI. React 19 on Vite, React Router for the screens, TanStack Query for everything
that comes from the server, react-hook-form with Zod for the forms, Tailwind 4 and shadcn/ui
for the styling.

```sh
npm install
cp .env.example .env
npm run dev          # http://localhost:3001
npm run typecheck    # tsc -b
npm run build        # tsc -b && vite build  →  dist/
```

The API lives in `../server` and is the contract. The server never depends on anything here.

## Not wired to the API yet

Every screen reads through `src/api/`, and those hooks currently call `src/api/demoWorkspace.ts`
— an in-memory stand-in that holds the fixtures and mimics the server's refusals. **That is the
only file in this project with fake data in it.**

The point of the arrangement is that connecting the real API replaces `demoWorkspace.ts` and the
bodies of the `api/` hooks, and touches no screen, form or component. Sign-in is deliberately
left disabled rather than faked, because storing a token is part of that work and a login form
that looks real but does nothing is worse than one that says so.

## Layout

```
src/
  main.tsx                  Providers: Router, QueryClient, Workspace
  AppRoutes.tsx             Every screen's URL, and the admin guard
  App.css                   Tailwind 4 theme, and the few component classes
  api/                      One file per resource, exporting useXxx hooks
  components/               Shared pieces, with ui/ holding the shadcn primitives
  forms/<name>-form/        One folder per form: its Zod schema and its fields
  hooks/                    Logic worth naming on its own
  layouts/Layout.tsx        Sidebar, top bar, footer, toaster
  lib/                      money.ts and the cn() helper
  pages/                    One file per screen, rendering and nothing else
```

A page reads hooks and renders. It does not fetch, and it never holds server data in
`useState` — that is what the query cache is for. A completed transfer invalidates the wallet
and the transfer list, and every screen showing either of them updates.

## Two things carried over from the server's design

- **Money is a string of minor units.** `"150000"` is NGN 1,500.00. Arithmetic uses `BigInt`
  and never `Number`, because a JSON number is a float and a large enough balance stops being
  exact. `lib/money.ts` converts for display and for input; nothing else formats money.
- **Every error carries a request ID.** The API returns it in `X-Request-Id` and repeats it in
  `error.requestId`. The transfer dialog shows it on a failure so a user's report can be traced
  to a log line.

## The Idempotency-Key, which is the one subtle thing here

`hooks/useTransferAttempt.ts` holds it, and the rule is one key per set of details the user
authorised:

- Pressing **Confirm** again after a failure **reuses** the key. That is what makes the retry
  safe — the server recognises it and returns the first outcome instead of moving money twice.
- **Editing the amount or the recipient discards** it, because that is a different transfer and
  reusing the key would make the server replay the old one.

Getting it wrong in either direction is a real bug, which is why it lives in one named place
instead of being spread across the form and the dialog.

An unconfirmed outcome is not a failure: the server answers `503` when it cannot say whether
the transfer committed, the key is kept, and the button changes to **Check status** because
pressing it asks about the same key rather than sending again. A `409` is the opposite — the key
is already spent on different details and can never succeed, so the only offer is a new
transfer.

## Deployment

`npm run build` produces static files in `dist/`, so this deploys as a static site with no Node
process. `VITE_API_BASE_URL` points at the API, and that origin has to appear in the server's
`CORS_ORIGINS` or the browser blocks every response — see `docs/deployment.md`.

Vite only exposes variables prefixed `VITE_` to the browser. Anything in `.env` is public once
the app is built, so no secret belongs there.
