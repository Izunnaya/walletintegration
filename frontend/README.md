# Wallet frontend

I built the wallet UI with React and Vite, following the structure from my
Restaurant project: screens, workflow forms and resource API hooks. The screens
match the API's account, wallet, transfer and admin operations.

I keep server data in TanStack Query, fields in React Hook Form and calculations
in pure helpers. Transfers have an explicit recovery workflow because losing a
response does not establish that the payment failed.

## Start

```sh
npm ci
# Copy .env.example to .env.local and set VITE_API_BASE_URL.
npm run dev
```

Open http://localhost:3001. The default API is http://localhost:3000. Restart Vite
after changing the URL and allow the frontend origin in backend CORS.

## Deploy

The frontend is a Render static site, built from this folder using
`npm ci && npm run build` and published from `./dist`. The second service in
[`render.yaml`](../render.yaml) records those settings.

`VITE_API_BASE_URL` is public build configuration, so changing it means rebuilding
the files. The API must allow the deployed frontend origin through `CORS_ORIGINS`.
The static rewrite serves `index.html` for application routes so refreshing
`/transfer` or a receipt URL works. The [deployment guide](../docs/deployment.md)
walks through these settings in order.

## Check

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

On Windows, set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` to use installed Edge.
Tests use a separate server and intercepted API responses; they do not send money
to the deployed service.

Read the [frontend guide](../docs/frontend.md) for the folder structure, screens,
API integration, sessions, transfer recovery, loading states and deployment.
The [API contract](../docs/api.md) explains the backend endpoints.

My [frontend decisions](../docs/frontend-decisions.md) cover the reasons and
tradeoffs behind this structure, sessions, validation and payment recovery.
