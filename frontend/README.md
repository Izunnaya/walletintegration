# Frontend

The wallet UI. React 19 on Vite, React Router for the screens, TanStack Query for everything
that comes from the server, react-hook-form with Zod for the forms, Tailwind 4 and shadcn/ui
for the styling, framer-motion for transitions, react-loading-skeleton for placeholders and
sonner for notifications.

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
  lib/                      money.ts, notify.ts, motion.ts and the cn() helper
  pages/                    One file per screen, rendering and nothing else
```

A page reads hooks and renders. It does not fetch, and it never holds server data in
`useState` — that is what the query cache is for. A completed transfer invalidates the wallet
and the transfer list, and every screen showing either of them updates.

## Motion, loading and notifications

Three conventions, each in one place, so none of them drift:

- **`lib/motion.ts`** holds every timing. Inconsistent motion reads as a bug even when nobody
  can say why. The rule is that money changing is the only thing on screen that should feel
  like an event; everything else gets a short fade and a few pixels of travel. Accessibility
  is set once in `main.tsx` — `MotionConfig reducedMotion="user"` drops transforms for anyone
  whose system asks for reduced motion, so no component can forget.
- **`components/LoadingStates.tsx`** holds placeholders shaped like the thing that is coming,
  so content fills a shape already on screen instead of pushing the page around. The
  `GlobalProgressBar` covers the other half: a background refetch, where the screen already
  has content and replacing it with skeletons would throw away what the user is reading.
- **`lib/notify.ts`** is the only place that raises a toast. It decides what a failure says
  (always with the request ID, which is what ties a user's report to a log line), what gets
  announced at all, and how long it stays. Validation belongs beside the field, not in a
  toast; a failure already visible in an open dialog is not repeated.

Table rows are deliberately **not** staggered — the transactions table re-renders on every
search keystroke, so a stagger would replay on each keypress.

## Bundle

Screens are split a chunk each with `React.lazy`, and the libraries are split out of the
entry in `vite.config.ts`. That is about caching more than size: app code changes every
deploy, React and framer-motion change a few times a year, and bundled together a one-line
fix invalidates all of it for every returning visitor.

Boot payload is around 186 kB gzipped, which is what it was before motion and skeletons were
added — the splitting paid for them.

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
