# Frontend

The wallet UI. React 19 on Vite. React Router for the screens, TanStack Query for anything that
comes from the server, react-hook-form with Zod for the forms, Tailwind 4 and shadcn/ui for the
styling.

```sh
npm install
cp .env.example .env
npm run dev          # http://localhost:3001
npm run typecheck    # tsc -b
npm run build        # tsc -b && vite build, output in dist/
```

The API lives in `../server` and is the contract. The server depends on nothing here.

## Not wired to the API yet

Every screen reads through `src/api/`. Those hooks call `src/api/demoWorkspace.ts`, an
in-memory stand-in that holds the fixtures and mimics the server's refusals. It is the only
file here with fake data in it.

Connecting the real API replaces that file and the bodies of the `api/` hooks. No screen, form
or component changes.

Sign-in is disabled rather than faked. Storing a token is part of that work, and a login form
that looks real and does nothing is worse than one that says so.

## Layout

```
src/
  main.tsx              providers: Router, QueryClient, Workspace
  AppRoutes.tsx         every screen URL, and the admin guard
  App.css               Tailwind 4 theme and the few component classes
  api/                  one file per resource, exporting useXxx hooks
  components/           shared pieces. ui/ holds the shadcn primitives
  forms/<name>-form/    one folder per form: its Zod schema and its fields
  hooks/                logic worth naming on its own
  layouts/Layout.tsx    sidebar, top bar, footer, toaster
  lib/                  money.ts and the cn() helper
  pages/                one file per screen, rendering and nothing else
```

A page reads hooks and renders. It does not fetch and it never holds server data in `useState`.
That is what the query cache is for. A completed transfer invalidates the wallet and the
transfer list, and every screen showing either updates.

## Two conventions from the server

Money is a string of minor units. `"150000"` is NGN 1,500.00. Arithmetic uses `BigInt`, never
`Number`, because a JSON number is a float and loses precision at scale. `lib/money.ts`
converts for display and for input. Nothing else formats money.

Every error carries a request id. The API returns it in `X-Request-Id` and repeats it in
`error.requestId`. The transfer dialog shows it on a failure so a report can be traced to a log
line.

## The Idempotency-Key

`hooks/useTransferAttempt.ts` holds it. One key per set of details the user authorized.

Pressing Confirm again after a failure reuses the key. The server recognizes it and returns the
first outcome instead of moving money twice.

Editing the amount or the recipient discards it. That is a different transfer, and reusing the
key would make the server replay the old one.

Wrong in either direction is a real bug, which is why it lives in one named place rather than
spread across the form and the dialog.

An unconfirmed outcome is not a failure. The server answers `503` when it cannot say whether
the transfer committed. The key is kept and the button becomes Check status, because pressing
it asks about the same key rather than sending again.

A `409` is the opposite. The key is spent on different details and can never succeed, so the
only offer is a new transfer.

## Deployment

`npm run build` produces static files in `dist/`, so this deploys as a static site with no Node
process.

`VITE_API_BASE_URL` points at the API. That origin must appear in the server's `CORS_ORIGINS`
or the browser blocks every response. See [../docs/deployment.md](../docs/deployment.md).

Vite exposes only variables prefixed `VITE_` to the browser. Anything in `.env` is public once
the app is built, so no secret belongs there.
